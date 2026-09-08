import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { aMeetingDetail, dashboardContext, renderScreen } from "../test-utils";
import { CallDetailPage } from "./call-detail-page";

vi.mock("../lib/api", () => ({
  api: { getMeeting: vi.fn(), getMeetingExport: vi.fn() },
}));

vi.mock("../lib/download", () => ({
  downloadTextFile: vi.fn(),
  meetingFileName: () => "launch-week-sync.txt",
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

  it("counts the turns and words of the transcript", async () => {
    renderDetail();
    expect(
      await screen.findByRole("button", { name: /Transcrição completa/ }),
    ).toHaveAccessibleName(expect.stringContaining("2 falas · 11 palavras"));
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
    await waitFor(() => expect(api.getMeetingExport).toHaveBeenCalledWith("g1", "m1"));
    expect(downloadTextFile).toHaveBeenCalledWith("launch-week-sync.txt", "conteúdo exportado");
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
