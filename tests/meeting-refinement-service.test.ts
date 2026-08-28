import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";
import { addSegment, createManifest, markManifestCompleted } from "../src/recording/manifest.js";
import { MeetingRefinementService } from "../src/refinement/meeting-refinement-service.js";
import { RefinementProviderFailureError } from "../src/refinement/openrouter-refinement-provider.js";
import type { RefinementEntry } from "../src/refinement/refinement-result.js";
import { RefinementStore } from "../src/refinement/refinement-store.js";
import {
  completeTranscriptionSegment,
  createTranscriptionState,
  markTranscriptionCompleted,
} from "../src/transcription/transcription-state.js";
import { TranscriptionStore } from "../src/transcription/transcription-store.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function createContext() {
  const root = await mkdtemp(join(tmpdir(), "summyz-refinement-service-"));
  directories.push(root);
  const manifest = markManifestCompleted(
    addSegment(
      createManifest({
        guildId: "guild-1",
        meetingId: "meeting-1",
        notificationChannelId: "text-1",
        startedAt: "2026-08-17T10:00:00.000Z",
        voiceChannelId: "voice-1",
      }),
      {
        durationMs: 2_000,
        endedAtMs: 12_000,
        file: "participants/user-1/segment-1.ogg",
        segmentId: "segment-1",
        startedAtMs: 10_000,
        userDisplayName: "Fab",
        userId: "user-1",
      },
    ),
    "2026-08-17T10:01:00.000Z",
  );
  const transcriptionStore = new TranscriptionStore(root);
  let transcription = createTranscriptionState(
    "meeting-1",
    ["segment-1"],
    "2026-08-17T10:01:00.000Z",
  );
  transcription = completeTranscriptionSegment(
    transcription,
    "segment-1",
    { attempts: 1, pieces: [{ endedAtMs: 2_000, startedAtMs: 0, text: "conditivite" }] },
    "2026-08-17T10:02:00.000Z",
  );
  await transcriptionStore.save(
    markTranscriptionCompleted(transcription, "2026-08-17T10:02:00.000Z"),
  );
  const raw = "[00:00:10.000 – 00:00:12.000] Fab: conditivite\n";
  await transcriptionStore.writeTranscript("meeting-1", raw);
  return { manifest, raw, refinementStore: new RefinementStore(root), root, transcriptionStore };
}

describe("MeetingRefinementService", () => {
  it("rejeita gravação aberta e aguarda a transcrição ser concluída", async () => {
    const context = await createContext();
    const generate = vi.fn();
    const service = new MeetingRefinementService({
      generator: { generate },
      logger: createLogger("silent"),
      refinementStore: context.refinementStore,
      transcriptionStore: context.transcriptionStore,
    });
    await expect(
      service.process(
        createManifest({
          guildId: "guild-1",
          meetingId: "open-meeting",
          notificationChannelId: "text-1",
          startedAt: "2026-08-17T10:00:00.000Z",
          voiceChannelId: "voice-1",
        }),
      ),
    ).rejects.toThrow(/concluída/i);

    await context.transcriptionStore.save(
      createTranscriptionState("meeting-1", ["segment-1"], "2026-08-17T10:01:00.000Z"),
    );
    await service.process(context.manifest);
    expect(generate).not.toHaveBeenCalled();
  });

  it("preserva o bruto e grava o refinado", async () => {
    const context = await createContext();
    const service = new MeetingRefinementService({
      generator: {
        generate: vi.fn(async (entries: readonly RefinementEntry[]) => ({
          attempts: 1,
          entries: entries.map((entry) => ({ ...entry, text: "conjuntivite" })),
        })),
      },
      logger: createLogger("silent"),
      refinementStore: context.refinementStore,
      transcriptionStore: context.transcriptionStore,
    });

    await service.process(context.manifest);

    await expect(
      readFile(context.transcriptionStore.rawTranscriptPath("meeting-1"), "utf8"),
    ).resolves.toBe(context.raw);
    await expect(
      readFile(context.transcriptionStore.transcriptPath("meeting-1"), "utf8"),
    ).resolves.toContain("conjuntivite");
    await expect(context.refinementStore.load("meeting-1")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("aceita resolver o gerador assincronamente no momento do processamento", async () => {
    const context = await createContext();
    const generate = vi.fn(async (entries: readonly RefinementEntry[]) => ({
      attempts: 1,
      entries: [...entries],
    }));
    const resolveGenerator = vi.fn(async () => ({ generate }));
    const service = new MeetingRefinementService({
      logger: createLogger("silent"),
      refinementStore: context.refinementStore,
      resolveGenerator,
      transcriptionStore: context.transcriptionStore,
    });

    await service.process(context.manifest);

    expect(resolveGenerator).toHaveBeenCalledWith(context.manifest);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("restaura o bruto e continua após três falhas do refinamento", async () => {
    const context = await createContext();
    const service = new MeetingRefinementService({
      generator: {
        generate: vi.fn(async () => {
          throw new RefinementProviderFailureError(3, new Error("indisponível"));
        }),
      },
      logger: createLogger("silent"),
      refinementStore: context.refinementStore,
      transcriptionStore: context.transcriptionStore,
    });

    await service.process(context.manifest);

    await expect(
      readFile(context.transcriptionStore.transcriptPath("meeting-1"), "utf8"),
    ).resolves.toBe(context.raw);
    await expect(context.refinementStore.load("meeting-1")).resolves.toMatchObject({
      attempts: 3,
      failureCode: "provider_failed",
      status: "fallback",
    });
  });

  it("mantém o refinamento pendente enquanto ainda restam tentativas duráveis", async () => {
    const context = await createContext();
    const service = new MeetingRefinementService({
      generator: {
        generate: vi.fn(async () => {
          throw new RefinementProviderFailureError(3, new Error("indisponível"));
        }),
      },
      logger: createLogger("silent"),
      refinementStore: context.refinementStore,
      transcriptionStore: context.transcriptionStore,
    });

    await expect(
      service.process(context.manifest, { fallbackOnProviderFailure: false }),
    ).rejects.toBeInstanceOf(RefinementProviderFailureError);

    await expect(context.refinementStore.load("meeting-1")).resolves.toMatchObject({
      status: "processing",
    });
    await expect(
      readFile(context.transcriptionStore.transcriptPath("meeting-1"), "utf8"),
    ).resolves.toBe(context.raw);
  });

  it("não mascara uma falha interna como indisponibilidade do modelo", async () => {
    const context = await createContext();
    const service = new MeetingRefinementService({
      generator: {
        generate: vi.fn(async () => {
          throw new Error("estado interno inválido");
        }),
      },
      logger: createLogger("silent"),
      refinementStore: context.refinementStore,
      transcriptionStore: context.transcriptionStore,
    });

    await expect(service.process(context.manifest)).rejects.toThrow(/estado interno/i);
    await expect(context.refinementStore.load("meeting-1")).resolves.toMatchObject({
      status: "processing",
    });
  });

  it("não chama novamente o modelo ao retomar um estado terminal", async () => {
    const context = await createContext();
    const generate = vi.fn(async (entries) => ({ attempts: 1, entries }));
    const service = new MeetingRefinementService({
      generator: { generate },
      logger: createLogger("silent"),
      refinementStore: context.refinementStore,
      transcriptionStore: context.transcriptionStore,
    });
    await service.process(context.manifest);
    await service.process(context.manifest);

    expect(generate).toHaveBeenCalledOnce();
  });
});
