import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLanguage } from "../i18n/store";
import { api, type CommandReference } from "../lib/api";
import { renderScreen } from "../tests/test-utils";
import { CommandsPage } from "./commands-page";

vi.mock("../lib/api", () => ({ api: { listCommands: vi.fn() } }));

/** The API always answers in English and names each group with a stable id. */
const reference: CommandReference = [
  {
    commands: [
      { description: "Starts recording the voice channel you are in", name: "/record" },
      { description: "Stops recording the voice channel you are in", name: "/stop" },
    ],
    id: "recording",
    label: "Recording",
  },
  {
    commands: [
      {
        description: "Sets the summary and transcript forum",
        name: "/recording-summary-forum set",
      },
      { description: "Allows a role to start and stop recordings", name: "/recording-role add" },
    ],
    id: "administrative",
    label: "Administrative shortcuts",
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

  it("keeps the English text of commands and groups the dashboard does not know yet", async () => {
    vi.mocked(api.listCommands).mockResolvedValue([
      {
        commands: [{ description: "Exports the meeting audio", name: "/recording-audio" }],
        id: "audio",
        label: "Audio",
      },
    ]);
    renderScreen(<CommandsPage />);
    expect(await screen.findByText("Exports the meeting audio")).toBeInTheDocument();
    expect(screen.getByText("Audio")).toBeInTheDocument();
  });

  it("shows the API text as it is when the dashboard is in English", async () => {
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
