import { describe, expect, it } from "vitest";

import { compatibilityTag, downloadProgress, formatBytes, installTag } from "./model-labels";

describe("model labels", () => {
  it("formats sizes the way people read disk space", () => {
    expect(formatBytes(5_200_000_000)).toBe("5,2 GB");
    expect(formatBytes(486_212_372)).toBe("486 MB");
    expect(formatBytes(78_203_619)).toBe("78 MB");
    expect(formatBytes(142_000_000_000)).toBe("142 GB");
  });

  it("names how well a model fits this machine", () => {
    expect(compatibilityTag("recommended")).toEqual({ label: "Recomendado", tone: "action" });
    expect(compatibilityTag("compatible")).toEqual({ label: "Compatível", tone: "neutral" });
    expect(compatibilityTag("above_recommended")).toEqual({
      label: "Acima do seu hardware",
      tone: "warn",
    });
    expect(compatibilityTag("incompatible")).toEqual({ label: "Incompatível", tone: "fail" });
    expect(compatibilityTag("unknown")).toBeNull();
  });

  it("says whether a local model is on disk, downloading or unknown", () => {
    expect(installTag(true, 1_000_000_000)).toEqual({ label: "Instalado", tone: "ok" });
    expect(installTag(false, 5_200_000_000)).toEqual({
      label: "Não instalado · 5,2 GB",
      tone: "neutral",
    });
    expect(installTag(false, null)).toEqual({ label: "Não instalado", tone: "neutral" });
    expect(installTag(null, null)).toBeNull();
  });

  it("describes download progress, including queued and unknown sizes", () => {
    const job = {
      completedBytes: 1_820_000_000,
      downloadId: "d1",
      failureCode: null,
      model: "qwen3:8b",
      provider: "ollama" as const,
      status: "downloading" as const,
      totalBytes: 5_200_000_000,
    };
    expect(downloadProgress(job)).toEqual({ label: "Baixando… 35% de 5,2 GB", percent: 35 });
    expect(downloadProgress({ ...job, totalBytes: null })).toEqual({
      label: "Baixando… 1,8 GB",
      percent: null,
    });
    expect(downloadProgress({ ...job, status: "queued" })).toEqual({
      label: "Na fila. Um download acontece por vez.",
      percent: null,
    });
    expect(downloadProgress({ ...job, status: "cancelling" })).toEqual({
      label: "Cancelando e apagando os arquivos parciais…",
      percent: null,
    });
  });
});
