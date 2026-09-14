import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { aMeetingPage, dashboardContext, guildSelection, renderScreen } from "../tests/test-utils";
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

  it("shows the total in the header", async () => {
    renderScreen(<CallsPage />);
    expect(await screen.findByText("2 registros")).toBeInTheDocument();
  });

  it("treats a single-token search as a meeting id", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.type(screen.getByLabelText(/Buscar por canal/), "m1{Enter}");
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith("g1", { meetingId: "m1", page: 1 }),
    );
  });

  it("treats a multi-word search as a channel name", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.type(screen.getByLabelText(/Buscar por canal/), "launch week{Enter}");
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith("g1", { channelName: "launch week", page: 1 }),
    );
  });

  it("strips the hash from a channel search", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.type(screen.getByLabelText(/Buscar por canal/), "#launch{Enter}");
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith("g1", { channelName: "launch", page: 1 }),
    );
  });

  it("clears an active search", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.type(screen.getByLabelText(/Buscar por canal/), "m1{Enter}");
    await screen.findByRole("button", { name: "Limpar" });
    await userEvent.click(screen.getByRole("button", { name: "Limpar" }));
    await waitFor(() => expect(listMeetings).toHaveBeenLastCalledWith("g1", { page: 1 }));
  });

  it("filters by pipeline state", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.click(screen.getByRole("tab", { name: "Falhas" }));
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith("g1", { page: 1, state: "failed" }),
    );
  });

  it("exposes the advanced filters on demand", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.click(screen.getByRole("button", { name: /Avançado/ }));
    await userEvent.selectOptions(screen.getByLabelText("Conteúdo retido"), "true");
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith("g1", { contentRetained: true, page: 1 }),
    );
  });

  it("filters by participant using the historical directory", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.click(screen.getByRole("button", { name: /Avançado/ }));
    await screen.findByRole("option", { name: "PixelPaladin" });
    await userEvent.selectOptions(screen.getByLabelText("Participante"), "u1");
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith("g1", { page: 1, participantUserId: "u1" }),
    );
  });

  it("filters by date range", async () => {
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    await userEvent.click(screen.getByRole("button", { name: /Avançado/ }));
    await userEvent.type(screen.getByLabelText("De"), "2026-09-01");
    await waitFor(() =>
      expect(listMeetings).toHaveBeenLastCalledWith("g1", { dateFrom: "2026-09-01", page: 1 }),
    );
  });

  it("pages forward and back", async () => {
    listMeetings.mockResolvedValue(aMeetingPage({ total: 40 }));
    renderScreen(<CallsPage />);
    await screen.findByText("Launch Week Sync");
    expect(screen.getByRole("button", { name: /Anterior/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Próxima/ }));
    await waitFor(() => expect(listMeetings).toHaveBeenLastCalledWith("g1", { page: 2 }));
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
});
