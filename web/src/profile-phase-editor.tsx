import { useState } from "react";
import { z } from "zod";

import type { Profile, PromptDefaults } from "./api";
import { Button, Field, SelectField, TextAreaField, Toggle } from "./components";

import { VadEditor } from "./profile-vad-editor";

export function PhaseEditor({
  onChange,
  onTranscriptionTabChange,
  phase,
  profile,
  promptDefaults,
  transcriptionTab,
}: {
  onChange: (profile: unknown) => void;
  onTranscriptionTabChange?: (tab: "model" | "vad") => void;
  phase: "Transcrição" | "Refinamento" | "Resumo";
  profile: Profile;
  promptDefaults: PromptDefaults | undefined;
  transcriptionTab?: "model" | "vad";
}) {
  if (phase === "Transcrição") {
    const value = profile.transcription;
    const selectedTab = transcriptionTab ?? "model";
    return (
      <fieldset className="phase">
        <legend>{phase}</legend>
        <div aria-label="Configuração da transcrição" className="phase-tabs" role="tablist">
          <button
            aria-selected={selectedTab === "model"}
            className={selectedTab === "model" ? "active" : ""}
            onClick={() => onTranscriptionTabChange?.("model")}
            role="tab"
            type="button"
          >
            Modelo e transcrição
          </button>
          <button
            aria-selected={selectedTab === "vad"}
            className={selectedTab === "vad" ? "active" : ""}
            onClick={() => onTranscriptionTabChange?.("vad")}
            role="tab"
            type="button"
          >
            VAD
          </button>
        </div>
        {selectedTab === "model" ? (
          <>
            <div className="form-grid">
              <SelectField disabled label="Provedor" value={value.provider ?? ""}>
                <option value="">Escolha um provedor</option>
                <option value="faster-whisper">faster-whisper</option>
                <option value="openrouter">openrouter</option>
              </SelectField>
              <Field
                label="Modelo"
                placeholder="medium ou vendor/model"
                value={value.model ?? ""}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    transcription: { ...value, model: event.currentTarget.value || null },
                  })
                }
              />
            </div>
            <div className="form-grid">
              {profile.profileType === "local" && (
                <Field
                  label="Tamanho do lote"
                  placeholder="auto ou 0–64"
                  value={profile.transcription.batchSize}
                  onChange={(event) => {
                    const raw = event.currentTarget.value;
                    onChange({
                      ...profile,
                      transcription: {
                        ...value,
                        batchSize: raw === "auto" || raw === "" ? "auto" : Number(raw),
                      },
                    });
                  }}
                />
              )}
              <Field
                label="Intervalo máximo de união (ms)"
                min={0}
                type="number"
                value={value.mergeMaxGapMs}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    transcription: { ...value, mergeMaxGapMs: event.currentTarget.valueAsNumber },
                  })
                }
              />
            </div>
            <div className="form-grid">
              <Field
                label="Silêncio entre falas (ms)"
                min={0}
                type="number"
                value={value.interSpeechSilenceMs}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    transcription: {
                      ...value,
                      interSpeechSilenceMs: event.currentTarget.valueAsNumber,
                    },
                  })
                }
              />
              <Field
                label="Temperatura"
                max={1}
                min={0}
                step={0.1}
                type="number"
                value={value.temperature ?? ""}
                onChange={(event) => {
                  const { temperature: _temperature, ...withoutTemperature } = value;
                  onChange({
                    ...profile,
                    transcription:
                      event.currentTarget.value === ""
                        ? withoutTemperature
                        : { ...value, temperature: event.currentTarget.valueAsNumber },
                  });
                }}
              />
            </div>
            <PromptEditor
              defaultPrompt={promptDefaults?.transcription ?? null}
              disabledMessage="Sem prompt editável. O prompt-base imutável do Summyz Community continuará ativo."
              label="Prompt da transcrição"
              toggleLabel="Enviar prompt de transcrição"
              value={value.prompt}
              onChange={(prompt) => onChange({ ...profile, transcription: { ...value, prompt } })}
            />
            <TextAreaField
              defaultValue={JSON.stringify(value.providerOptions ?? {}, null, 2)}
              hint="Objeto JSON agrupado pelo slug do provedor."
              label="Opções avançadas do provedor"
              rows={4}
              onBlur={(event) => {
                const parsed = parseProviderOptions(event.currentTarget.value);
                if (parsed !== undefined)
                  onChange({ ...profile, transcription: { ...value, providerOptions: parsed } });
              }}
            />
          </>
        ) : (
          <VadEditor profile={profile} onChange={onChange} />
        )}
      </fieldset>
    );
  }
  const key = phase === "Refinamento" ? "refinement" : "summary";
  const value = profile[key];
  function replace(next: typeof value) {
    onChange(
      key === "refinement"
        ? { ...profile, refinement: next }
        : { ...profile, summary: { ...profile.summary, ...next } },
    );
  }
  return (
    <fieldset className="phase">
      <legend>{phase}</legend>
      <div className="form-grid">
        <SelectField disabled label="Provedor" value={value.provider ?? ""}>
          <option value="">Escolha um provedor</option>
          <option value="ollama">ollama</option>
          <option value="openrouter">openrouter</option>
        </SelectField>
        <Field
          label="Modelo"
          placeholder="qwen3:4b ou vendor/model"
          value={value.model ?? ""}
          onChange={(event) => replace({ ...value, model: event.currentTarget.value || null })}
        />
      </div>
      <div className="form-grid">
        <Field
          label="Máximo por trecho"
          min={1000}
          type="number"
          value={value.maxChunkCharacters}
          onChange={(event) =>
            replace({ ...value, maxChunkCharacters: event.currentTarget.valueAsNumber })
          }
        />
        <Field
          label="Temperatura"
          max={2}
          min={0}
          step={0.1}
          type="number"
          value={value.generation.temperature ?? ""}
          onChange={(event) =>
            replace({
              ...value,
              generation:
                event.currentTarget.value === ""
                  ? { ...value.generation, temperature: undefined }
                  : { ...value.generation, temperature: event.currentTarget.valueAsNumber },
            })
          }
        />
      </div>
      <div className="form-grid">
        <Field
          label="Seed"
          type="number"
          value={value.generation.seed ?? ""}
          onChange={(event) => {
            const { seed: _seed, ...withoutSeed } = value.generation;
            replace({
              ...value,
              generation:
                event.currentTarget.value === ""
                  ? withoutSeed
                  : { ...value.generation, seed: event.currentTarget.valueAsNumber },
            });
          }}
        />
        <Toggle
          checked={value.generation.think ?? false}
          label="Raciocínio do modelo"
          description="Encaminha think=true quando o provedor oferece suporte."
          onChange={(think) => replace({ ...value, generation: { ...value.generation, think } })}
        />
      </div>
      {phase === "Refinamento" ? (
        <PromptEditor
          defaultPrompt={promptDefaults?.refinement}
          disabledMessage="Sem prompt editável. O prompt-base imutável do Summyz Community continuará ativo."
          label="Prompt de refinamento"
          toggleLabel="Enviar prompt de refinamento"
          value={profile.refinement.prompt}
          onChange={(prompt) =>
            onChange({ ...profile, refinement: { ...profile.refinement, prompt } })
          }
        />
      ) : (
        <div className="summary-prompts">
          <PromptEditor
            defaultPrompt={promptDefaults?.summaryExtraction}
            disabledMessage="Sem prompt editável. O prompt-base imutável do Summyz Community continuará ativo."
            label="Prompt do resumo — extração"
            toggleLabel="Enviar prompt de extração"
            value={profile.summary.extractionPrompt}
            onChange={(extractionPrompt) =>
              onChange({
                ...profile,
                summary: { ...profile.summary, extractionPrompt },
              })
            }
          />
          <PromptEditor
            defaultPrompt={promptDefaults?.summaryConsolidation}
            disabledMessage="Sem prompt editável. O prompt-base imutável do Summyz Community continuará ativo."
            label="Prompt do resumo — consolidação"
            toggleLabel="Enviar prompt de consolidação"
            value={profile.summary.consolidationPrompt}
            onChange={(consolidationPrompt) =>
              onChange({
                ...profile,
                summary: { ...profile.summary, consolidationPrompt },
              })
            }
          />
        </div>
      )}
    </fieldset>
  );
}

export function TranslationEditor({
  onChange,
  profile,
}: {
  onChange: (profile: unknown) => void;
  profile: Profile;
}) {
  const value = profile.translation;
  if (value === null) return null;
  const replace = (translation: typeof value) => onChange({ ...profile, translation });
  return (
    <fieldset className="phase">
      <legend>Tradução</legend>
      <p className="field-hint">
        Esta fase adiciona uma chamada ao modelo. Se falhar, o resumo-base será publicado no idioma
        predominante e o autor do /record receberá uma DM privada.
      </p>
      <div className="form-grid">
        <SelectField disabled label="Provedor" value={value.provider}>
          <option value="ollama">ollama</option>
          <option value="openrouter">openrouter</option>
        </SelectField>
        <Field
          label="Modelo"
          placeholder="qwen3:4b ou vendor/model"
          value={value.model ?? ""}
          onChange={(event) => replace({ ...value, model: event.currentTarget.value || null })}
        />
      </div>
      <button
        className="text-button"
        onClick={() => replace({ ...value, model: profile.summary.model })}
        type="button"
      >
        Usar modelo do resumo
      </button>
      <details className="advanced-settings">
        <summary>Configurações avançadas</summary>
        <div className="form-grid">
          <Field
            label="Temperatura"
            max={2}
            min={0}
            step={0.1}
            type="number"
            value={value.generation.temperature ?? ""}
            onChange={(event) =>
              replace({
                ...value,
                generation: {
                  ...value.generation,
                  temperature:
                    event.currentTarget.value === ""
                      ? undefined
                      : event.currentTarget.valueAsNumber,
                },
              })
            }
          />
          <Field
            label="Seed"
            type="number"
            value={value.generation.seed ?? ""}
            onChange={(event) =>
              replace({
                ...value,
                generation: {
                  ...value.generation,
                  seed:
                    event.currentTarget.value === ""
                      ? undefined
                      : event.currentTarget.valueAsNumber,
                },
              })
            }
          />
        </div>
        <Toggle
          checked={value.generation.think ?? false}
          description="Encaminha think=true quando o provedor oferece suporte."
          label="Raciocínio do modelo"
          onChange={(think) => replace({ ...value, generation: { ...value.generation, think } })}
        />
        <PromptEditor
          defaultPrompt="Traduza somente os campos permitidos e preserve os termos protegidos."
          disabledMessage="Sem prompt editável. O prompt-base imutável do Summyz Community continuará ativo."
          label="Prompt de tradução"
          toggleLabel="Usar prompt de tradução"
          value={value.prompt}
          onChange={(prompt) => replace({ ...value, prompt })}
        />
      </details>
    </fieldset>
  );
}

export function PromptEditor({
  defaultPrompt,
  disabledMessage,
  label,
  onChange,
  toggleLabel,
  value,
}: {
  defaultPrompt: string | null | undefined;
  disabledMessage: string;
  label: string;
  onChange: (value: string | null) => void;
  toggleLabel: string;
  value: string | null | undefined;
}) {
  const [pendingAction, setPendingAction] = useState<"disable" | "restore" | null>(null);
  const enabled = value !== null && value !== undefined;

  function confirmPendingAction() {
    if (pendingAction === "disable") onChange(null);
    if (pendingAction === "restore" && defaultPrompt !== undefined && defaultPrompt !== null) {
      onChange(defaultPrompt);
    }
    setPendingAction(null);
  }

  return (
    <section className="prompt-editor">
      <Toggle
        checked={enabled}
        description="Desative para remover somente a personalização; o prompt-base continuará ativo."
        label={toggleLabel}
        onChange={(checked) => {
          if (checked) onChange(defaultPrompt ?? "");
          else setPendingAction("disable");
        }}
      />
      {enabled ? (
        <>
          <TextAreaField
            hint="O texto completo será enviado ao modelo. Limite de 20.000 caracteres."
            label={label}
            maxLength={20_000}
            required
            rows={7}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
          {defaultPrompt !== undefined && defaultPrompt !== null && value !== defaultPrompt && (
            <Button
              className="secondary prompt-reset"
              onClick={() => setPendingAction("restore")}
              type="button"
            >
              Restaurar padrão
            </Button>
          )}
        </>
      ) : (
        <div className="prompt-disabled">
          <strong>Sem prompt</strong>
          <span>{disabledMessage}</span>
          {defaultPrompt !== undefined && defaultPrompt !== null && (
            <Button className="secondary" onClick={() => onChange(defaultPrompt)} type="button">
              Usar prompt padrão
            </Button>
          )}
        </div>
      )}
      {pendingAction !== null && (
        <div
          aria-label={pendingAction === "disable" ? "Desativar prompt" : "Restaurar prompt"}
          className="prompt-confirm"
          role="alertdialog"
        >
          <strong>
            {pendingAction === "disable" ? "Desativar este prompt?" : "Restaurar o padrão?"}
          </strong>
          <span>
            {pendingAction === "disable"
              ? "O texto editável será removido do perfil. O prompt-base imutável continuará sendo enviado."
              : "A personalização atual será substituída pelo prompt padrão."}
          </span>
          <div className="prompt-confirm-actions">
            <Button className="secondary" onClick={() => setPendingAction(null)} type="button">
              Cancelar
            </Button>
            <Button
              className={pendingAction === "disable" ? "danger" : undefined}
              onClick={confirmPendingAction}
              type="button"
            >
              {pendingAction === "disable" ? "Desativar prompt" : "Restaurar prompt"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

const providerOptionsSchema = z.record(z.string().min(1), z.record(z.string().min(1), z.json()));

function parseProviderOptions(input: string) {
  try {
    const value: unknown = JSON.parse(input);
    const parsed = providerOptionsSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  } catch (_error) {
    return undefined;
  }
}
