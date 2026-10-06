import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storedSecretMask } from "../components/secret-field";
import { setLanguage } from "../i18n/store";
import { ApiError, api, type DashboardSettings } from "../lib/api";
import {
  aSettings,
  dashboardContext,
  renderScreen,
  renderWithLiveSettings,
} from "../tests/test-utils";
import { BotPage } from "./bot-page";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    api: {
      removeSecret: vi.fn(),
      replaceBotToken: vi.fn(),
      updateSecret: vi.fn(),
    },
  };
});

beforeEach(() => {
  vi.mocked(api.replaceBotToken).mockResolvedValue(undefined);
  vi.mocked(api.updateSecret).mockResolvedValue(undefined);
  vi.mocked(api.removeSecret).mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  vi.clearAllMocks();
});

function application() {
  return screen.getByRole("region", { name: "Aplicação Discord" });
}

describe("BotPage", () => {
  it("reads in English", () => {
    setLanguage("en");
    renderScreen(<BotPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Bot" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Discord application" })).toBeInTheDocument();
    expect(screen.getByLabelText("Bot token")).toHaveValue(storedSecretMask);
    expect(screen.getByRole("button", { name: "About the Bot token field" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit bot token" })).toBeInTheDocument();
  });

  it("holds only the Discord application, in a narrow column", () => {
    renderScreen(<BotPage />);
    expect(application()).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toEqual([application()]);
    expect(screen.queryByText(/Conta do dono/)).toBeNull();
    expect(screen.getByRole("main").firstElementChild).toHaveClass("max-w-3xl");
  });

  it("lists every application field in one run, with no section titles or divider", () => {
    renderScreen(<BotPage />);
    const card = application();
    expect(
      within(card)
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["Aplicação Discord"]);
    expect(within(card).queryByText("Login OAuth2")).toBeNull();
    expect(within(card).queryByText(/ficam em OAuth2/)).toBeNull();
    expect(card.querySelector(".border-t")).toBeNull();
    const fields = [
      within(card).getByText("Application ID"),
      within(card).getByLabelText("Token do bot"),
      within(card).getByLabelText("Client Secret"),
      within(card).getByText("URL de redirecionamento"),
    ];
    for (const [index, field] of fields.slice(1).entries()) {
      expect(fields[index]?.compareDocumentPosition(field)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("keeps the installation-wide blocks out of this screen", () => {
    renderScreen(<BotPage />);
    expect(screen.queryByRole("region", { name: "Provedores" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Acesso ao dashboard" })).toBeNull();
    expect(screen.queryByText("Estado da instalação")).toBeNull();
  });

  it("reloads the settings from the server when the page opens", async () => {
    const reloadSettings = vi.fn().mockResolvedValue(undefined);
    renderScreen(<BotPage />, { context: dashboardContext({ reloadSettings }) });
    await waitFor(() => expect(reloadSettings).toHaveBeenCalledTimes(1));
  });

  it("shows the read-only Application ID with a copy action", async () => {
    renderScreen(<BotPage />);
    expect(screen.getByText("123456789012345678")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copiar Application ID" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("123456789012345678");
  });

  it("locks the stored token behind the pencil, with no warning or replace button", () => {
    renderScreen(<BotPage />);
    const field = screen.getByLabelText("Token do bot");
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue(storedSecretMask);
    expect(screen.getByRole("button", { name: "Editar token do bot" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mostrar o valor digitado" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Substituir" })).toBeNull();
    expect(screen.queryByText(/revalida a aplicação/)).toBeNull();
  });

  it("opens the token with its warning from the pencil and locks it again on cancel", async () => {
    renderScreen(<BotPage />);
    await userEvent.click(screen.getByRole("button", { name: "Editar token do bot" }));
    const field = screen.getByLabelText("Token do bot");
    expect(field).not.toHaveAttribute("readonly");
    expect(field).toHaveFocus();
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", "Digite o novo valor para substituir");
    const warning = screen.getByText(/revalida a aplicação/);
    // The warning sits under the field it is about.
    expect(field.compareDocumentPosition(warning)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole("button", { name: "Substituir" })).toBeDisabled();
    await userEvent.type(field, "new-token");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveValue(storedSecretMask);
    expect(screen.queryByText(/revalida a aplicação/)).toBeNull();
    expect(api.replaceBotToken).not.toHaveBeenCalled();
  });

  it("shows the token being typed from the eye", async () => {
    renderScreen(<BotPage />);
    await userEvent.click(screen.getByRole("button", { name: "Editar token do bot" }));
    const field = screen.getByLabelText("Token do bot");
    await userEvent.type(field, "new-token");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar o valor digitado" }));
    expect(field).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(field).toHaveAttribute("type", "password");
  });

  it.each([
    ["Application ID", /General Information/],
    ["Token do bot", /Reset Token/],
    ["Client Secret", /conta Discord do dono do servidor/],
    ["URL de redirecionamento", /OAuth2 → Redirects/],
  ])("explains %s from its help tip", async (field, explanation) => {
    renderScreen(<BotPage />);
    await userEvent.hover(
      within(application()).getByRole("button", { name: `Sobre o campo ${field}` }),
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(explanation);
  });

  it("keeps the explanations inside the help tips instead of under the fields", () => {
    renderScreen(<BotPage />);
    expect(within(application()).getAllByRole("button", { name: /^Sobre o campo/ })).toHaveLength(
      4,
    );
    expect(within(application()).queryByText(/OAuth2 → Redirects/)).toBeNull();
  });

  it("replaces the bot token through the dedicated route after confirmation", async () => {
    renderScreen(<BotPage />, {
      context: dashboardContext({ reloadSettings: () => Promise.resolve(aSettings()) }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Editar token do bot" }));
    const field = screen.getByLabelText("Token do bot");
    await userEvent.type(field, "new-token");
    await userEvent.click(screen.getByRole("button", { name: "Substituir" }));
    const dialog = screen.getByRole("dialog", { name: "Substituir o token do bot?" });
    expect(dialog).toHaveTextContent(/Token de outra aplicação/);
    expect(api.replaceBotToken).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Substituir token" }));
    await waitFor(() => expect(api.replaceBotToken).toHaveBeenCalledWith("new-token"));
    expect(await screen.findByText(/Token salvo/)).toBeInTheDocument();
    expect(field).toHaveValue(storedSecretMask);
    expect(field).toHaveAttribute("readonly");
    expect(screen.queryByText(/revalida a aplicação/)).toBeNull();
  });

  it("keeps the token being edited when the confirmation is cancelled", async () => {
    renderScreen(<BotPage />);
    await userEvent.click(screen.getByRole("button", { name: "Editar token do bot" }));
    await userEvent.type(screen.getByLabelText("Token do bot"), "new-token");
    await userEvent.click(screen.getByRole("button", { name: "Substituir" }));
    const dialog = screen.getByRole("dialog", { name: "Substituir o token do bot?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.replaceBotToken).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Token do bot")).toHaveValue("new-token");
    expect(screen.getByLabelText("Token do bot")).not.toHaveAttribute("readonly");
  });

  it.each([
    ["invalid_discord_bot_token", 400, "Token recusado pelo Discord"],
    ["active_recording", 409, "Há uma gravação em andamento"],
    ["pending_meetings", 409, "Ainda há reuniões em processamento"],
    ["internal_error", 500, "Não foi possível substituir o token."],
  ])("explains why the token was not replaced (%s)", async (code, status, message) => {
    vi.mocked(api.replaceBotToken).mockRejectedValue(new ApiError(status, code));
    renderScreen(<BotPage />);
    await userEvent.click(screen.getByRole("button", { name: "Editar token do bot" }));
    await userEvent.type(screen.getByLabelText("Token do bot"), "bad");
    await userEvent.click(screen.getByRole("button", { name: "Substituir" }));
    await userEvent.click(screen.getByRole("button", { name: "Substituir token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    // A refused token stays open, so it can be fixed and sent again.
    expect(screen.getByLabelText("Token do bot")).not.toHaveAttribute("readonly");
  });

  it("follows the server after the bot token is replaced", async () => {
    const serverSettings = vi
      .fn<() => Promise<DashboardSettings>>()
      .mockResolvedValueOnce(aSettings())
      .mockResolvedValue(aSettings({ discordApplicationId: "222" }));
    renderWithLiveSettings(<BotPage />, { initialSettings: aSettings(), serverSettings });
    await waitFor(() => expect(serverSettings).toHaveBeenCalledTimes(1));
    expect(screen.getByText("123456789012345678")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Editar token do bot" }));
    await userEvent.type(screen.getByLabelText("Token do bot"), "new-token");
    await userEvent.click(screen.getByRole("button", { name: "Substituir" }));
    await userEvent.click(screen.getByRole("button", { name: "Substituir token" }));
    expect(await screen.findByText("222")).toBeInTheDocument();
    expect(serverSettings).toHaveBeenCalledTimes(2);
    // Another application took over: the owner connection and the Client Secret are gone.
    expect(screen.getByText(/Aplicação trocada/)).toBeInTheDocument();
  });

  it("copies the redirect URL to register on Discord", async () => {
    renderScreen(<BotPage />);
    expect(
      within(application()).getByText("http://127.0.0.1:8787/api/discord/callback"),
    ).toBeInTheDocument();
    await userEvent.click(
      within(application()).getByRole("button", { name: "Copiar URL de redirecionamento" }),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/discord/callback",
    );
  });

  it("saves and removes the Discord Client Secret", async () => {
    let stored = false;
    vi.mocked(api.updateSecret).mockImplementation(async () => {
      stored = true;
    });
    vi.mocked(api.removeSecret).mockImplementation(async () => {
      stored = false;
    });
    const secrets = () => ({
      discordBotToken: true,
      discordClientSecret: stored,
      openRouterApiKey: true,
    });
    const serverSettings = vi
      .fn<() => Promise<DashboardSettings>>()
      .mockImplementation(async () => aSettings({ secrets: secrets() }));
    renderWithLiveSettings(<BotPage />, {
      initialSettings: aSettings({ secrets: secrets() }),
      serverSettings,
    });
    const field = within(application()).getByLabelText("Client Secret");
    expect(field).toHaveAttribute("placeholder", "Ainda não configurado");
    await userEvent.type(field, "client-secret");
    await userEvent.click(within(application()).getByRole("button", { name: "Atualizar" }));
    await waitFor(() =>
      expect(api.updateSecret).toHaveBeenCalledWith("discord_client_secret", "client-secret"),
    );
    await waitFor(() => expect(field).toHaveValue(storedSecretMask));
    expect(field).toHaveAttribute("readonly");
    expect(
      within(application()).getByRole("button", { name: "Editar Client Secret" }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(application()).getByRole("button", { name: "Remover Client Secret" }),
    );
    await waitFor(() => expect(api.removeSecret).toHaveBeenCalledWith("discord_client_secret"));
    await waitFor(() => expect(field).toHaveAttribute("placeholder", "Ainda não configurado"));
    expect(field).not.toHaveAttribute("readonly");
  });
});
