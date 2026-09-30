import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const MAX_RATE_LIMIT_WAIT_MS = 5_000;
const MAX_ATTEMPTS = 3;
const rateLimitBodySchema = z.object({ retry_after: z.number().finite().nonnegative() });

interface DiscordRateLimitEvent {
  attempt: number;
  endpoint: string;
  method: string;
  retryAfterSeconds: number | undefined;
}

interface WaitBudget {
  deadline?: number;
}

const requestWaitBudget = new AsyncLocalStorage<WaitBudget>();

export function beginDiscordApiRequestWaitBudget(): void {
  requestWaitBudget.enterWith({});
}

export class DiscordRateLimitError extends Error {
  public readonly code = "discord_rate_limited";
  public readonly statusCode = 503;

  public constructor(public readonly retryAfterSeconds?: number) {
    super("discord_rate_limited");
    this.name = "DiscordRateLimitError";
  }
}

function secondsFromHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

async function retryAfterSeconds(response: Response): Promise<number | undefined> {
  const fromHeader = secondsFromHeader(response.headers.get("retry-after"));
  if (fromHeader !== undefined) {
    await response.body?.cancel();
    return fromHeader;
  }
  try {
    const body: unknown = await response.json();
    const result = rateLimitBodySchema.safeParse(body);
    return result.success ? result.data.retry_after : undefined;
  } catch {
    return undefined;
  }
}

function requestKey(input: RequestInfo | URL, init?: RequestInit): string {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  const authorization = headers.get("authorization") ?? "";
  const credentialHash = createHash("sha256").update(authorization).digest("hex");
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return `${credentialHash}:${method.toUpperCase()}:${url.pathname}`;
}

function globalKey(key: string): string {
  return `${key.slice(0, key.indexOf(":"))}:global`;
}

async function waitForCooldown(
  cooldowns: ReadonlyMap<string, number>,
  key: string,
  signal: AbortSignal | undefined,
  budget: WaitBudget,
): Promise<void> {
  const remainingMs =
    Math.max(cooldowns.get(key) ?? 0, cooldowns.get(globalKey(key)) ?? 0) - Date.now();
  if (remainingMs <= 0) return;
  budget.deadline ??= Date.now() + MAX_RATE_LIMIT_WAIT_MS;
  if (Date.now() + remainingMs > budget.deadline) {
    throw new DiscordRateLimitError(Math.ceil(remainingMs / 1_000));
  }
  await delay(remainingMs, undefined, { signal });
}

function rememberSuccessfulResponse(
  cooldowns: Map<string, number>,
  key: string,
  response: Response,
): void {
  if (response.headers.get("x-ratelimit-remaining") !== "0") return;
  const resetAfter = secondsFromHeader(response.headers.get("x-ratelimit-reset-after"));
  if (resetAfter !== undefined) cooldowns.set(key, Date.now() + resetAfter * 1_000);
}

function rememberRateLimit(
  cooldowns: Map<string, number>,
  key: string,
  response: Response,
  seconds: number,
): void {
  const isGlobal =
    response.headers.get("x-ratelimit-global") === "true" ||
    response.headers.get("x-ratelimit-scope") === "global";
  cooldowns.set(isGlobal ? globalKey(key) : key, Date.now() + seconds * 1_000);
}

async function handleRateLimit(
  response: Response,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  cooldowns: Map<string, number>,
  key: string,
  attempt: number,
  budget: WaitBudget,
  logRateLimit: ((event: DiscordRateLimitEvent) => void) | undefined,
): Promise<void> {
  const seconds = await retryAfterSeconds(response);
  const url = new URL(input instanceof Request ? input.url : String(input));
  logRateLimit?.({
    attempt: attempt + 1,
    endpoint: url.pathname,
    method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
    retryAfterSeconds: seconds,
  });
  if (seconds === undefined) throw new DiscordRateLimitError();
  rememberRateLimit(cooldowns, key, response, seconds);
  budget.deadline ??= Date.now() + MAX_RATE_LIMIT_WAIT_MS;
  if (attempt === MAX_ATTEMPTS - 1 || Date.now() + seconds * 1_000 > budget.deadline) {
    throw new DiscordRateLimitError(Math.ceil(seconds));
  }
}

export function createDiscordApiFetch(
  fetchImpl: typeof fetch,
  logRateLimit?: (event: DiscordRateLimitEvent) => void,
): typeof fetch {
  const cooldowns = new Map<string, number>();

  return async (input, init) => {
    const key = requestKey(input, init);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const budget = requestWaitBudget.getStore() ?? {};

    for (let attempt = 0; ; attempt += 1) {
      await waitForCooldown(cooldowns, key, signal, budget);

      const response = await fetchImpl(input, init);
      if (response.status !== 429) {
        rememberSuccessfulResponse(cooldowns, key, response);
        return response;
      }

      await handleRateLimit(response, input, init, cooldowns, key, attempt, budget, logRateLimit);
    }
  };
}
