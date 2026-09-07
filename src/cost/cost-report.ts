import type { AppConfig } from "../config.js";
import {
  addDecimalAmounts,
  type CostAttempt,
  type CostLedgerStore,
  type CostMeetingWithAttempts,
  type CostPhase,
  divideDecimal,
  isPositiveDecimal,
  multiplyDecimal,
} from "./cost-ledger.js";

export type CostReportErrorCode = "invalid_period" | "meeting_in_progress" | "meeting_not_found";

export class CostReportError extends Error {
  public readonly code: CostReportErrorCode;

  public constructor(code: CostReportErrorCode) {
    super(code);
    this.name = "CostReportError";
    this.code = code;
  }
}

interface CostReportServiceOptions {
  language: AppConfig["botLanguage"];
  reconcile?: (guildId: string) => Promise<void>;
  store: Pick<CostLedgerStore, "getMeeting" | "listMeetings">;
  timeZone: string;
}

export function createCostReportService(options: CostReportServiceOptions) {
  return new CostReportService(options);
}

export class CostReportService {
  readonly #language: AppConfig["botLanguage"];
  readonly #reconcile: ((guildId: string) => Promise<void>) | undefined;
  readonly #store: CostReportServiceOptions["store"];
  readonly #timeZone: string;

  public constructor(options: CostReportServiceOptions) {
    this.#language = options.language;
    this.#reconcile = options.reconcile;
    this.#store = options.store;
    this.#timeZone = options.timeZone;
  }

  public async meeting(guildId: string, meetingId: string): Promise<string> {
    await this.#reconcile?.(guildId);
    const data = await this.#store.getMeeting(guildId, meetingId);
    if (data === undefined) throw new CostReportError("meeting_not_found");
    if (data.meeting.completedAt === null) throw new CostReportError("meeting_in_progress");
    return formatMeeting(data, this.#language, this.#timeZone);
  }

  public async period(guildId: string, from: string, to: string): Promise<string> {
    await this.#reconcile?.(guildId);
    const range = parseDateRange(from, to, this.#timeZone);
    const meetings = await this.#store.listMeetings(guildId, range);
    return formatPeriod(
      meetings.filter((meeting) => meeting.meeting.completedAt !== null),
      from,
      to,
      this.#language,
    );
  }
}

function formatMeeting(
  data: CostMeetingWithAttempts,
  language: AppConfig["botLanguage"],
  timeZone: string,
): string {
  const completedAt = data.meeting.completedAt;
  if (completedAt === null) throw new CostReportError("meeting_in_progress");
  const locale = language === "pt-BR" ? "pt-BR" : "en-US";
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  });
  const dateParts = Object.fromEntries(
    dateFormatter
      .formatToParts(new Date(data.meeting.startedAt))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const date =
    language === "pt-BR"
      ? `${dateParts.day}/${dateParts.month}/${dateParts.year} ${dateParts.hour}:${dateParts.minute}`
      : `${dateParts.month}/${dateParts.day}/${dateParts.year} ${dateParts.hour}:${dateParts.minute}`;
  const duration = formatDuration(
    new Date(completedAt).getTime() - new Date(data.meeting.startedAt).getTime(),
  );
  const sections = (["transcription", "refinement", "summary", "translation"] as const).map(
    (phase) =>
      formatPhase(
        phase,
        data.attempts.filter((attempt) => attempt.phase === phase),
        language,
      ),
  );
  const confirmed = confirmedCosts(data.attempts);
  const pending = data.attempts.filter((attempt) => attempt.financialStatus === "pending").length;
  const unattributed = data.attempts.filter(
    (attempt) => attempt.financialStatus === "unattributed",
  ).length;
  const chargedFailures = data.attempts.filter(
    (attempt) =>
      attempt.outcome === "failure" &&
      attempt.cost !== null &&
      attempt.financialStatus === "confirmed" &&
      isPositiveDecimal(attempt.cost),
  );
  const failureCost = addDecimalAmounts(
    chargedFailures.flatMap((attempt) => (attempt.cost === null ? [] : [attempt.cost])),
  );
  const lines =
    language === "pt-BR"
      ? [
          `Reunião: \`${data.meeting.meetingId}\``,
          `Data: ${date}`,
          `Duração: ${duration}`,
          "",
          ...sections,
          `Total confirmado: USD ${confirmed}`,
          "",
          `Tentativas cobradas com falha: ${String(chargedFailures.length)} — USD ${failureCost}`,
          `Reconciliações pendentes: ${String(pending)}`,
          `Não foi possível confirmar automaticamente: ${String(unattributed)}`,
        ]
      : [
          `Meeting: \`${data.meeting.meetingId}\``,
          `Date: ${date}`,
          `Duration: ${duration}`,
          "",
          ...sections,
          `Confirmed total: USD ${confirmed}`,
          "",
          `Charged failed attempts: ${String(chargedFailures.length)} — USD ${failureCost}`,
          `Pending reconciliations: ${String(pending)}`,
          `Could not be confirmed automatically: ${String(unattributed)}`,
        ];
  if (pending + unattributed > 0) lines.push("", friendlyWarning(language, pending, unattributed));
  return lines.join("\n");
}

function formatPhase(
  phase: CostPhase,
  attempts: readonly CostAttempt[],
  language: AppConfig["botLanguage"],
): string {
  const label = phaseLabels[language][phase];
  if (attempts.length === 0) {
    return `${label}\n${language === "pt-BR" ? "Sem execuções registradas" : "No recorded executions"}\n`;
  }
  const details: string[] = [label];
  for (const group of groupAttempts(attempts, language).values()) {
    details.push(...formatAttemptGroup(group, language));
  }
  return `${details.join("\n")}\n`;
}

function groupAttempts(
  attempts: readonly CostAttempt[],
  language: AppConfig["botLanguage"],
): Map<string, CostAttempt[]> {
  const groups = new Map<string, CostAttempt[]>();
  for (const attempt of attempts) {
    const model = attempt.model ?? missingModelLabel(language);
    const key = `${attempt.execution}:${attempt.provider}:${model}`;
    groups.set(key, [...(groups.get(key) ?? []), attempt]);
  }
  return groups;
}

function formatAttemptGroup(
  group: readonly CostAttempt[],
  language: AppConfig["botLanguage"],
): string[] {
  const first = group[0];
  if (first === undefined) return [];
  const execution = first.execution === "api" ? `API — ${first.provider}` : "Local";
  const details = [
    `${language === "pt-BR" ? "Execução" : "Execution"}: ${execution}`,
    `${language === "pt-BR" ? "Modelo" : "Model"}: ${first.model ?? missingModelLabel(language)}`,
  ];
  if (first.execution !== "api") return details;
  return [
    ...details,
    `${language === "pt-BR" ? "Requisições" : "Requests"}: ${String(group.length)}`,
    `${language === "pt-BR" ? "Custo confirmado" : "Confirmed cost"}: USD ${confirmedCosts(group)}`,
  ];
}

function missingModelLabel(language: AppConfig["botLanguage"]): string {
  return language === "pt-BR" ? "Não informado" : "Not reported";
}

function formatPeriod(
  meetings: readonly CostMeetingWithAttempts[],
  from: string,
  to: string,
  language: AppConfig["botLanguage"],
): string {
  const attempts = meetings.flatMap((meeting) => meeting.attempts);
  const apiAttempts = attempts.filter((attempt) => attempt.execution === "api");
  const localAttempts = attempts.filter((attempt) => attempt.execution === "local");
  const apiMeetings = meetings.filter((meeting) =>
    meeting.attempts.some((attempt) => attempt.execution === "api"),
  );
  const totalDurationMs = meetings.reduce((sum, item) => {
    if (item.meeting.completedAt === null) return sum;
    return (
      sum +
      (new Date(item.meeting.completedAt).getTime() - new Date(item.meeting.startedAt).getTime())
    );
  }, 0);
  const total = confirmedCosts(apiAttempts);
  const charged = apiAttempts.filter(
    (attempt) => attempt.cost !== null && isPositiveDecimal(attempt.cost),
  );
  const chargedFailures = charged.filter((attempt) => attempt.outcome === "failure");
  const pending = apiAttempts.filter((attempt) => attempt.financialStatus === "pending").length;
  const unattributed = apiAttempts.filter(
    (attempt) => attempt.financialStatus === "unattributed",
  ).length;
  const period = `${displayDate(from)}–${displayDate(to)}`;
  const phaseLines = (["transcription", "refinement", "summary", "translation"] as const).map(
    (phase) => {
      const selected = apiAttempts.filter((attempt) => attempt.phase === phase);
      return `${phaseLabels[language][phase]}: ${String(selected.length)} ${language === "pt-BR" ? "requisições" : "requests"} — USD ${confirmedCosts(selected)}`;
    },
  );
  const average = apiMeetings.length === 0 ? "0" : divideDecimal(total, apiMeetings.length);
  const apiDurationMs = apiMeetings.reduce((sum, item) => {
    if (item.meeting.completedAt === null) return sum;
    return (
      sum +
      (new Date(item.meeting.completedAt).getTime() - new Date(item.meeting.startedAt).getTime())
    );
  }, 0);
  const hourlyAverage =
    apiDurationMs === 0 ? "0" : divideDecimal(multiplyDecimal(total, 3_600_000), apiDurationMs);
  const lines =
    language === "pt-BR"
      ? [
          `Período: ${period}`,
          "",
          `Reuniões: ${String(meetings.length)}`,
          `Reuniões com uso de API: ${String(apiMeetings.length)}`,
          `Reuniões somente locais: ${String(meetings.length - apiMeetings.length)}`,
          `Duração total: ${formatDuration(totalDurationMs)}`,
          `Duração média: ${formatDuration(meetings.length === 0 ? 0 : totalDurationMs / meetings.length)}`,
          "",
          `Requisições aos provedores: ${String(apiAttempts.length)}`,
          `Requisições cobradas: ${String(charged.length)}`,
          `Requisições cobradas com falha: ${String(chargedFailures.length)}`,
          `Execuções locais: ${String(localAttempts.length)}`,
          "",
          ...phaseLines,
          `Total confirmado: USD ${total}`,
          "",
          `Custo externo médio confirmado por reunião com uso de API: USD ${average}`,
          `Custo externo médio confirmado por hora de reunião com uso de API: USD ${hourlyAverage}`,
          "",
          `Reconciliações pendentes: ${String(pending)}`,
          `Não foi possível confirmar automaticamente: ${String(unattributed)}`,
        ]
      : [
          `Period: ${period}`,
          "",
          `Meetings: ${String(meetings.length)}`,
          `Meetings using an API: ${String(apiMeetings.length)}`,
          `Local-only meetings: ${String(meetings.length - apiMeetings.length)}`,
          `Total duration: ${formatDuration(totalDurationMs)}`,
          `Average duration: ${formatDuration(meetings.length === 0 ? 0 : totalDurationMs / meetings.length)}`,
          "",
          `Provider requests: ${String(apiAttempts.length)}`,
          `Charged requests: ${String(charged.length)}`,
          `Charged failed requests: ${String(chargedFailures.length)}`,
          `Local executions: ${String(localAttempts.length)}`,
          "",
          ...phaseLines,
          `Confirmed total: USD ${total}`,
          "",
          `Average confirmed external cost per meeting using an API: USD ${average}`,
          `Average confirmed external cost per meeting hour using an API: USD ${hourlyAverage}`,
          "",
          `Pending reconciliations: ${String(pending)}`,
          `Could not be confirmed automatically: ${String(unattributed)}`,
        ];
  if (pending + unattributed > 0) lines.push("", friendlyWarning(language, pending, unattributed));
  return lines.join("\n");
}

function confirmedCosts(attempts: readonly CostAttempt[]): string {
  return addDecimalAmounts(
    attempts.flatMap((attempt) =>
      attempt.financialStatus === "confirmed" && attempt.cost !== null ? [attempt.cost] : [],
    ),
  );
}

function friendlyWarning(
  language: AppConfig["botLanguage"],
  pending: number,
  unattributed: number,
): string {
  if (language === "en") {
    return `⚠️ Some attempts do not yet have a cost confirmed by OpenRouter. The displayed total includes confirmed values only and may increase. Under verification: ${String(pending)}. Could not be confirmed automatically: ${String(unattributed)}.`;
  }
  return `⚠️ Algumas tentativas ainda não têm o custo confirmado pelo OpenRouter. O total exibido considera somente valores já confirmados e pode aumentar. Em verificação: ${String(pending)}. Não foi possível confirmar automaticamente: ${String(unattributed)}.`;
}

function parseDateRange(from: string, to: string, timeZone: string) {
  const start = parseCalendarDate(from);
  const end = parseCalendarDate(to);
  if (compareCalendarDates(start, end) > 0) throw new CostReportError("invalid_period");
  const nextDay = new Date(Date.UTC(end.year, end.month - 1, end.day + 1));
  return {
    endedBefore: zonedMidnightToUtc(
      {
        day: nextDay.getUTCDate(),
        month: nextDay.getUTCMonth() + 1,
        year: nextDay.getUTCFullYear(),
      },
      timeZone,
    ).toISOString(),
    startedAtOrAfter: zonedMidnightToUtc(start, timeZone).toISOString(),
  };
}

interface CalendarDate {
  day: number;
  month: number;
  year: number;
}

function parseCalendarDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) throw new CostReportError("invalid_period");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new CostReportError("invalid_period");
  }
  return { day, month, year };
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  return (
    Date.UTC(left.year, left.month - 1, left.day) - Date.UTC(right.year, right.month - 1, right.day)
  );
}

function zonedMidnightToUtc(date: CalendarDate, timeZone: string): Date {
  const desired = Date.UTC(date.year, date.month - 1, date.day);
  let result = desired;
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });
  for (let iteration = 0; iteration < 3; iteration += 1) {
    result += desired - observedUtc(formatter, result);
  }
  return new Date(result);
}

function observedUtc(formatter: Intl.DateTimeFormat, timestamp: number): number {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const part = (name: string, fallback: number): number => parts[name] ?? fallback;
  const hour = part("hour", 0);
  return Date.UTC(
    part("year", 0),
    part("month", 1) - 1,
    part("day", 1),
    hour === 24 ? 0 : hour,
    part("minute", 0),
    part("second", 0),
  );
}

function displayDate(value: string): string {
  const date = parseCalendarDate(value);
  return `${String(date.day).padStart(2, "0")}/${String(date.month).padStart(2, "0")}/${String(date.year)}`;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.trunc(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

const phaseLabels = {
  en: {
    refinement: "Refinement",
    summary: "Summary",
    transcription: "Transcription",
    translation: "Translation",
  },
  "pt-BR": {
    refinement: "Refinamento",
    summary: "Resumo",
    transcription: "Transcrição",
    translation: "Tradução",
  },
} as const;
