import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "../lib/api";
import { unguardedHoverClasses } from "../tests/test-utils";
import { UnlockPage } from "./unlock-page";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ApiError: actual.ApiError, api: { login: vi.fn() } };
});

function renderPage(onUnlocked = vi.fn()) {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <UnlockPage onUnlocked={onUnlocked} />
    </MemoryRouter>,
  );
  return onUnlocked;
}

beforeEach(() => {
  vi.mocked(api.login).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("UnlockPage", () => {
  it("asks only for the installation password", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Desbloquear" })).toBeInTheDocument();
    expect(screen.getByLabelText("Senha da instalação")).toHaveAttribute("type", "password");
    expect(screen.queryByLabelText(/e-mail/i)).toBeNull();
  });

  it("explains that this is not a user password", async () => {
    renderPage();
    await userEvent.hover(screen.getByRole("button", { name: "Ajuda" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Senha da instalação, não de usuário");
    expect(screen.getByRole("tooltip")).toHaveTextContent("recover-access");
  });

  it("does not react to hover while the password is being checked", () => {
    renderPage();
    expect(unguardedHoverClasses(screen.getByRole("button", { name: "Entrar" }))).toEqual([]);
  });

  it("ignores an empty submission", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(api.login).not.toHaveBeenCalled();
  });

  it("unlocks the installation and hands over to the dashboard", async () => {
    const onUnlocked = renderPage();
    await userEvent.type(
      screen.getByLabelText("Senha da instalação"),
      "uma frase bem longa{enter}",
    );
    expect(
      await screen.findByRole("heading", { name: "Instalação desbloqueada" }),
    ).toBeInTheDocument();
    expect(api.login).toHaveBeenCalledWith("uma frase bem longa");
    await userEvent.click(screen.getByRole("button", { name: "Ir para o dashboard" }));
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it("counts wrong attempts without revealing anything else", async () => {
    vi.mocked(api.login).mockRejectedValue(new ApiError(401, "invalid_password"));
    renderPage();
    await userEvent.type(screen.getByLabelText("Senha da instalação"), "errada");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Senha incorreta");
    expect(screen.getByRole("alert")).toHaveTextContent("Tentativa 1");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Tentativa 2"));
  });

  it("shows the temporary lockout with its countdown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.login).mockRejectedValue(new ApiError(429, "login_rate_limited", 42));
    renderPage();
    await userEvent.type(screen.getByLabelText("Senha da instalação"), "errada");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("00:42")).toBeInTheDocument();
    expect(screen.getByText("Aguarde para tentar de novo")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_000));
    expect(await screen.findByText("00:40")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(41_000));
    expect(await screen.findByLabelText("Senha da instalação")).toHaveValue("");
  });

  it("reports an outage without pretending the password was wrong", async () => {
    vi.mocked(api.login).mockRejectedValue(new Error("offline"));
    renderPage();
    await userEvent.type(screen.getByLabelText("Senha da instalação"), "qualquer");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível verificar a senha",
    );
  });
});
