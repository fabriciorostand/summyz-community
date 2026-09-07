import { Bot } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { api, type Profile, type ProfileListItem, type PromptDefaults, profileSchema } from "./api";
import { Button, Field } from "./components";

import { LanguageSelector, nextLocalizedProfileName } from "./profile-language";
import { PhaseEditor, TranslationEditor } from "./profile-phase-editor";

export function ProfileEditor({
  items,
  locale,
  onSelect,
  onItemsChange,
  selected,
  selectedProfileId,
}: {
  items: ProfileListItem[];
  locale: "en" | "pt-BR";
  onSelect: (id: string) => void;
  onItemsChange: (value: ProfileListItem[]) => void;
  selected: Profile | null;
  selectedProfileId: string | null;
}) {
  const [draft, setDraft] = useState<Profile | null>(selected);
  const [promptDefaults, setPromptDefaults] = useState<PromptDefaults>();
  const [transcriptionTab, setTranscriptionTab] = useState<"model" | "vad">("model");
  const previousPromptDefaults = useRef<PromptDefaults | undefined>(undefined);
  const promptProfileId = draft?.profileId;
  const promptSummaryLanguage = draft?.language;
  useEffect(() => {
    previousPromptDefaults.current = undefined;
    setPromptDefaults(undefined);
    setDraft(selected);
  }, [selected]);
  useEffect(() => {
    if (promptProfileId === undefined || promptSummaryLanguage === undefined) return;
    const profileId = promptProfileId;
    const summaryLanguage = promptSummaryLanguage;
    const previous = previousPromptDefaults.current;
    let active = true;
    void api.getPromptDefaults(summaryLanguage).then((next) => {
      if (!active) return;
      setDraft((current) => {
        if (
          current === null ||
          current.profileId !== profileId ||
          current.language !== summaryLanguage ||
          previous === undefined
        ) {
          return current;
        }
        return profileSchema.parse({
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
        });
      });
      previousPromptDefaults.current = next;
      setPromptDefaults(next);
    });
    return () => {
      active = false;
    };
  }, [promptProfileId, promptSummaryLanguage]);
  if (draft === null) return null;
  const currentDraft = draft;
  async function save(event: FormEvent) {
    event.preventDefault();
    const currentItem = items.find((item) => item.profile.profileId === currentDraft.profileId);
    if (
      currentItem?.active === true &&
      !window.confirm(
        "Este perfil está ativo em um ou mais servidores. As alterações valerão nas próximas reuniões. Deseja salvar?",
      )
    ) {
      return;
    }
    await api.updateProfile(currentDraft);
    onItemsChange(
      items.map((item) =>
        item.profile.profileId === currentDraft.profileId
          ? { ...item, profile: currentDraft }
          : item,
      ),
    );
  }
  async function create() {
    const { profileId: _profileId, userId: _userId, ...base } = currentDraft;
    const created = await api.createProfile({
      ...base,
      name: nextLocalizedProfileName(items, locale),
    });
    onItemsChange([...items, { active: false, profile: created }]);
    onSelect(created.profileId);
  }
  async function remove() {
    await api.deleteProfile(currentDraft.profileId);
    const remaining = items.filter((item) => item.profile.profileId !== currentDraft.profileId);
    onItemsChange(remaining);
    onSelect(remaining[0]?.profile.profileId ?? "");
  }
  return (
    <>
      <div className="section-title profile-heading">
        <span>
          <Bot />
        </span>
        <div>
          <h2>Perfis de IA</h2>
          <p>Configure modelos e parâmetros reutilizáveis em seus servidores.</p>
        </div>
        <Button className="secondary" onClick={create}>
          Novo perfil
        </Button>
      </div>
      <div className="profile-tabs">
        {items.map(({ active, profile }) => (
          <button
            className={profile.profileId === selectedProfileId ? "active" : ""}
            key={profile.profileId}
            onClick={() => onSelect(profile.profileId)}
            type="button"
          >
            {profile.name}
            {active && <i>Em uso</i>}
          </button>
        ))}
      </div>
      <form className="panel stack" onSubmit={save}>
        <div className="profile-actions">
          <Field
            label="Nome do perfil"
            value={currentDraft.name}
            onChange={(event) => setDraft({ ...currentDraft, name: event.currentTarget.value })}
          />
        </div>
        <LanguageSelector
          value={currentDraft.language}
          onChange={(language) => {
            const translation =
              language === "auto"
                ? null
                : (currentDraft.translation ?? {
                    generation: {},
                    model: null,
                    prompt: null,
                    provider: currentDraft.profileType === "external" ? "openrouter" : "ollama",
                  });
            setDraft(profileSchema.parse({ ...currentDraft, language, translation }));
          }}
        />
        <aside className="model-license-note" role="note">
          <strong>Licenças dos modelos</strong>
          <span>
            Modelos são fornecidos por terceiros e não fazem parte do Summyz Community. Verifique a
            licença e os termos de cada modelo antes de usá-lo; IDs personalizados continuam
            permitidos.
          </span>
        </aside>
        <p className="field-hint">
          Em auto, o resumo usa o idioma predominante. Se o idioma escolhido já for exatamente o
          predominante da call, a tradução será ignorada e não gerará custo.
        </p>
        <PhaseEditor
          phase="Transcrição"
          profile={currentDraft}
          promptDefaults={promptDefaults}
          transcriptionTab={transcriptionTab}
          onTranscriptionTabChange={setTranscriptionTab}
          onChange={(next) => setDraft(profileSchema.parse(next))}
        />
        {currentDraft.language !== "auto" && currentDraft.translation !== null && (
          <TranslationEditor
            profile={currentDraft}
            onChange={(next) => setDraft(profileSchema.parse(next))}
          />
        )}
        <PhaseEditor
          phase="Refinamento"
          profile={currentDraft}
          promptDefaults={promptDefaults}
          onChange={(next) => setDraft(profileSchema.parse(next))}
        />
        <PhaseEditor
          phase="Resumo"
          profile={currentDraft}
          promptDefaults={promptDefaults}
          onChange={(next) => setDraft(profileSchema.parse(next))}
        />
        <div className="form-actions">
          <Button type="submit">Salvar perfil</Button>
          <Button
            className="danger"
            disabled={
              items.length === 1 ||
              items.some((item) => item.profile.profileId === currentDraft.profileId && item.active)
            }
            onClick={remove}
            type="button"
          >
            Excluir perfil
          </Button>
        </div>
      </form>
    </>
  );
}
