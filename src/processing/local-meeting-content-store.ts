import type { MeetingContentStore } from "./meeting-finalizer.js";

// Files produced by the pipeline already provide content persistence in local mode.
export class LocalMeetingContentStore implements MeetingContentStore {
  public async persist(): Promise<boolean> {
    return true;
  }
}
