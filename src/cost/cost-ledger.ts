import { z } from "zod";

import type { RecordingManifest } from "../recording/manifest.js";

export const costPhaseSchema = z.enum(["transcription", "refinement", "summary"]);
export type CostPhase = z.infer<typeof costPhaseSchema>;

export const financialStatusSchema = z.enum([
  "pending",
  "confirmed",
  "unattributed",
  "not_applicable",
]);
export type FinancialStatus = z.infer<typeof financialStatusSchema>;

const storageIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const decimalAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "O custo deve ser um decimal não negativo");

export const costMeetingRecordSchema = z.object({
  completedAt: z.iso.datetime().nullable(),
  guildId: storageIdentifierSchema,
  meetingId: storageIdentifierSchema,
  startedAt: z.iso.datetime(),
});

export const costAttemptSchema = z
  .object({
    attemptId: storageIdentifierSchema,
    confirmationSource: z.enum(["response", "generation"]).nullable(),
    cost: decimalAmountSchema.nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    endedAt: z.iso.datetime().nullable(),
    execution: z.enum(["api", "local"]),
    financialStatus: financialStatusSchema,
    generationId: z.string().min(1).max(256).nullable(),
    guildId: storageIdentifierSchema,
    meetingId: storageIdentifierSchema,
    model: z.string().min(1).max(256).nullable(),
    outcome: z.enum(["pending", "success", "failure"]),
    phase: costPhaseSchema,
    provider: z.string().min(1).max(100),
    startedAt: z.iso.datetime(),
  })
  .superRefine((attempt, context) => {
    if (attempt.financialStatus === "confirmed") {
      if (attempt.cost === null || attempt.currency === null) {
        context.addIssue({
          code: "custom",
          message: "Confirmed costs require amount and currency",
        });
      }
    } else if (attempt.cost !== null || attempt.currency !== null) {
      context.addIssue({ code: "custom", message: "Unconfirmed costs cannot contain an amount" });
    }
    if (attempt.execution === "local" && attempt.financialStatus !== "not_applicable") {
      context.addIssue({ code: "custom", message: "Local execution has no external cost" });
    }
    if (attempt.outcome === "pending" && attempt.endedAt !== null) {
      context.addIssue({ code: "custom", message: "Pending attempts cannot have an end time" });
    }
    if (attempt.outcome !== "pending" && attempt.endedAt === null) {
      context.addIssue({ code: "custom", message: "Finished attempts require an end time" });
    }
  });

export type CostMeetingRecord = z.infer<typeof costMeetingRecordSchema>;
export type CostAttempt = z.infer<typeof costAttemptSchema>;

export interface CostMeetingWithAttempts {
  attempts: CostAttempt[];
  meeting: CostMeetingRecord;
}

export interface CostMeetingRange {
  endedBefore: string;
  startedAtOrAfter: string;
}

export interface CostLedgerStore {
  getMeeting(guildId: string, meetingId: string): Promise<CostMeetingWithAttempts | undefined>;
  listMeetings(guildId: string, range: CostMeetingRange): Promise<CostMeetingWithAttempts[]>;
  saveAttempt(attempt: CostAttempt): Promise<void>;
  saveMeeting(manifest: RecordingManifest): Promise<void>;
}

interface CreateCostAttemptInput {
  attemptId: string;
  execution: CostAttempt["execution"];
  guildId: string;
  meetingId: string;
  model: string | null;
  phase: CostPhase;
  provider: string;
  startedAt: string;
}

export function createCostAttempt(input: CreateCostAttemptInput): CostAttempt {
  return costAttemptSchema.parse({
    ...input,
    confirmationSource: null,
    cost: null,
    currency: null,
    endedAt: null,
    financialStatus: input.execution === "local" ? "not_applicable" : "pending",
    generationId: null,
    outcome: "pending",
  });
}

type FinishCostAttemptInput = Pick<CostAttempt, "endedAt" | "financialStatus" | "outcome"> &
  Partial<Pick<CostAttempt, "confirmationSource" | "cost" | "currency" | "generationId" | "model">>;

export function finishCostAttempt(
  attempt: CostAttempt,
  input: FinishCostAttemptInput,
): CostAttempt {
  return costAttemptSchema.parse({
    ...attempt,
    ...input,
    confirmationSource: input.confirmationSource ?? null,
    cost: input.cost ?? null,
    currency: input.currency ?? null,
    generationId: input.generationId ?? attempt.generationId,
    model: input.model ?? attempt.model,
  });
}

export function toCostMeetingRecord(manifest: RecordingManifest): CostMeetingRecord {
  return costMeetingRecordSchema.parse({
    completedAt: manifest.completedAt ?? null,
    guildId: manifest.guildId,
    meetingId: manifest.meetingId,
    startedAt: manifest.startedAt,
  });
}

export function addDecimalAmounts(amounts: readonly string[]): string {
  if (amounts.length === 0) return "0";
  const parsed = amounts.map(parseDecimal);
  const scale = Math.max(...parsed.map((value) => value.scale));
  const total = parsed.reduce(
    (sum, value) => sum + value.coefficient * 10n ** BigInt(scale - value.scale),
    0n,
  );
  return formatDecimal(total, scale);
}

export function isPositiveDecimal(amount: string): boolean {
  return parseDecimal(amount).coefficient > 0n;
}

export function multiplyDecimal(amount: string, multiplier: number): string {
  if (!Number.isSafeInteger(multiplier) || multiplier < 0) {
    throw new Error("O multiplicador do custo deve ser um inteiro não negativo");
  }
  const value = parseDecimal(amount);
  return formatDecimal(value.coefficient * BigInt(multiplier), value.scale);
}

export function divideDecimal(amount: string, divisor: number, precision = 12): string {
  if (!Number.isInteger(divisor) || divisor <= 0) {
    throw new Error("O divisor do custo médio deve ser positivo");
  }
  const value = parseDecimal(amount);
  const integerDivisor = BigInt(divisor);
  const integerPart = value.coefficient / (10n ** BigInt(value.scale) * integerDivisor);
  let remainder = value.coefficient % (10n ** BigInt(value.scale) * integerDivisor);
  const denominator = 10n ** BigInt(value.scale) * integerDivisor;
  let fraction = "";
  for (let index = 0; index < precision && remainder !== 0n; index += 1) {
    remainder *= 10n;
    fraction += String(remainder / denominator);
    remainder %= denominator;
  }
  const suffix = remainder === 0n ? "" : "…";
  return fraction.length === 0
    ? String(integerPart)
    : `${String(integerPart)}.${fraction}${suffix}`;
}

export function decimalAmountFromNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid provider cost");
  return decimalAmountFromProviderText(String(value));
}

export function decimalAmountFromProviderText(text: string): string {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (match === null || text.length > 256) throw new Error("Invalid provider cost");
  const integer = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1_000) {
    throw new Error("Invalid provider cost");
  }
  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + exponent;
  const coefficient =
    decimalPosition >= digits.length
      ? BigInt(digits) * 10n ** BigInt(decimalPosition - digits.length)
      : BigInt(digits);
  const scale = Math.max(0, digits.length - decimalPosition);
  return formatDecimal(coefficient, scale);
}

function parseDecimal(value: string): { coefficient: bigint; scale: number } {
  const parsed = decimalAmountSchema.parse(value);
  const [integer, fraction = ""] = parsed.split(".");
  return { coefficient: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

function formatDecimal(coefficient: bigint, scale: number): string {
  if (scale === 0) return String(coefficient);
  const digits = String(coefficient).padStart(scale + 1, "0");
  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}
