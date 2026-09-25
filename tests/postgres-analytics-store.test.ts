import { describe, expect, it, vi } from "vitest";

import { PostgresAnalyticsStore } from "../src/database/postgres-analytics-store.js";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import {
  addParticipant,
  addSegment,
  createManifest,
  markManifestCompleted,
} from "../src/recording/manifest.js";
import {
  completeTranscriptionGroup,
  createTranscriptionState,
  markTranscriptionCompleted,
} from "../src/transcription/transcription-state.js";

describe("PostgresAnalyticsStore", () => {
  it("persiste palavras na linha do tempo e inclui participante silencioso", async () => {
    const query = vi.fn(async (_text: string, _values?: readonly unknown[]) => ({
      rowCount: 1,
      rows: [],
    }));
    const store = new PostgresAnalyticsStore({ query } satisfies PostgresExecutor);
    let manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T10:00:00.000Z",
      voiceChannelId: "voice-1",
      voiceChannelName: "Planejamento",
    });
    manifest = addParticipant(manifest, { displayName: "Ana", userId: "ana" });
    manifest = addParticipant(manifest, { displayName: "Bia", userId: "bia" });
    manifest = addSegment(manifest, {
      durationMs: 2_000,
      endedAtMs: 3_000,
      file: "participants/ana/segment-1.ogg",
      segmentId: "segment-1",
      startedAtMs: 1_000,
      userDisplayName: "Ana",
      userId: "ana",
    });
    manifest = markManifestCompleted(manifest, "2026-08-24T10:05:00.000Z");
    let transcription = createTranscriptionState(
      manifest.meetingId,
      ["segment-1"],
      "2026-08-24T10:05:01.000Z",
    );
    transcription = completeTranscriptionGroup(
      transcription,
      {
        representativeSegmentId: "segment-1",
        result: {
          attempts: 1,
          pieces: [{ endedAtMs: 1_000, startedAtMs: 0, text: "Olá." }],
          words: [{ endedAtMs: 1_000, startedAtMs: 0, text: "Olá." }],
        },
        segmentIds: ["segment-1"],
      },
      "2026-08-24T10:05:02.000Z",
    );
    transcription = markTranscriptionCompleted(transcription, "2026-08-24T10:05:03.000Z");

    await store.persistParticipation(manifest, transcription);

    const values = query.mock.calls[0]?.[1];
    expect(values?.slice(0, 2)).toEqual(["meeting-1", "guild-1"]);
    expect(JSON.parse(String(values?.[2]))).toEqual([
      { display_name: "Ana", talk_percentage: 100, talk_time_ms: 1_000, user_id: "ana" },
      { display_name: "Bia", talk_percentage: 0, talk_time_ms: 0, user_id: "bia" },
    ]);
    expect(values?.[3]).toBe("Planejamento");
  });

  it("returns rolling analytics, exact costs and terminal status series", async () => {
    const responses = [
      {
        rows: [
          {
            average_duration_ms: 120_000,
            previous_calls: 3,
            total_calls: 4,
            total_duration_ms: 240_000,
          },
        ],
      },
      {
        rows: [
          { amount: "0.250000", attempt_count: 2, currency: "USD", financial_status: "confirmed" },
          { amount: null, attempt_count: 2, currency: null, financial_status: "unattributed" },
        ],
      },
      {
        rows: [
          {
            amount: "0.250000",
            attempt_count: 2,
            currency: "USD",
            execution: "api",
            financial_status: "confirmed",
            phase: "summary",
            provider: "openrouter",
          },
        ],
      },
      {
        rows: [
          {
            avatar_url: "https://cdn.discordapp.com/avatars/ana/avatar.png",
            display_name: "Ana",
            talk_time_ms: "4000",
            user_id: "ana",
          },
        ],
      },
      { rows: [{ bucket_start: "2026-08-01", completed: 3, failed: 1 }] },
      { rows: [{ open_task_count: 2 }] },
    ];
    const query = vi.fn(async (_text: string, _values?: readonly unknown[]) => ({
      rowCount: 1,
      ...(responses.shift() ?? { rows: [] }),
    }));
    const store = new PostgresAnalyticsStore({ query } satisfies PostgresExecutor);

    await expect(
      store.getDashboard("guild-1", {
        now: "2026-08-30T15:00:00.000Z",
        period: "30d",
        timeZone: "America/Sao_Paulo",
      }),
    ).resolves.toEqual({
      averageDurationMs: 120_000,
      calls: { current: 4, deltaPercentage: 33, previous: 3 },
      cost: {
        attemptCounts: { confirmed: 2, notApplicable: 0, pending: 0, unattributed: 2 },
        breakdown: [
          {
            attemptCounts: { confirmed: 2, notApplicable: 0, pending: 0, unattributed: 0 },
            confirmed: [{ amount: "0.250000", currency: "USD" }],
            execution: "api",
            phase: "summary",
            provider: "openrouter",
          },
        ],
        confirmed: [{ amount: "0.250000", currency: "USD" }],
      },
      openTaskCount: 2,
      period: "30d",
      statusSeries: [{ bucketStart: "2026-08-01", completed: 3, failed: 1 }],
      topSpeakers: [
        {
          avatarUrl: "https://cdn.discordapp.com/avatars/ana/avatar.png",
          displayName: "Ana",
          talkTimeMs: 4_000,
          userId: "ana",
        },
      ],
      totalCalls: 4,
      totalDurationMs: 240_000,
    });
    expect(query.mock.calls[0]?.[0]).toContain("previous_calls");
    expect(query.mock.calls[1]?.[0]).toContain("financial_status");
    expect(query.mock.calls[2]?.[0]).toContain("phase");
  });

  it("projeta somente o resumo público com o idioma fixado na reunião", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            completed_at: "2026-08-28T01:27:14.888Z",
            ai_profile_id: "profile-1",
            ai_profile_name: "Perfil principal",
            audio_retained: true,
            content_retained: true,
            duration_ms: 9_359,
            failure_code: null,
            meeting_id: "meeting-1",
            meeting_manifest: { botLanguage: "pt-BR" },
            pipeline_status: "completed",
            publication_root_message_id: "message-1",
            publication_thread_id: "thread-1",
            raw_transcript: "Transcrição original",
            started_at: "2026-08-28T01:27:05.529Z",
            summary: {
              attempts: 1,
              completedAt: "2026-08-28T01:27:14.888Z",
              effectiveLanguage: "pt-BR",
              languageValidation: {
                attempts: 1,
                detectedLanguage: "pt",
                requestedLanguage: "pt-BR",
                status: "confirmed",
              },
              meetingId: "meeting-1",
              schemaVersion: 1,
              startedAt: "2026-08-28T01:27:05.529Z",
              status: "completed",
              summary: {
                decisions: ["Adotar o fluxo."],
                discussedTopics: ["Planejamento"],
                executiveSummary: "A equipe alinhou o projeto.",
                observations: ["Revisar o cronograma."],
                tasks: [
                  {
                    deadlineText: "sexta-feira",
                    ownerName: "Ana",
                    text: "Publicar o documento.",
                  },
                ],
              },
              updatedAt: "2026-08-28T01:27:14.888Z",
            },
            talk_time_available: false,
            transcript: "Transcrição revisada",
            voice_channel_name: "Planejamento",
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          { amount: "0.125", attempt_count: 1, currency: "USD", financial_status: "confirmed" },
          { amount: null, attempt_count: 1, currency: null, financial_status: "pending" },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const store = new PostgresAnalyticsStore({ query } satisfies PostgresExecutor);

    const meeting = await store.getMeeting("guild-1", "meeting-1");

    expect(meeting?.summary).toEqual({
      decisions: ["Adotar o fluxo."],
      discussedTopics: ["Planejamento"],
      executiveSummary: "A equipe alinhou o projeto.",
      language: "pt-BR",
      observations: ["Revisar o cronograma."],
      status: "completed",
      tasks: [
        {
          deadlineText: "sexta-feira",
          ownerName: "Ana",
          text: "Publicar o documento.",
        },
      ],
    });
    expect(meeting).toMatchObject({
      aiProfile: { name: "Perfil principal", profileId: "profile-1" },
      audioRetained: true,
      cost: {
        attemptCounts: { confirmed: 1, notApplicable: 0, pending: 1, unattributed: 0 },
        confirmed: [{ amount: "0.125", currency: "USD" }],
      },
      discordUrl: "https://discord.com/channels/guild-1/thread-1/message-1",
    });
    expect(JSON.stringify(meeting?.summary)).not.toContain("sourceEntryIds");
  });

  it("includes the snapshotted AI profile in meeting history items", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            ai_profile_id: "profile-1",
            ai_profile_name: "Default OpenRouter",
            completed_at: "2026-09-08T15:00:00.000Z",
            content_retained: true,
            duration_ms: 3_600_000,
            failure_code: null,
            meeting_id: "meeting-1",
            pipeline_status: "completed",
            started_at: "2026-09-08T14:00:00.000Z",
            talk_time_available: false,
            total: 1,
            voice_channel_name: "Launch Week Sync",
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const store = new PostgresAnalyticsStore({ query } satisfies PostgresExecutor);

    const history = await store.listMeetings("guild-1", {
      page: 1,
      pageSize: 20,
      timeZone: "America/Sao_Paulo",
    });

    expect(history.items[0]).toMatchObject({
      aiProfile: { name: "Default OpenRouter", profileId: "profile-1" },
      meetingId: "meeting-1",
      voiceChannelName: "Launch Week Sync",
    });
  });

  it("busca o ID exato no servidor e ignora os demais filtros", async () => {
    const query = vi.fn(async (_text: string, _values?: readonly unknown[]) => ({
      rowCount: 0,
      rows: [],
    }));
    const store = new PostgresAnalyticsStore({ query } satisfies PostgresExecutor);

    await store.listMeetings("guild-1", {
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
      meetingId: "meeting-1",
      page: 1,
      pageSize: 20,
      state: "failed",
      timeZone: "America/Sao_Paulo",
    });

    expect(query.mock.calls[0]?.[0]).toContain("meeting.meeting_id = $2");
    expect(query.mock.calls[0]?.[0]).toContain("$2::text IS NOT NULL AND");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "guild-1",
      "meeting-1",
      "2026-08-01",
      "2026-08-31",
      "failed",
      "America/Sao_Paulo",
      20,
      0,
      null,
      null,
      null,
    ]);
  });

  it("filters calls by channel, retention and participant", async () => {
    const query = vi.fn<PostgresExecutor["query"]>(async () => ({ rowCount: 0, rows: [] }));
    const store = new PostgresAnalyticsStore({ query } satisfies PostgresExecutor);

    await store.listMeetings("guild-1", {
      channelName: "planejamento",
      contentRetained: true,
      page: 1,
      pageSize: 20,
      participantUserId: "user-1",
      timeZone: "America/Sao_Paulo",
    });

    expect(query.mock.calls[0]?.[0]).toContain("voice_channel_name ILIKE");
    expect(query.mock.calls[0]?.[0]).toContain("content.meeting_id IS NOT NULL");
    expect(query.mock.calls[0]?.[0]).toContain("meeting_participants");
  });
});
