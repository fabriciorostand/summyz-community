import { aiProfileSchema, createInitialAiProfile } from "summyz-community-shared/ai-profile";
import { PostgresDatabase } from "summyz-community-shared/database/postgres-database";
import { SecretBox } from "summyz-community-shared/security/secret-box";
import { describe, expect, it, vi } from "vitest";
import {
  createEvaluationTarget,
  readEvaluationInstallation,
} from "../../../scripts/evaluation/summary-target.js";
import { loadConfig } from "../src/config.js";

const encodedKey = Buffer.alloc(32, 7).toString("base64url");
const secretBox = new SecretBox(encodedKey);
const config = loadConfig({
  DATABASE_URL: "postgres://test:test@localhost/test",
  SUMMYZ_SECRETS_KEY: encodedKey,
});
function profile(type: "local" | "external" = "local", device = "cpu") {
  const initial = createInitialAiProfile(type, "pt-BR");
  return aiProfileSchema.parse({
    ...initial,
    transcription: { ...initial.transcription, model: "transcription-test" },
    refinement: { ...initial.refinement, model: "refinement-test" },
    summary: {
      ...initial.summary,
      model: "target-model",
      generation: { temperature: 0.2, seed: 42 },
      ...(type === "local" ? { device } : {}),
      extractionPrompt: "Custom extraction instruction",
    },
    promptModes: { ...initial.promptModes, summaryExtraction: "custom" },
  });
}
function database(selected = profile(), apiKey: string | undefined = "test-secret-key") {
  const query = vi.fn(async (sql: string) => ({
    rowCount: 1,
    rows: sql.includes("FROM ai_profiles")
      ? [
          {
            profile_id: selected.profileId,
            profile_type: selected.profileType,
            name: selected.name,
            transcription: selected.transcription,
            refinement: selected.refinement,
            summary: selected.summary,
            language: selected.language,
            prompt_modes: selected.promptModes,
          },
        ]
      : sql.includes("FROM installation_secrets") && apiKey !== undefined
        ? [{ encrypted_value: secretBox.encrypt(apiKey) }]
        : [],
  }));
  const end = vi.fn(async () => undefined);
  const release = vi.fn();
  const connection = new PostgresDatabase({
    query,
    end,
    connect: async () => ({ query, release }),
  });
  return { connection, query, end, release };
}
const generated = {
  decisions: [],
  discussedTopics: [],
  executiveSummary: "Planejamento",
  observations: [],
  tasks: [],
  labels: {
    assignee: "Responsável",
    deadline: "Prazo",
    decisions: "Decisões",
    discussedTopics: "Temas",
    executiveSummary: "Resumo",
    meetingId: "Call",
    observations: "Observações",
    summary: "Resumo",
    tasks: "Tarefas",
    transcript: "Transcrição",
  },
};
const entries = [
  { id: "one", speaker: "Bruno", text: "Sem decisões.", startedAtMs: 0, endedAtMs: 1 },
];

describe("summary evaluation target", () => {
  it("reads profiles in a read-only transaction and closes the database without migrations", async () => {
    const db = database();
    const installation = await readEvaluationInstallation(db.connection, secretBox);
    expect(installation.profiles).toHaveLength(1);
    expect(
      db.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 4).join(" ")),
    ).toEqual([
      "BEGIN",
      "SET TRANSACTION READ ONLY",
      "SELECT profile_id, profile_type, name,",
      "COMMIT",
    ]);
    expect(db.end).toHaveBeenCalledOnce();
    expect(db.release).toHaveBeenCalledOnce();
  });
  it("only decrypts the configured external credential for an explicitly selected profile", async () => {
    const db = database(profile("external"));
    const result = await readEvaluationInstallation(db.connection, secretBox, "external-profile-1");
    expect(result.apiKey).toBe("test-secret-key");
    expect(db.query.mock.calls.some(([sql]) => sql.includes("FROM installation_secrets"))).toBe(
      true,
    );
    const local = database();
    await readEvaluationInstallation(local.connection, secretBox, "local-profile-1");
    expect(local.query.mock.calls.some(([sql]) => sql.includes("installation_secrets"))).toBe(
      false,
    );
  });
  it("closes resources when the profile does not exist or database reads fail", async () => {
    const db = database();
    await expect(readEvaluationInstallation(db.connection, secretBox, "absent")).rejects.toThrow();
    expect(db.end).toHaveBeenCalledOnce();
    const failed = database();
    failed.query.mockRejectedValueOnce(new Error("connection failure"));
    await expect(readEvaluationInstallation(failed.connection, secretBox)).rejects.toThrow();
    expect(failed.end).toHaveBeenCalledOnce();
  });
  it("uses the selected local model, prompts and generation options with the real generator", async () => {
    const fetch = vi.fn(async (url: string, _init: RequestInit) =>
      Response.json(
        url.endsWith("/api/ps")
          ? { models: [{ model: "target-model", size: 100, size_vram: 100 }] }
          : { message: { content: JSON.stringify(generated) } },
      ),
    );
    const target = createEvaluationTarget({ profile: profile("local", "gpu"), config, fetch });
    await expect(target.generator.generate(entries)).resolves.toMatchObject({
      summary: { tasks: [] },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe("http://ollama-gpu:11434/api/chat");
    const body = String(fetch.mock.calls[0]?.[1].body);
    expect(body).toContain("Custom extraction instruction");
    expect(JSON.parse(body)).toMatchObject({
      model: "target-model",
      options: { temperature: 0.2, seed: 42 },
    });
    expect(target.metadata).toMatchObject({
      profileId: "local-profile-1",
      model: "target-model",
      device: "gpu",
      language: "pt-BR",
    });
    expect(JSON.stringify(target.metadata)).not.toContain("Custom extraction instruction");
    expect(target.metadata.promptSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("requires explicit resolution of automatic device selection and rejects conflicting overrides", () => {
    expect(() => createEvaluationTarget({ profile: profile("local", "auto"), config })).toThrow();
    expect(
      createEvaluationTarget({ profile: profile("local", "auto"), config, device: "cpu" }).metadata
        .device,
    ).toBe("cpu");
    expect(() => createEvaluationTarget({ profile: profile(), config, device: "gpu" })).toThrow();
    expect(() =>
      createEvaluationTarget({
        profile: profile("external"),
        config,
        apiKey: "test",
        device: "cpu",
      }),
    ).toThrow();
  });
  it("requires complete configuration and external credentials without fallback", () => {
    expect(() =>
      createEvaluationTarget({ profile: createInitialAiProfile("local", "pt-BR"), config }),
    ).toThrow();
    expect(() => createEvaluationTarget({ profile: profile("external"), config })).toThrow();
  });
  it("uses OpenRouter only when configured and keeps credentials out of report metadata", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ choices: [{ message: { content: JSON.stringify(generated) } }] }),
    );
    const target = createEvaluationTarget({
      profile: profile("external"),
      config,
      apiKey: "test-secret-key",
      fetch,
    });
    await target.generator.generate(entries);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.stringify(fetch.mock.calls[0]?.[1].headers)).toContain("test-secret-key");
    expect(JSON.stringify(target.metadata)).not.toContain("test-secret-key");
    expect(target.metadata.device).toBeNull();
  });
});
