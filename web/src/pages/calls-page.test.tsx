import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDateFormat, setLanguage, setTimeFormat } from "../i18n/store";
import { api } from "../lib/api";
import {
  aMeetingPage,
  chooseOption,
  dashboardContext,
  guildSelection,
  openOptions,
  renderScreen,
} from "../tests/test-utils";
import { CallsPage } from "./calls-page";

vi.mock("../lib/api", () => ({
  api: { listHistoricalParticipants: vi.fn(), listMeetings: vi.fn() },
}));

const listMeetings = vi.mocked(api.listMeetings);

beforeEach(() => {
  listMeetings.mockResolvedValue(aMeetingPage());
  vi.mocked(api.listHistoricalParticipants).mockResolvedValue({
    items: [{ avatarUrl: null, displayName: "PixelPaladin", userId: "u1" }],
    page: 1,
    pageSize: 20,
    total: 1,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CallsPage", () => {
  it("lists each call with status, profile and talk time", async () => {
    renderScreen(<CallsPage />);
    expect(await screen.findByText("Launch Week Sync")).toBeInTheDocument();
    expect(screen.getByText("perfil Padrão OpenRouter")).toBeInTheDocument();
    expect(screen.getByText("PixelPaladin 38%")).toBeInTheDocument();
    expect(screen.getByText("Participantes · tempo de fala")).toBeInTheDocument();
    expect(screen.getByText("Concluída")).toBeInTheDocument();
    expect(screen.getByText("Falhou")).toBeInTheDocument();
  });

  it("describes retention per call", async () => {
    renderScreen(<CallsPage />);
    expect(await screen.findByText("perfil Padrão OpenRouter")).toBeInTheDocument();
    expect(screen.getByText("conteúdo não retido")).toBeInTheDocument();
  });

  it("links each row to the call detail", async () => {
    renderScreen(<CallsPage />);
    const row = await screen.findByText("Launch Week Sync");
    expect(row.closest("a")).toHaveAttribute("href", "/history/m1");
  });

  it("leaves the record count out of the header", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    expect(screen.queryByText(/registros/)).toBeNull();
  });

  it("treats a single-token search as a meeting id", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.type(screen.getByLabelText(/Buscar por canal/), "m1{Enter}");
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith(
        "g1",
        { meetingId: "m1", page: 1 },
        "America/Sao_Paulo",
      ),
    );
  });

  it("treats a multi-word search as a channel name", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.type(screen.getByLabelText(/Buscar por canal/), "launch week{Enter}");
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith(
        "g1",
        { channelName: "launch week", page: 1 },
        "America/Sao_Paulo",
      ),
    );
  });

  it("strips the hash from a channel search", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.type(screen.getByLabelText(/Buscar por canal/), "#launch{Enter}");
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith(
        "g1",
        { channelName: "launch", page: 1 },
        "America/Sao_Paulo",
      ),
    );
  });

  it("clears an active search", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.type(screen.getByLabelText(/Buscar por canal/), "m1{Enter}");
    await screen.findByRole("button", { name: "Limpar" });
    await userEvent.click(screen.getByRole("button", { name: "Limpar" }));
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith("g1", { page: 1 }, "America/Sao_Paulo"),
    );
  });

  it("filters by pipeline state", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.click(screen.getByRole("tab", { name: "Falhas" }));
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith(
        "g1",
        { page: 1, state: "failed" },
        "America/Sao_Paulo",
      ),
    );
  });

  it("keeps the advanced button at the start when it wraps below the tabs", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    // The tabs fill the row, so the button only reaches the right edge when both fit.
    expect(screen.getByRole("tablist", { name: "Estado da call" }).parentElement).toHaveClass(
      "flex-auto",
    );
    expect(screen.getByRole("button", { name: /Avançado/ })).not.toHaveClass("ml-auto");
  });

  it("exposes the advanced filters on demand", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.click(screen.getByRole("button", { name: /Avançado/ }));
    await chooseOption("Conteúdo retido", "Somente com conteúdo");
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith(
        "g1",
        { contentRetained: true, page: 1 },
        "America/Sao_Paulo",
      ),
    );
  });

  it("filters by participant using the historical directory", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.click(screen.getByRole("button", { name: /Avançado/ }));
    await openOptions("Participante");
    await userEvent.click(await screen.findByRole("option", { name: "PixelPaladin" }));
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith(
        "g1",
        { page: 1, participantUserId: "u1" },
        "America/Sao_Paulo",
      ),
    );
  });

  it("outlines the initials of a participant without a photo", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.click(screen.getByRole("button", { name: /Avançado/ }));
    await openOptions("Participante");
    const option = await screen.findByRole("option", { name: "PixelPaladin" });
    expect(within(option).getByText("PI")).toHaveClass("bg-action-soft", "border");
  });

  it("filters by date range", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.click(screen.getByRole("button", { name: /Avançado/ }));
    await userEvent.type(screen.getByLabelText("De"), "2026-09-01");
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith(
        "g1",
        { dateFrom: "2026-09-01", page: 1 },
        "America/Sao_Paulo",
      ),
    );
  });

  it("pages forward and back", async () => {
    listMeetings.mockResolvedValue(aMeetingPage({ total: 40 }));
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    expect(screen.getByRole("button", { name: /Anterior/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Próxima/ }));
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith("g1", { page: 2 }, "America/Sao_Paulo"),
    );
  });

  it("summarises the visible range", async () => {
    listMeetings.mockResolvedValue(aMeetingPage({ total: 42 }));
    renderScreen(<CallsPage />);
    expect(await screen.findByText("1–20 de 42")).toBeInTheDocument();
  });

  it("says when nothing matches the filters", async () => {
    listMeetings.mockResolvedValue(aMeetingPage({ items: [], total: 0 }));
    renderScreen(<CallsPage />);
    expect(
      await screen.findByRole("heading", { name: "Nenhuma call encontrada" }),
    ).toBeInTheDocument();
  });

  it("offers a retry when the history fails", async () => {
    listMeetings.mockRejectedValue(new Error("offline"));
    renderScreen(<CallsPage />);
    expect(
      await screen.findByRole("heading", { name: "Histórico indisponível" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    await waitFor(() => expect(listMeetings).toHaveBeenCalledTimes(2));
  });

  it("asks the operator to install the bot when no server has it", () => {
    renderScreen(<CallsPage />, {
      context: dashboardContext({
        guilds: guildSelection({ guilds: [], selectedGuildId: "" }),
      }),
    });
    expect(screen.getByRole("heading", { name: "Nenhum servidor instalado" })).toBeInTheDocument();
  });

  it("says when talk time is unavailable for a call", async () => {
    renderScreen(<CallsPage />);
    const failedRow = (await screen.findByText("Retro Sprint 41")).closest("a");
    expect(failedRow).not.toBeNull();
    expect(
      within(failedRow as HTMLElement).getByText("Informação indisponível"),
    ).toBeInTheDocument();
  });

  it("says when the participants have no talk time yet", async () => {
    const page = aMeetingPage();
    const [meeting] = page.items;
    if (meeting === undefined || meeting.participants === null) throw new Error("fixture");
    listMeetings.mockResolvedValue({
      ...page,
      items: [
        {
          ...meeting,
          participants: meeting.participants.map((participant) => ({
            ...participant,
            percentage: null,
            talkTimeMs: null,
          })),
        },
      ],
    });
    renderScreen(<CallsPage />);
    expect(await screen.findByText("tempo de fala indisponível")).toBeInTheDocument();
  });

  it("shows each start in the chosen date and time formats, without the year", async () => {
    setDateFormat("MM/DD/YYYY");
    setTimeFormat("12h");
    renderScreen(<CallsPage />);
    expect(await screen.findByText("09/04 2:02 PM")).toBeInTheDocument();
  });

  it("reads in English", async () => {
    setLanguage("en");
    renderScreen(<CallsPage />);
    expect(await screen.findByText("profile Padrão OpenRouter")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Completed" })).toBeInTheDocument();
    expect(screen.getByText("content not retained")).toBeInTheDocument();
    expect(screen.getByText("1–2 of 2")).toBeInTheDocument();
  });

  it("does not print the time zone footer", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    expect(screen.queryByText(/fuso/i)).not.toBeInTheDocument();
  });
});
