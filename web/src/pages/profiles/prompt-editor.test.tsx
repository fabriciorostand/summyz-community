import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PromptEditor } from "./prompt-editor";

const defaultPrompt = { sent: "English default", shown: "prompt padrão" };

function renderEditor(overrides: Partial<Parameters<typeof PromptEditor>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <PromptEditor
      defaultPrompt={defaultPrompt}
      label="Prompt de refinamento"
      mode="custom"
      onChange={onChange}
      value={null}
      {...overrides}
    />,
  );
  return { onChange };
}

describe("PromptEditor", () => {
  it("explains that the base prompt stays active when no prompt is sent", () => {
    renderEditor();
    expect(screen.getByText("Não enviado")).toBeInTheDocument();
    expect(
      screen.getByText("Sem prompt. O prompt-base do Summyz continua sendo enviado."),
    ).toBeInTheDocument();
  });

  it("adopts the default prompt from the empty state as a default, not as custom text", async () => {
    const { onChange } = renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Usar prompt padrão" }));
    expect(onChange).toHaveBeenCalledWith({ mode: "default", value: "English default" });
  });

  it("starts an empty custom prompt when there is no default", async () => {
    const { onChange } = renderEditor({ defaultPrompt: undefined });
    await userEvent.click(screen.getByRole("button", { name: "Escrever prompt" }));
    expect(onChange).toHaveBeenCalledWith({ mode: "custom", value: "" });
  });

  it("tells a default prompt from a customised one by its mode", () => {
    const { unmount } = render(
      <PromptEditor
        defaultPrompt={defaultPrompt}
        label="Prompt"
        mode="default"
        onChange={vi.fn()}
        value="English default"
      />,
    );
    expect(screen.getByText("Padrão")).toBeInTheDocument();
    unmount();
    renderEditor({ value: "prompt padrão" });
    expect(screen.getByText("Personalizado")).toBeInTheDocument();
  });

  it("shows a default prompt in the dashboard language", () => {
    renderEditor({ mode: "default", value: "English default" });
    expect(screen.getByText("prompt padrão")).toBeInTheDocument();
    expect(screen.queryByText("English default")).toBeNull();
  });

  it("turns the first edit of a default prompt into custom text", async () => {
    const { onChange } = renderEditor({ mode: "default", value: "English default" });
    await userEvent.click(screen.getByRole("button", { name: "Editar prompt" }));
    await userEvent.type(screen.getByLabelText("Prompt de refinamento"), "!");
    expect(onChange).toHaveBeenLastCalledWith({ mode: "custom", value: "prompt padrão!" });
  });

  it("shows the start of the prompt until the person opens the editor", async () => {
    const { onChange } = renderEditor({ value: "texto" });
    expect(screen.getByText("texto")).toBeInTheDocument();
    expect(screen.queryByLabelText("Prompt de refinamento")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Editar prompt" }));
    await userEvent.type(screen.getByLabelText("Prompt de refinamento"), "!");

    expect(onChange).toHaveBeenCalledWith({ mode: "custom", value: "texto!" });
    await userEvent.click(screen.getByRole("button", { name: "Fechar editor" }));
    expect(screen.queryByLabelText("Prompt de refinamento")).toBeNull();
  });

  it("asks for confirmation before it stops sending a prompt", async () => {
    const { onChange } = renderEditor({ value: "texto" });
    await userEvent.click(screen.getByRole("button", { name: "Editar prompt" }));
    await userEvent.click(screen.getByRole("button", { name: "Não enviar este prompt" }));

    expect(screen.getByRole("alertdialog", { name: "Não enviar prompt" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Não enviar" }));
    expect(onChange).toHaveBeenCalledWith({ mode: "custom", value: null });
  });

  it("keeps the prompt when the removal is cancelled", async () => {
    const { onChange } = renderEditor({ value: "texto" });
    await userEvent.click(screen.getByRole("button", { name: "Editar prompt" }));
    await userEvent.click(screen.getByRole("button", { name: "Não enviar este prompt" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("asks for confirmation before restoring the default", async () => {
    const { onChange } = renderEditor({ value: "personalizado" });
    await userEvent.click(screen.getByRole("button", { name: "Editar prompt" }));
    await userEvent.click(screen.getByRole("button", { name: "Restaurar padrão" }));

    expect(screen.getByRole("alertdialog", { name: "Restaurar padrão" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restaurar prompt padrão" }));
    expect(onChange).toHaveBeenCalledWith({ mode: "default", value: "English default" });
  });

  it("hides the restore action while the prompt is already the default", async () => {
    renderEditor({ mode: "default", value: "English default" });
    await userEvent.click(screen.getByRole("button", { name: "Editar prompt" }));
    expect(screen.queryByRole("button", { name: "Restaurar padrão" })).toBeNull();
  });

  it("offers to restore custom text even when it matches the default word for word", async () => {
    renderEditor({ value: "prompt padrão" });
    await userEvent.click(screen.getByRole("button", { name: "Editar prompt" }));
    expect(screen.getByRole("button", { name: "Restaurar padrão" })).toBeInTheDocument();
  });

  it("hides the restore action when there is no default to restore", async () => {
    renderEditor({ defaultPrompt: undefined, value: "personalizado" });
    await userEvent.click(screen.getByRole("button", { name: "Editar prompt" }));
    expect(screen.queryByRole("button", { name: "Restaurar padrão" })).toBeNull();
  });
});
