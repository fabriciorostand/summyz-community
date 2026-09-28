import { describe, expect, it } from "vitest";

import { loadWebConfig } from "../src/api/web-config.js";

const required = {
  DATABASE_URL: "postgresql://summyz:secret@localhost:5432/summyz",
  SUMMYZ_SECRETS_KEY: Buffer.alloc(32, 7).toString("base64url"),
  SUMMYZ_SETUP_TOKEN: "a-bootstrap-token-with-32-characters",
};

describe("loadWebConfig", () => {
  it("limita o dashboard à máquina local por padrão", () => {
    expect(loadWebConfig(required)).toMatchObject({
      accessMode: "local",
      host: "127.0.0.1",
      port: 8787,
      publicBaseUrl: "http://127.0.0.1:8787",
      staticDirectory: "web/dist",
    });
  });

  it("exige chaves de infraestrutura fortes e aceita HTTPS para VPS", () => {
    expect(() => loadWebConfig({ ...required, SUMMYZ_SETUP_TOKEN: "short" })).toThrow();
    expect(() => loadWebConfig({ ...required, SUMMYZ_SECRETS_KEY: "invalid" })).toThrow();
    expect(() =>
      loadWebConfig({ ...required, PUBLIC_BASE_URL: "https://summyz.example.com/dashboard" }),
    ).toThrow(/origin/i);
    expect(
      loadWebConfig({
        ...required,
        DASHBOARD_ACCESS_MODE: "public",
        PUBLIC_BASE_URL: "https://summyz.example.com",
        WEB_HOST: "0.0.0.0",
      }),
    ).toMatchObject({
      accessMode: "public",
      host: "0.0.0.0",
      publicBaseUrl: "https://summyz.example.com",
    });
  });

  it("requires HTTPS and a non-loopback listener in public mode", () => {
    expect(() =>
      loadWebConfig({
        ...required,
        DASHBOARD_ACCESS_MODE: "public",
        PUBLIC_BASE_URL: "http://example.com",
        WEB_HOST: "0.0.0.0",
      }),
    ).toThrow(/HTTPS/i);
    expect(() =>
      loadWebConfig({
        ...required,
        DASHBOARD_ACCESS_MODE: "public",
        PUBLIC_BASE_URL: "https://example.com",
      }),
    ).toThrow(/WEB_HOST/i);
  });
});
