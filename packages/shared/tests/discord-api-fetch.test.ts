import { describe, expect, it, vi } from "vitest";

import { createDiscordApiFetch, DiscordRateLimitError } from "../src/discord/discord-api-fetch.js";

describe("Discord API fetch", () => {
  it("retries a rate limited request after Discord's short Retry-After", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "retry-after": "0.001" } }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const request = createDiscordApiFetch(fetchMock);

    const response = await request("https://discord.com/api/v10/users/@me/guilds", {
      headers: { authorization: "Bearer private-access-token" },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
  });

  it("uses the response body when Retry-After is absent", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ retry_after: 0.001 }, { status: 429 }))
      .mockResolvedValueOnce(Response.json([]));

    await expect(
      createDiscordApiFetch(fetchMock)("https://discord.com/api/v10/users/@me/guilds"),
    ).resolves.toHaveProperty("status", 200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops before a long wait and exposes a safe temporary error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "12" } }));
    const logRateLimit = vi.fn();
    const request = createDiscordApiFetch(fetchMock, logRateLimit);

    await expect(
      request("https://discord.com/api/v10/users/@me/guilds", {
        headers: { authorization: "Bearer private-access-token" },
      }),
    ).rejects.toMatchObject({
      code: "discord_rate_limited",
      retryAfterSeconds: 12,
      statusCode: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/api/v10/users/@me/guilds",
        retryAfterSeconds: 12,
      }),
    );
    expect(JSON.stringify(logRateLimit.mock.calls)).not.toContain("private-access-token");
    expect(JSON.stringify(new DiscordRateLimitError(12))).not.toContain("private-access-token");
  });

  it("does not retain a successful guild response as an authorization cache", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));
    const request = createDiscordApiFetch(fetchMock);

    await request("https://discord.com/api/v10/users/@me/guilds");
    await request("https://discord.com/api/v10/users/@me/guilds");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not apply one credential's global cooldown to another credential", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "retry-after": "12", "x-ratelimit-scope": "global" },
        }),
      )
      .mockResolvedValueOnce(Response.json([]));
    const request = createDiscordApiFetch(fetchMock);

    await expect(
      request("https://discord.com/api/v10/users/@me/guilds", {
        headers: { authorization: "Bearer user-token" },
      }),
    ).rejects.toBeInstanceOf(DiscordRateLimitError);
    await expect(
      request("https://discord.com/api/v10/users/@me/guilds", {
        headers: { authorization: "Bot bot-token" },
      }),
    ).resolves.toHaveProperty("status", 200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a successful response's reset headers to avoid a known exhausted route", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([], {
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "12" },
      }),
    );
    const request = createDiscordApiFetch(fetchMock);

    await request("https://discord.com/api/v10/users/@me/guilds");
    await expect(request("https://discord.com/api/v10/users/@me/guilds")).rejects.toMatchObject({
      statusCode: 503,
      retryAfterSeconds: 12,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails safely when Discord sends a rate limit without a usable delay", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not JSON", { status: 429 }));
    const request = createDiscordApiFetch(fetchMock);

    await expect(request("https://discord.com/api/v10/users/@me/guilds")).rejects.toMatchObject({
      code: "discord_rate_limited",
      statusCode: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid retry delay rather than guessing when to retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ retry_after: "later" }, { status: 429 }));
    const request = createDiscordApiFetch(fetchMock);

    await expect(request("https://discord.com/api/v10/users/@me/guilds")).rejects.toMatchObject({
      code: "discord_rate_limited",
      retryAfterSeconds: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops after repeated rate limits even when Discord requests no delay", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(null, { status: 429, headers: { "retry-after": "0" } }),
      );
    const request = createDiscordApiFetch(fetchMock);

    await expect(request("https://discord.com/api/v10/users/@me/guilds")).rejects.toBeInstanceOf(
      DiscordRateLimitError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
