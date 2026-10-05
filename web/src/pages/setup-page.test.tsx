import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadPreferences } from "../i18n/store";
import { ApiError, api } from "../lib/api";
import { leaveDashboardFor } from "../lib/browser-navigation";
import { chooseOption, unguardedHoverClasses } from "../tests/test-utils";
import { SetupPage } from "./setup-page";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    api: {
      getBotInstallation: vi.fn(),
      getSetupStatus: vi.fn(),
      setup: vi.fn(),
      startDiscordConnection: vi.fn(),
    },
  };
});
vi.mock("../lib/browser-navigation", () => ({ leaveDashboardFor: vi.fn() }));

const redirectUri = "http://127.0.0.1:8787/api/discord/callback";

function renderSetup(accessMode: "local" | "public", hash = "") {
  const onComplete = vi.fn();
  render(
    <MemoryRouter initialEntries={[`/setup${hash}`]}>
      <SetupPage accessMode={accessMode} onComplete={onComplete} />
    </MemoryRouter>,
  );
  return onComplete;
}

async function enterToken(token = "MTI4OTQ0MzAyMTc2NDkxOTMwNg.bot-token", next = "Continuar") {
  await userEvent.type(screen.getByLabelText("Token do bot"), token);
  await userEvent.click(screen.getByRole("button", { name: next }));
}

async function skipDiscord(label = "Pular por enquanto") {
  await userEvent.click(await screen.findByRole("button", { name: label }));
}

beforeEach(() => {
  vi.mocked(api.setup).mockResolvedValue(undefined);
  vi.mocked(api.getBotInstallation).mockResolvedValue({
    applicationId: "123456789012345678",
    configured: true,
    installUrl: "https://discord.com/oauth2/authorize?client_id=123456789012345678",
  });
  vi.mocked(api.getSetupStatus).mockResolvedValue({
    accessMode: "local",
    discordRedirectUri: redirectUri,
    passwordConfigured: false,
    setupCompleted: false,
    technicalSetupCompleted: false,
  });
  vi.mocked(api.startDiscordConnection).mockResolvedValue("https://discord.com/oauth2/authorize");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("SetupPage language", () => {
  it("follows the browser language before anyone chooses", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
    reloadPreferences();
    renderSetup("local");

    expect(screen.getByRole("heading", { name: "Paste the bot token" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Bot token"), "bot-token");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await skipDiscord("Skip for now");
    await waitFor(() =>
      expect(api.setup).toHaveBeenCalledWith(undefined, {
        discordBotToken: "bot-token",
        setupLanguage: "en",
      }),
    );
  });

  it("switches language from the corner picker and names the first profile in it", async () => {
    renderSetup("local");
    await chooseOption("Idioma do dashboard", "English");

    expect(screen.getByRole("heading", { name: "Paste the bot token" })).toBeInTheDocument();
    expect(localStorage.getItem("summyz:language")).toBe("en");
    await userEvent.type(screen.getByLabelText("Bot token"), "bot-token");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await skipDiscord("Skip for now");
    await waitFor(() =>
      expect(api.setup).toHaveBeenCalledWith(undefined, {
        discordBotToken: "bot-token",
        setupLanguage: "en",
      }),
    );
  });
});

describe("SetupPage in local mode", () => {
  it("paints the submit action with the gradient and drops it while disabled", () => {
    renderSetup("local");
    expect(screen.getByRole("button", { name: "Continuar" })).toHaveClass(
      "bg-action-gradient",
      "enabled:hover:bg-action-gradient-hover",
      "disabled:bg-none",
    );
  });

  it("has the token and optional owner steps and no password", () => {
    renderSetup("local");
    expect(screen.getByText("Token do bot")).toBeInTheDocument();
    expect(screen.getByText("Conta do dono (opcional)")).toBeInTheDocument();
    expect(screen.getByText("Adicionar a um servidor")).toBeInTheDocument();
    expect(screen.queryByText("Senha da instalação")).toBeNull();
    expect(screen.getByText("Modo")).toBeInTheDocument();
    expect(screen.getByText("Local")).toBeInTheDocument();
  });

  it("does not react to hover while the primary action is unavailable", () => {
    renderSetup("local");
    expect(unguardedHoverClasses(screen.getByRole("button", { name: "Continuar" }))).toEqual([]);
  });

  it("finishes with the token alone and explains what skipping the Client Secret means", async () => {
    const onComplete = renderSetup("local");
    await enterToken();
    expect(
      await screen.findByRole("heading", { name: "Prepare a conexão do dono" }),
    ).toBeInTheDocument();
    await skipDiscord();
    expect(await screen.findByRole("heading", { name: "Bot conectado" })).toBeInTheDocument();
    expect(api.setup).toHaveBeenCalledWith(undefined, {
      discordBotToken: "MTI4OTQ0MzAyMTc2NDkxOTMwNg.bot-token",
      setupLanguage: "pt-BR",
    });
    expect(screen.getByText(/Sem o Client Secret, nenhum servidor/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Conectar conta Discord/ })).toBeNull();
    const link = await screen.findByRole("link", { name: /Adicionar a um servidor/ });
    expect(link).toHaveAttribute(
      "href",
      "https://discord.com/oauth2/authorize?client_id=123456789012345678",
    );
    await userEvent.click(screen.getByRole("button", { name: "Ir para o dashboard" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("stores the Client Secret and offers to connect the owner's account", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    renderSetup("local");
    await enterToken();
    expect(await screen.findByText(redirectUri)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copiar URL de redirecionamento" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(redirectUri);
    const finish = screen.getByRole("button", { name: "Concluir" });
    expect(finish).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Client Secret"), "client-secret");
    await userEvent.click(finish);

    expect(await screen.findByRole("heading", { name: "Bot conectado" })).toBeInTheDocument();
    expect(api.setup).toHaveBeenCalledWith(undefined, {
      discordBotToken: "MTI4OTQ0MzAyMTc2NDkxOTMwNg.bot-token",
      discordClientSecret: "client-secret",
      setupLanguage: "pt-BR",
    });
    expect(screen.queryByText(/Sem o Client Secret/)).toBeNull();
    expect(screen.queryByText(/entre com a senha da instalação/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Conectar conta Discord/ }));
    expect(leaveDashboardFor).toHaveBeenCalledWith("https://discord.com/oauth2/authorize");
  });

  it("shows the Discord rejection next to the token", async () => {
    vi.mocked(api.setup).mockRejectedValue(new ApiError(400, "invalid_discord_bot_token"));
    renderSetup("local");
    await enterToken("invalid");
    await skipDiscord();
    expect(await screen.findByRole("alert")).toHaveTextContent("Token recusado pelo Discord");
    expect(screen.getByLabelText("Token do bot")).toBeInTheDocument();
  });
});

describe("SetupPage reading order", () => {
  it("puts the current step before the progress rail", () => {
    renderSetup("local");
    const form = screen.getByRole("button", { name: "Continuar" }).closest("form");
    const rail = screen.getByRole("complementary");
    expect(form).not.toBeNull();
    if (form !== null) {
      expect(form.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe("SetupPage in public mode", () => {
  it("keeps the claim in memory and strips it from the address bar", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    renderSetup("public", "#claim=setup-claim-token");
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(screen.getByText("Público")).toBeInTheDocument();
    expect(screen.getByText("Não conectado")).toBeInTheDocument();
  });

  // Typing the whole flow key by key takes about 1.5s alone but passes 5s under a loaded
  // coverage run.
  it("walks through token, owner connection, password and the Discord authorization", async () => {
    const onComplete = renderSetup("public", "#claim=setup-claim-token");
    await enterToken();
    await userEvent.type(await screen.findByLabelText("Client Secret"), "client-secret");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(
      await screen.findByRole("heading", { name: "Escolha a senha desta instalação" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mínimo 15")).toBeInTheDocument();

    const password = screen.getByLabelText("Senha da instalação");
    await userEvent.type(password, "curta");
    expect(screen.getByText("Curta · 5 de 15")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Concluir" })).toBeDisabled();
    expect(api.setup).not.toHaveBeenCalled();

    await userEvent.type(password, " mas agora ficou longa");
    expect(screen.getByText("Boa · 27 caracteres")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Concluir" }));

    expect(await screen.findByRole("heading", { name: "Bot conectado" })).toBeInTheDocument();
    expect(api.setup).toHaveBeenCalledWith("setup-claim-token", {
      discordBotToken: "MTI4OTQ0MzAyMTc2NDkxOTMwNg.bot-token",
      discordClientSecret: "client-secret",
      installationPassword: "curta mas agora ficou longa",
      setupLanguage: "pt-BR",
    });
    expect(screen.getByText("Online")).toBeInTheDocument();
    // Connecting ends the fresh session, so the operator is told to sign in again.
    expect(screen.getByText(/entre com a senha da instalação/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ir para o dashboard" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("goes back from the password to the owner step and then to the token", async () => {
    renderSetup("public", "#claim=setup-claim-token");
    await enterToken();
    await skipDiscord();
    await userEvent.click(await screen.findByRole("button", { name: "Voltar" }));
    expect(
      await screen.findByRole("heading", { name: "Prepare a conexão do dono" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.getByLabelText("Token do bot")).toHaveValue(
      "MTI4OTQ0MzAyMTc2NDkxOTMwNg.bot-token",
    );
  });

  it("returns to the token step when Discord rejects it at the end", async () => {
    vi.mocked(api.setup).mockRejectedValue(new ApiError(400, "invalid_discord_bot_token"));
    renderSetup("public", "#claim=setup-claim-token");
    await enterToken("MTI4OTQ0MzAyMTc2NDkxOTMwNg.x");
    await skipDiscord();
    await userEvent.type(
      await screen.findByLabelText("Senha da instalação"),
      "uma frase bem longa mesmo",
    );
    await userEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Token recusado pelo Discord");
    expect(screen.getByLabelText("Token do bot")).toBeInTheDocument();
  });

  it("explains a rejected claim", async () => {
    vi.mocked(api.setup).mockRejectedValue(new ApiError(403, "invalid_setup_token"));
    renderSetup("public");
    await enterToken("MTI4OTQ0MzAyMTc2NDkxOTMwNg.x");
    await skipDiscord();
    await userEvent.type(
      await screen.findByLabelText("Senha da instalação"),
      "uma frase bem longa mesmo",
    );
    await userEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/link privado de setup/);
  });

  it("reports a generic failure", async () => {
    vi.mocked(api.setup).mockRejectedValue(new Error("offline"));
    renderSetup("local");
    await enterToken("MTI4OTQ0MzAyMTc2NDkxOTMwNg.x");
    await skipDiscord();
    expect(await screen.findByRole("alert")).toHaveTextContent("O setup não pôde ser concluído");
  });
});
