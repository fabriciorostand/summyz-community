import { describe, expect, it } from "vitest";

import { getI18n, setLanguage } from "../../i18n/store";
import { compatibilityTag, downloadProgress, installTag } from "./model-labels";

const job = {
  completedBytes: 1_820_000_000,
  downloadId: "d1",
  failureCode: null,
  model: "qwen3:8b",
  provider: "ollama" as const,
  status: "downloading" as const,
  totalBytes: 5_200_000_000,
};

describe("model labels", () => {
  it("names how well a model fits this machine", () => {
    const { t } = getI18n();
    expect(compatibilityTag("recommended", t)).toEqual({ label: "Recomendado", tone: "action" });
    expect(compatibilityTag("compatible", t)).toEqual({ label: "Compatível", tone: "neutral" });
    expect(compatibilityTag("above_recommended", t)).toEqual({
      label: "Acima do seu hardware",
      tone: "warn",
    });
    expect(compatibilityTag("incompatible", t)).toEqual({ label: "Incompatível", tone: "fail" });
    expect(compatibilityTag("unknown", t)).toBeNull();
  });

  it("says whether a local model is on disk, downloading or unknown", () => {
    const i18n = getI18n();
    expect(installTag(true, 1_000_000_000, i18n)).toEqual({ label: "Instalado", tone: "ok" });
    expect(installTag(false, 5_200_000_000, i18n)).toEqual({
      label: "Não instalado · 5,2 GB",
      tone: "neutral",
    });
    expect(installTag(false, null, i18n)).toEqual({ label: "Não instalado", tone: "neutral" });
    expect(installTag(null, null, i18n)).toBeNull();
  });

  it("describes download progress, including queued and unknown sizes", () => {
    const i18n = getI18n();
    expect(downloadProgress(job, i18n)).toEqual({ label: "Baixando… 35% de 5,2 GB", percent: 35 });
    expect(downloadProgress({ ...job, totalBytes: null }, i18n)).toEqual({
      label: "Baixando… 1,8 GB",
      percent: null,
    });
    expect(downloadProgress({ ...job, status: "queued" }, i18n)).toEqual({
      label: "Na fila. Um download acontece por vez.",
      percent: null,
    });
    expect(downloadProgress({ ...job, status: "cancelling" }, i18n)).toEqual({
      label: "Cancelando e apagando os arquivos parciais…",
      percent: null,
    });
  });

  it("speaks the dashboard language with its separators", () => {
    setLanguage("en");
    const i18n = getI18n();
    expect(compatibilityTag("above_recommended", i18n.t)?.label).toBe("Above your hardware");
    expect(installTag(false, 5_200_000_000, i18n)?.label).toBe("Not installed · 5.2 GB");
    expect(downloadProgress(job, i18n).label).toBe("Downloading… 35% of 5.2 GB");
  });
});
