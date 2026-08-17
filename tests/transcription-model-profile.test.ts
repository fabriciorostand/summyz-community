import { mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  loadTranscriptionModelProfile,
  parseTranscriptionModelProfiles,
} from "../src/transcription/transcription-model-profile.js";

describe("perfis de modelos de transcrição", () => {
  it("carrega o perfil Whisper versionado sem pausa sintética", async () => {
    await expect(
      loadTranscriptionModelProfile(
        resolve("config/transcription-model-profiles.json"),
        "openai/whisper-large-v3",
      ),
    ).resolves.toEqual({
      interSpeechSilenceMs: 0,
      language: "pt-BR",
      temperature: 0,
      timestampMode: "word",
    });
  });

  it("seleciona pelo slug exato e mantém configurações isoladas", () => {
    const profiles = parseTranscriptionModelProfiles({
      "deepgram/nova-3": {
        interSpeechSilenceMs: 350,
        language: "pt-BR",
        temperature: 0,
        timestampMode: "word",
      },
      "openai/whisper-large-v3": {
        interSpeechSilenceMs: 0,
        language: "pt-BR",
        temperature: 0,
        timestampMode: "word",
      },
    });

    expect(profiles["deepgram/nova-3"]).toMatchObject({ interSpeechSilenceMs: 350 });
    expect(profiles["openai/whisper-large-v3"]).toMatchObject({
      interSpeechSilenceMs: 0,
    });
  });

  it("falha quando o modelo não possui perfil", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-profiles-"));
    const path = join(directory, "profiles.json");
    await writeFile(
      path,
      JSON.stringify({
        "openai/whisper-large-v3": {
          interSpeechSilenceMs: 0,
          language: "pt-BR",
          temperature: 0,
          timestampMode: "word",
        },
      }),
      "utf8",
    );

    await expect(loadTranscriptionModelProfile(path, "modelo/ausente")).rejects.toThrow(
      /não possui perfil/i,
    );
  });

  it("rejeita arquivo inválido sem reproduzir seu conteúdo no erro", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-profiles-"));
    const path = join(directory, "profiles.json");
    await writeFile(path, '{"segredo":"valor-sensível"}', "utf8");

    const error = await loadTranscriptionModelProfile(path, "segredo").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("valor-sensível");
  });

  it("valida opções específicas como objetos JSON por provedor", () => {
    expect(() =>
      parseTranscriptionModelProfiles({
        "deepgram/nova-3": {
          interSpeechSilenceMs: 350,
          providerOptions: { deepgram: "smart_format=true" },
          temperature: 0,
          timestampMode: "word",
        },
      }),
    ).toThrow();
  });
});
