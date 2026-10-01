import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../lib/api";
import { leaveDashboardFor } from "../lib/browser-navigation";
import { useDiscordConnect, useDiscordConnection } from "./use-discord-connection";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  api: { getDiscordConnection: vi.fn(), startDiscordConnection: vi.fn() },
}));
vi.mock("../lib/browser-navigation", () => ({ leaveDashboardFor: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe("useDiscordConnection", () => {
  it("reads which owner account is connected", async () => {
    vi.mocked(api.getDiscordConnection).mockResolvedValue({
      connected: true,
      discordUserId: "u1",
      discordUsername: "owner",
    });
    const { result } = renderHook(() => useDiscordConnection());
    expect(result.current.connection).toBeUndefined();
    await waitFor(() =>
      expect(result.current.connection).toEqual({
        connected: true,
        discordUserId: "u1",
        discordUsername: "owner",
      }),
    );
    expect(result.current.loadFailed).toBe(false);
  });

  it("reads the connection again when the Discord application changes", async () => {
    vi.mocked(api.getDiscordConnection)
      .mockResolvedValueOnce({ connected: true, discordUserId: "u1", discordUsername: "owner" })
      .mockResolvedValueOnce({ connected: false });
    const { rerender, result } = renderHook(
      ({ applicationId }) => useDiscordConnection(applicationId),
      { initialProps: { applicationId: "app-1" } },
    );
    await waitFor(() => expect(result.current.connection?.connected).toBe(true));

    rerender({ applicationId: "app-2" });

    await waitFor(() => expect(result.current.connection).toEqual({ connected: false }));
    expect(api.getDiscordConnection).toHaveBeenCalledTimes(2);
  });

  it("reports a failed status check without inventing a connection", async () => {
    vi.mocked(api.getDiscordConnection).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useDiscordConnection());
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.connection).toBeUndefined();
  });
});

describe("useDiscordConnect", () => {
  it("leaves the dashboard for the Discord authorization page", async () => {
    vi.mocked(api.startDiscordConnection).mockResolvedValue(
      "https://discord.com/oauth2/authorize?state=s",
    );
    const { result } = renderHook(() => useDiscordConnect());

    await act(() => result.current.connect());

    expect(leaveDashboardFor).toHaveBeenCalledWith("https://discord.com/oauth2/authorize?state=s");
    expect(result.current.connecting).toBe(true);
    expect(result.current.failure).toBeUndefined();
  });

  it.each([
    [new ApiError(409, "discord_client_secret_missing"), "discord_client_secret_missing"],
    [new ApiError(409, "discord_bot_not_configured"), "discord_bot_not_configured"],
    [new ApiError(503, "discord_rate_limited", 4), "discord_rate_limited"],
    [new ApiError(500, "internal_error"), "request_failed"],
    [new Error("offline"), "request_failed"],
  ])("explains why the authorization could not start (%s)", async (error, failure) => {
    vi.mocked(api.startDiscordConnection).mockRejectedValue(error);
    const { result } = renderHook(() => useDiscordConnect());

    await act(() => result.current.connect());

    expect(leaveDashboardFor).not.toHaveBeenCalled();
    expect(result.current.connecting).toBe(false);
    expect(result.current.failure).toBe(failure);
  });
});
