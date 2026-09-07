import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { api, ApiError } from "./api";
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  SetupPage,
  VerifyPage,
} from "./auth-pages";

afterEach(() => vi.restoreAllMocks());

describe("authentication pages", () => {
  it("logs in and presents both safe failure messages", async () => {
    const login = vi.spyOn(api, "login").mockResolvedValueOnce(undefined);
    const { unmount } = renderRoute(<LoginPage registrationEnabled />);
    fill("E-mail", "owner@example.com");
    fill("Senha", "correct-horse-battery-staple");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(login).toHaveBeenCalled());
    unmount();

    login.mockRejectedValueOnce(new ApiError(401, "invalid_credentials"));
    renderRoute(<LoginPage registrationEnabled={false} />);
    fill("E-mail", "owner@example.com");
    fill("Senha", "wrong-password");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("E-mail ou senha incorretos.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Criar uma conta" })).not.toBeInTheDocument();
  });

  it("registers an account and handles a rejected registration", async () => {
    const register = vi.spyOn(api, "register").mockResolvedValueOnce(undefined);
    const { unmount } = renderRoute(<RegisterPage />);
    fill("E-mail", "new@example.com");
    fill(/^Senha/, "a-very-long-password");
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByText("Verifique seu e-mail")).toBeInTheDocument();
    expect(register).toHaveBeenCalledWith("new@example.com", "a-very-long-password", "pt-BR");
    unmount();

    register.mockRejectedValueOnce(new Error("offline"));
    renderRoute(<RegisterPage />);
    fill("E-mail", "new@example.com");
    fill(/^Senha/, "a-very-long-password");
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByText(/não foi possível criar a conta/i)).toBeInTheDocument();
  });

  it("requests and applies a password reset", async () => {
    const forgot = vi.spyOn(api, "forgotPassword").mockResolvedValue(undefined);
    const reset = vi.spyOn(api, "resetPassword").mockResolvedValue(undefined);
    const { unmount } = renderRoute(<ForgotPasswordPage />);
    fill("E-mail", "owner@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Enviar link" }));
    expect(await screen.findByText(/se a conta existir/i)).toBeInTheDocument();
    expect(forgot).toHaveBeenCalledWith("owner@example.com");
    unmount();

    renderRoute(<ResetPasswordPage />, "/reset-password?token=reset-token");
    fill("Nova senha", "new-long-password");
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    await waitFor(() => expect(reset).toHaveBeenCalledWith("reset-token", "new-long-password"));
  });

  it("verifies valid and invalid email links", async () => {
    const verify = vi
      .spyOn(api, "verifyEmail")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("expired"));
    const { unmount } = renderRoute(<VerifyPage />, "/verify?token=valid");
    fireEvent.click(screen.getByRole("button", { name: "Verificar e-mail" }));
    expect(await screen.findByText(/conta verificada/i)).toBeInTheDocument();
    unmount();

    renderRoute(<VerifyPage />, "/verify?token=expired");
    fireEvent.click(screen.getByRole("button", { name: "Verificar e-mail" }));
    expect(await screen.findByText(/inválido ou expirou/i)).toBeInTheDocument();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("submits every initial setup field and reports failure safely", async () => {
    const setup = vi.spyOn(api, "setup").mockResolvedValueOnce(undefined);
    const completed = vi.fn();
    const status = { registrationEnabled: false, setupCompleted: false };
    const { unmount } = renderRoute(<SetupPage onComplete={completed} status={status} />);
    fillSetup();
    fireEvent.click(screen.getByRole("button", { name: "Concluir configuração" }));
    await waitFor(() => expect(completed).toHaveBeenCalled());
    expect(setup).toHaveBeenCalledWith(
      "setup-token",
      expect.objectContaining({
        administrator: expect.objectContaining({ email: "owner@example.com" }),
        installation: expect.objectContaining({ discordClientId: "client-id" }),
      }),
    );
    unmount();

    setup.mockRejectedValueOnce(new Error("rejected"));
    renderRoute(<SetupPage onComplete={completed} status={status} />);
    fillSetup();
    fireEvent.click(screen.getByRole("button", { name: "Concluir configuração" }));
    expect(await screen.findByText(/setup não pôde ser concluído/i)).toBeInTheDocument();
  });
});

function renderRoute(element: React.ReactNode, entry = "/") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

function fill(label: string | RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillSetup(): void {
  const values: Record<string, string> = {
    setupToken: "setup-token",
    email: "owner@example.com",
    password: "a-very-long-password",
    discordClientId: "client-id",
    discordClientSecret: "client-secret",
    discordBotToken: "bot-token",
    publicBaseUrl: "https://summyz.example.com",
    smtpHost: "smtp.example.com",
    smtpPort: "587",
    smtpUser: "smtp-user",
    smtpPassword: "smtp-password",
    smtpFromEmail: "mail@example.com",
    smtpFromName: "Summyz",
  };
  for (const [name, value] of Object.entries(values)) {
    const input = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
    if (input === null) throw new Error(`Missing setup field: ${name}`);
    fireEvent.change(input, { target: { value } });
  }
}
