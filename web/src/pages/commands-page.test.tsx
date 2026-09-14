import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type CommandReference } from "../lib/api";
import { aSettings, dashboardContext, renderScreen } from "../tests/test-utils";
import { CommandsPage } from "./commands-page";

vi.mock("../lib/api", () => ({ api: { listCommands: vi.fn() } }));

const reference: CommandReference = [
  {
    commands: [
      { description: "Inicia a gravação do canal de voz em que você está", name: "/record" },
      { description: "Encerra a gravação do canal de voz em que você está", name: "/stop" },
    ],
    label: "Gravação",
  },
  {
    commands: [
      {
        description: "Define o fórum de resumos e transcrições",
        name: "/recording-summary-forum set",
      },
      {
        description: "Autoriza um cargo a iniciar e encerrar gravações",
        name: "/recording-role add",
      },
    ],
    label: "Atalhos administrativos",
  },
  {
    commands: [
      {
        description: "Mostra os custos das reuniões iniciadas em um período",
        name: "/recording-cost period",
      },
    ],
    label: "Custo — só para o dono do servidor",
  },
];

/** Mirrors the layout: the outlet context changes when the operator switches the language. */
function LanguageSwitchingHost() {
  const [dashboardLanguage, setDashboardLanguage] = useState<"en" | "pt-BR">("pt-BR");
  return (
    <MemoryRouter>
      <button onClick={() => setDashboardLanguage("en")} type="button">
        English
      </button>
      <Routes>
        <Route
          element={
            <Outlet context={dashboardContext({ settings: aSettings({ dashboardLanguage }) })} />
          }
        >
          <Route element={<CommandsPage />} path="/" />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(api.listCommands).mockResolvedValue(reference);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CommandsPage", () => {
  it("groups the commands the bot registers", async () => {
    renderScreen(<CommandsPage />);
    expect(screen.getByRole("banner")).toHaveTextContent("Registrados pelo bot no Discord");
    expect(await screen.findByText("Gravação")).toBeInTheDocument();
    expect(screen.getByText("Atalhos administrativos")).toBeInTheDocument();
    expect(screen.getByText("Custo — só para o dono do servidor")).toBeInTheDocument();
  });

  it("lists every command the API returns with its description", async () => {
    renderScreen(<CommandsPage />);
    expect(await screen.findByText("/record")).toBeInTheDocument();
    expect(
      screen.getByText("Inicia a gravação do canal de voz em que você está"),
    ).toBeInTheDocument();
    expect(screen.getByText("/recording-summary-forum set")).toBeInTheDocument();
    expect(screen.getByText("/recording-cost period")).toBeInTheDocument();
    expect(screen.queryByText("/record start")).toBeNull();
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

  it("reloads the reference when the dashboard language changes", async () => {
    render(<LanguageSwitchingHost />);
    expect(await screen.findByText("/record")).toBeInTheDocument();
    expect(api.listCommands).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(api.listCommands).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("/record")).toBeInTheDocument();
  });

  it("is a plain reference without a second column", async () => {
    renderScreen(<CommandsPage />);
    await screen.findByText("/record");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.queryByTestId("controls")).toBeNull();
  });
});
