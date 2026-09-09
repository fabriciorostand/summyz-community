import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PromptEditor } from "./prompt-editor";

function renderEditor(overrides: Partial<Parameters<typeof PromptEditor>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <PromptEditor
      defaultPrompt="prompt padrão"
      label="Prompt de refinamento"
      onChange={onChange}
      toggleLabel="Enviar prompt de refinamento"
      value={null}
      {...overrides}
    />,
  );
  return { onChange };
}

describe("PromptEditor", () => {
  it("explains that the base prompt stays active when no prompt is set", () => {
    renderEditor();
    expect(screen.getByText("Sem prompt")).toBeInTheDocument();
    expect(
      screen.getByText(/O prompt-base imutável do Summyz Community continuará ativo/),
    ).toBeInTheDocument();
  });

  it("adopts the default prompt from the empty state", async () => {
    const { onChange } = renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Usar prompt padrão" }));
    expect(onChange).toHaveBeenCalledWith("prompt padrão");
  });

  it("adopts the default prompt from the toggle", async () => {
    const { onChange } = renderEditor();
    await userEvent.click(screen.getByRole("checkbox", { name: /Enviar prompt de refinamento/ }));
    expect(onChange).toHaveBeenCalledWith("prompt padrão");
  });

  it("falls back to an empty prompt when there is no default", async () => {
    const { onChange } = renderEditor({ defaultPrompt: null });
    await userEvent.click(screen.getByRole("checkbox", { name: /Enviar prompt de refinamento/ }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("edits an existing prompt", async () => {
    const { onChange } = renderEditor({ value: "texto" });
    await userEvent.type(screen.getByLabelText("Prompt de refinamento"), "!");
    expect(onChange).toHaveBeenCalledWith("texto!");
  });

  it("asks for confirmation before removing a prompt", async () => {
    const { onChange } = renderEditor({ value: "texto" });
    await userEvent.click(screen.getByRole("checkbox", { name: /Enviar prompt de refinamento/ }));
    expect(screen.getByRole("alertdialog", { name: "Desativar prompt" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Desativar prompt" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("keeps the prompt when the removal is cancelled", async () => {
    const { onChange } = renderEditor({ value: "texto" });
    await userEvent.click(screen.getByRole("checkbox", { name: /Enviar prompt de refinamento/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("asks for confirmation before restoring the default", async () => {
    const { onChange } = renderEditor({ value: "personalizado" });
    await userEvent.click(screen.getByRole("button", { name: "Restaurar padrão" }));
    expect(screen.getByRole("alertdialog", { name: "Restaurar prompt" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restaurar prompt" }));
    expect(onChange).toHaveBeenCalledWith("prompt padrão");
  });

  it("hides the restore action while the prompt already matches the default", () => {
    renderEditor({ value: "prompt padrão" });
    expect(screen.queryByRole("button", { name: "Restaurar padrão" })).toBeNull();
  });

  it("hides the restore action when there is no default to restore", () => {
    renderEditor({ defaultPrompt: undefined, value: "personalizado" });
    expect(screen.queryByRole("button", { name: "Restaurar padrão" })).toBeNull();
  });
});
