import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { App } from "./app";

describe("App", () => {
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

  it("mostra prompts padrão editáveis e comunica claramente quando estão desativados", async () => {
    const profile = {
      guildId: "guild-1",
      name: "Profile 1",
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
        timestampMode: "word",
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
        if (path.endsWith("/configuration")) {
          return Response.json({
            activeProfileId: "profile-1",
            profiles: [profile],
            recordingRoleIds: [],
            settings: {
              botLanguage: "pt-BR",
              persistMeetingAudio: false,
              persistMeetingContent: true,
            },
          });
        }
        if (path.endsWith("/resources")) return Response.json({ forums: [], roles: [] });
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
      <MemoryRouter initialEntries={["/guilds/guild-1"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue("Você é um revisor conservador.")).toBeInTheDocument();
    expect(screen.getByText(/nenhum prompt será enviado na transcrição/i)).toBeInTheDocument();
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
  });
});
