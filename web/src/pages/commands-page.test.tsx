import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLanguage } from "../i18n/store";
import { api, type CommandReference } from "../lib/api";
import { renderScreen } from "../tests/test-utils";
import { CommandsPage } from "./commands-page";

vi.mock("../lib/api", () => ({ api: { listCommands: vi.fn() } }));

/** The API describes every group and command in each language the bot supports. */
const reference: CommandReference = [
  {
    commands: [
      {
        description: {
          en: "Starts recording the voice channel you are in",
          "pt-BR": "Inicia a gravação do canal de voz em que você está",
        },
        name: "/record",
      },
      {
        description: {
          en: "Stops recording the voice channel you are in",
          "pt-BR": "Encerra a gravação do canal de voz em que você está",
        },
        name: "/stop",
      },
    ],
    id: "recording",
    label: { en: "Recording", "pt-BR": "Gravação" },
  },
  {
    commands: [
      {
        description: {
          en: "Sets the summary and transcript forum",
          "pt-BR": "Define o fórum de resumos e transcrições",
        },
        name: "/recording-summary-forum set",
      },
      {
        description: {
          en: "Confirms the server forum, AI profile, and recording permissions after an ownership change",
          "pt-BR": "Confirma o fórum, o perfil de IA e as permissões após troca de dono",
        },
        name: "/recording-activate",
      },
    ],
    id: "administrative",
    label: { en: "Administrative shortcuts", "pt-BR": "Atalhos administrativos" },
  },
];

beforeEach(() => {
  vi.mocked(api.listCommands).mockResolvedValue(reference);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CommandsPage", () => {
  it("groups the commands the bot registers, named in the dashboard language", async () => {
    renderScreen(<CommandsPage />);
    expect(screen.getByRole("banner")).not.toHaveTextContent("Registrados pelo bot no Discord");
    expect(await screen.findByText("Gravação")).toBeInTheDocument();
    expect(screen.getByText("Atalhos administrativos")).toBeInTheDocument();
  });

  it("lists every command the API returns with a translated description", async () => {
    renderScreen(<CommandsPage />);
    expect(await screen.findByText("/record")).toBeInTheDocument();
    expect(
      screen.getByText("Inicia a gravação do canal de voz em que você está"),
    ).toBeInTheDocument();
    expect(screen.getByText("/recording-summary-forum set")).toBeInTheDocument();
    expect(screen.queryByText("/record start")).toBeNull();
  });

  it("translates every command the API returns, including the newest ones", async () => {
    renderScreen(<CommandsPage />);
    expect(await screen.findByText("/recording-activate")).toBeInTheDocument();
    expect(
      screen.getByText("Confirma o fórum, o perfil de IA e as permissões após troca de dono"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/after an ownership change/)).toBeNull();
  });

  it("shows the English text when the dashboard is in English", async () => {
    setLanguage("en");
    renderScreen(<CommandsPage />);
    expect(
      await screen.findByText("Starts recording the voice channel you are in"),
    ).toBeInTheDocument();
    expect(screen.getByText("Recording")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Commands" })).toBeInTheDocument();
  });

  it("switches language without asking the API again", async () => {
    renderScreen(<CommandsPage />);
    expect(await screen.findByText("Gravação")).toBeInTheDocument();

    act(() => setLanguage("en"));

    expect(screen.getByText("Recording")).toBeInTheDocument();
    expect(api.listCommands).toHaveBeenCalledTimes(1);
  });

  it("shows a loading panel until the reference arrives", () => {
    vi.mocked(api.listCommands).mockReturnValue(new Promise(() => undefined));
    renderScreen(<CommandsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando comandos…");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers a retry when the reference cannot be loaded", async () => {
    vi.mocked(api.listCommands).mockRejectedValueOnce(new Error("offline"));
    renderScreen(<CommandsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Comandos indisponíveis");
    expect(alert.querySelector("code")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(await screen.findByText("/record")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.listCommands).toHaveBeenCalledTimes(2);
  });

  it("is a plain reference without a second column", async () => {
    renderScreen(<CommandsPage />);
    await screen.findByText("/record");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.queryByTestId("controls")).toBeNull();
  });
});
