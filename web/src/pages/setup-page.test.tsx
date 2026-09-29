import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadPreferences } from "../i18n/store";
import { ApiError, api } from "../lib/api";
import { chooseOption, unguardedHoverClasses } from "../tests/test-utils";
import { SetupPage } from "./setup-page";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    api: { getBotInstallation: vi.fn(), setup: vi.fn() },
  };
});

function renderSetup(accessMode: "local" | "public", hash = "") {
  const onComplete = vi.fn();
  render(
    <MemoryRouter initialEntries={[`/setup${hash}`]}>
      <SetupPage accessMode={accessMode} onComplete={onComplete} />
    </MemoryRouter>,
  );
  return onComplete;
}

beforeEach(() => {
  vi.mocked(api.setup).mockResolvedValue(undefined);
  vi.mocked(api.getBotInstallation).mockResolvedValue({
    applicationId: "123456789012345678",
    configured: true,
    installUrl: "https://discord.com/oauth2/authorize?client_id=123456789012345678",
  });
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
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
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
    expect(screen.getByRole("button", { name: "Concluir" })).toHaveClass(
      "bg-action-gradient",
      "enabled:hover:bg-action-gradient-hover",
      "disabled:bg-none",
    );
  });

  it("has only the token step and no password", () => {
    renderSetup("local");
    expect(screen.getByText("Token do bot")).toBeInTheDocument();
    expect(screen.getByText("Adicionar a um servidor")).toBeInTheDocument();
    expect(screen.queryByText("Senha da instalação")).toBeNull();
    expect(screen.getByText("Modo")).toBeInTheDocument();
    expect(screen.getByText("Local")).toBeInTheDocument();
  });

  it("does not react to hover while the primary action is unavailable", () => {
    renderSetup("local");
    expect(unguardedHoverClasses(screen.getByRole("button", { name: "Concluir" }))).toEqual([]);
  });

  it("finishes with the token alone and offers the Discord authorization", async () => {
    const onComplete = renderSetup("local");
    await userEvent.type(
      screen.getByLabelText("Token do bot"),
      "MTI4OTQ0MzAyMTc2NDkxOTMwNg.bot-token",
    );
    await userEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(await screen.findByRole("heading", { name: "Bot conectado" })).toBeInTheDocument();
    expect(api.setup).toHaveBeenCalledWith(undefined, {
      discordBotToken: "MTI4OTQ0MzAyMTc2NDkxOTMwNg.bot-token",
      setupLanguage: "pt-BR",
    });
    const link = await screen.findByRole("link", { name: /Adicionar a um servidor/ });
    expect(link).toHaveAttribute(
      "href",
      "https://discord.com/oauth2/authorize?client_id=123456789012345678",
    );
    await userEvent.click(screen.getByRole("button", { name: "Ir para o dashboard" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("shows the Discord rejection next to the token", async () => {
    vi.mocked(api.setup).mockRejectedValue(new ApiError(400, "invalid_discord_bot_token"));
    renderSetup("local");
    await userEvent.type(screen.getByLabelText("Token do bot"), "invalid");
    await userEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Token recusado pelo Discord");
  });
});

describe("SetupPage reading order", () => {
  it("puts the current step before the progress rail", () => {
    renderSetup("local");
    const form = screen.getByRole("button", { name: "Concluir" }).closest("form");
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

  it("walks through token, password and the Discord authorization", async () => {
    const onComplete = renderSetup("public", "#claim=setup-claim-token");
    await userEvent.type(
      screen.getByLabelText("Token do bot"),
      "MTI4OTQ0MzAyMTc2NDkxOTMwNg.bot-token",
    );
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
      installationPassword: "curta mas agora ficou longa",
      setupLanguage: "pt-BR",
    });
    expect(screen.getByText("Online")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ir para o dashboard" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("goes back to the token step", async () => {
    renderSetup("public", "#claim=setup-claim-token");
    await userEvent.type(
      screen.getByLabelText("Token do bot"),
      "MTI4OTQ0MzAyMTc2NDkxOTMwNg.bot-token",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Voltar" }));
    expect(screen.getByLabelText("Token do bot")).toHaveValue(
      "MTI4OTQ0MzAyMTc2NDkxOTMwNg.bot-token",
    );
  });

  it("returns to the token step when Discord rejects it at the end", async () => {
    vi.mocked(api.setup).mockRejectedValue(new ApiError(400, "invalid_discord_bot_token"));
    renderSetup("public", "#claim=setup-claim-token");
    await userEvent.type(screen.getByLabelText("Token do bot"), "MTI4OTQ0MzAyMTc2NDkxOTMwNg.x");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
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
    await userEvent.type(screen.getByLabelText("Token do bot"), "MTI4OTQ0MzAyMTc2NDkxOTMwNg.x");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
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
    await userEvent.type(screen.getByLabelText("Token do bot"), "MTI4OTQ0MzAyMTc2NDkxOTMwNg.x");
    await userEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("O setup não pôde ser concluído");
  });
});
