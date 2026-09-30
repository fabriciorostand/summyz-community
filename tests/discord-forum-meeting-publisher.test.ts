import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BotLeftGuildError,
  DiscordMeetingPublisher,
} from "../src/discord/discord-meeting-publisher.js";
import { createLogger } from "../src/logger.js";
import { createManifest } from "../src/recording/manifest.js";
import { createPublicationState } from "../src/summary/publication-state.js";
import { PublicationStore } from "../src/summary/publication-store.js";
import { InMemoryGuildConfigurationStore } from "./in-memory-guild-config-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function createContext() {
  const root = await mkdtemp(join(tmpdir(), "summyz-forum-publication-"));
  directories.push(root);
  const transcriptPath = join(root, "transcript.txt");
  await writeFile(transcriptPath, "[00:00:00.000 – 00:00:01.000] Ana: Olá.\n");
  const configStore = new InMemoryGuildConfigurationStore();
  await configStore.setSummaryForum("guild-1", { forumId: "forum-1", tagId: "tag-1" });
  const manifest = createManifest({
    guildId: "guild-1",
    meetingId: "meeting-1",
    notificationChannelId: "text-original",
    startedAt: "2026-08-17T15:30:00.000Z",
    voiceChannelId: "voice-1",
    voiceChannelName: "Lobby",
  });
  return { configStore, manifest, root, transcriptPath };
}

describe("publicação da reunião em fórum do Discord", () => {
  it("inspects forum permissions after publication fails without replacing the original error", async () => {
    const context = await createContext();
    const onFailure = vi.fn(async () => {
      throw new Error("diagnostic unavailable");
    });
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client: {
        channels: { fetch: vi.fn(async () => null) },
      } as unknown as Client,
      guildConfigStore: context.configStore,
      language: "en",
      logger: createLogger("silent"),
      onFailure,
      store: new PublicationStore(context.root),
      timeZone: "UTC",
    });

    await expect(
      publisher.publishTranscriptOnly(context.manifest, context.transcriptPath),
    ).rejects.toThrow(/fórum/i);
    expect(onFailure).toHaveBeenCalledWith("guild-1", "forum-1");
  });
  it("skips forum diagnostics when the destination was removed", async () => {
    const context = await createContext();
    await context.configStore.clearSummaryForum("guild-1");
    const onFailure = vi.fn(async () => undefined);
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client: { channels: { fetch: vi.fn() } } as unknown as Client,
      guildConfigStore: context.configStore,
      language: "en",
      logger: createLogger("silent"),
      onFailure,
      store: new PublicationStore(context.root),
      timeZone: "UTC",
    });

    await expect(
      publisher.publishTranscriptOnly(context.manifest, context.transcriptPath),
    ).rejects.toThrow(/nenhum fórum/i);
    expect(onFailure).not.toHaveBeenCalled();
  });
  it("does not leak primitive diagnostic errors into the publication result", async () => {
    const context = await createContext();
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client: { channels: { fetch: vi.fn(async () => null) } } as unknown as Client,
      guildConfigStore: context.configStore,
      language: "en",
      logger: createLogger("silent"),
      onFailure: async () => {
        throw "sensitive-token";
      },
      store: new PublicationStore(context.root),
      timeZone: "UTC",
    });

    await expect(
      publisher.publishTranscriptOnly(context.manifest, context.transcriptPath),
    ).rejects.toThrow(/fórum/i);
  });
  it("stops publication before creating a forum post when the bot has left", async () => {
    const context = await createContext();
    const create = vi.fn();
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => false,
      client: {
        channels: { fetch: vi.fn(async () => ({ threads: { create }, type: 15 })) },
      } as unknown as Client,
      guildConfigStore: context.configStore,
      language: "en",
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "UTC",
    });

    await expect(
      publisher.publishTranscriptOnly(context.manifest, context.transcriptPath),
    ).rejects.toBeInstanceOf(BotLeftGuildError);
    expect(create).not.toHaveBeenCalled();
  });
  it("rechecks bot presence immediately before creating a post", async () => {
    const context = await createContext();
    const create = vi.fn();
    const canPublish = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const publisher = new DiscordMeetingPublisher({
      canPublish,
      client: {
        channels: { fetch: vi.fn(async () => ({ threads: { create }, type: 15 })) },
      } as unknown as Client,
      guildConfigStore: context.configStore,
      language: "en",
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "UTC",
    });

    await expect(
      publisher.publishTranscriptOnly(context.manifest, context.transcriptPath),
    ).rejects.toBeInstanceOf(BotLeftGuildError);
    expect(create).not.toHaveBeenCalled();
    expect(canPublish).toHaveBeenCalledTimes(2);
    expect(canPublish).toHaveBeenCalledWith(context.manifest);
  });
  it("publica títulos, seções e anexos em inglês com data MM/DD/YYYY", async () => {
    const context = await createContext();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: "topics-1" })
      .mockResolvedValueOnce({ id: "decisions-1" })
      .mockResolvedValueOnce({ id: "tasks-1" })
      .mockResolvedValueOnce({ id: "observations-1" })
      .mockResolvedValueOnce({ id: "transcript-1" });
    const thread = { id: "post-1", isSendable: () => true, isThread: () => true, send };
    const create = vi.fn(async () => thread);
    const client = {
      channels: {
        fetch: vi.fn(async (id: string) =>
          id === "forum-1" ? { threads: { create }, type: 15 } : thread,
        ),
      },
    } as unknown as Client;
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client,
      guildConfigStore: context.configStore,
      language: "en",
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "America/Sao_Paulo",
    });

    await publisher.publishSummary(
      context.manifest,
      {
        decisions: ["Adopt the new workflow."],
        discussedTopics: ["New workflow"],
        executiveSummary: "The team discussed the workflow.",
        observations: ["The tool still needs to be selected."],
        tasks: [{ deadlineText: "by Friday", ownerName: "Bruno", text: "Send the file." }],
      },
      context.transcriptPath,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          content: expect.stringMatching(/Meeting ID[\s\S]*Executive summary/),
        }),
        name: "Summary — 08/17/2026 12:30 — Lobby",
        reason: "Publishing result for meeting meeting-1",
      }),
    );
    const sent = JSON.stringify(send.mock.calls);
    expect(sent).toContain("Discussed topics");
    expect(sent).toContain("Decisions");
    expect(sent).toContain("Tasks");
    expect(sent).toContain("Assignee: Bruno");
    expect(sent).toContain("Deadline: by Friday");
    expect(sent).toContain("Open issues and notes");
    expect(sent).toContain("Full voice call transcript");
    expect(sent).not.toContain("Pendências e observações");
  });

  it("usa os rótulos do idioma efetivo do artefato, independentemente do botLanguage", async () => {
    const context = await createContext();
    const send = vi.fn(async () => ({ id: "message-1" }));
    const thread = { id: "post-1", isSendable: () => true, isThread: () => true, send };
    const create = vi.fn(async () => thread);
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client: {
        channels: {
          fetch: vi.fn(async (id: string) =>
            id === "forum-1" ? { threads: { create }, type: 15 } : thread,
          ),
        },
      } as unknown as Client,
      guildConfigStore: context.configStore,
      language: "pt-BR",
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "America/Sao_Paulo",
    });

    await publisher.publishSummary(
      context.manifest,
      {
        decisions: ["Adoptar el flujo."],
        discussedTopics: ["Flujo"],
        executiveSummary: "El equipo decidió.",
        labels: {
          assignee: "Responsable",
          deadline: "Plazo",
          decisions: "Decisiones",
          discussedTopics: "Temas tratados",
          executiveSummary: "Resumen ejecutivo",
          fullTranscript: "Transcripción completa",
          meetingId: "ID de la reunión",
          observations: "Observaciones",
          summary: "Resumen",
          tasks: "Tareas",
          transcript: "Transcripción",
        },
        observations: ["Sin pendientes."],
        tasks: [],
      },
      context.transcriptPath,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ content: expect.stringContaining("Resumen ejecutivo") }),
        name: "Resumen — 17/08/2026 12:30 — Lobby",
      }),
    );
    expect(JSON.stringify(send.mock.calls)).toContain("Temas tratados");
    expect(JSON.stringify(send.mock.calls)).not.toContain("Tópicos discutidos");
  });

  it("publica somente a transcrição e avisa falhas em inglês", async () => {
    const context = await createContext();
    const thread = {
      id: "post-1",
      isSendable: (): boolean => true,
      isThread: (): boolean => true,
      send: vi.fn(),
    };
    const create = vi.fn(async () => thread);
    const notify = vi.fn(async () => undefined);
    const client = {
      channels: {
        fetch: vi.fn(async (id: string) => {
          if (id === "forum-1") return { threads: { create }, type: 15 };
          return id === "text-original"
            ? { isSendable: (): boolean => true, send: notify }
            : thread;
        }),
      },
    } as unknown as Client;
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client,
      guildConfigStore: context.configStore,
      language: "en",
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "America/Sao_Paulo",
    });

    await publisher.publishTranscriptOnly(context.manifest, context.transcriptPath);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          content: expect.stringContaining("The summary is unavailable"),
          files: [context.transcriptPath],
        }),
        name: "Transcript — 08/17/2026 12:30 — Lobby",
      }),
    );

    await context.configStore.clearSummaryForum("guild-1");
    const secondPublisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client,
      guildConfigStore: context.configStore,
      language: "en",
      logger: createLogger("silent"),
      store: new PublicationStore(join(context.root, "second")),
      timeZone: "America/Sao_Paulo",
    });
    await expect(
      secondPublisher.publishTranscriptOnly(
        { ...context.manifest, meetingId: "meeting-2" },
        context.transcriptPath,
      ),
    ).rejects.toThrow();
    expect(notify).toHaveBeenCalledWith({
      allowedMentions: { parse: [] },
      content: "⚠️ Unable to publish the summary and transcript to the configured channel.",
    });
  });

  it("cria um post com resumo, respostas e transcrição usando a tag configurada", async () => {
    const context = await createContext();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: "topics-1" })
      .mockResolvedValueOnce({ id: "decisions-1" })
      .mockResolvedValueOnce({ id: "tasks-1" })
      .mockResolvedValueOnce({ id: "observations-1" })
      .mockResolvedValueOnce({ id: "transcript-1" });
    const thread = { id: "post-1", isSendable: () => true, isThread: () => true, send };
    const create = vi.fn(async () => thread);
    const forum = { threads: { create }, type: 15 };
    const fetch = vi.fn(async (id: string) => (id === "forum-1" ? forum : thread));
    const client = { channels: { fetch } } as unknown as Client;
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client,
      guildConfigStore: context.configStore,
      language: "pt-BR",
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

    expect(create).toHaveBeenCalledWith({
      appliedTags: ["tag-1"],
      autoArchiveDuration: 10_080,
      message: expect.objectContaining({
        allowedMentions: { parse: [] },
        content: expect.stringMatching(/meeting-1[\s\S]*Resumo executivo[\s\S]*A equipe/),
      }),
      name: "Resumo — 17/08/2026 12:30 — Lobby",
      reason: "Publicação do resultado da reunião meeting-1",
    });
    expect(JSON.stringify(send.mock.calls)).toContain("Tópicos discutidos");
    expect(JSON.stringify(send.mock.calls)).toContain("Decisões");
    expect(JSON.stringify(send.mock.calls)).toContain("Tarefas");
    expect(JSON.stringify(send.mock.calls)).toContain("Pendências e observações");
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ files: [context.transcriptPath] }),
    );
  });

  it("cria um único post com aviso e transcrição quando o resumo falha", async () => {
    const context = await createContext();
    const thread = { id: "post-1", isSendable: () => true, isThread: () => true, send: vi.fn() };
    const create = vi.fn(async () => thread);
    const client = {
      channels: { fetch: vi.fn(async () => ({ threads: { create }, type: 15 })) },
    } as unknown as Client;
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client,
      guildConfigStore: context.configStore,
      language: "pt-BR",
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "America/Sao_Paulo",
    });

    await publisher.publishTranscriptOnly(context.manifest, context.transcriptPath);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          content: expect.stringContaining("resumo está indisponível"),
          files: [context.transcriptPath],
        }),
        name: "Transcrição — 17/08/2026 12:30 — Lobby",
      }),
    );
    expect(thread.send).not.toHaveBeenCalled();
  });

  it("usa o fórum mais recente antes de iniciar e mantém o post ao retomar", async () => {
    const context = await createContext();
    await context.configStore.setSummaryForum("guild-1", { forumId: "forum-2" });
    const send = vi.fn(async () => ({ id: "transcript-1" }));
    const thread = { id: "post-1", isSendable: () => true, isThread: () => true, send };
    const create = vi.fn(async () => thread);
    const fetch = vi.fn(async (id: string) =>
      id === "forum-2" ? { threads: { create }, type: 15 } : thread,
    );
    const client = { channels: { fetch } } as unknown as Client;
    const store = new PublicationStore(context.root);
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client,
      guildConfigStore: context.configStore,
      language: "pt-BR",
      logger: createLogger("silent"),
      store,
      timeZone: "America/Sao_Paulo",
    });

    await publisher.publishSummary(
      context.manifest,
      {
        decisions: [],
        discussedTopics: [],
        executiveSummary: "Resumo.",
        observations: [],
        tasks: [],
      },
      context.transcriptPath,
    );
    await context.configStore.setSummaryForum("guild-1", { forumId: "forum-3" });
    await publisher.publishSummary(
      context.manifest,
      {
        decisions: [],
        discussedTopics: [],
        executiveSummary: "Resumo.",
        observations: [],
        tasks: [],
      },
      context.transcriptPath,
    );

    expect(fetch).toHaveBeenCalledWith("forum-2");
    expect(fetch).not.toHaveBeenCalledWith("forum-1");
    expect(fetch).not.toHaveBeenCalledWith("forum-3");
    expect(create).toHaveBeenCalledOnce();
  });

  it("avisa uma vez no chat original quando não consegue acessar o fórum", async () => {
    const context = await createContext();
    const notify = vi.fn(async () => undefined);
    const originalChannel = { isSendable: () => true, send: notify };
    const client = {
      channels: {
        fetch: vi.fn(async (id: string) => (id === "text-original" ? originalChannel : null)),
      },
    } as unknown as Client;
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client,
      guildConfigStore: context.configStore,
      language: "pt-BR",
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "America/Sao_Paulo",
    });

    await expect(
      publisher.publishTranscriptOnly(context.manifest, context.transcriptPath),
    ).rejects.toThrow(/fórum/i);
    await expect(
      publisher.publishTranscriptOnly(context.manifest, context.transcriptPath),
    ).rejects.toThrow(/fórum/i);

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      allowedMentions: { parse: [] },
      content: "⚠️ Não foi possível publicar o resumo e a transcrição no canal configurado.",
    });
  });

  it("retoma o mesmo post após falha parcial sem perder o progresso persistido", async () => {
    const context = await createContext();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("falha temporária"))
      .mockResolvedValue({ id: "message-1" });
    const thread = { id: "post-1", isSendable: () => true, isThread: () => true, send };
    const create = vi.fn(async () => thread);
    const originalChannel = { isSendable: () => true, send: vi.fn(async () => undefined) };
    const client = {
      channels: {
        fetch: vi.fn(async (id: string) => {
          if (id === "forum-1") {
            return { threads: { create }, type: 15 };
          }
          return id === "text-original" ? originalChannel : thread;
        }),
      },
    } as unknown as Client;
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client,
      guildConfigStore: context.configStore,
      language: "pt-BR",
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "America/Sao_Paulo",
    });
    const summary = {
      decisions: ["Decisão."],
      discussedTopics: ["Tópico."],
      executiveSummary: "Resumo.",
      observations: [],
      tasks: [],
    };

    await expect(
      publisher.publishSummary(context.manifest, summary, context.transcriptPath),
    ).rejects.toThrow("falha temporária");
    await publisher.publishSummary(context.manifest, summary, context.transcriptPath);

    expect(create).toHaveBeenCalledOnce();
    await expect(new PublicationStore(context.root).load("meeting-1")).resolves.toMatchObject({
      rootMessageId: "post-1",
      status: "completed",
      threadId: "post-1",
    });
  });

  it("formata conteúdo longo, canal sem nome e tarefa sem detalhes opcionais", async () => {
    const context = await createContext();
    await context.configStore.setSummaryForum("guild-1", { forumId: "forum-1" });
    const manifestWithoutChannelName = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-without-channel-name",
      notificationChannelId: "text-original",
      startedAt: "2026-08-17T15:30:00.000Z",
      voiceChannelId: "voice-1",
    });
    let sentMessages = 0;
    const send = vi.fn(async () => {
      sentMessages += 1;
      return { id: `message-${sentMessages}` };
    });
    const thread = { id: "post-1", isSendable: () => true, isThread: () => true, send };
    const create = vi.fn(async () => thread);
    const client = {
      channels: { fetch: vi.fn(async () => ({ threads: { create }, type: 15 })) },
    } as unknown as Client;
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client,
      guildConfigStore: context.configStore,
      language: "pt-BR",
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "America/Sao_Paulo",
    });

    await publisher.publishSummary(
      manifestWithoutChannelName,
      {
        decisions: [],
        discussedTopics: [],
        executiveSummary: `Primeiro parágrafo.\n\n${"A".repeat(5_000)}`,
        observations: [],
        tasks: [{ text: "Executar tarefa." }],
      },
      context.transcriptPath,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Resumo — 17/08/2026 12:30 — Canal de voz" }),
    );
    expect(JSON.stringify(send.mock.calls)).toContain("Executar tarefa.");
    expect(JSON.stringify(send.mock.calls)).not.toContain("Responsável:");
  });

  it("rejeita a retomada quando o modo persistido diverge do resultado", async () => {
    const context = await createContext();
    const store = new PublicationStore(context.root);
    await store.save(
      createPublicationState("meeting-1", "transcript_only", "2026-08-17T15:31:00.000Z"),
    );
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client: { channels: { fetch: vi.fn() } } as unknown as Client,
      guildConfigStore: context.configStore,
      language: "pt-BR",
      logger: createLogger("silent"),
      store,
      timeZone: "America/Sao_Paulo",
    });

    await expect(
      publisher.publishSummary(
        context.manifest,
        {
          decisions: [],
          discussedTopics: [],
          executiveSummary: "Resumo.",
          observations: [],
          tasks: [],
        },
        context.transcriptPath,
      ),
    ).rejects.toThrow(/modo de publicação/i);
  });

  it("detecta publicação persistida incompleta após retomar o post", async () => {
    const context = await createContext();
    const store = new PublicationStore(context.root);
    await store.save({
      ...createPublicationState("meeting-1", "transcript_only", "2026-08-17T15:31:00.000Z"),
      threadId: "post-1",
      transcriptMessageId: "transcript-1",
    });
    const thread = { isSendable: () => true, isThread: () => true, send: vi.fn() };
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client: { channels: { fetch: vi.fn(async () => thread) } } as unknown as Client,
      guildConfigStore: context.configStore,
      language: "pt-BR",
      logger: createLogger("silent"),
      store,
      timeZone: "America/Sao_Paulo",
    });

    await expect(
      publisher.publishTranscriptOnly(context.manifest, context.transcriptPath),
    ).rejects.toThrow(/identificadores do Discord/i);
  });

  it("rejeita post persistido indisponível e envia o aviso no chat original", async () => {
    const context = await createContext();
    const store = new PublicationStore(context.root);
    await store.save({
      ...createPublicationState("meeting-1", "transcript_only", "2026-08-17T15:31:00.000Z"),
      rootMessageId: "post-1",
      threadId: "post-1",
      transcriptMessageId: "transcript-1",
    });
    const notify = vi.fn(async () => undefined);
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client: {
        channels: {
          fetch: vi.fn(async (id: string) =>
            id === "text-original" ? { isSendable: () => true, send: notify } : null,
          ),
        },
      } as unknown as Client,
      guildConfigStore: context.configStore,
      language: "pt-BR",
      logger: createLogger("silent"),
      store,
      timeZone: "America/Sao_Paulo",
    });

    await expect(
      publisher.publishTranscriptOnly(context.manifest, context.transcriptPath),
    ).rejects.toThrow(/post persistido/i);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("trata destino removido e canal original sem suporte a mensagens", async () => {
    const context = await createContext();
    await context.configStore.clearSummaryForum("guild-1");
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client: {
        channels: { fetch: vi.fn(async () => ({ isSendable: () => false })) },
      } as unknown as Client,
      guildConfigStore: context.configStore,
      language: "pt-BR",
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "America/Sao_Paulo",
    });

    await expect(
      publisher.publishTranscriptOnly(context.manifest, context.transcriptPath),
    ).rejects.toThrow(/nenhum fórum/i);
  });

  it("trata rejeição não Error ao tentar notificar a falha", async () => {
    const context = await createContext();
    const publisher = new DiscordMeetingPublisher({
      canPublish: async () => true,
      client: {
        channels: {
          fetch: vi.fn(async (id: string) => {
            if (id === "text-original") throw "canal indisponível";
            return null;
          }),
        },
      } as unknown as Client,
      guildConfigStore: context.configStore,
      language: "pt-BR",
      logger: createLogger("silent"),
      store: new PublicationStore(context.root),
      timeZone: "America/Sao_Paulo",
    });

    await expect(
      publisher.publishTranscriptOnly(context.manifest, context.transcriptPath),
    ).rejects.toThrow(/fórum/i);
  });
});
