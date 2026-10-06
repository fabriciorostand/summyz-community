import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLanguage } from "../i18n/store";
import { api, type CostDetail } from "../lib/api";
import { dashboardContext, guildSelection, renderScreen } from "../tests/test-utils";
import { CostsPage } from "./costs-page";

vi.mock("../lib/api", () => ({ api: { getCostDetail: vi.fn() } }));

const getCostDetail = vi.mocked(api.getCostDetail);

const counts = (confirmed: number, pending = 0, notApplicable = 0) => ({
  confirmed,
  notApplicable,
  pending,
  unattributed: 0,
});

function aCostDetail(overrides: Partial<CostDetail> = {}): CostDetail {
  return {
    attemptCounts: counts(4, 0, 2),
    confirmed: [{ amount: "4.12", currency: "USD" }],
    dateFrom: "2026-10-01",
    dateTo: "2026-10-05",
    meetingCount: 12,
    models: [
      {
        attemptCounts: counts(3),
        chargedFailures: { confirmed: [{ amount: "0.05", currency: "USD" }], count: 1 },
        confirmed: [{ amount: "3.09", currency: "USD" }],
        execution: "api",
        model: "openai/whisper-1",
        phase: "transcription",
        provider: "openrouter",
      },
      {
        attemptCounts: counts(0, 0, 2),
        chargedFailures: { confirmed: [], count: 0 },
        confirmed: [],
        execution: "local",
        model: "llama3.1:8b",
        phase: "refinement",
        provider: "ollama",
      },
      {
        attemptCounts: counts(1),
        chargedFailures: { confirmed: [], count: 0 },
        confirmed: [{ amount: "1.03", currency: "USD" }],
        execution: "api",
        model: null,
        phase: "summary",
        provider: "openrouter",
      },
    ],
    stages: [
      {
        attemptCounts: counts(3),
        confirmed: [{ amount: "3.09", currency: "USD" }],
        phase: "transcription",
      },
      { attemptCounts: counts(0, 0, 2), confirmed: [], phase: "refinement" },
      {
        attemptCounts: counts(1),
        confirmed: [{ amount: "1.03", currency: "USD" }],
        phase: "summary",
      },
    ],
    timeZone: "America/Sao_Paulo",
    topMeetings: [
      {
        confirmed: [{ amount: "0.62", currency: "USD" }],
        meetingId: "m1",
        startedAt: "2026-10-02T13:00:00.000Z",
        voiceChannelName: "Launch Week Sync",
      },
      {
        confirmed: [{ amount: "0.31", currency: "USD" }],
        meetingId: "m2",
        startedAt: "2026-10-03T13:00:00.000Z",
        voiceChannelName: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T15:00:00.000Z"));
  getCostDetail.mockResolvedValue(aCostDetail());
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  setLanguage("pt-BR");
});

function renderCosts(route = "/costs", context = dashboardContext()) {
  return renderScreen(<CostsPage />, { context, path: "/costs", route });
}

describe("CostsPage", () => {
  it("opens on the current month in the viewer's zone", async () => {
    renderCosts();
    await screen.findByText("USD 4,12");
    expect(getCostDetail).toHaveBeenCalledWith(
      "g1",
      { dateFrom: "2026-10-01", dateTo: "2026-10-05" },
      "America/Sao_Paulo",
    );
    expect(screen.getByLabelText("De")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("Até")).toHaveValue("2026-10-05");
    expect(screen.getByText("confirmados em 12 reuniões")).toBeInTheDocument();
    expect(screen.queryByText(/recording-cost period/)).toBeNull();
  });

  it("returns to the overview from the header, separated from the title by a slash", async () => {
    renderCosts();
    const back = await screen.findByRole("link", { name: "Visão geral" });
    expect(back).toHaveAttribute("href", "/");
    expect(back.nextElementSibling).toHaveTextContent(/^\/$/);
  });

  it("reads the range from the address and keeps a new date there", async () => {
    renderCosts("/costs?from=2026-09-01&to=2026-09-30");
    await screen.findByText("USD 4,12");
    expect(getCostDetail).toHaveBeenLastCalledWith(
      "g1",
      { dateFrom: "2026-09-01", dateTo: "2026-09-30" },
      "America/Sao_Paulo",
    );

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-15" } });

    await waitFor(() =>
      expect(getCostDetail).toHaveBeenLastCalledWith(
        "g1",
        { dateFrom: "2026-09-15", dateTo: "2026-09-30" },
        "America/Sao_Paulo",
      ),
    );
    expect(screen.getByLabelText("De")).toHaveValue("2026-09-15");

    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-09-20" } });

    await waitFor(() =>
      expect(getCostDetail).toHaveBeenLastCalledWith(
        "g1",
        { dateFrom: "2026-09-15", dateTo: "2026-09-20" },
        "America/Sao_Paulo",
      ),
    );
  });

  it("explains a reversed range instead of querying it", async () => {
    renderCosts("/costs?from=2026-09-30&to=2026-09-01");
    expect(
      await screen.findByText("A data inicial precisa ser igual ou anterior à data final."),
    ).toBeInTheDocument();
    expect(getCostDetail).not.toHaveBeenCalled();
  });

  it("walks the stages in pipeline order with their share, provider and model", async () => {
    renderCosts();
    const stages = await screen.findByRole("list", { name: "Custo por etapa" });
    // Only the stages themselves; each one nests its own list of models.
    const items = [...stages.children] as HTMLElement[];
    expect(items.map((item) => within(item).getByRole("heading").textContent)).toEqual([
      "Transcrição",
      "Refinamento",
      "Resumo",
    ]);
    const [transcription, refinement, summary] = items as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(transcription).getByText("USD 3,09")).toBeInTheDocument();
    expect(within(transcription).getByText("75% do total")).toBeInTheDocument();
    expect(within(transcription).getByText("openrouter · openai/whisper-1")).toBeInTheDocument();
    expect(within(transcription).getByText("3 requisições")).toBeInTheDocument();
    expect(within(refinement).getByText("sem custo")).toBeInTheDocument();
    expect(within(refinement).getByText("ollama · llama3.1:8b")).toBeInTheDocument();
    expect(within(refinement).getByText("2 execuções locais")).toBeInTheDocument();
    expect(within(summary).getByText("openrouter · modelo não informado")).toBeInTheDocument();
  });

  it("draws the stage track in proportion to the confirmed cost, skipping free stages", async () => {
    renderCosts();
    const track = await screen.findByRole("img", {
      name: "Distribuição do custo confirmado por etapa",
    });
    const segments = [...track.children] as HTMLElement[];
    expect(segments.map((segment) => segment.className)).toEqual([
      expect.stringContaining("bg-series-1"),
      expect.stringContaining("bg-series-3"),
    ]);
    expect(segments.map((segment) => segment.style.flexGrow)).toEqual(["75", "25"]);
  });

  it("fills the whole track even when the confirmed total is a few cents", async () => {
    // Raw amounts as flex-grow summed below 1 and left most of the track empty.
    const detail = aCostDetail();
    getCostDetail.mockResolvedValue({
      ...detail,
      confirmed: [{ amount: "0.04", currency: "USD" }],
      stages: detail.stages.map((stage) => ({
        ...stage,
        confirmed:
          stage.phase === "refinement"
            ? []
            : [{ amount: stage.phase === "transcription" ? "0.03" : "0.01", currency: "USD" }],
      })),
    });
    renderCosts();
    const track = await screen.findByRole("img", {
      name: "Distribuição do custo confirmado por etapa",
    });
    const grow = ([...track.children] as HTMLElement[]).map((segment) =>
      Number(segment.style.flexGrow),
    );
    expect(grow).toEqual([75, 25]);
  });

  it("marks a stage that never ran in the range", async () => {
    const detail = aCostDetail();
    getCostDetail.mockResolvedValue({
      ...detail,
      models: detail.models.filter((model) => model.phase !== "summary"),
      stages: detail.stages.map((stage) =>
        stage.phase === "summary" ? { ...stage, attemptCounts: counts(0), confirmed: [] } : stage,
      ),
    });
    renderCosts();
    expect(await screen.findByText("Não executada no intervalo")).toBeInTheDocument();
  });

  it("lists every provider and model with requests, charged failures and exact cost", async () => {
    renderCosts();
    const table = await screen.findByRole("table", { name: "Por provedor e modelo" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["Transcrição", "openrouteropenai/whisper-1", "3", "1 · USD 0,05", "USD 3,09"],
      ["Refinamento", "ollamallama3.1:8b", "2", "—", "sem custo"],
      ["Resumo", "openroutermodelo não informado", "1", "—", "USD 1,03"],
    ]);
  });

  it("explains charged failures on demand", async () => {
    renderCosts();
    await userEvent.click(await screen.findByRole("button", { name: "Falhas cobradas" }));
    expect(
      screen.getByText(/Tentativas que falharam, mas que o OpenRouter cobrou/),
    ).toBeInTheDocument();
  });

  it("links the five most expensive meetings to their detail", async () => {
    renderCosts();
    const list = await screen.findByRole("list", { name: "Reuniões mais caras" });
    const links = within(list).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/history/m1", "/history/m2"]);
    expect(within(links[0] as HTMLElement).getByText("Launch Week Sync")).toBeInTheDocument();
    expect(within(links[0] as HTMLElement).getByText("USD 0,62")).toBeInTheDocument();
    expect(within(links[1] as HTMLElement).getByText("Canal indisponível")).toBeInTheDocument();
  });

  it("says when no meeting has a confirmed cost", async () => {
    getCostDetail.mockResolvedValue(aCostDetail({ topMeetings: [] }));
    renderCosts();
    expect(
      await screen.findByText("Nenhuma reunião com custo confirmado no intervalo."),
    ).toBeInTheDocument();
  });

  it("warns that pending and unattributed attempts leave the total incomplete", async () => {
    getCostDetail.mockResolvedValue(
      aCostDetail({
        attemptCounts: { confirmed: 4, notApplicable: 0, pending: 2, unattributed: 1 },
      }),
    );
    renderCosts();
    expect(
      await screen.findByText(/2 tentativas ainda aguardam a confirmação do OpenRouter\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 tentativa não foi atribuída automaticamente\./)).toBeInTheDocument();
  });

  it("invites another range when no meeting finished in it", async () => {
    getCostDetail.mockResolvedValue(aCostDetail({ meetingCount: 0 }));
    renderCosts();
    expect(await screen.findByText("Nenhuma reunião encerrada no intervalo")).toBeInTheDocument();
    expect(screen.getByLabelText("De")).toBeInTheDocument();
  });

  it("offers a retry when the costs fail to load", async () => {
    getCostDetail.mockRejectedValueOnce(new Error("offline"));
    renderCosts();
    expect(await screen.findByText("Não foi possível carregar os custos")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("USD 4,12")).toBeInTheDocument();
  });

  it("asks for a server with the bot before querying", () => {
    renderCosts(
      "/costs",
      dashboardContext({
        guilds: guildSelection({ guilds: [], selectedGuild: undefined, selectedGuildId: "" }),
      }),
    );
    expect(screen.getByText("Nenhum servidor instalado")).toBeInTheDocument();
    expect(getCostDetail).not.toHaveBeenCalled();
  });

  it("reads in English", async () => {
    setLanguage("en");
    renderCosts();
    expect(await screen.findByText("confirmed across 12 meetings")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Costs" })).toBeInTheDocument();
  });
});
