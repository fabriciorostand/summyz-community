import type { LiveMeetingParticipant } from "../database/postgres-live-meeting-store.js";
import type { RecordingManifest } from "./manifest.js";

export type RecordingStopReason =
  | "bot_left_guild"
  | "channel_empty"
  | "command"
  | "owner_changed"
  | "reconnect_exhausted"
  | "shutdown";

export type RecordingStopRequest =
  | { reason: "command"; stoppedByUserId: string }
  | { reason: Exclude<RecordingStopReason, "command"> };

export function shouldStartTranscription(reason: RecordingStopReason): boolean {
  return reason === "command" || reason === "channel_empty" || reason === "owner_changed";
}

export interface StartRecordingInput {
  guildId: string;
  guildIconUrl?: string | null;
  guildName?: string;
  notificationChannelId: string;
  startedByUserId?: string;
  verifiedOwnerUserId?: string;
  voiceChannelId: string;
  voiceChannelName?: string;
}

export interface RecordingHandle {
  guildId: string;
  meetingId: string;
  notificationChannelId: string;
  recordParticipant?(userId: string, displayName: string, avatarUrl?: string | null): Promise<void>;
  stop(request: RecordingStopRequest): Promise<void>;
  voiceChannelId: string;
  updateLiveParticipants?(participants: readonly LiveMeetingParticipant[]): Promise<void>;
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

export class RecordingRecoveryPendingError extends Error {
  public constructor() {
    super("A gravação anterior está suspensa enquanto o acesso ao servidor é verificado");
    this.name = "RecordingRecoveryPendingError";
  }
}

export class RecordingCoordinator {
  readonly #factory: RecordingSessionFactory;
  readonly #pendingGuildIds = new Set<string>();
  readonly #recoverableGuildIds = new Set<string>();
  readonly #recordings = new Map<string, RecordingHandle>();

  public constructor(factory: RecordingSessionFactory) {
    this.#factory = factory;
  }

  public get(guildId: string): RecordingHandle | undefined {
    return this.#recordings.get(guildId);
  }

  public activeGuildIds(): string[] {
    return [...this.#recordings.keys()];
  }

  public isPending(guildId: string): boolean {
    return this.#pendingGuildIds.has(guildId);
  }

  public setRecoverable(guildId: string, recoverable: boolean): void {
    if (recoverable) this.#recoverableGuildIds.add(guildId);
    else this.#recoverableGuildIds.delete(guildId);
  }

  public async start(input: StartRecordingInput): Promise<RecordingHandle> {
    if (this.#recoverableGuildIds.has(input.guildId)) {
      throw new RecordingRecoveryPendingError();
    }
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

  public async recordParticipant(
    guildId: string,
    voiceChannelId: string,
    userId: string,
    displayName: string,
    avatarUrl?: string | null,
  ): Promise<void> {
    const handle = this.#recordings.get(guildId);
    if (handle?.voiceChannelId !== voiceChannelId) return;
    if (avatarUrl === undefined) await handle.recordParticipant?.(userId, displayName);
    else await handle.recordParticipant?.(userId, displayName, avatarUrl);
  }

  public async updateLiveParticipants(
    guildId: string,
    voiceChannelId: string,
    participants: readonly LiveMeetingParticipant[],
  ): Promise<void> {
    const handle = this.#recordings.get(guildId);
    if (handle?.voiceChannelId !== voiceChannelId) return;
    await handle.updateLiveParticipants?.(participants);
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
