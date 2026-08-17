import { describe, expect, it, vi } from "vitest";

import {
  RecordingAlreadyActiveError,
  RecordingCoordinator,
  shouldStartTranscription,
  type RecordingHandle,
  type RecordingSessionFactory,
} from "../src/recording/recording-coordinator.js";
import { createManifest } from "../src/recording/manifest.js";

function createHandle(guildId: string, voiceChannelId: string): RecordingHandle {
  return {
    guildId,
    meetingId: `meeting-${guildId}`,
    stop: vi.fn(async () => undefined),
    voiceChannelId,
  };
}

describe("RecordingCoordinator", () => {
  it("inicia transcrição somente após comando ou canal vazio", () => {
    expect(shouldStartTranscription("command")).toBe(true);
    expect(shouldStartTranscription("channel_empty")).toBe(true);
    expect(shouldStartTranscription("shutdown")).toBe(false);
    expect(shouldStartTranscription("reconnect_exhausted")).toBe(false);
  });

  it("bloqueia inicializações concorrentes no mesmo servidor", async () => {
    const factory: RecordingSessionFactory = {
      create: vi.fn(async (input) => createHandle(input.guildId, input.voiceChannelId)),
      resume: vi.fn(),
    };
    const coordinator = new RecordingCoordinator(factory);

    const firstStart = coordinator.start({
      guildId: "guild-1",
      notificationChannelId: "text-1",
      voiceChannelId: "voice-1",
    });
    await expect(
      coordinator.start({
        guildId: "guild-1",
        notificationChannelId: "text-1",
        voiceChannelId: "voice-1",
      }),
    ).rejects.toBeInstanceOf(RecordingAlreadyActiveError);
    await firstStart;

    expect(factory.create).toHaveBeenCalledTimes(1);
  });

  it("permite uma gravação por servidor", async () => {
    const factory: RecordingSessionFactory = {
      create: vi.fn(async (input) => createHandle(input.guildId, input.voiceChannelId)),
      resume: vi.fn(),
    };
    const coordinator = new RecordingCoordinator(factory);

    await coordinator.start({
      guildId: "guild-1",
      notificationChannelId: "text-1",
      voiceChannelId: "voice-1",
    });

    await expect(
      coordinator.start({
        guildId: "guild-1",
        notificationChannelId: "text-2",
        voiceChannelId: "voice-2",
      }),
    ).rejects.toBeInstanceOf(RecordingAlreadyActiveError);
  });

  it("encerra imediatamente quando o canal fica sem pessoas", async () => {
    const handle = createHandle("guild-1", "voice-1");
    const factory: RecordingSessionFactory = {
      create: vi.fn(async () => handle),
      resume: vi.fn(),
    };
    const coordinator = new RecordingCoordinator(factory);
    await coordinator.start({
      guildId: "guild-1",
      notificationChannelId: "text-1",
      voiceChannelId: "voice-1",
    });

    await coordinator.handleHumanCountChanged("guild-1", "voice-1", 0);

    expect(handle.stop).toHaveBeenCalledWith("channel_empty");
    expect(coordinator.get("guild-1")).toBeUndefined();
  });

  it("não encerra por mudanças em outro canal", async () => {
    const handle = createHandle("guild-1", "voice-1");
    const factory: RecordingSessionFactory = {
      create: vi.fn(async () => handle),
      resume: vi.fn(),
    };
    const coordinator = new RecordingCoordinator(factory);
    await coordinator.start({
      guildId: "guild-1",
      notificationChannelId: "text-1",
      voiceChannelId: "voice-1",
    });

    await coordinator.handleHumanCountChanged("guild-1", "voice-other", 0);

    expect(handle.stop).not.toHaveBeenCalled();
  });

  it("não encerra enquanto ainda houver pessoas no canal", async () => {
    const handle = createHandle("guild-1", "voice-1");
    const factory: RecordingSessionFactory = {
      create: vi.fn(async () => handle),
      resume: vi.fn(),
    };
    const coordinator = new RecordingCoordinator(factory);
    await coordinator.start({
      guildId: "guild-1",
      notificationChannelId: "text-1",
      voiceChannelId: "voice-1",
    });

    await coordinator.handleHumanCountChanged("guild-1", "voice-1", 1);

    expect(handle.stop).not.toHaveBeenCalled();
  });

  it("informa quando não existe gravação para encerrar", async () => {
    const factory: RecordingSessionFactory = {
      create: vi.fn(),
      resume: vi.fn(),
    };
    const coordinator = new RecordingCoordinator(factory);

    await expect(coordinator.stop("guild-1", "command")).resolves.toBe(false);
  });

  it("remove a gravação encerrada pelo próprio handle", async () => {
    const handle = createHandle("guild-1", "voice-1");
    let notifyEnded: (() => void) | undefined;
    const factory: RecordingSessionFactory = {
      create: vi.fn(async (_input, onEnded) => {
        notifyEnded = onEnded;
        return handle;
      }),
      resume: vi.fn(),
    };
    const coordinator = new RecordingCoordinator(factory);
    await coordinator.start({
      guildId: "guild-1",
      notificationChannelId: "text-1",
      voiceChannelId: "voice-1",
    });

    notifyEnded?.();

    expect(coordinator.get("guild-1")).toBeUndefined();
  });

  it("libera o servidor quando a inicialização falha", async () => {
    const handle = createHandle("guild-1", "voice-1");
    const create = vi
      .fn<RecordingSessionFactory["create"]>()
      .mockRejectedValueOnce(new Error("falha"))
      .mockResolvedValueOnce(handle);
    const factory: RecordingSessionFactory = { create, resume: vi.fn() };
    const coordinator = new RecordingCoordinator(factory);
    const input = {
      guildId: "guild-1",
      notificationChannelId: "text-1",
      voiceChannelId: "voice-1",
    };

    await expect(coordinator.start(input)).rejects.toThrow("falha");
    await expect(coordinator.start(input)).resolves.toBe(handle);
  });

  it("retoma uma reunião interrompida e bloqueia retomada duplicada", async () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const handle = createHandle("guild-1", "voice-1");
    const factory: RecordingSessionFactory = {
      create: vi.fn(),
      resume: vi.fn(async () => handle),
    };
    const coordinator = new RecordingCoordinator(factory);

    await expect(coordinator.resume(manifest)).resolves.toBe(handle);
    await expect(coordinator.resume(manifest)).resolves.toBeUndefined();
    expect(coordinator.get("guild-1")).toBe(handle);
  });

  it("não registra uma retomada que não encontrou pessoas no canal", async () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const factory: RecordingSessionFactory = {
      create: vi.fn(),
      resume: vi.fn(async () => undefined),
    };
    const coordinator = new RecordingCoordinator(factory);

    await expect(coordinator.resume(manifest)).resolves.toBeUndefined();
    expect(coordinator.get("guild-1")).toBeUndefined();
  });

  it("encerra todas as gravações durante o desligamento", async () => {
    const firstHandle = createHandle("guild-1", "voice-1");
    const secondHandle = createHandle("guild-2", "voice-2");
    const factory: RecordingSessionFactory = {
      create: vi.fn(async (input) => (input.guildId === "guild-1" ? firstHandle : secondHandle)),
      resume: vi.fn(),
    };
    const coordinator = new RecordingCoordinator(factory);
    await coordinator.start({
      guildId: "guild-1",
      notificationChannelId: "text-1",
      voiceChannelId: "voice-1",
    });
    await coordinator.start({
      guildId: "guild-2",
      notificationChannelId: "text-2",
      voiceChannelId: "voice-2",
    });

    await coordinator.shutdown();

    expect(firstHandle.stop).toHaveBeenCalledWith("shutdown");
    expect(secondHandle.stop).toHaveBeenCalledWith("shutdown");
    expect(coordinator.get("guild-1")).toBeUndefined();
    expect(coordinator.get("guild-2")).toBeUndefined();
  });
});
