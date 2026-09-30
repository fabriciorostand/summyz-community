import { createHash } from "node:crypto";

import {
  ChannelType,
  type Client,
  type ForumChannel,
  type GuildTextBasedChannel,
  ThreadAutoArchiveDuration,
} from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { GuildConfigurationStore, SummaryForumConfiguration } from "../guild-config-store.js";
import type { RecordingManifest } from "../recording/manifest.js";
import { createPublicationState, type PublicationState } from "../summary/publication-state.js";
import type { PublicationStore } from "../summary/publication-store.js";
import type { PublicSummary } from "../summary/summary-result.js";

interface PublicationText {
  assignee: string;
  auditReason: string;
  deadline: string;
  decisions: string;
  defaultVoiceChannel: string;
  discussedTopics: string;
  executiveSummary: string;
  failureMessage: string;
  fullTranscript: string;
  meetingId: string;
  openIssues: string;
  summary: string;
  summaryUnavailable: string;
  tasks: string;
  transcript: string;
}

type PublishingState = Extract<PublicationState, { status: "publishing" }>;

const publicationTexts = {
  en: {
    assignee: "Assignee",
    auditReason: "Publishing result for meeting",
    deadline: "Deadline",
    decisions: "Decisions",
    defaultVoiceChannel: "Voice channel",
    discussedTopics: "Discussed topics",
    executiveSummary: "Executive summary",
    failureMessage: "⚠️ Unable to publish the summary and transcript to the configured channel.",
    fullTranscript: "📎 Full voice call transcript:",
    meetingId: "Meeting ID",
    openIssues: "Open issues and notes",
    summary: "Summary",
    summaryUnavailable:
      "The summary could not be generated after the configured attempts. " +
      "The summary is unavailable, but the full transcript is attached.",
    tasks: "Tasks",
    transcript: "Transcript",
  },
  "pt-BR": {
    assignee: "Responsável",
    auditReason: "Publicação do resultado da reunião",
    deadline: "Prazo",
    decisions: "Decisões",
    defaultVoiceChannel: "Canal de voz",
    discussedTopics: "Tópicos discutidos",
    executiveSummary: "Resumo executivo",
    failureMessage: "⚠️ Não foi possível publicar o resumo e a transcrição no canal configurado.",
    fullTranscript: "📎 Transcrição completa da call:",
    meetingId: "ID da reunião",
    openIssues: "Pendências e observações",
    summary: "Resumo",
    summaryUnavailable:
      "Não foi possível gerar o resumo após as tentativas configuradas. " +
      "O resumo está indisponível, mas a transcrição completa está anexada.",
    tasks: "Tarefas",
    transcript: "Transcrição",
  },
} as const satisfies Record<AppConfig["botLanguage"], PublicationText>;

const resolvePublicationText = (
  language: AppConfig["botLanguage"],
  summary?: PublicSummary,
): PublicationText => ({
  ...publicationTexts[language],
  ...(summary?.labels === undefined
    ? {}
    : {
        assignee: summary.labels.assignee,
        deadline: summary.labels.deadline,
        decisions: summary.labels.decisions,
        discussedTopics: summary.labels.discussedTopics,
        executiveSummary: summary.labels.executiveSummary,
        fullTranscript: summary.labels.fullTranscript,
        meetingId: summary.labels.meetingId,
        openIssues: summary.labels.observations,
        summary: summary.labels.summary,
        tasks: summary.labels.tasks,
        transcript: summary.labels.transcript,
      }),
});

interface DiscordMeetingPublisherOptions {
  canPublish(manifest: RecordingManifest): Promise<boolean>;
  client: Client;
  guildConfigStore: GuildConfigurationStore;
  language: AppConfig["botLanguage"];
  logger: Logger;
  now?: () => Date;
  onFailure?: (guildId: string, forumId: string) => Promise<void>;
  store: PublicationStore;
  timeZone: string;
}

export interface MeetingPublisher {
  publishSummary(
    manifest: RecordingManifest,
    summary: PublicSummary,
    transcriptPath: string,
  ): Promise<void>;
  publishTranscriptOnly(manifest: RecordingManifest, transcriptPath: string): Promise<void>;
}

export class BotLeftGuildError extends Error {
  public constructor() {
    super("bot_left_guild");
    this.name = "BotLeftGuildError";
  }
}

export class DiscordMeetingPublisher implements MeetingPublisher {
  readonly #canPublish: (manifest: RecordingManifest) => Promise<boolean>;
  readonly #client: Client;
  readonly #guildConfigStore: GuildConfigurationStore;
  readonly #language: AppConfig["botLanguage"];
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #onFailure: ((guildId: string, forumId: string) => Promise<void>) | undefined;
  readonly #store: PublicationStore;
  readonly #timeZone: string;

  public constructor(options: DiscordMeetingPublisherOptions) {
    this.#canPublish = options.canPublish;
    this.#client = options.client;
    this.#guildConfigStore = options.guildConfigStore;
    this.#language = options.language;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
    this.#onFailure = options.onFailure;
    this.#store = options.store;
    this.#timeZone = options.timeZone;
  }

  public async publishSummary(
    manifest: RecordingManifest,
    summary: PublicSummary,
    transcriptPath: string,
  ): Promise<void> {
    await this.#publish(manifest, "summary", transcriptPath, summary);
  }

  public async publishTranscriptOnly(
    manifest: RecordingManifest,
    transcriptPath: string,
  ): Promise<void> {
    await this.#publish(manifest, "transcript_only", transcriptPath);
  }

  async #publish(
    manifest: RecordingManifest,
    mode: PublicationState["mode"],
    transcriptPath: string,
    summary?: PublicSummary,
  ): Promise<void> {
    if (!(await this.#canPublish(manifest))) {
      throw new BotLeftGuildError();
    }
    let state =
      (await this.#store.tryLoad(manifest.meetingId)) ??
      createPublicationState(manifest.meetingId, mode, this.#now().toISOString());
    if (state.mode !== mode) {
      throw new Error("O modo de publicação persistido não corresponde ao resultado da reunião");
    }
    if (state.status === "completed") {
      return;
    }

    try {
      state = await this.#publishPending(state, manifest, mode, transcriptPath, summary);
    } catch (error) {
      await this.#handlePublicationFailure(error, state, manifest);
      throw error;
    }

    const completedAt = this.#now().toISOString();
    if (
      state.rootMessageId === undefined ||
      state.threadId === undefined ||
      state.transcriptMessageId === undefined
    ) {
      throw new Error("A publicação não possui todos os identificadores do Discord");
    }
    const completed = {
      completedAt,
      createdAt: state.createdAt,
      ...(state.failureNotifiedAt === undefined
        ? {}
        : { failureNotifiedAt: state.failureNotifiedAt }),
      meetingId: state.meetingId,
      mode: state.mode,
      rootMessageId: state.rootMessageId,
      schemaVersion: state.schemaVersion,
      status: "completed" as const,
      summaryMessageIds: state.summaryMessageIds,
      threadId: state.threadId,
      transcriptMessageId: state.transcriptMessageId,
      updatedAt: completedAt,
    };
    await this.#store.save(completed);
    this.#logger.info(
      { meetingId: manifest.meetingId, publicationMode: mode, threadId: completed.threadId },
      "Resultado da reunião publicado no Discord",
    );
  }

  async #handlePublicationFailure(
    error: unknown,
    state: PublishingState,
    manifest: RecordingManifest,
  ): Promise<void> {
    if (error instanceof BotLeftGuildError) return;
    if (this.#onFailure !== undefined) {
      try {
        const destination = await this.#guildConfigStore.getSummaryForum(manifest.guildId);
        if (destination !== undefined) {
          await this.#onFailure(manifest.guildId, destination.forumId);
        }
      } catch (diagnosticError) {
        this.#logger.warn(
          {
            errorType:
              diagnosticError instanceof Error ? diagnosticError.name : typeof diagnosticError,
            guildId: manifest.guildId,
          },
          "Unable to inspect bot permissions after publication failure",
        );
      }
    }
    const persistedState = await this.#store.tryLoad(manifest.meetingId).catch(() => undefined);
    const failureState = persistedState?.status === "publishing" ? persistedState : state;
    await this.#notifyFailureOnce(failureState, manifest);
  }

  async #publishPending(
    state: PublishingState,
    manifest: RecordingManifest,
    mode: PublicationState["mode"],
    transcriptPath: string,
    summary?: PublicSummary,
  ): Promise<PublishingState> {
    const language = manifest.botLanguage ?? this.#language;
    const text = resolvePublicationText(language, summary);
    const summaryChunks =
      mode === "summary" && summary !== undefined
        ? formatSummary(manifest.meetingId, summary, text)
        : [];
    const publication = await this.#resolvePublicationThread(
      state,
      manifest,
      mode,
      transcriptPath,
      language,
      text,
      summaryChunks,
    );
    state = await this.#publishSummaryChunks(
      publication.state,
      publication.thread,
      manifest,
      summaryChunks,
    );
    return this.#publishTranscript(state, publication.thread, manifest, transcriptPath, text);
  }

  async #resolvePublicationThread(
    state: PublishingState,
    manifest: RecordingManifest,
    mode: PublicationState["mode"],
    transcriptPath: string,
    language: AppConfig["botLanguage"],
    text: PublicationText,
    summaryChunks: readonly string[],
  ): Promise<{ readonly state: PublishingState; readonly thread: GuildTextBasedChannel }> {
    if (state.threadId !== undefined) {
      return { state, thread: await this.#resolveThread(state.threadId) };
    }
    const destination = await this.#resolveDestination(manifest.guildId);
    const forum = await this.#resolveForum(destination.forumId);
    const title = createPostTitle(
      manifest.startedAt,
      manifest.voiceChannelName ?? text.defaultVoiceChannel,
      mode,
      this.#timeZone,
      language,
      text,
    );
    const firstContent =
      mode === "summary"
        ? summaryChunks[0]
        : `${text.meetingId}: \`${manifest.meetingId}\`\n\n${text.summaryUnavailable}`;
    if (firstContent === undefined)
      throw new Error("O resumo não possui conteúdo para iniciar o post");
    await this.#requirePublicationAccess(manifest);
    const thread = await forum.threads.create({
      ...(destination.tagId === undefined ? {} : { appliedTags: [destination.tagId] }),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      message: {
        allowedMentions: { parse: [] },
        content: firstContent,
        ...(mode === "transcript_only" ? { files: [transcriptPath] } : {}),
      },
      name: title,
      reason: `${text.auditReason} ${manifest.meetingId}`,
    });
    const nextState = await this.#saveProgress(state, {
      rootMessageId: thread.id,
      summaryMessageIds: mode === "summary" ? [thread.id] : [],
      threadId: thread.id,
      ...(mode === "transcript_only" ? { transcriptMessageId: thread.id } : {}),
    });
    return { state: nextState, thread };
  }

  async #publishSummaryChunks(
    state: PublishingState,
    thread: GuildTextBasedChannel,
    manifest: RecordingManifest,
    summaryChunks: readonly string[],
  ): Promise<PublishingState> {
    for (let index = state.summaryMessageIds.length; index < summaryChunks.length; index += 1) {
      const content = summaryChunks[index];
      if (content === undefined) {
        throw new Error("O conteúdo do resumo ficou inconsistente");
      }
      await this.#requirePublicationAccess(manifest);
      const message = await thread.send({
        allowedMentions: { parse: [] },
        content,
        enforceNonce: true,
        nonce: createNonce(manifest.meetingId, `summary:${index}`),
      });
      state = await this.#saveProgress(state, {
        summaryMessageIds: [...state.summaryMessageIds, message.id],
      });
    }
    return state;
  }

  async #publishTranscript(
    state: PublishingState,
    thread: GuildTextBasedChannel,
    manifest: RecordingManifest,
    transcriptPath: string,
    text: PublicationText,
  ): Promise<PublishingState> {
    if (state.transcriptMessageId !== undefined) return state;
    await this.#requirePublicationAccess(manifest);
    const transcriptMessage = await thread.send({
      allowedMentions: { parse: [] },
      content: text.fullTranscript,
      enforceNonce: true,
      files: [transcriptPath],
      nonce: createNonce(manifest.meetingId, "transcript"),
    });
    return this.#saveProgress(state, { transcriptMessageId: transcriptMessage.id });
  }

  async #resolveDestination(guildId: string): Promise<SummaryForumConfiguration> {
    const destination = await this.#guildConfigStore.getSummaryForum(guildId);
    if (destination === undefined) {
      throw new Error("Nenhum fórum de resumos está configurado neste servidor");
    }
    return destination;
  }

  async #requirePublicationAccess(manifest: RecordingManifest): Promise<void> {
    if (!(await this.#canPublish(manifest))) {
      throw new BotLeftGuildError();
    }
  }

  async #resolveForum(channelId: string): Promise<ForumChannel> {
    const channel = await this.#client.channels.fetch(channelId);
    if (channel?.type !== ChannelType.GuildForum) {
      throw new Error("O fórum configurado não está disponível para publicação");
    }
    return channel;
  }

  async #resolveThread(threadId: string): Promise<GuildTextBasedChannel> {
    const channel = await this.#client.channels.fetch(threadId);
    if (channel === null || !channel.isThread() || !channel.isSendable()) {
      throw new Error("O post persistido não está disponível para publicação");
    }
    return channel;
  }

  async #notifyFailureOnce(
    state: Extract<PublicationState, { status: "publishing" }>,
    manifest: RecordingManifest,
  ): Promise<void> {
    if (state.failureNotifiedAt !== undefined) {
      return;
    }
    try {
      const channel = await this.#client.channels.fetch(manifest.notificationChannelId);
      if (channel?.isSendable()) {
        await channel.send({
          allowedMentions: { parse: [] },
          content: publicationTexts[manifest.botLanguage ?? this.#language].failureMessage,
        });
        const now = this.#now().toISOString();
        await this.#store.save({
          ...state,
          failureNotifiedAt: now,
          updatedAt: now,
        });
      }
    } catch (error) {
      this.#logger.warn(
        {
          channelId: manifest.notificationChannelId,
          errorType: getErrorType(error),
          meetingId: manifest.meetingId,
        },
        "Unable to send publication failure notification",
      );
    }
  }

  async #saveProgress(
    state: Extract<PublicationState, { status: "publishing" }>,
    update: Partial<
      Pick<
        Extract<PublicationState, { status: "publishing" }>,
        "rootMessageId" | "summaryMessageIds" | "threadId" | "transcriptMessageId"
      >
    >,
  ): Promise<Extract<PublicationState, { status: "publishing" }>> {
    const updated = {
      ...state,
      ...update,
      updatedAt: this.#now().toISOString(),
    };
    await this.#store.save(updated);
    return updated;
  }
}

function createPostTitle(
  startedAt: string,
  voiceChannelName: string,
  mode: PublicationState["mode"],
  timeZone: string,
  language: AppConfig["botLanguage"],
  text: PublicationText,
): string {
  const parts = new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(startedAt));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const date =
    language === "en"
      ? `${value("month")}/${value("day")}/${value("year")}`
      : `${value("day")}/${value("month")}/${value("year")}`;
  const prefix = mode === "summary" ? text.summary : text.transcript;
  return `${prefix} — ${date} ${value("hour")}:${value("minute")} — ${voiceChannelName}`.slice(
    0,
    100,
  );
}

function formatSummary(meetingId: string, summary: PublicSummary, text: PublicationText): string[] {
  const sections = [
    `${text.meetingId}: \`${meetingId}\`\n\n## ${text.executiveSummary}\n${summary.executiveSummary}`,
  ];
  appendList(sections, text.discussedTopics, summary.discussedTopics);
  appendList(sections, text.decisions, summary.decisions);
  if (summary.tasks.length > 0) {
    sections.push(
      `## ${text.tasks}\n${summary.tasks
        .map((task) => {
          const details = [
            task.ownerName === undefined ? undefined : `${text.assignee}: ${task.ownerName}`,
            task.deadlineText === undefined ? undefined : `${text.deadline}: ${task.deadlineText}`,
          ].filter((item): item is string => item !== undefined);
          return `- ${task.text}${details.length === 0 ? "" : `\n  ${details.join(" · ")}`}`;
        })
        .join("\n")}`,
    );
  }
  appendList(sections, text.openIssues, summary.observations);
  return sections.flatMap((section) => splitDiscordContent(section, 1_900));
}

function appendList(sections: string[], title: string, items: readonly string[]): void {
  if (items.length > 0) {
    sections.push(`## ${title}\n${items.map((item) => `- ${item}`).join("\n")}`);
  }
}

function splitDiscordContent(content: string, maximumLength: number): string[] {
  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > maximumLength) {
    const candidate = remaining.slice(0, maximumLength);
    const boundary = Math.max(candidate.lastIndexOf("\n\n"), candidate.lastIndexOf("\n"));
    const end = boundary > 0 ? boundary : maximumLength;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

function createNonce(meetingId: string, part: string): string {
  return createHash("sha256").update(`${meetingId}:${part}`).digest("hex").slice(0, 25);
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
