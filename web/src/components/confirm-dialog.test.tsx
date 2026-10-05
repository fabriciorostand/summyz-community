import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  it("centres its actions", () => {
    render(
      <ConfirmDialog confirmLabel="Alterar" onCancel={vi.fn()} onConfirm={vi.fn()} open title="Ok?">
        <p>Body</p>
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Ok?" });
    const actions = within(dialog).getByRole("button", { name: "Cancelar" }).parentElement;
    expect(actions).toBe(within(dialog).getByRole("button", { name: "Alterar" }).parentElement);
    expect(actions).toHaveClass("justify-center");
    expect(actions).not.toHaveClass("justify-end");
  });
});
