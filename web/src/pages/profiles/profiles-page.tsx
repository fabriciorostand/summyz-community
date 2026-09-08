import {
  AudioLines,
  Bot,
  Languages,
  MessageSquareQuote,
  Plus,
  Scale,
  Settings2,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { Disclosure, Tabs } from "../../components/disclosure";
import { ErrorState, LoadingPanel } from "../../components/states";
import { Badge, Button, Card, Field, Notice, RailLabel } from "../../components/ui";
import { useDashboard } from "../../layout/dashboard-layout";
import { TopBar } from "../../layout/top-bar";
import {
  api,
  type Profile,
  type ProfileListItem,
  type PromptDefaults,
  profileSchema,
} from "../../lib/api";
import { Screen } from "../screen";
import { PhaseSettings, TranscriptionSettings, TranslationSettings } from "./generation-editor";
import { LanguageSelector, nextLocalizedProfileName } from "./language-selector";
import { PromptEditor } from "./prompt-editor";
import { VadEditor } from "./vad-editor";

export function ProfilesPage() {
  const { controls, user } = useDashboard();
  const [items, setItems] = useState<ProfileListItem[]>();
  const [profileType, setProfileType] = useState<Profile["profileType"]>("external");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    setItems(undefined);
    try {
      const next = await api.listProfiles();
      setItems(next);
      setSelectedProfileId(
        next.find((item) => item.profile.profileType === "external")?.profile.profileId ?? null,
      );
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = items?.filter((item) => item.profile.profileType === profileType) ?? [];
  const selected =
    visible.find((item) => item.profile.profileId === selectedProfileId) ?? visible[0];

  return (
    <>
      <TopBar
        actions={
          <>
            {items !== undefined && selected !== undefined && (
              <CreateProfileButton
                items={items}
                locale={user.dashboardLanguage}
                onCreated={(profile) => {
                  setItems([...items, { active: false, profile }]);
                  setSelectedProfileId(profile.profileId);
                }}
                template={selected.profile}
              />
            )}
            {controls}
          </>
        }
        meta="Pessoais · reutilizáveis em qualquer servidor"
        title="Perfis de IA"
      />
      <Screen>
        {loadError ? (
          <ErrorState
            code="request_failed"
            onRetry={() => void load()}
            title="Perfis indisponíveis"
          >
            Não foi possível carregar seus perfis.
          </ErrorState>
        ) : items === undefined ? (
          <LoadingPanel label="Carregando perfis…" />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              <Tabs
                ariaLabel="Tipo de execução"
                onChange={(next) => {
                  setProfileType(next);
                  setSelectedProfileId(
                    items.find((item) => item.profile.profileType === next)?.profile.profileId ??
                      null,
                  );
                }}
                options={[
                  { label: "API externa", value: "external" },
                  { label: "Local", value: "local" },
                ]}
                value={profileType}
              />
              <div className="flex flex-col gap-1.5">
                {visible.map(({ active, profile }) => (
                  <button
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      profile.profileId === selected?.profile.profileId
                        ? "border-action bg-action-soft"
                        : "border-line bg-surface-raised hover:border-line-strong"
                    }`}
                    key={profile.profileId}
                    onClick={() => setSelectedProfileId(profile.profileId)}
                    type="button"
                  >
                    <Bot className="size-4 shrink-0 text-accent" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <strong className="truncate text-[12.5px] font-medium text-ink">
                        {profile.name}
                      </strong>
                      <small className="label-mono truncate text-ink-muted">
                        {profile.summary.model ?? "padrão"} · {profile.language}
                      </small>
                    </span>
                    {active && <Badge tone="action">Em uso</Badge>}
                  </button>
                ))}
              </div>
              <Notice icon={<Scale className="mt-0.5 size-3.5 shrink-0" />}>
                <strong className="block text-ink">Licenças dos modelos</strong>
                Modelos são de terceiros e não fazem parte do Summyz Community. Verifique a licença
                antes de usar.
              </Notice>
            </div>
            {selected !== undefined && (
              <ProfileEditor
                item={selected}
                items={visible}
                key={selected.profile.profileId}
                onDeleted={(profileId) => {
                  const remaining = items.filter((item) => item.profile.profileId !== profileId);
                  setItems(remaining);
                  setSelectedProfileId(
                    remaining.find((item) => item.profile.profileType === profileType)?.profile
                      .profileId ?? null,
                  );
                }}
                onSaved={(profile) =>
                  setItems(
                    items.map((item) =>
                      item.profile.profileId === profile.profileId ? { ...item, profile } : item,
                    ),
                  )
                }
              />
            )}
          </div>
        )}
      </Screen>
    </>
  );
}

function CreateProfileButton({
  items,
  locale,
  onCreated,
  template,
}: {
  items: readonly ProfileListItem[];
  locale: "en" | "pt-BR";
  onCreated: (profile: Profile) => void;
  template: Profile;
}) {
  const [busy, setBusy] = useState(false);
  async function create() {
    const { profileId: _profileId, userId: _userId, ...base } = template;
    setBusy(true);
    try {
      onCreated(
        await api.createProfile({ ...base, name: nextLocalizedProfileName(items, locale) }),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button disabled={busy} onClick={() => void create()} type="button">
      <Plus className="size-3.5" />
      Novo perfil
    </Button>
  );
}

function ProfileEditor({
  item,
  items,
  onDeleted,
  onSaved,
}: {
  item: ProfileListItem;
  items: readonly ProfileListItem[];
  onDeleted: (profileId: string) => void;
  onSaved: (profile: Profile) => void;
}) {
  const [draft, setDraft] = useState<Profile>(item.profile);
  const [promptDefaults, setPromptDefaults] = useState<PromptDefaults>();
  const [busy, setBusy] = useState(false);
  const previousDefaults = useRef<PromptDefaults | undefined>(undefined);
  const { language, profileId } = draft;

  // Switching the summary language rewrites the prompts that still hold the previous defaults.
  useEffect(() => {
    let active = true;
    void api.getPromptDefaults(language).then((next) => {
      if (!active) return;
      const previous = previousDefaults.current;
      if (previous !== undefined) {
        setDraft((current) =>
          current.profileId !== profileId || current.language !== language
            ? current
            : profileSchema.parse({
                ...current,
                summary: {
                  ...current.summary,
                  consolidationPrompt:
                    current.summary.consolidationPrompt === previous.summaryConsolidation
                      ? next.summaryConsolidation
                      : current.summary.consolidationPrompt,
                  extractionPrompt:
                    current.summary.extractionPrompt === previous.summaryExtraction
                      ? next.summaryExtraction
                      : current.summary.extractionPrompt,
                },
              }),
        );
      }
      previousDefaults.current = next;
      setPromptDefaults(next);
    });
    return () => {
      active = false;
    };
  }, [language, profileId]);

  const change = (next: unknown) => setDraft(profileSchema.parse(next));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      item.active &&
      !window.confirm(
        "Este perfil está ativo em um ou mais servidores. As alterações valerão nas próximas reuniões. Deseja salvar?",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.updateProfile(draft);
      onSaved(draft);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteProfile(draft.profileId);
      onDeleted(draft.profileId);
    } finally {
      setBusy(false);
    }
  }

  const promptsCustomised =
    draft.refinement.prompt !== null ||
    draft.summary.extractionPrompt !== null ||
    draft.summary.consolidationPrompt !== null;

  return (
    <form className="flex min-w-0 flex-col gap-4" onSubmit={(event) => void save(event)}>
      <RailLabel>O essencial</RailLabel>
      <Card>
        <div className="flex flex-col gap-3">
          <Field
            label="Nome do perfil"
            onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
            value={draft.name}
          />
          <LanguageSelector
            onChange={(nextLanguage) =>
              change({
                ...draft,
                language: nextLanguage,
                translation:
                  nextLanguage === "auto"
                    ? null
                    : (draft.translation ?? {
                        generation: {},
                        model: null,
                        prompt: null,
                        provider: draft.profileType === "external" ? "openrouter" : "ollama",
                      }),
              })
            }
            value={draft.language}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Modelo de transcrição"
              onChange={(event) =>
                change({
                  ...draft,
                  transcription: {
                    ...draft.transcription,
                    model: event.currentTarget.value || null,
                  },
                })
              }
              placeholder={draft.profileType === "local" ? "large-v3" : "openai/whisper-1"}
              value={draft.transcription.model ?? ""}
            />
            <Field
              label="Modelo de resumo"
              onChange={(event) =>
                change({
                  ...draft,
                  summary: { ...draft.summary, model: event.currentTarget.value || null },
                })
              }
              placeholder={draft.profileType === "local" ? "qwen3:4b" : "vendor/model"}
              value={draft.summary.model ?? ""}
            />
          </div>
          <p className="m-0 text-[11.5px] leading-relaxed text-ink-muted">
            Em <span className="font-mono text-ink-secondary">auto</span>, o resumo usa o idioma
            predominante da call e a tradução é ignorada — sem custo extra.
          </p>
        </div>
      </Card>

      <div className="mt-2 flex items-center gap-3">
        <span className="label-mono text-ink-muted">Avançado</span>
        <span className="h-px flex-1 bg-line-soft" />
        <span className="label-mono text-ink-dim">Mexa só se precisar</span>
      </div>

      <Disclosure
        icon={<AudioLines className="size-4" />}
        summary={`${draft.transcription.vad.enabled ? "Ativada" : "Desativada"} · limiar ${String(draft.transcription.vad.threshold)} · margem ${String(draft.transcription.vad.speechPadMs)} ms`}
        title="Detecção de voz (VAD)"
      >
        <VadEditor onChange={change} profile={draft} />
      </Disclosure>

      <Disclosure
        badge={promptsCustomised ? undefined : <Badge>Padrão</Badge>}
        icon={<MessageSquareQuote className="size-4" />}
        summary="Refino, extração e consolidação"
        title="Prompts do pipeline"
      >
        <div className="flex flex-col gap-5">
          <PromptEditor
            defaultPrompt={promptDefaults?.refinement}
            label="Prompt de refinamento"
            onChange={(prompt) => change({ ...draft, refinement: { ...draft.refinement, prompt } })}
            toggleLabel="Enviar prompt de refinamento"
            value={draft.refinement.prompt}
          />
          <PromptEditor
            defaultPrompt={promptDefaults?.summaryExtraction}
            label="Prompt do resumo — extração"
            onChange={(extractionPrompt) =>
              change({ ...draft, summary: { ...draft.summary, extractionPrompt } })
            }
            toggleLabel="Enviar prompt de extração"
            value={draft.summary.extractionPrompt}
          />
          <PromptEditor
            defaultPrompt={promptDefaults?.summaryConsolidation}
            label="Prompt do resumo — consolidação"
            onChange={(consolidationPrompt) =>
              change({ ...draft, summary: { ...draft.summary, consolidationPrompt } })
            }
            toggleLabel="Enviar prompt de consolidação"
            value={draft.summary.consolidationPrompt}
          />
        </div>
      </Disclosure>

      <Disclosure
        icon={<Settings2 className="size-4" />}
        summary="Temperatura, seed, think, tamanho de chunk, junção de falas"
        title="Geração e fatiamento"
      >
        <div className="flex flex-col gap-5">
          <div>
            <div className="label-mono mb-2 text-ink-muted">Transcrição</div>
            <TranscriptionSettings onChange={change} profile={draft} />
          </div>
          <div>
            <div className="label-mono mb-2 text-ink-muted">Refinamento</div>
            <PhaseSettings onChange={change} phase="refinement" profile={draft} />
          </div>
          <div>
            <div className="label-mono mb-2 text-ink-muted">Resumo</div>
            <PhaseSettings onChange={change} phase="summary" profile={draft} />
          </div>
        </div>
      </Disclosure>

      {draft.language !== "auto" && draft.translation !== null && (
        <Disclosure
          icon={<Languages className="size-4" />}
          summary="Modelo e prompt usados quando o idioma difere do predominante"
          title="Tradução"
        >
          <div className="flex flex-col gap-4">
            <TranslationSettings onChange={change} profile={draft} />
            <PromptEditor
              defaultPrompt="Traduza somente os campos permitidos e preserve os termos protegidos."
              label="Prompt de tradução"
              onChange={(prompt) =>
                change({ ...draft, translation: { ...draft.translation, prompt } })
              }
              toggleLabel="Usar prompt de tradução"
              value={draft.translation.prompt}
            />
          </div>
        </Disclosure>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} type="submit">
          {busy ? "Salvando…" : "Salvar perfil"}
        </Button>
        <Button
          disabled={busy || items.length === 1 || item.active}
          onClick={() => void remove()}
          type="button"
          variant="danger"
        >
          Excluir
        </Button>
        {item.active && (
          <span className="text-[11.5px] text-ink-muted">
            Este perfil está ativo em {String(item.activeServerCount ?? 1)} servidor(es). As
            alterações valem nas próximas reuniões.
          </span>
        )}
      </div>
    </form>
  );
}
