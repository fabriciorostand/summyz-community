import { z } from "zod";

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    if (value !== "UTC" && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "A valid IANA time zone or UTC is required");

export const calendarQuerySchema = z.object({ timeZone: timeZoneSchema });
export const exportPresentationSchema = z.object({
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
  timeFormat: z.enum(["24h", "12h"]),
  timeZone: timeZoneSchema,
});
export type ExportPresentation = z.infer<typeof exportPresentationSchema>;

export function formatExportDate(value: string, input: ExportPresentation): string {
  const options = exportPresentationSchema.parse(input);
  const date = new Date(z.iso.datetime({ offset: true }).parse(value));
  const parts = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: options.timeFormat === "24h" ? "h23" : "h12",
    timeZone: options.timeZone,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const result = parts.find((entry) => entry.type === type)?.value;
    if (result === undefined) throw new Error("Date formatter returned incomplete parts");
    return result;
  };
  const dates = {
    "DD/MM/YYYY": `${part("day")}/${part("month")}/${part("year")}`,
    "MM/DD/YYYY": `${part("month")}/${part("day")}/${part("year")}`,
    "YYYY-MM-DD": `${part("year")}-${part("month")}-${part("day")}`,
  };
  const period = options.timeFormat === "12h" ? ` ${part("dayPeriod")}` : "";
  return `${dates[options.dateFormat]} ${part("hour")}:${part("minute")}${period}`;
}
