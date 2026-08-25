import type { MeetingContentStore } from "./meeting-finalizer.js";

// Os arquivos produzidos pelo pipeline já são a persistência de conteúdo no modo local.
export class LocalMeetingContentStore implements MeetingContentStore {
  public async persist(): Promise<boolean> {
    return true;
  }
}
