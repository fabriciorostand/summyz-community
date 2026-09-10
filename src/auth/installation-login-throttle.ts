const FREE_FAILURES = 2;
const MAX_DELAY_SECONDS = 300;
const MAX_TRACKED_CLIENTS = 10_000;

export class InstallationLoginThrottleError extends Error {
  public constructor(public readonly retryAfterSeconds: number) {
    super("login_rate_limited");
    this.name = "InstallationLoginThrottleError";
  }
}

export class InstallationLoginThrottle {
  readonly #attempts = new Map<string, { failures: number; lockedUntil: number }>();
  readonly #now: () => number;

  public constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  public check(key: string): void {
    const attempt = this.#attempts.get(key);
    if (attempt === undefined) return;
    const remainingMs = attempt.lockedUntil - this.#now();
    if (remainingMs > 0) {
      throw new InstallationLoginThrottleError(Math.ceil(remainingMs / 1_000));
    }
  }

  public recordFailure(key: string): void {
    if (!this.#attempts.has(key) && this.#attempts.size >= MAX_TRACKED_CLIENTS) {
      const oldestKey = this.#attempts.keys().next().value;
      if (typeof oldestKey === "string") this.#attempts.delete(oldestKey);
    }
    const failures = (this.#attempts.get(key)?.failures ?? 0) + 1;
    const delaySeconds =
      failures <= FREE_FAILURES
        ? 0
        : Math.min(2 ** (failures - FREE_FAILURES - 1), MAX_DELAY_SECONDS);
    this.#attempts.set(key, {
      failures,
      lockedUntil: this.#now() + delaySeconds * 1_000,
    });
  }

  public recordSuccess(key: string): void {
    this.#attempts.delete(key);
  }
}
