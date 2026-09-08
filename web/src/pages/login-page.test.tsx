import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "../lib/api";
import { renderWithRouter } from "../tests/test-utils";
import { LoginPage } from "./login-page";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ApiError: actual.ApiError, api: { login: vi.fn() } };
});

const login = vi.mocked(api.login);

beforeEach(() => {
  login.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LoginPage", () => {
  it("carries the product story next to the form", () => {
    renderWithRouter(<LoginPage />);
    expect(screen.getByRole("heading", { name: /Conversas viram decisões/ })).toBeInTheDocument();
    expect(screen.getByText("Self-hosted · seus dados ficam com você")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Entrar" })).toBeInTheDocument();
  });

  it("signs in with the given credentials", async () => {
    renderWithRouter(<LoginPage />);
    await userEvent.type(screen.getByLabelText("E-mail"), "ana@pixelforge.gg");
    await userEvent.type(screen.getByLabelText("Senha"), "senha-super-secreta");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith("ana@pixelforge.gg", "senha-super-secreta"),
    );
  });

  it("reports wrong credentials without leaking detail", async () => {
    login.mockRejectedValue(new ApiError(401, "invalid_credentials"));
    renderWithRouter(<LoginPage />);
    await userEvent.type(screen.getByLabelText("E-mail"), "ana@pixelforge.gg");
    await userEvent.type(screen.getByLabelText("Senha"), "errada");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha incorretos.");
  });

  it("reports an unexpected failure separately", async () => {
    login.mockRejectedValue(new Error("offline"));
    renderWithRouter(<LoginPage />);
    await userEvent.type(screen.getByLabelText("E-mail"), "ana@pixelforge.gg");
    await userEvent.type(screen.getByLabelText("Senha"), "senha");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível entrar.");
  });
});
