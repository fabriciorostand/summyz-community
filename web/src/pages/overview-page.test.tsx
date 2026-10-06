import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLanguage, setTimeFormat } from "../i18n/store";
import { api } from "../lib/api";
import {
  aDashboard,
  aLiveMeeting,
  aMeetingPage,
  aTask,
  dashboardContext,
  guildSelection,
  renderScreen,
} from "../tests/test-utils";
import { OverviewPage } from "./overview-page";

vi.mock("../lib/api", () => ({
  api: { getBotInstallation: vi.fn(), listMeetings: vi.fn(), listTasks: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.getBotInstallation).mockResolvedValue({
    applicationId: "1",
    configured: true,
    installUrl: "https://discord.com/oauth2/authorize?client_id=1",
  });
  vi.mocked(api.listMeetings).mockResolvedValue(aMeetingPage());
  vi.mocked(api.listTasks).mockResolvedValue([aTask()]);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("OverviewPage", () => {
  it("shows the headline metrics from the dashboard", async () => {
    renderScreen(<OverviewPage />);
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("38,0")).toBeInTheDocument();
    expect(screen.getByText("USD 12,48")).toBeInTheDocument();
    expect(screen.getByText("+16%")).toBeInTheDocument();
  });

  it("shows every cost of the overview with two decimals", async () => {
    const dashboard = aDashboard();
    renderScreen(<OverviewPage />, {
      context: dashboardContext({
        dashboard: {
          ...dashboard,
          cost: {
            confirmed: [{ amount: "3.5", currency: "USD" }],
            stages: dashboard.cost.stages.map((stage) =>
              stage.phase === "transcription"
                ? { ...stage, confirmed: [{ amount: "0.004", currency: "USD" }] }
                : stage,
            ),
          },
        },
      }),
    });
    expect(await screen.findByText("USD 3,50")).toBeInTheDocument();
    expect(screen.getByText("< USD 0,01")).toBeInTheDocument();
  });

  it("does not print the time zone footer", async () => {
    renderScreen(<OverviewPage />);
    await screen.findByRole("heading", { name: "Visão geral" });
    expect(screen.queryByText(/Fuso/)).not.toBeInTheDocument();
  });

  it("leaves pending and unattributed attempts to the cost detail page", async () => {
    renderScreen(<OverviewPage />);
    await screen.findByText("USD 12,48");
    expect(screen.queryByText(/pendente/)).toBeNull();
    expect(screen.queryByText(/atribuída/)).toBeNull();
    expect(screen.queryByText(/subtotal confirmado/)).toBeNull();
  });

  it("breaks the cost down by stage only, in pipeline order", async () => {
    renderScreen(<OverviewPage />);
    const card = (await screen.findByRole("heading", { name: "Custo por etapa" })).closest(
      "section",
    ) as HTMLElement;
    const rows = within(card).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "TranscriçãoUSD 7,21",
      "Refinamento—",
      "Resumosem custo",
    ]);
    expect(within(card).queryByText(/openrouter|faster-whisper|local/)).toBeNull();
    expect(
      within(card).getByRole("img", { name: "Distribuição do custo confirmado" }),
    ).toBeInTheDocument();
  });

  it("keeps each stage on its own series colour, like the cost detail page", async () => {
    const dashboard = aDashboard();
    const paid = (phase: "refinement" | "summary" | "transcription") => ({
      confirmed: [{ amount: "1.00", currency: "USD" }],
      executions: ["api" as const],
      phase,
    });
    renderScreen(<OverviewPage />, {
      context: dashboardContext({
        dashboard: {
          ...dashboard,
          cost: {
            ...dashboard.cost,
            stages: [
              paid("transcription"),
              { confirmed: [], executions: ["local"], phase: "refinement" },
              paid("summary"),
            ],
          },
        },
      }),
    });
    const bar = await screen.findByRole("img", { name: "Distribuição do custo confirmado" });
    const segments = [...bar.children] as HTMLElement[];
    expect(segments.map((segment) => segment.className)).toEqual(["bg-series-1", "bg-series-3"]);
    expect(segments.map((segment) => segment.style.width)).toEqual(["50%", "50%"]);
  });

  it("opens the cost detail from the cost card", async () => {
    renderScreen(<OverviewPage />);
    expect(await screen.findByRole("link", { name: "Detalhar" })).toHaveAttribute("href", "/costs");
  });

  it("labels the speaker panel in Portuguese", async () => {
    renderScreen(<OverviewPage />);
    expect(await screen.findByRole("heading", { name: "Principais falantes" })).toBeInTheDocument();
    expect(screen.getByText("Tempo de fala")).toBeInTheDocument();
  });

  it("ranks the top speakers by share of talk time", async () => {
    renderScreen(<OverviewPage />);
    expect(await screen.findByText("PixelPaladin")).toBeInTheDocument();
    expect(screen.getByText("58%")).toBeInTheDocument();
  });

  it("labels the period section without repeating the range the tabs already show", async () => {
    renderScreen(<OverviewPage />);
    expect(await screen.findByText("Período")).toBeInTheDocument();
    expect(screen.queryByText(/Últimos|Todo o histórico/)).toBeNull();
  });

  it("changes the period when another range is picked", async () => {
    const setPeriod = vi.fn();
    renderScreen(<OverviewPage />, { context: dashboardContext({ setPeriod }) });
    await userEvent.click(await screen.findByRole("tab", { name: "90d" }));
    expect(setPeriod).toHaveBeenCalledWith("90d");
  });

  it("renders the live meeting card with a running clock", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-08T17:14:41.000Z"), shouldAdvanceTime: true });
    renderScreen(<OverviewPage />, {
      context: dashboardContext({
        dashboard: aDashboard({ liveMeeting: aLiveMeeting() }),
      }),
    });
    expect(await screen.findByText("#launch-week")).toBeInTheDocument();
    expect(screen.getByText("Gravando")).toBeInTheDocument();
    expect(screen.getByText("12:41")).toBeInTheDocument();
    expect(screen.getByText("falando")).toBeInTheDocument();
    expect(screen.getByText(/perfil/)).toHaveTextContent("Padrão OpenRouter");
  });

  it("shows when the live meeting started in the zone the metrics were asked in", async () => {
    renderScreen(<OverviewPage />, {
      context: dashboardContext({
        dashboard: aDashboard({ liveMeeting: aLiveMeeting(), timeZone: "UTC" }),
      }),
    });
    expect(await screen.findByText(/Iniciada às 17:02/)).toBeInTheDocument();
  });

  it("keeps the day period of the start time on the 12-hour clock", async () => {
    setTimeFormat("12h");
    renderScreen(<OverviewPage />, {
      context: dashboardContext({ dashboard: aDashboard({ liveMeeting: aLiveMeeting() }) }),
    });
    expect(await screen.findByText(/Iniciada às 2:02 PM/)).toBeInTheDocument();
  });

  it("asks for the recent calls in the browser time zone", async () => {
    renderScreen(<OverviewPage />);
    await screen.findByText("Launch Week Sync");
    expect(api.listMeetings).toHaveBeenCalledWith("g1", { page: 1 }, "America/Sao_Paulo");
  });

  it("reads entirely in English, with English separators", async () => {
    setLanguage("en");
    vi.mocked(api.listTasks).mockResolvedValue([aTask()]);
    renderScreen(<OverviewPage />);
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("38.0")).toBeInTheDocument();
    expect(screen.getByText("USD 12.48")).toBeInTheDocument();
    expect(screen.getByText("Top speakers")).toBeInTheDocument();
    expect(await screen.findByText("FRI 04/09")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all 7" })).toBeInTheDocument();
  });

  it("groups the open tasks by owner with a link to the full screen", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      aTask(),
      aTask({ deadlineDate: null, taskId: "33333333-3333-4333-8333-333333333333", text: "Plano" }),
      aTask({
        ownerDisplayName: "RespawnRita",
        ownerUserId: "u2",
        taskId: "44444444-4444-4444-8444-444444444444",
        text: "Abrir o repro",
      }),
    ]);
    renderScreen(<OverviewPage />);
    const panel = (await screen.findByText("Marcar a branch de release")).closest("section");
    if (panel === null) throw new Error("expected the tasks card");
    expect(within(panel).getByText("PixelPaladin").closest("div")).toHaveTextContent("2");
    expect(within(panel).getByText("RespawnRita").closest("div")).toHaveTextContent("1");
    expect(within(panel).getAllByText("SEX 04/09")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Ver todas as 7" })).toHaveAttribute("href", "/tasks");
  });

  it("lists the most recent calls", async () => {
    renderScreen(<OverviewPage />);
    expect(await screen.findByText("Launch Week Sync")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Histórico" })).toHaveAttribute("href", "/history");
  });

  it("offers the Discord authorization when the bot is in no server", async () => {
    renderScreen(<OverviewPage />, {
      context: dashboardContext({
        dashboard: undefined,
        guilds: guildSelection({ guilds: [], selectedGuildId: "" }),
      }),
    });
    expect(
      screen.getByRole("heading", { name: "O bot ainda não está em nenhum servidor" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: /Adicionar o bot a um servidor/ }),
    ).toHaveAttribute("href", "https://discord.com/oauth2/authorize?client_id=1");
  });

  it("shows a retryable error pointing at the installation when the metrics fail", async () => {
    const reload = vi.fn();
    renderScreen(<OverviewPage />, {
      context: dashboardContext({
        dashboardError: true,
        guilds: guildSelection({ guilds: [], reload, selectedGuild: undefined }),
      }),
    });
    expect(
      screen.getByRole("heading", { name: "Não foi possível carregar as métricas" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver instalação" })).toHaveAttribute(
      "href",
      "/installation",
    );
    await userEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows the skeleton while the dashboard is loading", () => {
    renderScreen(<OverviewPage />, { context: dashboardContext({ dashboard: undefined }) });
    expect(screen.getByRole("status")).toHaveTextContent("Carregando métricas do servidor…");
  });

  it("explains the empty state of the speaker panel", async () => {
    renderScreen(<OverviewPage />, {
      context: dashboardContext({ dashboard: aDashboard({ topSpeakers: [] }) }),
    });
    expect(
      await screen.findByText(/O tempo de fala estará disponível após a primeira call concluída/),
    ).toBeInTheDocument();
  });

  it("hides the task panel when nothing is open", async () => {
    renderScreen(<OverviewPage />, {
      context: dashboardContext({ dashboard: aDashboard({ openTaskCount: 0 }) }),
    });
    await waitFor(() => expect(api.listMeetings).toHaveBeenCalled());
    expect(screen.queryByText("Tarefas abertas")).toBeNull();
  });

  it("survives the recent-calls request failing", async () => {
    vi.mocked(api.listMeetings).mockRejectedValue(new Error("offline"));
    renderScreen(<OverviewPage />);
    expect(await screen.findByText("Nenhuma call registrada ainda.")).toBeInTheDocument();
  });

  it("survives the task request failing", async () => {
    vi.mocked(api.listTasks).mockRejectedValue(new Error("offline"));
    renderScreen(<OverviewPage />);
    await waitFor(() => expect(api.listTasks).toHaveBeenCalled());
    expect(screen.getByText("Tarefas abertas")).toBeInTheDocument();
  });
});

describe("OverviewPage cost warnings", () => {
  it("says when no cost was registered", async () => {
    const dashboard = aDashboard();
    renderScreen(<OverviewPage />, {
      context: dashboardContext({
        dashboard: {
          ...dashboard,
          cost: {
            confirmed: [],
            stages: dashboard.cost.stages.map((stage) => ({
              ...stage,
              confirmed: [],
              executions: [],
            })),
          },
        },
      }),
    });
    expect(await screen.findByText("Nenhum custo registrado no período.")).toBeInTheDocument();
  });
});
