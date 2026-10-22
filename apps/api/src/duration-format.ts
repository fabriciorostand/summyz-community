export function formatClockDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.trunc(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map(padDurationPart).join(":");
}

const padDurationPart = (value: number): string => String(value).padStart(2, "0");
