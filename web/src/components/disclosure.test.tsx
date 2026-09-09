import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Disclosure, Tabs } from "./disclosure";

describe("Disclosure", () => {
  it("starts collapsed and hides its content", () => {
    render(
      <Disclosure summary="Ativada · limiar 0,50" title="Detecção de voz">
        <p>conteúdo avançado</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: /Detecção de voz/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("conteúdo avançado")).not.toBeVisible();
  });

  it("expands and collapses on click", async () => {
    render(
      <Disclosure title="Prompts">
        <p>corpo</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: /Prompts/ });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("corpo")).toBeVisible();
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("can start open and render a badge and icon", () => {
    render(
      <Disclosure
        badge={<span>Padrão</span>}
        defaultOpen
        icon={<span data-testid="icon" />}
        title="Geração"
      >
        <p>corpo</p>
      </Disclosure>,
    );
    expect(screen.getByRole("button", { name: /Geração/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Padrão")).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("links the trigger to the region it controls", () => {
    render(
      <Disclosure title="Tradução">
        <p>corpo</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: /Tradução/ });
    const controlled = trigger.getAttribute("aria-controls");
    expect(controlled).not.toBeNull();
    expect(document.getElementById(controlled ?? "")).not.toBeNull();
  });
});

describe("Tabs", () => {
  it("marks the selected tab and reports changes", async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        ariaLabel="Estado"
        onChange={onChange}
        options={[
          { label: "Todas", value: "" },
          { count: 3, label: "Falhas", value: "failed" },
        ]}
        value=""
      />,
    );
    expect(screen.getByRole("tab", { name: "Todas" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Falhas/ }));
    expect(onChange).toHaveBeenCalledWith("failed");
  });

  it("exposes the tablist label", () => {
    render(
      <Tabs
        ariaLabel="Período"
        onChange={() => undefined}
        options={[{ label: "30d", value: "30d" }]}
        value="30d"
      />,
    );
    expect(screen.getByRole("tablist", { name: "Período" })).toBeInTheDocument();
  });
});
