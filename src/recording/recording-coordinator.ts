import type { RecordingManifest } from "./manifest.js";

export type RecordingStopReason = "channel_empty" | "command" | "reconnect_exhausted" | "shutdown";

export type RecordingStopRequest =
  | { reason: "command"; stoppedByUserId: string }
  | { reason: Exclude<RecordingStopReason, "command"> };

export function shouldStartTranscription(reason: RecordingStopReason): boolean {
  return reason === "command" || reason === "channel_empty";
}

export interface StartRecordingInput {
  guildId: string;
  notificationChannelId: string;
  voiceChannelId: string;
  voiceChannelName?: string;
}

export interface RecordingHandle {
  guildId: string;
  meetingId: string;
  notificationChannelId: string;
  stop(request: RecordingStopRequest): Promise<void>;
  voiceChannelId: string;
}

export interface RecordingSessionFactory {
  create(input: StartRecordingInput, onEnded?: () => void): Promise<RecordingHandle>;
  resume(manifest: RecordingManifest, onEnded?: () => void): Promise<RecordingHandle | undefined>;
}

export class RecordingAlreadyActiveError extends Error {
  public constructor() {
    super("Já existe uma gravação ativa neste servidor");
    this.name = "RecordingAlreadyActiveError";
  }
}

export class RecordingCoordinator {
  readonly #factory: RecordingSessionFactory;
  readonly #pendingGuildIds = new Set<string>();
  readonly #recordings = new Map<string, RecordingHandle>();

  public constructor(factory: RecordingSessionFactory) {
    this.#factory = factory;
  }

  public get(guildId: string): RecordingHandle | undefined {
    return this.#recordings.get(guildId);
  }

  public async start(input: StartRecordingInput): Promise<RecordingHandle> {
    if (this.#recordings.has(input.guildId) || this.#pendingGuildIds.has(input.guildId)) {
      throw new RecordingAlreadyActiveError();
    }

    this.#pendingGuildIds.add(input.guildId);
    let handle: RecordingHandle | undefined;
    try {
      handle = await this.#factory.create(input, () => {
        if (handle !== undefined) {
          this.#removeIfCurrent(input.guildId, handle);
        }
      });
      this.#recordings.set(input.guildId, handle);
      return handle;
    } finally {
      this.#pendingGuildIds.delete(input.guildId);
    }
  }

  public async resume(manifest: RecordingManifest): Promise<RecordingHandle | undefined> {
    if (this.#recordings.has(manifest.guildId) || this.#pendingGuildIds.has(manifest.guildId)) {
      return undefined;
    }

    this.#pendingGuildIds.add(manifest.guildId);
    let handle: RecordingHandle | undefined;
    try {
      handle = await this.#factory.resume(manifest, () => {
        if (handle !== undefined) {
          this.#removeIfCurrent(manifest.guildId, handle);
        }
      });
      if (handle !== undefined) {
        this.#recordings.set(manifest.guildId, handle);
      }
      return handle;
    } finally {
      this.#pendingGuildIds.delete(manifest.guildId);
    }
  }

  public async stop(guildId: string, request: RecordingStopRequest): Promise<boolean> {
    const handle = this.#recordings.get(guildId);
    if (handle === undefined) {
      return false;
    }

    await handle.stop(request);
    this.#removeIfCurrent(guildId, handle);
    return true;
  }

  public async handleHumanCountChanged(
    guildId: string,
    voiceChannelId: string,
    humanCount: number,
  ): Promise<void> {
    const handle = this.#recordings.get(guildId);
    if (handle?.voiceChannelId !== voiceChannelId || humanCount > 0) {
      return;
    }

    await this.stop(guildId, { reason: "channel_empty" });
  }

  public async shutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.#recordings.values()].map((recording) => recording.stop({ reason: "shutdown" })),
    );
    this.#recordings.clear();
  }

  #removeIfCurrent(guildId: string, handle: RecordingHandle): void {
    if (this.#recordings.get(guildId) === handle) {
      this.#recordings.delete(guildId);
    }
  }
}
