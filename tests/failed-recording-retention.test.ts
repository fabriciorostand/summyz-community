import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logger.js";
import { FailedRecordingRetention } from "../src/transcription/failed-recording-retention.js";
import {
  createTranscriptionState,
  markTranscriptionFailed,
} from "../src/transcription/transcription-state.js";
import { TranscriptionStore } from "../src/transcription/transcription-store.js";

describe("retenção de gravações com transcrição perdida", () => {
  it("exclui a reunião completa somente depois de 24 horas", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-retention-"));
    const store = new TranscriptionStore(root);
    const expired = markTranscriptionFailed(
      createTranscriptionState("expired", ["segment-1"], "2026-08-15T10:00:00.000Z"),
      "provider_failed",
      "2026-08-15T12:00:00.000Z",
    );
    const recent = markTranscriptionFailed(
      createTranscriptionState("recent", ["segment-2"], "2026-08-16T10:00:00.000Z"),
      "provider_failed",
      "2026-08-16T12:01:00.000Z",
    );
    await store.save(expired);
    await store.save(recent);
    await writeFile(store.resolveMeetingFile("expired", "audio.ogg"), "sensível");
    const retention = new FailedRecordingRetention({
      logger: createLogger("silent"),
      retentionHours: 24,
      store,
    });

    await retention.cleanup(new Date("2026-08-16T12:00:00.000Z"));

    await expect(access(store.meetingDirectory("expired"))).rejects.toThrow();
    await expect(access(store.meetingDirectory("recent"))).resolves.toBeUndefined();
  });

  it("pode iniciar e parar a verificação periódica mais de uma vez", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-retention-"));
    const retention = new FailedRecordingRetention({
      logger: createLogger("silent"),
      retentionHours: 24,
      store: new TranscriptionStore(root),
    });

    retention.start();
    retention.start();
    retention.stop();
    retention.stop();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
