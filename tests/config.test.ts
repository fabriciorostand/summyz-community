import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("carrega os padrões seguros do MVP", () => {
    const config = loadConfig({
      DISCORD_CLIENT_ID: "client-id",
      DISCORD_TOKEN: "token",
    });

    expect(config).toMatchObject({
      dataDir: "./data",
      discordClientId: "client-id",
      discordToken: "token",
      segmentMaxSeconds: 60,
      segmentSilenceMs: 1_000,
      voiceReconnectMaxMs: 300_000,
    });
  });

  it("rejeita durações de segmento inválidas", () => {
    expect(() =>
      loadConfig({
        DISCORD_CLIENT_ID: "client-id",
        DISCORD_TOKEN: "token",
        SEGMENT_MAX_SECONDS: "0",
      }),
    ).toThrow(/SEGMENT_MAX_SECONDS/);
  });
});
