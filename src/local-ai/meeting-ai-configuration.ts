import type { MeetingAiConfiguration } from "../recording/manifest.js";

export function hasInsufficientLocalHardware(configuration: MeetingAiConfiguration): boolean {
  return [configuration.transcription, configuration.refinement, configuration.summary].some(
    (phase) => phase.hardwareWarning === true,
  );
}
