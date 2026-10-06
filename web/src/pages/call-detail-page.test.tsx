import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDateFormat, setLanguage, setTimeFormat } from "../i18n/store";
import { api } from "../lib/api";
import { meetingFileName } from "../lib/download";
import { aMeetingDetail, dashboardContext, renderScreen } from "../tests/test-utils";
import { CallDetailPage } from "./call-detail-page";

vi.mock("../lib/api", () => ({
  api: { getMeeting: vi.fn(), getMeetingExport: vi.fn() },
}));

vi.mock("../lib/download", () => ({
  downloadTextFile: vi.fn(),
  meetingFileName: vi.fn(() => "launch-week-sync.txt"),
}));

const getMeeting = vi.mocked(api.getMeeting);

function renderDetail(context = dashboardContext()) {
  return renderScreen(<CallDetailPage />, {
    context,
    path: "/history/:meetingId",
    route: "/history/m1",
  });
}

beforeEach(() => {
  getMeeting.mockResolvedValue(aMeetingDetail());
  vi.mocked(api.getMeetingExport).mockResolvedValue("conteúdo exportado");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CallDetailPage", () => {
  it("returns to the history from the header, separated from the title by a slash", async () => {
    renderDetail();
    const back = await screen.findByRole("link", { name: "Calls" });
    expect(back).toHaveAttribute("href", "/history");
    expect(back.nextElementSibling).toHaveTextContent(/^\/$/);
  });

  it("shows the channel name and status in the header", async () => {
    renderDetail();
    expect(await screen.findByRole("heading", { name: /Launch Week Sync/ })).toBeInTheDocument();
    expect(screen.getByText("Concluída")).toBeInTheDocument();
  });

  it("renders the structured summary", async () => {
    renderDetail();
    expect(
      await screen.findByText("A Pixelforge trava a data de lançamento na sexta."),
    ).toBeInTheDocument();
    expect(screen.getByText("Data de lançamento travada: sexta-feira.")).toBeInTheDocument();
    expect(screen.getByText("Estabilidade do co-op no nível 3")).toBeInTheDocument();
    expect(screen.getByText("Marcar a branch.")).toBeInTheDocument();
  });

  it("parses the transcript into speaker turns", async () => {
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: /Transcrição completa/ }));
    expect(screen.getByText("00:00:04")).toBeInTheDocument();
    expect(screen.getByText("Build está verde na main.")).toBeInTheDocument();
    expect(screen.getByText("O co-op dessincroniza no nível 3.")).toBeInTheDocument();
  });

  it("titles the transcript disclosure without turn and word counts", async () => {
    renderDetail();
    expect(
      await screen.findByRole("button", { name: /Transcrição completa/ }),
    ).toHaveAccessibleName("Transcrição completa");
  });

  it("falls back to raw text when the transcript has no headers", async () => {
    getMeeting.mockResolvedValue(aMeetingDetail({ transcript: "texto solto" }));
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: /Transcrição completa/ }));
    expect(screen.getByText("texto solto")).toBeInTheDocument();
  });

  it("lists the participants with their share", async () => {
    renderDetail();
    expect(await screen.findByText("38%")).toBeInTheDocument();
    expect(screen.getByText("27%")).toBeInTheDocument();
  });

  it("fills the technical sheet from the API", async () => {
    renderDetail();
    expect(await screen.findByText("Padrão OpenRouter")).toBeInTheDocument();
    expect(screen.getByText("USD 0,412907")).toBeInTheDocument();
    expect(screen.getByText("1h 04m")).toBeInTheDocument();
    expect(screen.getByText("não")).toBeInTheDocument();
  });

  it("asks for the meeting in the browser time zone", async () => {
    renderDetail();
    await screen.findByText("Padrão OpenRouter");
    expect(getMeeting).toHaveBeenCalledWith("g1", "m1", "America/Sao_Paulo");
  });

  it("shows the full start date with the year in the chosen formats", async () => {
    renderDetail();
    expect(await screen.findByText("04/09/2026 14:02")).toBeInTheDocument();
  });

  it("follows an explicit date and time format on the start date", async () => {
    setDateFormat("YYYY-MM-DD");
    setTimeFormat("12h");
    renderDetail();
    expect(await screen.findByText("2026-09-04 2:02 PM")).toBeInTheDocument();
  });

  it("reads in English, keeping the summary content untouched", async () => {
    setLanguage("en");
    renderDetail();
    expect(await screen.findByText("Fact sheet")).toBeInTheDocument();
    expect(screen.getByText("USD 0.412907")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export/ })).toBeInTheDocument();
    expect(
      screen.getByText("A Pixelforge trava a data de lançamento na sexta."),
    ).toBeInTheDocument();
  });

  it("titles the summary sections in the summary language when the summary has no labels", async () => {
    setLanguage("en");
    renderDetail();
    expect(await screen.findByText("Resumo executivo")).toBeInTheDocument();
    expect(screen.getByText("Decisões")).toBeInTheDocument();
    expect(screen.getByText("Tarefas por responsável")).toBeInTheDocument();
  });

  it("uses English section titles for a summary written in another language", async () => {
    const meeting = aMeetingDetail();
    if (meeting.summary?.status !== "completed") throw new Error("fixture must be completed");
    getMeeting.mockResolvedValue({ ...meeting, summary: { ...meeting.summary, language: "es" } });
    renderDetail();
    expect(await screen.findByText("Executive summary")).toBeInTheDocument();
    expect(screen.getByText("Decisions")).toBeInTheDocument();
    expect(screen.getByText("Open issues and notes")).toBeInTheDocument();
  });

  it("keeps the section titles the summary brought with it", async () => {
    const meeting = aMeetingDetail();
    if (meeting.summary?.status !== "completed") throw new Error("fixture must be completed");
    getMeeting.mockResolvedValue({
      ...meeting,
      summary: {
        ...meeting.summary,
        labels: {
          assignee: "Responsable",
          deadline: "Plazo",
          decisions: "Decisiones",
          discussedTopics: "Temas tratados",
          executiveSummary: "Resumen ejecutivo",
          fullTranscript: "Transcripción completa",
          meetingId: "ID de la reunión",
          observations: "Pendientes",
          summary: "Resumen",
          tasks: "Tareas",
          transcript: "Transcripción",
        },
      },
    });
    renderDetail();
    expect(await screen.findByText("Resumen ejecutivo")).toBeInTheDocument();
    expect(screen.getByText("Decisiones")).toBeInTheDocument();
  });

  it("links to the published Discord post", async () => {
    renderDetail();
    expect(await screen.findByRole("link", { name: /Abrir no Discord/ })).toHaveAttribute(
      "href",
      "https://discord.com/channels/1/2/3",
    );
  });

  it("exports the meeting through the API", async () => {
    const { downloadTextFile } = await import("../lib/download");
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: /Exportar/ }));
    await waitFor(() =>
      expect(api.getMeetingExport).toHaveBeenCalledWith("g1", "m1", {
        dateFormat: "DD/MM/YYYY",
        timeFormat: "24h",
        timeZone: "America/Sao_Paulo",
      }),
    );
    expect(downloadTextFile).toHaveBeenCalledWith("launch-week-sync.txt", "conteúdo exportado");
    expect(meetingFileName).toHaveBeenCalledWith("Launch Week Sync", "m1", "reuniao");
  });

  it("exports in the formats chosen in this browser", async () => {
    setLanguage("en");
    setDateFormat("MM/DD/YYYY");
    setTimeFormat("12h");
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: /Export/ }));
    await waitFor(() =>
      expect(api.getMeetingExport).toHaveBeenCalledWith("g1", "m1", {
        dateFormat: "MM/DD/YYYY",
        timeFormat: "12h",
        timeZone: "America/Sao_Paulo",
      }),
    );
    expect(meetingFileName).toHaveBeenCalledWith("Launch Week Sync", "m1", "meeting");
  });

  it("reports an export failure on the button", async () => {
    vi.mocked(api.getMeetingExport).mockRejectedValue(new Error("offline"));
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: /Exportar/ }));
    expect(await screen.findByRole("button", { name: /Falhou/ })).toBeInTheDocument();
  });

  it("hides the export button when there is nothing to export", async () => {
    getMeeting.mockResolvedValue(aMeetingDetail({ summary: null, transcript: null }));
    renderDetail();
    await waitFor(() => expect(screen.getAllByText("Conteúdo não retido.")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: /Exportar/ })).toBeNull();
  });

  it("explains a summary that could not be generated", async () => {
    getMeeting.mockResolvedValue(
      aMeetingDetail({ summary: { language: "pt-BR", status: "failed" } }),
    );
    renderDetail();
    expect(
      await screen.findByText(/Não foi possível gerar o resumo após as tentativas/),
    ).toBeInTheDocument();
  });

  it("warns when no attempt confirmed the requested summary language", async () => {
    const detail = aMeetingDetail();
    if (detail.summary?.status !== "completed") throw new Error("fixture must be completed");
    getMeeting.mockResolvedValue(
      aMeetingDetail({
        summary: {
          ...detail.summary,
          languageWarning: { detectedLanguage: "pt", requestedLanguage: "en" },
        },
      }),
    );
    renderDetail();
    const warning = await screen.findByText(
      /Não foi possível confirmar que o resumo foi gerado em/,
    );
    expect(warning).toHaveTextContent(
      "Não foi possível confirmar que o resumo foi gerado em en. Idioma identificado: pt.",
    );
    expect(within(warning).getByText("en").tagName).toBe("STRONG");
    expect(within(warning).getByText("pt").tagName).toBe("STRONG");
  });

  it("omits the identified language when the warning has none", async () => {
    const detail = aMeetingDetail();
    if (detail.summary?.status !== "completed") throw new Error("fixture must be completed");
    getMeeting.mockResolvedValue(
      aMeetingDetail({
        summary: { ...detail.summary, languageWarning: { requestedLanguage: "en" } },
      }),
    );
    renderDetail();
    const warning = await screen.findByText(
      /Não foi possível confirmar que o resumo foi gerado em/,
    );
    expect(warning).toHaveTextContent("Não foi possível confirmar que o resumo foi gerado em en.");
    expect(screen.queryByText(/Idioma identificado/)).toBeNull();
  });

  it("shows no language warning when the summary language was confirmed", async () => {
    renderDetail();
    await screen.findByText("A Pixelforge trava a data de lançamento na sexta.");
    expect(screen.queryByText(/Não foi possível confirmar que o resumo/)).toBeNull();
  });

  it("copies the meeting id", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: /m1/ }));
    expect(writeText).toHaveBeenCalledWith("m1");
    vi.unstubAllGlobals();
  });

  it("offers a retry when the call cannot be loaded", async () => {
    getMeeting.mockRejectedValue(new Error("offline"));
    renderDetail();
    expect(await screen.findByRole("heading", { name: "Call indisponível" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    await waitFor(() => expect(getMeeting).toHaveBeenCalledTimes(2));
  });

  it("says when participation is unavailable", async () => {
    getMeeting.mockResolvedValue(aMeetingDetail({ participants: null }));
    renderDetail();
    expect(await screen.findByText("Informação indisponível.")).toBeInTheDocument();
  });
});
