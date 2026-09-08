import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type InstallationHealth, type InstallationSettings } from "../lib/api";
import { renderScreen } from "../test-utils";
import { InstallationPage } from "./installation-page";

vi.mock("../lib/api", () => ({
  api: {
    getInstallationHealth: vi.fn(),
    getInstallationSettings: vi.fn(),
    updateInstallationSettings: vi.fn(),
    updateSecret: vi.fn(),
  },
}));

function settings(overrides: Partial<InstallationSettings> = {}): InstallationSettings {
  return {
    discordClientId: "1289443021764919306",
    publicBaseUrl: "http://127.0.0.1:8787",
    registrationEnabled: true,
    secrets: {
      discordBotToken: true,
      discordClientSecret: true,
      openRouterApiKey: false,
      smtpPassword: true,
    },
    setupCompleted: true,
    smtp: {
      fromEmail: "bot@pixelforge.gg",
      fromName: "Summyz Community",
      host: "smtp-relay.brevo.com",
      port: 587,
      replyTo: null,
      secure: false,
      user: "9a1b2c001@smtp-brevo.com",
    },
    ...overrides,
  };
}

function health(): InstallationHealth {
  return {
    checkedAt: "2026-09-08T12:00:00.000Z",
    components: [
      {
        componentId: "bot-1",
        componentType: "bot",
        details: {},
        heartbeatAt: "2026-09-08T11:59:00.000Z",
        stale: false,
        status: "ready",
      },
      {
        componentId: "ffmpeg-1",
        componentType: "ffmpeg",
        details: {},
        heartbeatAt: null,
        stale: true,
        status: "degraded",
      },
      {
        componentId: "ollama-1",
        componentType: "ollama",
        details: {},
        heartbeatAt: null,
        stale: false,
        status: "not_configured",
      },
      {
        componentId: "smtp-1",
        componentType: "smtp",
        details: {},
        heartbeatAt: null,
        stale: false,
        status: "unavailable",
      },
    ],
    database: { latencyMs: 3, migrationVersion: 12, status: "ready" },
    externalConfiguration: { openRouterConfigured: false, smtpConfigured: true },
    localAiRequired: false,
    queue: { active: 0, failed: 0, oldestPendingAt: null, scheduled: 0 },
  };
}

beforeEach(() => {
  vi.mocked(api.getInstallationSettings).mockResolvedValue(settings());
  vi.mocked(api.getInstallationHealth).mockResolvedValue(health());
  vi.mocked(api.updateInstallationSettings).mockResolvedValue(undefined);
  vi.mocked(api.updateSecret).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("InstallationPage", () => {
  it("loads the current credentials", async () => {
    renderScreen(<InstallationPage />);
    expect(await screen.findByLabelText("Client ID")).toHaveValue("1289443021764919306");
    expect(screen.getByLabelText("URL pública")).toHaveValue("http://127.0.0.1:8787");
  });

  it("marks which secrets are already configured", async () => {
    renderScreen(<InstallationPage />);
    expect(await screen.findByLabelText("Token do bot")).toHaveAttribute(
      "placeholder",
      "Configurado — digite para substituir",
    );
    expect(screen.getByLabelText("Chave OpenRouter")).toHaveAttribute(
      "placeholder",
      "Ainda não configurado",
    );
  });

  it("keeps the secret update button disabled until something is typed", async () => {
    renderScreen(<InstallationPage />);
    await screen.findByLabelText("Token do bot");
    const buttons = screen.getAllByRole("button", { name: "Atualizar" });
    expect(buttons[0]).toBeDisabled();
  });

  it("sends a replacement secret", async () => {
    renderScreen(<InstallationPage />);
    await userEvent.type(await screen.findByLabelText("Token do bot"), "novo-token");
    const buttons = screen.getAllByRole("button", { name: "Atualizar" });
    await userEvent.click(buttons[0] as HTMLElement);
    await waitFor(() =>
      expect(api.updateSecret).toHaveBeenCalledWith("discord_bot_token", "novo-token"),
    );
  });

  it("saves the installation settings", async () => {
    renderScreen(<InstallationPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Salvar instalação" }));
    await waitFor(() => expect(api.updateInstallationSettings).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Alterações salvas")).toBeInTheDocument();
  });

  it("hides the SMTP fields when e-mail is turned off", async () => {
    renderScreen(<InstallationPage />);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Envio de e-mail ativo/ }));
    expect(screen.queryByLabelText("Servidor SMTP")).toBeNull();
  });

  it("edits the SMTP host", async () => {
    renderScreen(<InstallationPage />);
    const host = await screen.findByLabelText("Servidor SMTP");
    await userEvent.clear(host);
    await userEvent.type(host, "smtp.example.com");
    expect(host).toHaveValue("smtp.example.com");
  });

  it("toggles public registration", async () => {
    renderScreen(<InstallationPage />);
    const toggle = await screen.findByRole("checkbox", { name: /Cadastro público/ });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
  });

  it("reports the health of every component", async () => {
    renderScreen(<InstallationPage />);
    expect(await screen.findByText("Bot autenticado no Discord")).toBeInTheDocument();
    expect(screen.getByText("FFmpeg com libopus")).toBeInTheDocument();
    expect(screen.getByText("sem heartbeat recente")).toBeInTheDocument();
    expect(screen.getByText("migração 12 · 3 ms")).toBeInTheDocument();
    expect(screen.getByText("0 na fila · 0 falhas")).toBeInTheDocument();
  });

  it("says when the health check itself fails", async () => {
    vi.mocked(api.getInstallationHealth).mockRejectedValue(new Error("offline"));
    renderScreen(<InstallationPage />);
    expect(
      await screen.findByText("Não foi possível consultar o estado dos componentes."),
    ).toBeInTheDocument();
  });

  it("shows a skeleton while the settings load", () => {
    renderScreen(<InstallationPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando a instalação…");
  });

  it("starts from Brevo defaults when SMTP was never configured", async () => {
    vi.mocked(api.getInstallationSettings).mockResolvedValue(settings({ smtp: null }));
    renderScreen(<InstallationPage />);
    const toggle = await screen.findByRole("checkbox", { name: /Envio de e-mail ativo/ });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(screen.getByLabelText("Servidor SMTP")).toHaveValue("smtp-relay.brevo.com");
  });
});
