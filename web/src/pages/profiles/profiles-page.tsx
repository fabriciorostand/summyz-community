import { AudioLines, Bot, MessageSquareQuote, Plus, Settings2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { Disclosure, Tabs } from "../../components/disclosure";
import { ErrorState, LoadingPanel } from "../../components/states";
import { Badge, Button, Card, Field, HelpTip, RailLabel } from "../../components/ui";
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
import { PhaseSettings, TranscriptionSettings } from "./generation-editor";
import { LanguageSelector, nextLocalizedProfileName } from "./language-selector";
import { PromptEditor } from "./prompt-editor";
import { VadEditor } from "./vad-editor";

function firstProfileId(
  items: readonly ProfileListItem[],
  profileType: Profile["profileType"],
): string | null {
  return items.find((item) => item.profile.profileType === profileType)?.profile.profileId ?? null;
}

export function ProfilesPage() {
  const { settings } = useDashboard();
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
      setSelectedProfileId(firstProfileId(next, "external"));
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

  function selectType(next: Profile["profileType"]) {
    setProfileType(next);
    setSelectedProfileId(firstProfileId(items ?? [], next));
  }

  function replaceProfile(profile: Profile) {
    setItems(
      (items ?? []).map((item) =>
        item.profile.profileId === profile.profileId ? { ...item, profile } : item,
      ),
    );
  }

  function addProfile(profile: Profile) {
    setItems([...(items ?? []), { active: false, profile }]);
    setSelectedProfileId(profile.profileId);
  }

  function dropProfile(profileId: string) {
    const remaining = (items ?? []).filter((item) => item.profile.profileId !== profileId);
    setItems(remaining);
    setSelectedProfileId(firstProfileId(remaining, profileType));
  }

  return (
    <>
      <TopBar
        actions={
          items !== undefined &&
          selected !== undefined && (
            <CreateProfileButton
              items={items}
              locale={settings.dashboardLanguage}
              onCreated={addProfile}
              template={selected.profile}
            />
          )
        }
        meta={
          <HelpTip>
            Perfis são globais da instalação: qualquer servidor pode ativar qualquer perfil.
          </HelpTip>
        }
        title="Perfis de IA"
      />
      <Screen>
        <ProfilesBody
          items={items}
          loadError={loadError}
          onDeleted={dropProfile}
          onRetry={() => void load()}
          onSaved={replaceProfile}
          onSelect={setSelectedProfileId}
          onTypeChange={selectType}
          profileType={profileType}
          selected={selected}
          visible={visible}
        />
      </Screen>
    </>
  );
}

interface ProfilesBodyProps {
  items: ProfileListItem[] | undefined;
  loadError: boolean;
  onDeleted: (profileId: string) => void;
  onRetry: () => void;
  onSaved: (profile: Profile) => void;
  onSelect: (profileId: string) => void;
  onTypeChange: (value: Profile["profileType"]) => void;
  profileType: Profile["profileType"];
  selected: ProfileListItem | undefined;
  visible: ProfileListItem[];
}

function ProfilesBody(props: ProfilesBodyProps) {
  if (props.loadError) {
    return (
      <ErrorState code="request_failed" onRetry={props.onRetry} title="Perfis indisponíveis">
        Não foi possível carregar seus perfis.
      </ErrorState>
    );
  }
  if (props.items === undefined) return <LoadingPanel label="Carregando perfis…" />;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <Tabs
          ariaLabel="Tipo de execução"
          fill
          onChange={props.onTypeChange}
          options={[
            { label: "API externa", value: "external" },
            { label: "Local", value: "local" },
          ]}
          value={props.profileType}
        />
        <ProfileList
          onSelect={props.onSelect}
          selectedProfileId={props.selected?.profile.profileId}
          visible={props.visible}
        />
      </div>
      {props.selected !== undefined && (
        <ProfileEditor
          item={props.selected}
          items={props.visible}
          key={props.selected.profile.profileId}
          onDeleted={props.onDeleted}
          onSaved={props.onSaved}
        />
      )}
    </div>
  );
}

function ProfileList({
  onSelect,
  selectedProfileId,
  visible,
}: {
  onSelect: (profileId: string) => void;
  selectedProfileId: string | undefined;
  visible: readonly ProfileListItem[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {visible.map(({ active, profile }) => (
        <ProfileListButton
          active={active}
          key={profile.profileId}
          onSelect={onSelect}
          profile={profile}
          selected={profile.profileId === selectedProfileId}
        />
      ))}
    </div>
  );
}

function ProfileListButton({
  active,
  onSelect,
  profile,
  selected,
}: {
  active: boolean;
  onSelect: (profileId: string) => void;
  profile: Profile;
  selected: boolean;
}) {
  return (
    <button
      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        selected
          ? "border-action bg-action-soft"
          : "border-line bg-surface-raised hover:border-line-strong"
      }`}
      onClick={() => onSelect(profile.profileId)}
      type="button"
    >
      <Bot className="size-4 shrink-0 text-accent" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <strong className="truncate text-[12.5px] font-medium text-ink">{profile.name}</strong>
        <small className="label-mono truncate text-ink-muted">
          {profile.summary.model ?? "padrão"} · {profile.language}
        </small>
      </span>
      {active && <Badge tone="action">Em uso</Badge>}
    </button>
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
    const { profileId: _profileId, ...base } = template;
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

/** Keeps a prompt only while the operator customised it; untouched defaults follow the language. */
function keepCustom(
  current: string | null,
  previousDefault: string,
  nextDefault: string,
): string | null {
  return current === previousDefault ? nextDefault : current;
}

/** The summary follows the transcription language while its own language is auto. */
function summaryPromptLanguage(profile: Profile): string {
  return profile.language === "auto" ? profile.transcription.language : profile.language;
}

function retargetPrompts(
  profile: Profile,
  previous: PromptDefaults,
  next: PromptDefaults,
): Profile {
  return profileSchema.parse({
    ...profile,
    summary: {
      ...profile.summary,
      consolidationPrompt: keepCustom(
        profile.summary.consolidationPrompt,
        previous.summaryConsolidation,
        next.summaryConsolidation,
      ),
      extractionPrompt: keepCustom(
        profile.summary.extractionPrompt,
        previous.summaryExtraction,
        next.summaryExtraction,
      ),
    },
  });
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
  const { profileId } = draft;
  const promptLanguage = summaryPromptLanguage(draft);

  // Switching the summary output language rewrites the prompts that still hold the previous defaults.
  useEffect(() => {
    let active = true;
    void api.getPromptDefaults(promptLanguage).then((next) => {
      if (!active) return;
      const previous = previousDefaults.current;
      if (previous !== undefined) {
        setDraft((current) =>
          current.profileId === profileId && summaryPromptLanguage(current) === promptLanguage
            ? retargetPrompts(current, previous, next)
            : current,
        );
      }
      previousDefaults.current = next;
      setPromptDefaults(next);
    });
    return () => {
      active = false;
    };
  }, [promptLanguage, profileId]);

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
            label="Idioma da transcrição"
            onChange={(language) =>
              change({ ...draft, transcription: { ...draft.transcription, language } })
            }
            value={draft.transcription.language}
          />
          <LanguageSelector
            label="Idioma do resumo"
            onChange={(language) => change({ ...draft, language })}
            value={draft.language}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        </div>
      </Card>

      <div className="mt-2 flex items-center gap-3">
        <span className="label-mono text-ink-muted">Avançado</span>
        <span className="h-px flex-1 bg-line-soft" />
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
