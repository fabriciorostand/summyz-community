import { describe, expect, it, vi } from "vitest";

import { api } from "./api";

describe("dashboard API client", () => {
  it("renova a sessão e repete uma requisição autenticada que recebeu 401", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "session_expired" }), { status: 401 }),
      )
      .mockResolvedValueOnce(new Response(undefined, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listGuilds()).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/refresh",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
