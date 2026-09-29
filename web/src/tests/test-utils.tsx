import { type RenderResult, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";

import type { DashboardContext } from "../layout/dashboard-layout";
import type {
  DashboardAnalytics,
  DashboardSettings,
  DashboardTask,
  Guild,
  GuildConfiguration,
  GuildResources,
  MeetingHistoryDetail,
  MeetingHistoryPage,
  Profile,
} from "../lib/api";

export function aSettings(overrides: Partial<DashboardSettings> = {}): DashboardSettings {
  return {
    accessMode: "local",
    discordApplicationId: "1289443021764919306",
    secrets: { discordBotToken: true, openRouterApiKey: true },
    ...overrides,
  };
}

export function aGuild(overrides: Partial<Guild> = {}): Guild {
  return {
    activeProfile: { name: "Padrão OpenRouter", profileId: "p1", profileType: "external" },
    callCount: 42,
    iconUrl: null,
    id: "g1",
    name: "Pixelforge",
    summaryForum: { forumId: "f1", name: "#atas-de-reuniao" },
    ...overrides,
  };
}

export function aDashboard(overrides: Partial<DashboardAnalytics> = {}): DashboardAnalytics {
  return {
    averageDurationMs: 54 * 60_000,
    calls: { current: 42, deltaPercentage: 16, previous: 36 },
    cost: {
      attemptCounts: { confirmed: 40, notApplicable: 0, pending: 2, unattributed: 0 },
      breakdown: [
        {
          attemptCounts: { confirmed: 40, notApplicable: 0, pending: 0, unattributed: 0 },
          confirmed: [{ amount: "7.21", currency: "USD" }],
          execution: "api",
          phase: "transcription",
          provider: "openrouter",
        },
        {
          attemptCounts: { confirmed: 0, notApplicable: 4, pending: 0, unattributed: 0 },
          confirmed: [],
          execution: "local",
          phase: "summary",
          provider: "faster-whisper",
        },
      ],
      confirmed: [{ amount: "12.48", currency: "USD" }],
    },
    liveMeeting: null,
    openTaskCount: 7,
    period: "30d",
    statusSeries: [
      { bucketStart: "2026-08-31", completed: 5, failed: 1 },
      { bucketStart: "2026-09-07", completed: 8, failed: 0 },
    ],
    timeZone: "America/Sao_Paulo",
    topSpeakers: [
      { avatarUrl: null, displayName: "PixelPaladin", talkTimeMs: 340_000, userId: "u1" },
      { avatarUrl: null, displayName: "RespawnRita", talkTimeMs: 250_000, userId: "u2" },
    ],
    totalCalls: 42,
    totalDurationMs: 38 * 3_600_000,
    ...overrides,
  };
}

export function aLiveMeeting(): NonNullable<DashboardAnalytics["liveMeeting"]> {
  return {
    aiProfile: { name: "Padrão OpenRouter", profileId: "p1" },
    guildId: "g1",
    meetingId: "m-live",
    participants: [
      { avatarUrl: null, displayName: "PixelPaladin", userId: "u1" },
      { avatarUrl: null, displayName: "LootGoblin", userId: "u3" },
    ],
    speakingUserIds: ["u1"],
    startedAt: "2026-09-08T17:02:00.000Z",
    updatedAt: "2026-09-08T17:14:00.000Z",
    voiceChannelId: "c1",
    voiceChannelName: "#launch-week",
  };
}

export function aMeetingPage(overrides: Partial<MeetingHistoryPage> = {}): MeetingHistoryPage {
  return {
    items: [
      {
        aiProfile: { name: "Padrão OpenRouter", profileId: "p1" },
        completedAt: "2026-09-04T18:06:00.000Z",
        contentRetained: true,
        durationMs: 64 * 60_000,
        failureCode: null,
        meetingId: "m1",
        participants: [
          {
            avatarUrl: null,
            displayName: "PixelPaladin",
            percentage: 38,
            talkTimeMs: 100_000,
            userId: "u1",
          },
          {
            avatarUrl: null,
            displayName: "RespawnRita",
            percentage: 27,
            talkTimeMs: 70_000,
            userId: "u2",
          },
        ],
        pipelineStatus: "completed",
        startedAt: "2026-09-04T17:02:00.000Z",
        voiceChannelName: "Launch Week Sync",
      },
      {
        aiProfile: null,
        completedAt: null,
        contentRetained: false,
        durationMs: 47 * 60_000,
        failureCode: "summary_failed",
        meetingId: "m2",
        participants: null,
        pipelineStatus: "failed",
        startedAt: "2026-09-02T20:10:00.000Z",
        voiceChannelName: "Retro Sprint 41",
      },
    ],
    page: 1,
    pageSize: 20,
    timeZone: "America/Sao_Paulo",
    total: 2,
    ...overrides,
  };
}

export function aMeetingDetail(
  overrides: Partial<MeetingHistoryDetail> = {},
): MeetingHistoryDetail {
  const [first] = aMeetingPage().items;
  if (first === undefined) throw new Error("fixture must provide a meeting");
  return {
    ...first,
    audioRetained: false,
    cost: {
      attemptCounts: { confirmed: 3, notApplicable: 0, pending: 0, unattributed: 0 },
      breakdown: [],
      confirmed: [{ amount: "0.412907", currency: "USD" }],
    },
    discordUrl: "https://discord.com/channels/1/2/3",
    rawTranscript: null,
    summary: {
      decisions: ["Data de lançamento travada: sexta-feira."],
      discussedTopics: ["Estabilidade do co-op no nível 3"],
      executiveSummary: "A Pixelforge trava a data de lançamento na sexta.",
      language: "pt-BR",
      observations: ["Definir se o patch precisa de nova revisão."],
      status: "completed",
      tasks: [{ deadlineText: "sexta", ownerName: "PixelPaladin", text: "Marcar a branch." }],
    },
    timeZone: "America/Sao_Paulo",
    transcript:
      "[00:00:04 – 00:00:19] PixelPaladin: Build está verde na main.\n" +
      "[00:00:19 – 00:00:41] RespawnRita: O co-op dessincroniza no nível 3.\n",
    ...overrides,
  };
}

export function aTask(overrides: Partial<DashboardTask> = {}): DashboardTask {
  return {
    completedAt: null,
    completedByUserId: null,
    deadlineDate: "2026-09-04",
    deadlinePrecision: "date",
    deadlineText: "sexta",
    deadlineTime: null,
    deadlineTimeZone: "America/Sao_Paulo",
    meetingId: "m1",
    ownerAvatarUrl: null,
    ownerDisplayName: "PixelPaladin",
    ownerName: "PixelPaladin",
    ownerUserId: "u1",
    overdue: false,
    taskId: "22222222-2222-4222-8222-222222222222",
    text: "Marcar a branch de release",
    voiceChannelName: "Launch Week Sync",
    ...overrides,
  };
}

export function aProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    language: "pt-BR",
    // A null editable prompt means "not sent", which the API stores as a custom choice.
    promptModes: {
      refinement: "custom",
      summaryConsolidation: "custom",
      summaryExtraction: "custom",
      transcription: "default",
    },
    name: "Padrão OpenRouter",
    profileId: "p1",
    profileType: "external",
    refinement: {
      generation: {},
      maxChunkCharacters: 8_000,
      model: "vendor/refine",
      prompt: null,
      provider: "openrouter",
    },
    summary: {
      consolidationPrompt: null,
      extractionPrompt: null,
      generation: {},
      maxChunkCharacters: 8_000,
      model: "anthropic/claude-sonnet-4",
      provider: "openrouter",
    },
    transcription: {
      interSpeechSilenceMs: 700,
      language: "auto",
      mergeMaxGapMs: 400,
      model: "openai/whisper-1",
      prompt: null,
      provider: "openrouter",
      vad: {
        enabled: true,
        minSilenceDurationMs: 2_000,
        minSpeechDurationMs: 250,
        negativeSpeechThreshold: "auto",
        speechPadMs: 300,
        threshold: 0.5,
      },
    },
    ...overrides,
  } as Profile;
}

/** A profile as the server configuration lists it, with whether it can record. */
export function aConfigurationProfile(
  profile: Profile,
  availability: GuildConfiguration["profiles"][number]["availability"] = {
    missingModels: [],
    status: "ready",
    unavailableProviders: [],
  },
): GuildConfiguration["profiles"][number] {
  return { ...profile, availability };
}

export function aGuildConfiguration(
  overrides: Partial<GuildConfiguration> = {},
): GuildConfiguration {
  return {
    activeProfileId: "p1",
    profiles: [aConfigurationProfile(aProfile())],
    recordingRoleIds: ["r1"],
    recordingUserIds: [],
    settings: { botLanguage: "pt-BR", persistMeetingAudio: false, persistMeetingContent: true },
    summaryForum: { forumId: "f1" },
    ...overrides,
  };
}

export function aGuildResources(overrides: Partial<GuildResources> = {}): GuildResources {
  return {
    forums: [{ id: "f1", name: "#atas-de-reuniao", tags: [{ id: "t1", name: "sprint" }] }],
    memberCounts: { status: "available" },
    roles: [
      { id: "r1", memberCount: 12, name: "Time Engine" },
      { id: "r2", memberCount: 5, name: "QA" },
    ],
    ...overrides,
  };
}

export function guildSelection(
  overrides: Partial<DashboardContext["guilds"]> = {},
): DashboardContext["guilds"] {
  const installed = [aGuild()];
  return {
    error: false,
    guilds: installed,
    reload: () => undefined,
    selectedGuild: installed[0],
    selectedGuildId: "g1",
    setSelectedGuildId: () => undefined,
    ...overrides,
  };
}

export function dashboardContext(overrides: Partial<DashboardContext> = {}): DashboardContext {
  return {
    controls: <span data-testid="controls" />,
    dashboard: aDashboard(),
    dashboardError: false,
    guilds: guildSelection(),
    patchSettings: () => undefined,
    period: "30d",
    reloadDashboard: () => undefined,
    reloadSettings: () => Promise.resolve(),
    setPeriod: () => undefined,
    setTheme: () => undefined,
    settings: aSettings(),
    theme: "dark",
    ...overrides,
  };
}

/** Renders a screen the way the router does: inside a layout that supplies the outlet context. */
export function renderScreen(
  element: ReactElement,
  {
    context = dashboardContext(),
    path = "/",
    route = "/",
  }: { context?: DashboardContext; path?: string; route?: string } = {},
): RenderResult {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route element={element} path={path} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

export function renderWithRouter(children: ReactNode): RenderResult {
  return render(<MemoryRouter>{children}</MemoryRouter>);
}

/** Hover classes that would still apply while the element is disabled. */
export function unguardedHoverClasses(element: Element): string[] {
  return [...element.classList].filter((name) => name.startsWith("hover:"));
}

/** Opens a combobox by its accessible name and returns the list it controls. */
export async function openOptions(combobox: string): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("combobox", { name: combobox }));
  return screen.getByRole("listbox", { name: combobox });
}

/** Picks an option the way an operator does: open the combobox, then click the option. */
export async function chooseOption(combobox: string, option: string): Promise<void> {
  await openOptions(combobox);
  await userEvent.click(screen.getByRole("option", { name: option }));
}
