import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  api: { listMeetings: vi.fn(), listTasks: vi.fn() },
}));

beforeEach(() => {
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

  it("flags the attempts that are still pending", async () => {
    renderScreen(<OverviewPage />);
    expect(await screen.findByText("2 pendentes")).toBeInTheDocument();
  });

  it("breaks the cost down by phase and provider", async () => {
    renderScreen(<OverviewPage />);
    expect(await screen.findByText(/Transcrição/)).toBeInTheDocument();
    expect(screen.getByText("USD 7,21")).toBeInTheDocument();
    expect(screen.getByText("sem custo")).toBeInTheDocument();
  });

  it("ranks the top speakers by share of talk time", async () => {
    renderScreen(<OverviewPage />);
    expect(await screen.findByText("PixelPaladin")).toBeInTheDocument();
    expect(screen.getByText("58%")).toBeInTheDocument();
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

  it("lists the open tasks with a link to the full screen", async () => {
    renderScreen(<OverviewPage />);
    expect(await screen.findByText("Marcar a branch de release")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver todas as 7" })).toHaveAttribute("href", "/tasks");
  });

  it("lists the most recent calls", async () => {
    renderScreen(<OverviewPage />);
    expect(await screen.findByText("Launch Week Sync")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Histórico" })).toHaveAttribute("href", "/history");
  });

  it("offers to install the bot when no server has it", () => {
    renderScreen(<OverviewPage />, {
      context: dashboardContext({
        dashboard: undefined,
        guilds: guildSelection({ allGuilds: [], guilds: [], selectedGuildId: "" }),
      }),
    });
    expect(screen.getByRole("heading", { name: "Nenhum servidor ainda" })).toBeInTheDocument();
  });

  it("shows a retryable error when the metrics fail", async () => {
    const reload = vi.fn();
    renderScreen(<OverviewPage />, {
      context: dashboardContext({
        dashboardError: true,
        guilds: guildSelection({ allGuilds: [], guilds: [], reload, selectedGuild: undefined }),
      }),
    });
    expect(
      screen.getByRole("heading", { name: "Não foi possível carregar as métricas" }),
    ).toBeInTheDocument();
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
      await screen.findByText(/O talk time estará disponível após a primeira call concluída/),
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
  it("warns when attempts were not attributed", async () => {
    const dashboard = aDashboard();
    renderScreen(<OverviewPage />, {
      context: dashboardContext({
        dashboard: {
          ...dashboard,
          cost: {
            ...dashboard.cost,
            attemptCounts: { ...dashboard.cost.attemptCounts, unattributed: 2 },
          },
        },
      }),
    });
    expect(await screen.findByText(/não atribuída\(s\) automaticamente/)).toBeInTheDocument();
  });

  it("says when no cost was registered", async () => {
    const dashboard = aDashboard();
    renderScreen(<OverviewPage />, {
      context: dashboardContext({
        dashboard: { ...dashboard, cost: { ...dashboard.cost, breakdown: [] } },
      }),
    });
    expect(await screen.findByText("Nenhum custo registrado no período.")).toBeInTheDocument();
  });
});
