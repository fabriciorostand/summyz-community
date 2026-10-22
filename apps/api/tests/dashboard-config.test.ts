import { describe, expect, it } from "vitest";

import { loadDashboardConfig } from "../src/dashboard-config.js";

const required = {
  DATABASE_URL: "postgresql://summyz:secret@localhost:5432/summyz",
  SUMMYZ_SECRETS_KEY: Buffer.alloc(32, 7).toString("base64url"),
  SUMMYZ_SETUP_TOKEN: "a-bootstrap-token-with-32-characters",
};

describe("loadDashboardConfig", () => {
  it("limita o dashboard à máquina local por padrão", () => {
    expect(loadDashboardConfig(required)).toMatchObject({
      accessMode: "local",
      host: "127.0.0.1",
      port: 8787,
      publicBaseUrl: "http://127.0.0.1:8787",
      staticDirectory: "apps/dashboard/dist",
    });
  });

  it("exige chaves de infraestrutura fortes e aceita HTTPS para VPS", () => {
    expect(() => loadDashboardConfig({ ...required, SUMMYZ_SETUP_TOKEN: "short" })).toThrow();
    expect(() => loadDashboardConfig({ ...required, SUMMYZ_SECRETS_KEY: "invalid" })).toThrow();
    expect(() =>
      loadDashboardConfig({ ...required, PUBLIC_BASE_URL: "https://summyz.example.com/dashboard" }),
    ).toThrow(/origin/i);
    expect(
      loadDashboardConfig(
        {
          ...required,
          PUBLIC_BASE_URL: "https://summyz.example.com",
          DASHBOARD_HOST: "0.0.0.0",
        },
        ["--access-mode", "public"],
      ),
    ).toMatchObject({
      accessMode: "public",
      host: "0.0.0.0",
      publicBaseUrl: "https://summyz.example.com",
    });
  });

  it("requires HTTPS and a non-loopback listener in public mode", () => {
    expect(() =>
      loadDashboardConfig(
        {
          ...required,
          PUBLIC_BASE_URL: "http://example.com",
          DASHBOARD_HOST: "0.0.0.0",
        },
        ["--access-mode", "public"],
      ),
    ).toThrow(/HTTPS/i);
    expect(() =>
      loadDashboardConfig({ ...required, PUBLIC_BASE_URL: "https://example.com" }, [
        "--access-mode",
        "public",
      ]),
    ).toThrow(/DASHBOARD_HOST/i);
  });

  it.each(["", "local", "public", "invalid"])(
    "ignores a legacy access mode from the environment: %s",
    (mode) => {
      expect(loadDashboardConfig({ ...required, DASHBOARD_ACCESS_MODE: mode })).toMatchObject({
        accessMode: "local",
      });
    },
  );

  it("selects local mode explicitly even when a legacy environment selects public", () => {
    expect(
      loadDashboardConfig({ ...required, DASHBOARD_ACCESS_MODE: "public" }, [
        "--access-mode",
        "local",
      ]),
    ).toMatchObject({ accessMode: "local" });
  });

  it("accepts the equals syntax for public mode", () => {
    expect(
      loadDashboardConfig(
        { ...required, PUBLIC_BASE_URL: "https://example.com", DASHBOARD_HOST: "0.0.0.0" },
        ["--access-mode=public"],
      ),
    ).toMatchObject({ accessMode: "public" });
  });

  it.each([
    ["--access-mode", "invalid"],
    ["--access-mode"],
    ["--unknown"],
    ["public"],
    ["--access-mode", "local", "--access-mode", "public"],
  ])("rejects invalid or ambiguous startup arguments: %j", (...arguments_) => {
    expect(() => loadDashboardConfig(required, arguments_)).toThrow();
  });
});
