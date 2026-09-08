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

  it("seleciona o primeiro servidor instalado e apresenta métricas e top speakers", async () => {
    localStorage.removeItem("summyz:selected-guild");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
      if (path === "/api/guilds") {
        return Response.json([
          {
            iconUrl: null,
            id: "not-installed",
            installUrl: "https://discord.com/install",
            installed: false,
            name: "Sem bot",
          },
          {
            iconUrl: null,
            id: "guild-1",
            installUrl: "https://discord.com/install",
            installed: true,
            name: "Equipe",
          },
        ]);
      }
      if (path === "/api/guilds/guild-1/dashboard") {
        return Response.json({
          averageDurationMs: 3_600_000,
          calls: { current: 12, deltaPercentage: 16, previous: 10 },
          cost: {
            attemptCounts: { confirmed: 1, notApplicable: 0, pending: 0, unattributed: 2 },
            breakdown: [],
            confirmed: [{ amount: "0.25", currency: "USD" }],
          },
          openTaskCount: 0,
          period: "30d",
          statusSeries: [],
          timeZone: "America/Sao_Paulo",
          topSpeakers: [{ displayName: "Ana", talkTimeMs: 94_440_000, userId: "ana" }],
          totalCalls: 12,
          totalDurationMs: 43_200_000,
        });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("26h 14m")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByLabelText("Servidor")).toHaveValue("guild-1");
    expect(screen.getByText(/2 sem custo confirmado/i)).toBeInTheDocument();
  });

  it("apresenta percentuais de talk time na lista do histórico", async () => {
    localStorage.removeItem("summyz:selected-guild");
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
        if (path === "/api/guilds") {
          return Response.json([
            {
              iconUrl: null,
              id: "guild-1",
              installUrl: "https://discord.com/install",
              installed: true,
              name: "Equipe",
            },
          ]);
        }
        if (path === "/api/guilds/guild-1/meetings?page=1") {
          return Response.json({
            items: [
              {
                aiProfile: { name: "Default OpenRouter", profileId: "profile-1" },
                completedAt: "2026-08-24T10:00:45.000Z",
                contentRetained: true,
                durationMs: 45_000,
                failureCode: null,
                meetingId: "meeting-1",
                participants: [
                  { displayName: "Ana", percentage: 38, talkTimeMs: 12_000, userId: "ana" },
                  { displayName: "Bia", percentage: 0, talkTimeMs: 0, userId: "bia" },
                ],
                pipelineStatus: "completed",
                startedAt: "2026-08-24T10:00:00.000Z",
                voiceChannelName: "Planejamento",
              },
            ],
            page: 1,
            pageSize: 20,
            timeZone: "America/Sao_Paulo",
            total: 1,
          });
        }
        return Response.json({ error: "not_found" }, { status: 404 });
      }),
    );

    render(
      <MemoryRouter initialEntries={["/history"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Ana — 38%")).toBeInTheDocument();
    expect(screen.getByText("Bia — 0%")).toBeInTheDocument();
    expect(screen.getByText(/45s/)).toBeInTheDocument();
  });

  it("pesquisa uma call pelo ID completo sem combinar os demais filtros", async () => {
    localStorage.removeItem("summyz:selected-guild");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
      if (path === "/api/guilds") {
        return Response.json([
          {
            iconUrl: null,
            id: "guild-1",
            installUrl: "https://discord.com/install",
            installed: true,
            name: "Equipe",
          },
        ]);
      }
      if (path.startsWith("/api/guilds/guild-1/meetings?")) {
        return Response.json({
          items: [],
          page: 1,
          pageSize: 20,
          timeZone: "America/Sao_Paulo",
          total: 0,
        });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={["/history"]}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByLabelText("ID da reunião");
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "failed" } });
    fireEvent.change(screen.getByLabelText("ID da reunião"), { target: { value: "meeting-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/guilds/guild-1/meetings?page=1&meetingId=meeting-1",
        expect.anything(),
      );
    });
  });

  it("apresenta o resumo retido em seções HTML sem metadados internos", async () => {
    localStorage.setItem("summyz:selected-guild", "guild-1");
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
        if (path === "/api/guilds") {
          return Response.json([
            {
              iconUrl: null,
              id: "guild-1",
              installUrl: "https://discord.com/install",
              installed: true,
              name: "Equipe",
            },
          ]);
        }
        if (path === "/api/guilds/guild-1/meetings/meeting-1") {
          return Response.json({
            aiProfile: { name: "Default OpenRouter", profileId: "profile-1" },
            completedAt: "2026-08-24T10:00:45.000Z",
            contentRetained: true,
            durationMs: 45_000,
            failureCode: null,
            meetingId: "meeting-1",
            participants: [],
            pipelineStatus: "completed",
            rawTranscript: "Original",
            startedAt: "2026-08-24T10:00:00.000Z",
            summary: {
              decisions: ["Adotar o fluxo."],
              discussedTopics: ["Planejamento"],
              executiveSummary: "A equipe alinhou o projeto.",
              language: "pt-BR",
              observations: ["Revisar o cronograma."],
              status: "completed",
              tasks: [
                {
                  deadlineText: "sexta-feira",
                  ownerName: "Ana",
                  text: "Publicar o documento.",
                },
              ],
            },
            timeZone: "America/Sao_Paulo",
            transcript: "Transcrição revisada",
            voiceChannelName: "Planejamento",
          });
        }
        return Response.json({ error: "not_found" }, { status: 404 });
      }),
    );
    render(
      <MemoryRouter initialEntries={["/history/meeting-1"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Resumo executivo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tópicos discutidos" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Decisões" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tarefas" })).toBeInTheDocument();
    expect(screen.getByText("Responsável: Ana · Prazo: sexta-feira")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pendências e observações" })).toBeInTheDocument();
    expect(screen.queryByText(/sourceEntryIds|schemaVersion|attempts/)).not.toBeInTheDocument();
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

    expect(
      await screen.findByRole("heading", { name: "Entre no Summyz Community" }),
    ).toBeInTheDocument();
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

  it("repete as consultas da configuração na própria página", async () => {
    let configurationAttempts = 0;
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
          configurationAttempts += 1;
          if (configurationAttempts === 1) {
            return Response.json({ error: "internal_error" }, { status: 500 });
          }
          return Response.json({
            activeProfileId: null,
            profiles: [],
            recordingRoleIds: [],
            recordingUserIds: [],
            settings: {
              botLanguage: "pt-BR",
              persistMeetingAudio: false,
              persistMeetingContent: true,
            },
          });
        }
        return Response.json({ forums: [], roles: [] });
      }),
    );
    render(
      <MemoryRouter initialEntries={["/guilds/guild-1"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(
      await screen.findByRole("heading", { name: "Configuração do servidor" }),
    ).toBeInTheDocument();
    expect(configurationAttempts).toBe(2);
  });

  it("repete a consulta dos perfis na própria página", async () => {
    let profileAttempts = 0;
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
          profileAttempts += 1;
          if (profileAttempts === 1) {
            return Response.json({ error: "internal_error" }, { status: 500 });
          }
          return Response.json([]);
        }
        return Response.json({});
      }),
    );
    render(
      <MemoryRouter initialEntries={["/profiles"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByRole("heading", { name: "Seus perfis" })).toBeInTheDocument();
    expect(profileAttempts).toBe(2);
  });

  it("edita prompts e VAD no perfil pessoal de API externa", async () => {
    const profile = {
      language: "auto",
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
        maxChunkCharacters: 500000,
        model: "model-s",
        provider: "openrouter",
      },
      transcription: {
        interSpeechSilenceMs: 0,
        mergeMaxGapMs: 2000,
        model: "model-t",
        prompt: null,
        provider: "openrouter",
        providerOptions: {},
        vad: {
          enabled: true,
          minSilenceDurationMs: 768,
          minSpeechDurationMs: 96,
          negativeSpeechThreshold: "auto",
          speechPadMs: 96,
          threshold: 0.5,
        },
      },
      translation: null,
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
        batchSize: "auto",
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
      if (path === "/api/profiles" && init?.method === "POST") {
        return Response.json({ ...profile, name: "Perfil 2", profileId: "profile-2" });
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
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

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
    expect(screen.getByLabelText("Pesquisar idioma")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pesquisar idioma"), { target: { value: "zz" } });
    expect(screen.getByText("Nenhuma outra tag corresponde à pesquisa.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pesquisar idioma"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Idioma"), { target: { value: "pt-BR" } });
    expect(
      screen.getByText(
        /modelos são fornecidos por terceiros e não fazem parte do Summyz Community/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/verifique a licença e os termos de cada modelo antes de usá-lo/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/prompt-base imutável do Summyz Community continuará ativo/i).length,
    ).toBeGreaterThan(0);
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
    expect(screen.queryAllByText(/sem prompt editável/i)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /desativar prompt/i }));
    expect(screen.getAllByText(/sem prompt editável/i)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Nome do perfil"), {
      target: { value: "Perfil revisado" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/profiles/profile-1",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Novo perfil" }));
    expect(await screen.findByRole("button", { name: "Perfil 2" })).toBeInTheDocument();
    const deleteButton = screen.getByRole("button", { name: "Excluir perfil" });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    fireEvent.click(deleteButton);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/profiles/profile-2",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Local" }));
    expect(await screen.findByLabelText(/^Silêncio para encerrar/)).toHaveValue("auto");
    expect(await screen.findByLabelText(/^Duração máxima da fala/)).toHaveValue("auto");
    fireEvent.click(screen.getByRole("tab", { name: "Modelo e transcrição" }));
    expect(await screen.findByDisplayValue("faster-whisper")).toBeDisabled();
  });
});
