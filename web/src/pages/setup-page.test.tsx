import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { SetupPage } from "./setup-page";

vi.mock("../lib/api", () => ({ api: { setup: vi.fn() } }));

const setup = vi.mocked(api.setup);

async function fillAdministrator() {
  await userEvent.type(screen.getByLabelText("Token de configuração"), "token-do-log");
  await userEvent.type(screen.getByLabelText("E-mail"), "ana@pixelforge.gg");
  await userEvent.type(screen.getByLabelText("Senha"), "senha-de-doze+");
  await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

async function fillDiscord() {
  await userEvent.type(screen.getByLabelText("Client ID"), "128944302");
  await userEvent.type(screen.getByLabelText("Client secret"), "segredo");
  await userEvent.type(screen.getByLabelText("Token do bot"), "token-bot");
  await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

async function fillSmtp() {
  await userEvent.type(screen.getByLabelText("Login SMTP"), "smtp-user");
  await userEvent.type(screen.getByLabelText("Senha SMTP"), "smtp-pass");
  await userEvent.type(screen.getByLabelText("E-mail remetente"), "bot@pixelforge.gg");
}

beforeEach(() => {
  setup.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SetupPage", () => {
  it("starts on the administrator step", () => {
    render(<SetupPage onComplete={() => undefined} />);
    expect(screen.getByText("Passo 1 de 3 · Conta administradora")).toBeInTheDocument();
    expect(screen.getByLabelText("Token de configuração")).toBeInTheDocument();
  });

  it("walks through the three steps", async () => {
    render(<SetupPage onComplete={() => undefined} />);
    await fillAdministrator();
    expect(screen.getByText("Passo 2 de 3 · Aplicação Discord")).toBeInTheDocument();
    await fillDiscord();
    expect(screen.getByText("Passo 3 de 3 · Envio de e-mail")).toBeInTheDocument();
  });

  it("goes back to a previous step", async () => {
    render(<SetupPage onComplete={() => undefined} />);
    await fillAdministrator();
    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.getByText("Passo 1 de 3 · Conta administradora")).toBeInTheDocument();
  });

  it("sends everything in one request at the end", async () => {
    const onComplete = vi.fn();
    render(<SetupPage onComplete={onComplete} />);
    await fillAdministrator();
    await fillDiscord();
    await fillSmtp();
    await userEvent.click(screen.getByRole("button", { name: "Concluir configuração" }));
    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1));
    expect(setup).toHaveBeenCalledWith(
      "token-do-log",
      expect.objectContaining({
        administrator: expect.objectContaining({ email: "ana@pixelforge.gg" }),
        installation: expect.objectContaining({ discordClientId: "128944302" }),
      }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("reports a failed setup without leaking detail", async () => {
    setup.mockRejectedValue(new Error("bad token"));
    render(<SetupPage onComplete={() => undefined} />);
    await fillAdministrator();
    await fillDiscord();
    await fillSmtp();
    await userEvent.click(screen.getByRole("button", { name: "Concluir configuração" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O setup não pôde ser concluído. Confira o token e os campos.",
    );
  });

  it("carries the registration choice into the payload", async () => {
    render(<SetupPage onComplete={() => undefined} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Permitir novos cadastros/ }));
    await fillAdministrator();
    await fillDiscord();
    await fillSmtp();
    await userEvent.click(screen.getByRole("button", { name: "Concluir configuração" }));
    await waitFor(() =>
      expect(setup).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          installation: expect.objectContaining({ registrationEnabled: false }),
        }),
      ),
    );
  });

  it("explains the retention default up front", () => {
    render(<SetupPage onComplete={() => undefined} />);
    expect(screen.getByText("Privacidade previsível")).toBeInTheDocument();
    expect(screen.getByText(/O áudio começa desativado/)).toBeInTheDocument();
  });
});
