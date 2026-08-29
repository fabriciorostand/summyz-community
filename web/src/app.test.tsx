import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { App } from "./app";
import { nextLocalizedProfileName } from "./dashboard-pages";

describe("App", () => {
  it("escolhe o primeiro nome localizado disponível para um novo perfil", () => {
    expect(
      nextLocalizedProfileName(
        [{ profile: { name: "Perfil 1" } }, { profile: { name: "Perfil 3" } }],
        "pt-BR",
      ),
    ).toBe("Perfil 2");
    expect(nextLocalizedProfileName([{ profile: { name: "profile 1" } }], "en")).toBe("Profile 2");
  });

  it("mostra a conta Discord vinculada e permite desconectá-la", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/setup/status") {
        return Response.json({ setupCompleted: true, registrationEnabled: true });
      }
      if (path === "/api/auth/me") {
        return Response.json({
          dashboardLanguage: "pt-BR",
          email: "owner@example.com",
          emailVerified: true,
          installationRole: "administrator",
          userId: "00000000-0000-4000-8000-000000000001",
        });
      }
      if (path === "/api/discord/connection" && init?.method === "DELETE") {
        return new Response(undefined, { status: 204 });
      }
      if (path === "/api/discord/connection") {
        return Response.json({ connected: true, discordUsername: "fabricio" });
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/account?discord=connected"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/conectado como fabricio/i)).toBeInTheDocument();
    expect(screen.getByText("Discord conectado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conectar ao Discord" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Desconectar Discord" }));

    expect(await screen.findByRole("button", { name: "Conectar ao Discord" })).toBeInTheDocument();
  });

  it("apresenta login por email e senha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ setupCompleted: true, registrationEnabled: true })),
      ),
    );
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Entre no Summyz" })).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toBeInTheDocument();
    expect(screen.getByLabelText("Senha")).toBeInTheDocument();
  });

  it("explica os padrões de retenção no setup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ setupCompleted: false, registrationEnabled: false })),
      ),
    );
    render(
      <MemoryRouter initialEntries={["/setup"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/conteúdo das reuniões fica salvo por padrão/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/áudio começa desativado/i)).toBeInTheDocument();
  });

  it("mostra erro em vez de carregar indefinidamente quando a configuração falha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/setup/status") {
          return new Response(JSON.stringify({ setupCompleted: true, registrationEnabled: true }));
        }
        if (path === "/api/auth/me") {
          return new Response(
            JSON.stringify({
              dashboardLanguage: "pt-BR",
              email: "owner@example.com",
              emailVerified: true,
              installationRole: "administrator",
              userId: "00000000-0000-4000-8000-000000000001",
            }),
          );
        }
        if (path.endsWith("/configuration")) {
          return new Response(JSON.stringify({ error: "internal_error" }), { status: 500 });
        }
        return new Response(JSON.stringify({ forums: [], roles: [] }));
      }),
    );
    render(
      <MemoryRouter initialEntries={["/guilds/guild-1"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/não foi possível carregar a configuração/i),
    ).toBeInTheDocument();
  });

  it("edita prompts e VAD no perfil pessoal de API externa", async () => {
    const profile = {
      name: "Perfil 1",
      profileType: "external",
      profileId: "profile-1",
      refinement: {
        generation: {},
        maxChunkCharacters: 500000,
        model: "model-r",
        prompt: "Você é um revisor conservador.",
        provider: "openrouter",
      },
      summary: {
        consolidationPrompt: "Você consolida resumos em inglês.",
        extractionPrompt: "Você extrai informações em inglês.",
        generation: {},
        language: "en",
        maxChunkCharacters: 500000,
        model: "model-s",
        provider: "openrouter",
      },
      transcription: {
        batchSize: "auto",
        interSpeechSilenceMs: 0,
        language: "pt-BR",
        mergeMaxGapMs: 2000,
        model: "model-t",
        prompt: null,
        provider: "openrouter",
        providerOptions: {},
        timestampMode: "word",
        vad: {
          enabled: true,
          minSilenceDurationMs: 768,
          minSpeechDurationMs: 96,
          negativeSpeechThreshold: "auto",
          speechPadMs: 96,
          threshold: 0.5,
        },
      },
      userId: "00000000-0000-4000-8000-000000000001",
    };
    const localProfile = {
      ...profile,
      name: "Perfil 1",
      profileId: "profile-local-1",
      profileType: "local",
      refinement: { ...profile.refinement, model: "qwen3:1.7b", provider: "ollama" },
      summary: { ...profile.summary, model: "qwen3:4b", provider: "ollama" },
      transcription: {
        ...profile.transcription,
        model: "medium",
        provider: "faster-whisper",
        vad: {
          enabled: true,
          maxSpeechDurationSeconds: "auto",
          minSilenceDurationMs: "auto",
          minSpeechDurationMs: 0,
          negativeSpeechThreshold: "auto",
          speechPadMs: 400,
          threshold: 0.5,
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/setup/status") {
          return Response.json({ setupCompleted: true, registrationEnabled: true });
        }
        if (path === "/api/auth/me") {
          return Response.json({
            dashboardLanguage: "pt-BR",
            email: "owner@example.com",
            emailVerified: true,
            installationRole: "administrator",
            userId: "00000000-0000-4000-8000-000000000001",
          });
        }
        if (path === "/api/profiles") {
          return Response.json([
            { active: true, profile },
            { active: false, profile: localProfile },
          ]);
        }
        if (path.startsWith("/api/ai/prompts/defaults")) {
          return Response.json({
            refinement: "Você é um revisor conservador.",
            summaryConsolidation: "Você consolida resumos em inglês.",
            summaryExtraction: "Você extrai informações em inglês.",
            transcription: null,
          });
        }
        return new Response(undefined, { status: 204 });
      }),
    );

    render(
      <MemoryRouter initialEntries={["/profiles"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue("Você é um revisor conservador.")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("openrouter")).toHaveLength(3);
    for (const providerSelect of screen.getAllByDisplayValue("openrouter")) {
      expect(providerSelect).toBeDisabled();
    }
    expect(screen.getByText(/nenhum prompt será enviado na transcrição/i)).toBeInTheDocument();
    const vadTab = screen.getByRole("tab", { name: "VAD" });
    fireEvent.click(vadTab);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "VAD" })).toHaveAttribute("aria-selected", "true"),
    );
    expect(await screen.findByLabelText(/^Limiar de fala/)).toHaveValue(0.5);
    expect(await screen.findByLabelText(/^Silêncio para encerrar \(ms\)/)).toHaveValue(768);
    const refinementToggle = screen.getByRole("checkbox", {
      name: /enviar prompt de refinamento/i,
    });
    fireEvent.click(refinementToggle);
    expect(screen.getByRole("alertdialog", { name: /desativar prompt/i })).toBeInTheDocument();
    expect(
      screen.queryByText(/nenhum prompt será enviado no refinamento/i),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /desativar prompt/i }));
    expect(screen.getByText(/nenhum prompt será enviado no refinamento/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Local" }));
    expect(await screen.findByLabelText(/^Silêncio para encerrar/)).toHaveValue("auto");
    expect(await screen.findByLabelText(/^Duração máxima da fala/)).toHaveValue("auto");
    fireEvent.click(screen.getByRole("tab", { name: "Modelo e transcrição" }));
    expect(await screen.findByDisplayValue("faster-whisper")).toBeDisabled();
  });
});
