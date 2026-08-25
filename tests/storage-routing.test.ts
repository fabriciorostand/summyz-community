import { describe, expect, it } from "vitest";

import { requiresPostgres } from "../src/processing/storage-routing.js";
import { createManifest } from "../src/recording/manifest.js";

const localManifest = createManifest({
  guildId: "guild-1",
  meetingId: "local-meeting",
  notificationChannelId: "text-1",
  startedAt: "2026-08-24T10:00:00.000Z",
  storageMode: "local",
  voiceChannelId: "voice-1",
});

describe("roteamento de armazenamento", () => {
  it("não exige PostgreSQL no modo local sem reunião PostgreSQL pendente", () => {
    expect(requiresPostgres("local", [localManifest])).toBe(false);
  });

  it("exige PostgreSQL para novas reuniões configuradas nesse modo", () => {
    expect(requiresPostgres("postgres", [])).toBe(true);
  });

  it("mantém o backend PostgreSQL de uma reunião anterior após alterar o modo atual", () => {
    expect(requiresPostgres("local", [{ ...localManifest, storageMode: "postgres" }])).toBe(true);
  });
});
