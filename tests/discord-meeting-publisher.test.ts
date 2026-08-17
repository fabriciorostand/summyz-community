import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";

import { DiscordMeetingPublisher } from "../src/discord/discord-meeting-publisher.js";
import { createLogger } from "../src/logger.js";
import { createManifest } from "../src/recording/manifest.js";
import { PublicationStore } from "../src/summary/publication-store.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function createContext() {
  const root = await mkdtemp(join(tmpdir(), "summyz-publication-"));
  directories.push(root);
  const meetingDirectory = join(root, "meeting-1");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(meetingDirectory));
  const transcriptPath = join(meetingDirectory, "transcript.txt");
  await writeFile(transcriptPath, "[00:00:00.000 – 00:00:01.000] Ana: Olá.\n");
  const manifest = createManifest({
    guildId: "guild-1",
    meetingId: "meeting-1",
    notificationChannelId: "text-1",
    startedAt: "2026-08-17T15:30:00.000Z",
    voiceChannelId: "voice-1",
  });
  return { manifest, root, transcriptPath };
}

describe("publicação da reunião no Discord", () => {
  it("cria thread pública, publica seções sem evidências e anexa a transcrição", async () => {
    const context = await createContext();
    const threadSend = vi
      .fn()
      .mockResolvedValueOnce({ id: "summary-message-1" })
      .mockResolvedValueOnce({ id: "transcript-message-1" });
    const thread = {
      id: "thread-1",
      isSendable: () => true,
      isThread: () => true,
      send: threadSend,
    };
    const startThread = vi.fn(async () => thread);
    const rootMessage = { id: "root-1", startThread, thread: null };
    const channelSend = vi.fn(async () => rootMessage);
    const channel = {
      isSendable: () => true,
      messages: { fetch: vi.fn(async () => rootMessage) },
      send: channelSend,
      type: 0,
    };
    const fetch = vi.fn(async (id: string) => (id === "text-1" ? channel : thread));
    const client = { channels: { fetch } } as unknown as Client;
    const publisher = new DiscordMeetingPublisher({
      client,
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "America/Sao_Paulo",
    });

    await publisher.publishSummary(
      context.manifest,
      {
        decisions: ["Adotar o fluxo novo."],
        discussedTopics: ["Fluxo novo"],
        executiveSummary: "A equipe discutiu o fluxo.",
        observations: ["Ficou pendente decidir a ferramenta."],
        tasks: [{ deadlineText: "até sexta", ownerName: "Bruno", text: "Enviar o arquivo." }],
      },
      context.transcriptPath,
    );
    await publisher.publishSummary(
      context.manifest,
      {
        decisions: ["Adotar o fluxo novo."],
        discussedTopics: ["Fluxo novo"],
        executiveSummary: "A equipe discutiu o fluxo.",
        observations: ["Ficou pendente decidir a ferramenta."],
        tasks: [{ deadlineText: "até sexta", ownerName: "Bruno", text: "Enviar o arquivo." }],
      },
      context.transcriptPath,
    );

    expect(channelSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Resumo da call disponível"),
        enforceNonce: true,
      }),
    );
    expect(channelSend).toHaveBeenCalledOnce();
    expect(startThread).toHaveBeenCalledWith({
      autoArchiveDuration: 10_080,
      name: "Resumo da call — 17/08/2026 12:30",
      reason: "Publicação do resultado da reunião meeting-1",
    });
    const published = JSON.stringify(threadSend.mock.calls);
    expect(published).toContain("Resumo executivo");
    expect(published).toContain("Responsável: Bruno");
    expect(published).toContain("Prazo: até sexta");
    expect(published).not.toContain("sourceEntryIds");
    expect(threadSend).toHaveBeenLastCalledWith(
      expect.objectContaining({ files: [context.transcriptPath] }),
    );
    await expect(new PublicationStore(context.root).load("meeting-1")).resolves.toMatchObject({
      rootMessageId: "root-1",
      status: "completed",
      threadId: "thread-1",
      transcriptMessageId: "transcript-message-1",
    });
  });

  it("publica uma thread apenas com a transcrição quando o resumo falha", async () => {
    const context = await createContext();
    const threadSend = vi.fn(async () => ({ id: "transcript-message-1" }));
    const thread = {
      id: "thread-1",
      isSendable: () => true,
      isThread: () => true,
      send: threadSend,
    };
    const rootMessage = {
      id: "root-1",
      startThread: vi.fn(async () => thread),
      thread: null,
    };
    const channel = {
      isSendable: () => true,
      messages: { fetch: vi.fn(async () => rootMessage) },
      send: vi.fn(async () => rootMessage),
      type: 0,
    };
    const client = {
      channels: { fetch: vi.fn(async (id: string) => (id === "text-1" ? channel : thread)) },
    } as unknown as Client;
    const publisher = new DiscordMeetingPublisher({
      client,
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "America/Sao_Paulo",
    });

    await publisher.publishTranscriptOnly(context.manifest, context.transcriptPath);

    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Transcrição da call disponível (Resumo indisponível)"),
      }),
    );
    expect(rootMessage.startThread).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Transcrição — 17/08/2026" }),
    );
    expect(threadSend).toHaveBeenCalledOnce();
    expect(threadSend).toHaveBeenCalledWith(
      expect.objectContaining({ files: [context.transcriptPath] }),
    );
  });

  it("retoma a publicação persistida sem criar outra mensagem ou thread", async () => {
    const context = await createContext();
    const store = new PublicationStore(context.root);
    await store.save({
      createdAt: "2026-08-17T15:31:00.000Z",
      meetingId: "meeting-1",
      mode: "transcript_only",
      rootMessageId: "root-1",
      schemaVersion: 1,
      status: "publishing",
      summaryMessageIds: [],
      threadId: "thread-1",
      updatedAt: "2026-08-17T15:31:00.000Z",
    });
    const threadSend = vi.fn(async () => ({ id: "transcript-message-1" }));
    const thread = {
      id: "thread-1",
      isSendable: () => true,
      isThread: () => true,
      send: threadSend,
    };
    const channelSend = vi.fn();
    const channel = { isSendable: () => true, send: channelSend, type: 0 };
    const client = {
      channels: { fetch: vi.fn(async (id: string) => (id === "text-1" ? channel : thread)) },
    } as unknown as Client;
    const publisher = new DiscordMeetingPublisher({
      client,
      logger: createLogger("silent"),
      store,
      timeZone: "America/Sao_Paulo",
    });

    await publisher.publishTranscriptOnly(context.manifest, context.transcriptPath);

    expect(channelSend).not.toHaveBeenCalled();
    expect(threadSend).toHaveBeenCalledOnce();
  });

  it("rejeita canal pai ou thread persistida que não permitem publicação", async () => {
    const invalidParentContext = await createContext();
    const invalidParentClient = {
      channels: { fetch: vi.fn(async () => ({ type: 2 })) },
    } as unknown as Client;
    const invalidParentPublisher = new DiscordMeetingPublisher({
      client: invalidParentClient,
      logger: createLogger("silent"),
      store: new PublicationStore(invalidParentContext.root),
      timeZone: "America/Sao_Paulo",
    });

    await expect(
      invalidParentPublisher.publishTranscriptOnly(
        invalidParentContext.manifest,
        invalidParentContext.transcriptPath,
      ),
    ).rejects.toThrow(/canal/i);

    const invalidThreadContext = await createContext();
    const store = new PublicationStore(invalidThreadContext.root);
    await store.save({
      createdAt: "2026-08-17T15:31:00.000Z",
      meetingId: "meeting-1",
      mode: "transcript_only",
      rootMessageId: "root-1",
      schemaVersion: 1,
      status: "publishing",
      summaryMessageIds: [],
      threadId: "thread-1",
      updatedAt: "2026-08-17T15:31:00.000Z",
    });
    const parent = { isSendable: (): boolean => true, send: vi.fn(), type: 0 };
    const invalidThreadClient = {
      channels: {
        fetch: vi.fn(async (id: string) =>
          id === "text-1"
            ? parent
            : { isSendable: (): boolean => false, isThread: (): boolean => true },
        ),
      },
    } as unknown as Client;
    const invalidThreadPublisher = new DiscordMeetingPublisher({
      client: invalidThreadClient,
      logger: createLogger("silent"),
      store,
      timeZone: "America/Sao_Paulo",
    });

    await expect(
      invalidThreadPublisher.publishTranscriptOnly(
        invalidThreadContext.manifest,
        invalidThreadContext.transcriptPath,
      ),
    ).rejects.toThrow(/thread/i);
  });
});
