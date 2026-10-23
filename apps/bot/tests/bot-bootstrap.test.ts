import { describe, expect, it, vi } from "vitest";

import { waitForBotConfiguration } from "../src/bot-bootstrap.js";

describe("waitForBotConfiguration", () => {
  it("waits for installation setup before exposing Discord credentials", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        discordApplicationId: "application-id",
        discordToken: "bot-token",
        setupCompleted: false,
        version: "version-1",
      })
      .mockResolvedValueOnce({
        discordApplicationId: "application-id",
        discordToken: "bot-token",
        setupCompleted: true,
        version: "version-1",
      });
    const delay = vi.fn(async () => undefined);

    await expect(waitForBotConfiguration({ delay, read })).resolves.toEqual({
      discordApplicationId: "application-id",
      discordToken: "bot-token",
      version: "version-1",
    });
    expect(delay).toHaveBeenCalledOnce();
  });

  it("keeps waiting when credentials are incomplete", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        discordApplicationId: null,
        discordToken: undefined,
        setupCompleted: true,
        version: "version-1",
      })
      .mockResolvedValueOnce({
        discordApplicationId: "application-id",
        discordToken: "bot-token",
        setupCompleted: true,
        version: "version-1",
      });
    const delay = vi.fn(async () => undefined);

    await waitForBotConfiguration({ delay, read });

    expect(read).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledOnce();
  });
});
