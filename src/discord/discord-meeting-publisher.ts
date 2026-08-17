import { createHash } from "node:crypto";

import {
  ChannelType,
  type Client,
  type GuildTextBasedChannel,
  type Message,
  ThreadAutoArchiveDuration,
} from "discord.js";
import type { Logger } from "pino";

import type { RecordingManifest } from "../recording/manifest.js";
import { createPublicationState, type PublicationState } from "../summary/publication-state.js";
import type { PublicationStore } from "../summary/publication-store.js";
import type { PublicSummary } from "../summary/summary-result.js";

interface DiscordMeetingPublisherOptions {
  client: Client;
  logger: Logger;
  now?: () => Date;
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

export class DiscordMeetingPublisher implements MeetingPublisher {
  readonly #client: Client;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #store: PublicationStore;
  readonly #timeZone: string;

  public constructor(options: DiscordMeetingPublisherOptions) {
    this.#client = options.client;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
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
    let state =
      (await this.#store.tryLoad(manifest.meetingId)) ??
      createPublicationState(manifest.meetingId, mode, this.#now().toISOString());
    if (state.mode !== mode) {
      throw new Error("O modo de publicação persistido não corresponde ao resultado da reunião");
    }
    if (state.status === "completed") {
      return;
    }

    const parent = await this.#resolveParentChannel(manifest.notificationChannelId);
    let rootMessage: Message<true> | undefined;
    if (state.rootMessageId === undefined) {
      rootMessage = await parent.send({
        allowedMentions: { parse: [] },
        content:
          mode === "summary"
            ? `📝 Resumo da call disponível. ID: \`${manifest.meetingId}\``
            : `⚠️ Transcrição da call disponível (Resumo indisponível). ID: \`${manifest.meetingId}\``,
        enforceNonce: true,
        nonce: createNonce(manifest.meetingId, `${mode}:root`),
      });
      state = await this.#saveProgress(state, { rootMessageId: rootMessage.id });
    }

    let thread: GuildTextBasedChannel;
    if (state.threadId === undefined) {
      if (state.rootMessageId === undefined) {
        throw new Error("A mensagem inicial da publicação não foi persistida");
      }
      rootMessage ??= await parent.messages.fetch({ message: state.rootMessageId });
      thread =
        rootMessage.thread ??
        (await rootMessage.startThread({
          autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
          name: createThreadName(manifest.startedAt, mode, this.#timeZone),
          reason: `Publicação do resultado da reunião ${manifest.meetingId}`,
        }));
      state = await this.#saveProgress(state, { threadId: thread.id });
    } else {
      thread = await this.#resolveThread(state.threadId);
    }

    const summaryChunks = mode === "summary" && summary !== undefined ? formatSummary(summary) : [];
    for (let index = state.summaryMessageIds.length; index < summaryChunks.length; index += 1) {
      const content = summaryChunks[index];
      if (content === undefined) {
        throw new Error("O conteúdo do resumo ficou inconsistente");
      }
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

    if (state.transcriptMessageId === undefined) {
      const transcriptMessage = await thread.send({
        allowedMentions: { parse: [] },
        content:
          mode === "summary"
            ? "📎 Transcrição completa da call:"
            : "Não foi possível gerar o resumo após as tentativas configuradas. A transcrição completa está disponível abaixo:",
        enforceNonce: true,
        files: [transcriptPath],
        nonce: createNonce(manifest.meetingId, "transcript"),
      });
      state = await this.#saveProgress(state, { transcriptMessageId: transcriptMessage.id });
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

  async #resolveParentChannel(channelId: string) {
    const channel = await this.#client.channels.fetch(channelId);
    if (
      channel === null ||
      (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
    ) {
      throw new Error("O canal configurado não permite criar uma thread pública");
    }
    return channel;
  }

  async #resolveThread(threadId: string): Promise<GuildTextBasedChannel> {
    const channel = await this.#client.channels.fetch(threadId);
    if (channel === null || !channel.isThread() || !channel.isSendable()) {
      throw new Error("A thread persistida não está disponível para publicação");
    }
    return channel;
  }

  async #saveProgress(
    state: PublicationState,
    update: Partial<
      Pick<
        Extract<PublicationState, { status: "publishing" }>,
        "rootMessageId" | "summaryMessageIds" | "threadId" | "transcriptMessageId"
      >
    >,
  ): Promise<Extract<PublicationState, { status: "publishing" }>> {
    if (state.status !== "publishing") {
      throw new Error("A publicação já foi concluída");
    }
    const updated = {
      ...state,
      ...update,
      updatedAt: this.#now().toISOString(),
    };
    await this.#store.save(updated);
    return updated;
  }
}

function createThreadName(
  startedAt: string,
  mode: PublicationState["mode"],
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
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
  const date = `${value("day")}/${value("month")}/${value("year")}`;
  return mode === "summary"
    ? `Resumo da call — ${date} ${value("hour")}:${value("minute")}`
    : `Transcrição — ${date}`;
}

function formatSummary(summary: PublicSummary): string[] {
  const sections = [`## Resumo executivo\n${summary.executiveSummary}`];
  appendList(sections, "Tópicos discutidos", summary.discussedTopics);
  appendList(sections, "Decisões", summary.decisions);
  if (summary.tasks.length > 0) {
    sections.push(
      `## Tarefas\n${summary.tasks
        .map((task) => {
          const details = [
            task.ownerName === undefined ? undefined : `Responsável: ${task.ownerName}`,
            task.deadlineText === undefined ? undefined : `Prazo: ${task.deadlineText}`,
          ].filter((item): item is string => item !== undefined);
          return `- ${task.text}${details.length === 0 ? "" : `\n  ${details.join(" · ")}`}`;
        })
        .join("\n")}`,
    );
  }
  appendList(sections, "Pendências e observações", summary.observations);
  return splitDiscordContent(sections.join("\n\n"), 1_900);
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
