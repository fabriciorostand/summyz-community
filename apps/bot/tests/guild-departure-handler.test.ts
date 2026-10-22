import { describe, expect, it, vi } from "vitest";
import { GuildDepartureHandler } from "../src/discord/guild-departure-handler.js";

describe("GuildDepartureHandler", () => {
  it("leaves retained history untouched when no meeting is pending", async () => {
    const cleanup = vi.fn(async () => undefined);
    const info = vi.fn();
    const handler = new GuildDepartureHandler({
      cancelPending: vi.fn(async () => []),
      cleanup,
      logger: { error: vi.fn(), info },
      stop: vi.fn(async () => false),
    });

    await handler.handle("guild-1");

    expect(cleanup).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      { cancelledMeetings: 0, guildId: "guild-1" },
      "Pending guild meetings cancelled after bot departure",
    );
  });
  it("stops recording, fails pending meetings, and cleans their temporary files", async () => {
    const stop = vi.fn(async () => true);
    const cancelPending = vi.fn(async () => ["meeting-1", "meeting-2"]);
    const cleanup = vi.fn(async () => undefined);
    const handler = new GuildDepartureHandler({
      cancelPending,
      cleanup,
      logger: { error: vi.fn(), info: vi.fn() },
      stop,
    });

    await handler.handle("guild-1");

    expect(stop).toHaveBeenCalledWith("guild-1", { reason: "bot_left_guild" });
    expect(cancelPending).toHaveBeenCalledWith("guild-1");
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledWith("meeting-1");
    expect(cleanup).toHaveBeenCalledWith("meeting-2");
  });

  it("continues terminal cleanup when stopping the voice connection fails", async () => {
    const cancelPending = vi.fn(async () => ["meeting-1"]);
    const cleanup = vi.fn(async () => undefined);
    const error = vi.fn();
    const handler = new GuildDepartureHandler({
      cancelPending,
      cleanup,
      logger: { error, info: vi.fn() },
      stop: vi.fn(async () => {
        throw new Error("voice disconnected");
      }),
    });

    await handler.handle("guild-1");

    expect(cancelPending).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith("meeting-1");
    expect(error).toHaveBeenCalledOnce();
  });

  it("continues deleting other temporary files after one cleanup failure", async () => {
    const error = vi.fn();
    const cleanup = vi.fn(async (meetingId: string) => {
      if (meetingId === "meeting-1") throw new Error("disk busy");
    });
    const handler = new GuildDepartureHandler({
      cancelPending: vi.fn(async () => ["meeting-1", "meeting-2"]),
      cleanup,
      logger: { error, info: vi.fn() },
      stop: vi.fn(async () => false),
    });

    await handler.handle("guild-1");

    expect(cleanup).toHaveBeenCalledWith("meeting-2");
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ meetingId: "meeting-1" }),
      "Unable to delete temporary files after bot departure",
    );
  });

  it("logs non-Error failures without leaking their contents", async () => {
    const error = vi.fn();
    const handler = new GuildDepartureHandler({
      cancelPending: vi.fn(async () => ["meeting-1"]),
      cleanup: vi.fn(async () => {
        throw "secret cleanup value";
      }),
      logger: { error, info: vi.fn() },
      stop: vi.fn(async () => {
        throw "secret stop value";
      }),
    });

    await handler.handle("guild-1");

    expect(error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
  });
});
