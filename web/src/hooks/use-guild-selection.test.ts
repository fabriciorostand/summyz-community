import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { aGuild } from "../tests/test-utils";
import { useGuildSelection } from "./use-guild-selection";

vi.mock("../lib/api", () => ({ api: { listGuilds: vi.fn() } }));

const listGuilds = vi.mocked(api.listGuilds);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useGuildSelection", () => {
  it("lists the servers the bot is in and selects the first one", async () => {
    listGuilds.mockResolvedValue([
      aGuild({ id: "g1", name: "Pixelforge" }),
      aGuild({ id: "g2", name: "Engine Guild" }),
    ]);
    const { result } = renderHook(() => useGuildSelection());
    await waitFor(() => expect(result.current.guilds).toHaveLength(2));
    expect(result.current.selectedGuildId).toBe("g1");
    expect(result.current.selectedGuild?.name).toBe("Pixelforge");
  });

  it("restores the guild remembered by this browser", async () => {
    localStorage.setItem("summyz:selected-guild", "g2");
    listGuilds.mockResolvedValue([aGuild({ id: "g1" }), aGuild({ id: "g2" })]);
    const { result } = renderHook(() => useGuildSelection());
    await waitFor(() => expect(result.current.selectedGuildId).toBe("g2"));
  });

  it("ignores a remembered guild that is no longer installed", async () => {
    localStorage.setItem("summyz:selected-guild", "gone");
    listGuilds.mockResolvedValue([aGuild({ id: "g1" })]);
    const { result } = renderHook(() => useGuildSelection());
    await waitFor(() => expect(result.current.selectedGuildId).toBe("g1"));
  });

  it("remembers a new selection", async () => {
    listGuilds.mockResolvedValue([aGuild({ id: "g1" }), aGuild({ id: "g2" })]);
    const { result } = renderHook(() => useGuildSelection());
    await waitFor(() => expect(result.current.guilds).toHaveLength(2));
    act(() => result.current.setSelectedGuildId("g2"));
    expect(result.current.selectedGuildId).toBe("g2");
    expect(localStorage.getItem("summyz:selected-guild")).toBe("g2");
  });

  it("reports a failure instead of throwing", async () => {
    listGuilds.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useGuildSelection());
    await waitFor(() => expect(result.current.error).toBe(true));
  });

  it("refetches when asked to reload", async () => {
    listGuilds.mockResolvedValue([aGuild()]);
    const { result } = renderHook(() => useGuildSelection());
    await waitFor(() => expect(result.current.guilds).toHaveLength(1));
    act(() => result.current.reload());
    await waitFor(() => expect(listGuilds).toHaveBeenCalledTimes(2));
  });

  it("survives storage being unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    listGuilds.mockResolvedValue([aGuild({ id: "g1" })]);
    const { result } = renderHook(() => useGuildSelection());
    await waitFor(() => expect(result.current.selectedGuildId).toBe("g1"));
    act(() => result.current.setSelectedGuildId("g1"));
    expect(result.current.selectedGuildId).toBe("g1");
    vi.restoreAllMocks();
  });

  it("selects nothing when the bot is in no server", async () => {
    listGuilds.mockResolvedValue([]);
    const { result } = renderHook(() => useGuildSelection());
    await waitFor(() => expect(result.current.guilds).toHaveLength(0));
    expect(result.current.selectedGuildId).toBe("");
  });
});
