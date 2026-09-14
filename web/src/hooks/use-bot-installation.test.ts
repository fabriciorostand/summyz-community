import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { useBotInstallation } from "./use-bot-installation";

vi.mock("../lib/api", () => ({ api: { getBotInstallation: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe("useBotInstallation", () => {
  it("exposes the authorization link of a configured bot", async () => {
    vi.mocked(api.getBotInstallation).mockResolvedValue({
      applicationId: "1",
      configured: true,
      installUrl: "https://discord.com/oauth2/authorize?client_id=1",
    });
    const { result } = renderHook(() => useBotInstallation());
    await waitFor(() =>
      expect(result.current.installUrl).toBe("https://discord.com/oauth2/authorize?client_id=1"),
    );
  });

  it("yields no link when the bot is not configured or the request fails", async () => {
    vi.mocked(api.getBotInstallation).mockResolvedValueOnce({ configured: false });
    const first = renderHook(() => useBotInstallation());
    await waitFor(() => expect(api.getBotInstallation).toHaveBeenCalledTimes(1));
    expect(first.result.current.installUrl).toBeUndefined();

    vi.mocked(api.getBotInstallation).mockRejectedValueOnce(new Error("offline"));
    const second = renderHook(() => useBotInstallation());
    await waitFor(() => expect(api.getBotInstallation).toHaveBeenCalledTimes(2));
    expect(second.result.current.installUrl).toBeUndefined();
  });
});
