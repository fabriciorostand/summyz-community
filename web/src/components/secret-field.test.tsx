import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { SecretField, storedSecretMask } from "./secret-field";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  api: { removeSecret: vi.fn(), updateSecret: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.updateSecret).mockResolvedValue(undefined);
  vi.mocked(api.removeSecret).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderField(configured: boolean, onChange = vi.fn()) {
  render(
    <SecretField
      configured={configured}
      editLabel="Editar chave OpenRouter"
      failedMessage="Não foi possível salvar a chave."
      label="Chave OpenRouter"
      name="openrouter_api_key"
      onChange={onChange}
      removeLabel="Remover chave OpenRouter"
    />,
  );
  return onChange;
}

describe("SecretField", () => {
  it("locks a stored secret behind the pencil, keeping the remove button beside it", () => {
    renderField(true);
    const field = screen.getByLabelText("Chave OpenRouter");
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue(storedSecretMask);
    expect(field).not.toHaveAttribute("placeholder");
    expect(screen.queryByRole("button", { name: "Mostrar o valor digitado" })).toBeNull();
    expect(screen.getByRole("button", { name: "Editar chave OpenRouter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Atualizar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remover chave OpenRouter" })).toBeEnabled();
  });

  it("draws the pencil and then the trash inside the field box", () => {
    renderField(true);
    const box = screen.getByLabelText("Chave OpenRouter").parentElement;
    const pencil = screen.getByRole("button", { name: "Editar chave OpenRouter" });
    const trash = screen.getByRole("button", { name: "Remover chave OpenRouter" });
    expect(box).toContainElement(pencil);
    expect(box).toContainElement(trash);
    expect(pencil.compareDocumentPosition(trash)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("opens the field for a new value from the pencil", async () => {
    renderField(true);
    await userEvent.click(screen.getByRole("button", { name: "Editar chave OpenRouter" }));
    const field = screen.getByLabelText("Chave OpenRouter");
    expect(field).not.toHaveAttribute("readonly");
    expect(field).toHaveFocus();
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", "Digite o novo valor para substituir");
    expect(screen.queryByRole("button", { name: "Editar chave OpenRouter" })).toBeNull();
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled();
    const trash = screen.getByRole("button", { name: "Remover chave OpenRouter" });
    expect(trash).toBeEnabled();
    expect(field.parentElement).toContainElement(trash);
    expect(field.parentElement).not.toContainElement(
      screen.getByRole("button", { name: "Atualizar" }),
    );
  });

  it("locks again and discards the typed value when editing is cancelled", async () => {
    renderField(true);
    await userEvent.click(screen.getByRole("button", { name: "Editar chave OpenRouter" }));
    await userEvent.type(screen.getByLabelText("Chave OpenRouter"), "sk-or-1");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    const field = screen.getByLabelText("Chave OpenRouter");
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveValue(storedSecretMask);
    expect(api.updateSecret).not.toHaveBeenCalled();
  });

  it("saves the new value and locks the field again", async () => {
    const onChange = renderField(true);
    await userEvent.click(screen.getByRole("button", { name: "Editar chave OpenRouter" }));
    await userEvent.type(screen.getByLabelText("Chave OpenRouter"), "sk-or-1");
    await userEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() =>
      expect(api.updateSecret).toHaveBeenCalledWith("openrouter_api_key", "sk-or-1"),
    );
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText("Chave OpenRouter")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Chave OpenRouter")).toHaveValue(storedSecretMask);
  });

  it("stays open with the error when saving fails", async () => {
    vi.mocked(api.updateSecret).mockRejectedValue(new Error("offline"));
    renderField(true);
    await userEvent.click(screen.getByRole("button", { name: "Editar chave OpenRouter" }));
    await userEvent.type(screen.getByLabelText("Chave OpenRouter"), "sk-or-1");
    await userEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar a chave.");
    expect(screen.getByLabelText("Chave OpenRouter")).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText("Chave OpenRouter")).toHaveValue("sk-or-1");
  });

  it("shows and hides the typed value from the eye inside the field box", async () => {
    renderField(false);
    const field = screen.getByLabelText("Chave OpenRouter");
    await userEvent.type(field, "sk-or-1");
    const eye = screen.getByRole("button", { name: "Mostrar o valor digitado" });
    expect(field.parentElement).toContainElement(eye);
    expect(eye).toHaveAttribute("aria-pressed", "false");
    expect(field).toHaveAttribute("type", "password");
    await userEvent.click(eye);
    expect(eye).toHaveAttribute("aria-pressed", "true");
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveValue("sk-or-1");
    await userEvent.click(eye);
    expect(field).toHaveAttribute("type", "password");
  });

  it("hides the typed value again once the field locks", async () => {
    renderField(true);
    await userEvent.click(screen.getByRole("button", { name: "Editar chave OpenRouter" }));
    await userEvent.type(screen.getByLabelText("Chave OpenRouter"), "sk-or-1");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar o valor digitado" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByLabelText("Chave OpenRouter")).toHaveAttribute("type", "password");
    expect(screen.queryByRole("button", { name: "Mostrar o valor digitado" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Editar chave OpenRouter" }));
    expect(screen.getByLabelText("Chave OpenRouter")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Mostrar o valor digitado" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("never sends the mask of a stored secret as its value", async () => {
    renderField(true);
    await userEvent.click(screen.getByRole("button", { name: "Editar chave OpenRouter" }));
    expect(screen.getByLabelText("Chave OpenRouter")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeDisabled();
    expect(api.updateSecret).not.toHaveBeenCalled();
  });

  it("starts open when nothing is stored yet, with nothing to cancel or remove", () => {
    renderField(false);
    const field = screen.getByLabelText("Chave OpenRouter");
    expect(field).not.toHaveAttribute("readonly");
    expect(field).not.toHaveFocus();
    expect(field).toHaveAttribute("placeholder", "Ainda não configurado");
    expect(screen.queryByRole("button", { name: "Editar chave OpenRouter" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeInTheDocument();
    const trash = screen.getByRole("button", { name: "Remover chave OpenRouter" });
    expect(trash).toBeDisabled();
    expect(field.parentElement).toContainElement(trash);
  });

  it("removes the stored secret from the locked state", async () => {
    const onChange = renderField(true);
    await userEvent.click(screen.getByRole("button", { name: "Remover chave OpenRouter" }));
    await waitFor(() => expect(api.removeSecret).toHaveBeenCalledWith("openrouter_api_key"));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
