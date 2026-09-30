import { type Client, Events } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { GuildOwnerApprovalStore } from "../src/database/postgres-guild-owner-approval-store.js";
import { installGuildOwnershipHandler } from "../src/discord/guild-ownership-handler.js";
import type { RecordingCoordinator } from "../src/recording/recording-coordinator.js";

describe("guild ownership changes", () => {
  it("records current owners at startup so later offline transfers require confirmation", async () => {
    const listeners = new Map<string, (...args: unknown[]) => Promise<void> | void>();
    const client = {
      on: vi.fn(),
      once: (event: string, listener: (...args: unknown[]) => Promise<void> | void) => {
        listeners.set(event, listener);
      },
    } as unknown as Client;
    const approvals: GuildOwnerApprovalStore = {
      confirm: vi.fn(async () => true),
      isConfirmed: vi.fn(async () => true),
    };
    installGuildOwnershipHandler(client, {} as RecordingCoordinator, approvals, {
      error: vi.fn(),
      info: vi.fn(),
    });

    await listeners.get(Events.ClientReady)?.({
      guilds: {
        cache: new Map([
          ["guild-1", { id: "guild-1", ownerId: "owner-a" }],
          ["guild-2", { id: "guild-2", ownerId: "owner-b" }],
        ]),
      },
    });

    expect(approvals.isConfirmed).toHaveBeenCalledWith("guild-1", "owner-a");
    expect(approvals.isConfirmed).toHaveBeenCalledWith("guild-2", "owner-b");
  });

  it("stops a live recording and invalidates the old owner's approval", async () => {
    const listeners = new Map<string, (...args: unknown[]) => Promise<void> | void>();
    const client = {
      on: (event: string, listener: (...args: unknown[]) => Promise<void> | void) => {
        listeners.set(event, listener);
      },
      once: (event: string, listener: (...args: unknown[]) => Promise<void> | void) => {
        listeners.set(event, listener);
      },
    } as unknown as Client;
    const approvals: GuildOwnerApprovalStore = {
      confirm: vi.fn(async () => true),
      isConfirmed: vi.fn(async () => false),
    };
    const coordinator = {
      get: vi.fn(() => ({ meetingId: "meeting-1" })),
      stop: vi.fn(async () => true),
    } as unknown as RecordingCoordinator;
    installGuildOwnershipHandler(client, coordinator, approvals, {
      error: vi.fn(),
      info: vi.fn(),
    });

    await listeners.get(Events.GuildUpdate)?.(
      { id: "guild-1", ownerId: "owner-a" },
      { id: "guild-1", ownerId: "owner-b" },
    );

    expect(approvals.isConfirmed).toHaveBeenCalledWith("guild-1", "owner-b");
    expect(coordinator.stop).toHaveBeenCalledWith("guild-1", { reason: "owner_changed" });
  });

  it("ignores unchanged ownership and records transfers without an active recording", async () => {
    const listeners = new Map<string, (...args: unknown[]) => Promise<void> | void>();
    const client = {
      on: (event: string, listener: (...args: unknown[]) => Promise<void> | void) => {
        listeners.set(event, listener);
      },
      once: vi.fn(),
    } as unknown as Client;
    const approvals: GuildOwnerApprovalStore = {
      confirm: vi.fn(async () => true),
      isConfirmed: vi.fn(async () => false),
    };
    const coordinator = {
      get: vi.fn(() => undefined),
      stop: vi.fn(async () => true),
    } as unknown as RecordingCoordinator;
    installGuildOwnershipHandler(client, coordinator, approvals, { error: vi.fn(), info: vi.fn() });
    const onUpdate = listeners.get(Events.GuildUpdate);

    await onUpdate?.({ id: "guild-1", ownerId: "owner-a" }, { id: "guild-1", ownerId: "owner-a" });
    expect(approvals.isConfirmed).not.toHaveBeenCalled();
    await onUpdate?.({ id: "guild-1", ownerId: "owner-a" }, { id: "guild-1", ownerId: "owner-b" });
    expect(approvals.isConfirmed).toHaveBeenCalledWith("guild-1", "owner-b");
    expect(coordinator.stop).not.toHaveBeenCalled();
  });

  it("logs a failed startup ownership baseline and continues other guilds", async () => {
    const listeners = new Map<string, (...args: unknown[]) => Promise<void> | void>();
    const client = {
      on: vi.fn(),
      once: (event: string, listener: (...args: unknown[]) => Promise<void> | void) => {
        listeners.set(event, listener);
      },
    } as unknown as Client;
    const approvals: GuildOwnerApprovalStore = {
      confirm: vi.fn(async () => true),
      isConfirmed: vi.fn(async (guildId) => {
        if (guildId === "guild-1") throw new Error("database unavailable");
        return true;
      }),
    };
    const logger = { error: vi.fn(), info: vi.fn() };
    installGuildOwnershipHandler(client, {} as RecordingCoordinator, approvals, logger);

    await listeners.get(Events.ClientReady)?.({
      guilds: {
        cache: new Map([
          ["guild-1", { id: "guild-1", ownerId: "owner-a" }],
          ["guild-2", { id: "guild-2", ownerId: "owner-b" }],
        ]),
      },
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild-1" }),
      "Unable to record initial guild ownership",
    );
    expect(approvals.isConfirmed).toHaveBeenCalledWith("guild-2", "owner-b");
  });

  it("stops a live recording even when approval storage fails", async () => {
    const listeners = new Map<string, (...args: unknown[]) => Promise<void> | void>();
    const client = {
      on: (event: string, listener: (...args: unknown[]) => Promise<void> | void) => {
        listeners.set(event, listener);
      },
      once: vi.fn(),
    } as unknown as Client;
    const approvals: GuildOwnerApprovalStore = {
      confirm: vi.fn(async () => true),
      isConfirmed: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    };
    const coordinator = {
      get: vi.fn(() => ({ meetingId: "meeting-1" })),
      stop: vi.fn(async () => true),
    } as unknown as RecordingCoordinator;
    installGuildOwnershipHandler(client, coordinator, approvals, { error: vi.fn(), info: vi.fn() });

    await listeners.get(Events.GuildUpdate)?.(
      { id: "guild-1", ownerId: "owner-a" },
      { id: "guild-1", ownerId: "owner-b" },
    );

    expect(coordinator.stop).toHaveBeenCalledWith("guild-1", { reason: "owner_changed" });
  });
});
