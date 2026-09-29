import { Plus } from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { ErrorState, LoadingPanel } from "../../components/states";
import { Button } from "../../components/ui";
import { invalidateModelCatalogs } from "../../hooks/use-model-catalog";
import { type ModelDownloads, useModelDownloads } from "../../hooks/use-model-downloads";
import type { Messages } from "../../i18n/messages/pt-BR";
import { type I18nSnapshot, useI18n } from "../../i18n/store";
import { TopBar } from "../../layout/top-bar";
import {
  ApiError,
  api,
  type ModelDownload,
  type Profile,
  type ProfileListItem,
  type PromptDefaults,
  profileSchema,
} from "../../lib/api";
import { Screen } from "../screen";
import { DiscardDialog } from "./discard-dialog";
import { type Feedback, FeedbackToast } from "./feedback-toast";
import { languageLabel, nextLocalizedProfileName } from "./language-selector";
import { downloadProgress } from "./model-labels";
import { AvailabilityBanner, useMissingModels } from "./profile-availability";
import { ProfileHeader } from "./profile-header";
import { ProfilePicker } from "./profile-picker";
import {
  acknowledgeReview,
  changeExecution,
  type Execution,
  executionOf,
  incompleteStages,
  profileTypeOf,
  resolveReview,
  type Stage,
  type StageReview,
  stages,
  summaryPromptLanguage,
} from "./profile-stages";
import { SaveBar, type SaveBlocker } from "./save-bar";
import { StagePanel } from "./stage-panel";
import { type StageNote, StageTrail } from "./stage-trail";

/** Structural equality that ignores key order, since edits rebuild objects in other orders. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftEntries = Object.entries(left).filter(([, value]) => value !== undefined);
  const rightEntries = Object.entries(right).filter(([, value]) => value !== undefined);
  if (leftEntries.length !== rightEntries.length) return false;
  const rightMap = new Map(rightEntries);
  return leftEntries.every(
    ([key, value]) => rightMap.has(key) && sameValue(value, rightMap.get(key)),
  );
}

function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = Object.entries(current).find(([name]) => name === key)?.[1];
  }
  return current;
}

function saveErrorMessage(error: unknown, t: Messages): string {
  return (
    (error instanceof ApiError ? t.profiles.saveErrors[error.code] : undefined) ??
    t.profiles.saveFailed
  );
}

/** A default prompt takes the new default; custom text stays exactly as written. */
function followDefault(
  mode: Profile["promptModes"]["refinement"],
  current: string | null,
  next: string,
): string | null {
  return mode === "default" ? next : current;
}

/**
 * Loads the server's English defaults for the effective summary language. Switching that
 * language moves every prompt still in default mode to the new default, so what the editor
 * holds matches what the server will store.
 */
function usePromptDefaults(
  profile: Profile,
  setDraft: Dispatch<SetStateAction<Profile | null>>,
): PromptDefaults | undefined {
  const [defaults, setDefaults] = useState<PromptDefaults>();
  const previous = useRef<PromptDefaults | undefined>(undefined);
  const language = summaryPromptLanguage(profile);
  const { profileId } = profile;

  useEffect(() => {
    let current = true;
    api.getPromptDefaults(language).then(
      (next) => {
        if (!current) return;
        if (previous.current !== undefined) {
          setDraft((draft) =>
            draft !== null &&
            draft.profileId === profileId &&
            summaryPromptLanguage(draft) === language
              ? {
                  ...draft,
                  summary: {
                    ...draft.summary,
                    consolidationPrompt: followDefault(
                      draft.promptModes.summaryConsolidation,
                      draft.summary.consolidationPrompt,
                      next.summaryConsolidation,
                    ),
                    extractionPrompt: followDefault(
                      draft.promptModes.summaryExtraction,
                      draft.summary.extractionPrompt,
                      next.summaryExtraction,
                    ),
                  },
                }
              : draft,
          );
        }
        previous.current = next;
        setDefaults(next);
      },
      () => {
        // Without defaults the prompt editors hide "restore"; editing keeps working.
        if (current) setDefaults(undefined);
      },
    );
    return () => {
      current = false;
    };
  }, [language, profileId, setDraft]);

  return defaults;
}

export function ProfilesPage() {
  const i18n = useI18n();
  const { format, language, t } = i18n;
  const [items, setItems] = useState<ProfileListItem[]>();
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [stage, setStage] = useState<Stage>("transcription");
  const [review, setReview] = useState<StageReview>(new Map());
  const [needsModel, setNeedsModel] = useState<ReadonlySet<Stage>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ run: () => void } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackId = useRef(0);

  const notify = useCallback((text: string, tone: Feedback["tone"] = "ok") => {
    feedbackId.current += 1;
    setFeedback({ id: feedbackId.current, text, tone });
  }, []);

  const open = useCallback((profileId: string, list: readonly ProfileListItem[]) => {
    const target = list.find((item) => item.profile.profileId === profileId) ?? list[0];
    setSelectedId(target?.profile.profileId ?? null);
    setDraft(target?.profile ?? null);
    setStage("transcription");
    setReview(new Map());
    setNeedsModel(new Set());
    setConfirming(false);
    setSaveError(null);
    setNameError(null);
  }, []);

  const load = useCallback(async () => {
    setLoadError(false);
    setItems(undefined);
    try {
      const next = await api.listProfiles();
      setItems(next);
      open(next[0]?.profile.profileId ?? "", next);
    } catch {
      setLoadError(true);
    }
  }, [open]);

  /** Reads availability and usage again without touching the edit in progress. */
  const refresh = useCallback(async () => {
    try {
      const next = await api.listProfiles();
      setItems(next);
      return next;
    } catch {
      notify(t.profiles.refreshFailed, "fail");
      return undefined;
    }
  }, [notify, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSettled = useCallback(
    (job: ModelDownload) => {
      invalidateModelCatalogs();
      void refresh();
      if (job.status === "completed") notify(t.profiles.installed(job.model));
      if (job.status === "failed") notify(t.profiles.downloadFailed(job.model), "fail");
    },
    [notify, refresh, t],
  );
  const downloads = useModelDownloads(onSettled);

  const selected = items?.find((item) => item.profile.profileId === selectedId);
  const dirty =
    draft !== null &&
    selected !== undefined &&
    (needsModel.size > 0 || !sameValue(draft, selected.profile));

  function guard(action: () => void) {
    if (dirty) setPending({ run: action });
    else action();
  }

  async function create() {
    if (items === undefined || selected === undefined) return;
    if (incompleteStages(selected.profile).length > 0) {
      notify(t.profiles.completeBeforeCopy, "fail");
      return;
    }
    const { profileId: _profileId, profileType: _profileType, ...base } = selected.profile;
    try {
      const created = await api.createProfile({
        ...base,
        name: nextLocalizedProfileName(items, t.profiles.newProfilePrefix, language),
      });
      const refreshed = (await refresh()) ?? items;
      // The copy shows up even when the refreshed list does not carry it yet.
      const next = refreshed.some((item) => item.profile.profileId === created.profileId)
        ? refreshed
        : [...refreshed, { ...selected, active: false, activeServerCount: 0, profile: created }];
      if (next !== refreshed) setItems(next);
      open(created.profileId, next);
      notify(t.profiles.created(created.name));
    } catch (error) {
      notify(saveErrorMessage(error, t), "fail");
    }
  }

  async function remove(profileId: string) {
    try {
      await api.deleteProfile(profileId);
      const next = (items ?? []).filter((item) => item.profile.profileId !== profileId);
      setItems(next);
      open(next[0]?.profile.profileId ?? "", next);
      notify(t.profiles.deleted);
    } catch {
      notify(t.profiles.deleteFailed, "fail");
    }
  }

  return (
    <>
      <TopBar
        actions={
          <>
            {items !== undefined && draft !== null && selected !== undefined && (
              <ProfilePicker
                draft={draft}
                items={items}
                onSelect={(profileId) => guard(() => open(profileId, items))}
                selectedId={selected.profile.profileId}
              />
            )}
            <Button
              disabled={items === undefined || selected === undefined}
              onClick={() => guard(() => void create())}
              size="toolbar"
              type="button"
            >
              <Plus className="size-3.5" />
              {t.profiles.newProfile}
            </Button>
          </>
        }
        title={t.profiles.title}
      />
      <Screen>
        {loadError ? (
          <ErrorState
            code="request_failed"
            onRetry={() => void load()}
            title={t.profiles.unavailableTitle}
          >
            {t.profiles.unavailableBody}
          </ErrorState>
        ) : items === undefined ? (
          <LoadingPanel label={t.profiles.loading} />
        ) : draft === null || selected === undefined ? (
          <p className="m-0 text-[13px] text-ink-muted">{t.profiles.empty}</p>
        ) : (
          <ProfileEditor
            confirming={confirming}
            dirty={dirty}
            downloads={downloads}
            draft={draft}
            items={items}
            nameError={nameError}
            needsModel={needsModel}
            onChange={(next) => {
              const parsed = profileSchema.parse(next);
              // Only a field the person actually edited can clear its own review.
              setReview((current) =>
                [...current.keys()]
                  .filter((path) => !Object.is(readPath(draft, path), readPath(parsed, path)))
                  .reduce(
                    (result, path) => resolveReview(result, path, readPath(parsed, path)),
                    current,
                  ),
              );
              setDraft(parsed);
              setSaveError(null);
            }}
            onConfirmingChange={setConfirming}
            onDelete={() => void remove(selected.profile.profileId)}
            onDiscard={() => open(selected.profile.profileId, items)}
            onModelsChanged={() => void refresh()}
            onNameChange={(name) => {
              setDraft({ ...draft, name });
              setNameError(null);
            }}
            onReviewChange={setReview}
            onNeedsModelChange={setNeedsModel}
            onSaved={async (saved, missing) => {
              setItems((current) =>
                current?.map((item) =>
                  item.profile.profileId === saved.profileId ? { ...item, profile: saved } : item,
                ),
              );
              setDraft(saved);
              setNeedsModel(new Set());
              setReview(new Map());
              setConfirming(false);
              notify(
                missing.length > 0
                  ? t.profiles.savedMissing(format.list(missing))
                  : t.profiles.saved,
              );
              await refresh();
            }}
            onSaveError={(error) => {
              if (error instanceof ApiError && error.code === "profile_name_conflict") {
                setNameError(t.profiles.nameConflict(draft.name));
                setSaveError(t.profiles.nameConflictSave);
              } else {
                setSaveError(saveErrorMessage(error, t));
              }
              setConfirming(false);
            }}
            onStageChange={setStage}
            review={review}
            saveError={saveError}
            saving={saving}
            selected={selected}
            setDraft={setDraft}
            setSaving={setSaving}
            stage={stage}
          />
        )}
      </Screen>
      <DiscardDialog
        name={draft?.name ?? ""}
        onDiscard={() => {
          const action = pending;
          setPending(null);
          action?.run();
        }}
        onKeep={() => setPending(null)}
        open={pending !== null}
      />
      <FeedbackToast feedback={feedback} onDone={() => setFeedback(null)} />
    </>
  );
}

interface ProfileEditorProps {
  confirming: boolean;
  dirty: boolean;
  downloads: ModelDownloads;
  draft: Profile;
  items: readonly ProfileListItem[];
  nameError: string | null;
  needsModel: ReadonlySet<Stage>;
  onChange: (profile: unknown) => void;
  onConfirmingChange: (confirming: boolean) => void;
  onDelete: () => void;
  onDiscard: () => void;
  onModelsChanged: () => void;
  onNameChange: (name: string) => void;
  onNeedsModelChange: (stages: ReadonlySet<Stage>) => void;
  onReviewChange: (review: StageReview) => void;
  onSaved: (profile: Profile, missingModels: string[]) => Promise<void>;
  onSaveError: (error: unknown) => void;
  onStageChange: (stage: Stage) => void;
  review: StageReview;
  saveError: string | null;
  saving: boolean;
  selected: ProfileListItem;
  setDraft: Dispatch<SetStateAction<Profile | null>>;
  setSaving: (saving: boolean) => void;
  stage: Stage;
}

function ProfileEditor(props: ProfileEditorProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const { draft, needsModel, review, selected, stage } = props;
  const promptDefaults = usePromptDefaults(draft, props.setDraft);
  const draftMissing = useMissingModels(draft);
  const missing = props.dirty ? draftMissing : selected.availability.missingModels;

  const stageDirty = (item: Stage) =>
    needsModel.has(item) ||
    !sameValue(draft[item], selected.profile[item]) ||
    (item === "summary" && draft.language !== selected.profile.language);
  const dirtyStages: Record<Stage, boolean> = {
    refinement: stageDirty("refinement"),
    summary: stageDirty("summary"),
    transcription: stageDirty("transcription"),
  };
  const notes: Record<Stage, StageNote> = {
    refinement: stageNote("refinement", props, missing, i18n),
    summary: stageNote("summary", props, missing, i18n),
    transcription: stageNote("transcription", props, missing, i18n),
  };

  const incomplete = incompleteStages(draft);
  const reviewStages = stages.filter((item) =>
    [...review.keys()].some((path) => path.startsWith(`${item}.`)),
  );
  const blocker: SaveBlocker | null =
    incomplete.length > 0
      ? { kind: "incomplete", stages: incomplete }
      : review.size > 0
        ? { count: review.size, kind: "review", stages: reviewStages }
        : null;

  function changeStageExecution(execution: Execution) {
    const change = changeExecution(draft, selected.profile, review, stage, execution);
    props.setDraft(change.profile);
    props.onReviewChange(change.review);
    const next = new Set(needsModel);
    if (change.needsModel) next.add(stage);
    else next.delete(stage);
    props.onNeedsModelChange(next);
  }

  async function save(confirmed: boolean) {
    if (blocker !== null) return;
    if (selected.activeServerCount > 0 && !confirmed) {
      props.onConfirmingChange(true);
      return;
    }
    props.setSaving(true);
    try {
      await api.updateProfile(draft);
      await props.onSaved(
        { ...draft, profileType: profileTypeOf(draft) },
        missing.map((entry) => entry.model),
      );
    } catch (error) {
      props.onSaveError(error);
    } finally {
      props.setSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ProfileHeader
        activeServerCount={selected.activeServerCount}
        busy={props.saving}
        name={draft.name}
        nameError={props.nameError}
        onDelete={props.onDelete}
        onlyProfile={props.items.length === 1}
        onNameChange={props.onNameChange}
        savedName={selected.profile.name}
        type={profileTypeOf(draft)}
      />
      <AvailabilityBanner
        activeServerCount={selected.activeServerCount}
        availability={selected.availability}
        changed={props.dirty}
        downloads={props.downloads}
        draftMissing={draftMissing}
      />
      <StageTrail
        dirty={dirtyStages}
        notes={notes}
        onSelect={props.onStageChange}
        profile={draft}
        selected={stage}
      />
      <StagePanel
        downloads={props.downloads}
        needsModel={needsModel.has(stage)}
        onAcknowledge={(path) => props.onReviewChange(acknowledgeReview(review, path))}
        onChange={props.onChange}
        onExecution={changeStageExecution}
        onModel={(model) => {
          props.onChange({ ...draft, [stage]: { ...draft[stage], model } });
          const next = new Set(needsModel);
          next.delete(stage);
          props.onNeedsModelChange(next);
        }}
        onModelsChanged={props.onModelsChanged}
        profile={draft}
        promptDefaults={promptDefaults}
        review={review}
        stage={stage}
      />
      {props.dirty && (
        // Leaves room at the end of the page so the fixed bar never covers the last settings.
        <div className="h-28">
          <SaveBar
            activeServerCount={selected.activeServerCount}
            blocker={blocker}
            busy={props.saving}
            changes={[
              ...(draft.name === selected.profile.name ? [] : [t.profiles.name]),
              ...stages.filter((item) => dirtyStages[item]).map((item) => t.stages.titles[item]),
            ]}
            confirming={props.confirming}
            error={props.saveError}
            missingModels={missing.map((entry) => entry.model)}
            onBack={() => props.onConfirmingChange(false)}
            onConfirm={() => void save(true)}
            onDiscard={props.onDiscard}
            onGoTo={props.onStageChange}
            onSave={() => void save(false)}
          />
        </div>
      )}
    </div>
  );
}

function stageNote(
  stage: Stage,
  { downloads, draft, needsModel, review }: ProfileEditorProps,
  missing: readonly { model: string; phase: Stage; provider: ModelDownload["provider"] }[],
  i18n: I18nSnapshot,
): StageNote {
  const { format, t } = i18n;
  if (executionOf(draft, stage) === null) {
    return { text: t.profiles.chooseExecutionNote, tone: "warn" };
  }
  if (needsModel.has(stage) || draft[stage].model === null) {
    return { text: t.profiles.chooseModelNote, tone: "warn" };
  }
  const reviewCount = [...review.keys()].filter((path) => path.startsWith(`${stage}.`)).length;
  if (reviewCount > 0) return { text: t.profiles.reviewFields(reviewCount), tone: "warn" };
  const absent = missing.find((entry) => entry.phase === stage);
  if (absent !== undefined) {
    const job = downloads.jobFor(absent.provider, absent.model);
    if (job !== undefined && job.status !== "failed") {
      return { text: downloadProgress(job, i18n).label };
    }
    return { text: t.profiles.notInstalled, tone: "warn" };
  }
  if (stage === "transcription") {
    return {
      text: languageLabel(draft.transcription.language, t.profiles.detectedLanguage, format),
    };
  }
  if (stage === "refinement") {
    const sent = draft.promptModes.refinement === "default" || draft.refinement.prompt !== null;
    return { text: sent ? t.profiles.withRefinementPrompt : t.profiles.noPrompt };
  }
  return { text: languageLabel(draft.language, t.profiles.sameAsMeeting, format) };
}
