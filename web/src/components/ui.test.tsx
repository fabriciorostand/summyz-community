import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { unguardedHoverClasses } from "../tests/test-utils";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  FormError,
  HelpTip,
  Label,
  Meter,
  Notice,
  RailLabel,
  SectionHeading,
  SelectField,
  TextAreaField,
  Toggle,
} from "./ui";

describe("Button", () => {
  it("renders each variant with its own styling", () => {
    render(
      <>
        <Button variant="primary">Salvar</Button>
        <Button variant="secondary">Cancelar</Button>
        <Button variant="ghost">Limpar</Button>
        <Button variant="danger">Excluir</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Salvar" }).className).toContain("bg-action");
    expect(screen.getByRole("button", { name: "Excluir" }).className).toContain("text-fail");
  });

  it("paints the primary variant with the action gradient", () => {
    render(<Button variant="primary">Salvar</Button>);
    expect(screen.getByRole("button", { name: "Salvar" })).toHaveClass(
      "bg-action-gradient",
      "enabled:hover:bg-action-gradient-hover",
    );
  });

  it("reacts to hover only while enabled, whatever the variant", () => {
    render(
      <>
        <Button variant="primary">Salvar</Button>
        <Button variant="secondary">Cancelar</Button>
        <Button variant="ghost">Limpar</Button>
        <Button variant="danger">Excluir</Button>
      </>,
    );
    for (const button of screen.getAllByRole("button")) {
      expect(unguardedHoverClasses(button)).toEqual([]);
    }
  });

  it("matches the header controls at the toolbar size", () => {
    render(
      <>
        <Button>Padrão</Button>
        <Button size="toolbar">Topo</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Padrão" })).toHaveClass("py-2", "text-[13.5px]");
    const toolbar = screen.getByRole("button", { name: "Topo" });
    expect(toolbar).toHaveClass("h-[34px]", "text-[12.5px]");
    expect(toolbar).not.toHaveClass("py-2", "text-[13.5px]");
  });

  it("calls the handler when clicked", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ok</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Field", () => {
  it("labels the input and shows the hint", () => {
    render(<Field hint="Mínimo de 12 caracteres." label="Senha" type="password" />);
    expect(screen.getByLabelText("Senha")).toBeInTheDocument();
    expect(screen.getByText("Mínimo de 12 caracteres.")).toBeInTheDocument();
  });

  it("omits the hint when none is given", () => {
    render(<Field label="E-mail" />);
    expect(screen.getByLabelText("E-mail")).toBeInTheDocument();
  });
});

describe("SelectField", () => {
  it("labels the combobox, describes it with the hint and reports the picked value", async () => {
    const onChange = vi.fn();
    render(
      <SelectField
        hint="Escolha um"
        label="Idioma"
        onChange={onChange}
        options={[
          { label: "Português", value: "pt-BR" },
          { label: "English", value: "en" },
        ]}
        value="pt-BR"
      />,
    );
    const combobox = screen.getByRole("combobox", { name: "Idioma" });
    expect(combobox).toHaveAccessibleDescription("Escolha um");
    expect(screen.getByLabelText("Idioma")).toBe(combobox);
    await userEvent.click(combobox);
    expect(screen.getByRole("listbox", { name: "Idioma" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "English" }));
    expect(onChange).toHaveBeenCalledWith("en");
  });
});

describe("TextAreaField", () => {
  it("labels the textarea", () => {
    render(<TextAreaField hint="Até 20.000" label="Prompt" readOnly value="texto" />);
    expect(screen.getByLabelText("Prompt")).toHaveValue("texto");
    expect(screen.getByText("Até 20.000")).toBeInTheDocument();
  });
});

describe("Toggle", () => {
  it("reports the new checked state", async () => {
    const onChange = vi.fn();
    render(
      <Toggle checked={false} description="Explicação" label="Reter áudio" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("Explicação")).toBeInTheDocument();
  });

  it("renders without a description", () => {
    render(<Toggle checked label="Ativo" onChange={() => undefined} />);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});

describe("Badge", () => {
  it("adds a pulsing dot for the live tone", () => {
    const { container } = render(<Badge tone="live">Gravando</Badge>);
    expect(container.querySelector(".live-dot")).not.toBeNull();
  });

  it("renders other tones without the dot", () => {
    const { container } = render(<Badge tone="ok">Concluída</Badge>);
    expect(container.querySelector(".live-dot")).toBeNull();
  });

  it("defaults to the neutral tone", () => {
    render(<Badge>Membro</Badge>);
    expect(screen.getByText("Membro").className).toContain("bg-surface-inset");
  });
});

describe("Avatar", () => {
  it("shows the image when one is available", () => {
    render(<Avatar avatarUrl="https://cdn.example/a.png" name="Ana" />);
    expect(screen.getByRole("presentation", { hidden: true })).toHaveAttribute(
      "src",
      "https://cdn.example/a.png",
    );
  });

  it("falls back to initials", () => {
    render(<Avatar name="Marcela Torres" />);
    expect(screen.getByText("MT")).toBeInTheDocument();
  });

  it("keeps the neutral fallback by default", () => {
    render(<Avatar name="Marcela Torres" />);
    expect(screen.getByText("MT")).toHaveClass("bg-surface-inset", "text-ink-secondary");
    expect(screen.getByText("MT")).not.toHaveClass("border");
  });

  it("outlines the fallback in the action tone so it reads on raised surfaces", () => {
    render(<Avatar fallbackTone="action" name="Isabunda" />);
    expect(screen.getByText("IS")).toHaveClass(
      "border",
      "border-action/40",
      "bg-action-soft",
      "text-accent",
    );
    expect(screen.getByText("IS")).not.toHaveClass("bg-surface-inset");
  });
});

describe("Meter", () => {
  it("clamps the width between a visible minimum and 100%", () => {
    const { container } = render(<Meter percentage={0} />);
    expect(container.querySelector("[style]")).toHaveStyle({ width: "2%" });
  });

  it("never exceeds the track", () => {
    const { container } = render(<Meter percentage={140} tone="ok" />);
    expect(container.querySelector("[style]")).toHaveStyle({ width: "100%" });
  });
});

describe("Notice and FormError", () => {
  it("renders a warning notice", () => {
    render(<Notice tone="warn">Atenção</Notice>);
    expect(screen.getByText("Atenção")).toBeInTheDocument();
  });

  it("announces form errors", () => {
    render(<FormError>E-mail ou senha incorretos.</FormError>);
    expect(screen.getByRole("alert")).toHaveTextContent("E-mail ou senha incorretos.");
  });
});

describe("layout primitives", () => {
  it("renders a section heading with icon, description and action", () => {
    render(
      <SectionHeading
        action={<button type="button">Gerenciar</button>}
        description="Descrição"
        icon={<span data-testid="icon" />}
        title="Perfil de IA"
      />,
    );
    expect(screen.getByRole("heading", { name: "Perfil de IA" })).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gerenciar" })).toBeInTheDocument();
  });

  it("renders a heading without the optional parts", () => {
    render(<SectionHeading title="Acesso" />);
    expect(screen.getByRole("heading", { name: "Acesso" })).toBeInTheDocument();
  });

  it("renders cards, rail labels and labels", () => {
    render(
      <Card>
        <RailLabel>Avançado</RailLabel>
        <Label>Nome</Label>
      </Card>,
    );
    expect(screen.getByText("Avançado")).toBeInTheDocument();
    expect(screen.getByText("Nome")).toBeInTheDocument();
  });
});

describe("HelpTip", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("explains on focus and describes the trigger for screen readers", async () => {
    render(<HelpTip>Perfis são globais.</HelpTip>);
    const trigger = screen.getByRole("button", { name: "Ajuda" });
    await userEvent.tab();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Perfis são globais.");
    expect(trigger).toHaveAccessibleDescription("Perfis são globais.");
    await userEvent.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("takes a specific name when several tips share a screen", () => {
    render(<HelpTip label="Sobre a etapa Resumo">Escreve o resumo.</HelpTip>);
    expect(screen.getByRole("button", { name: "Sobre a etapa Resumo" })).toBeInTheDocument();
  });

  it("shifts the tip back inside a narrow viewport", async () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute("role") === "tooltip"
        ? new DOMRect(157, 350, 260, 80)
        : new DOMRect(0, 0, 0, 0);
    });
    render(<HelpTip>Senha definida na configuração inicial.</HelpTip>);
    await userEvent.tab();
    // The tip ends at 417px; moved in its own box, it must end 16px before the 320px edge.
    expect(screen.getByRole("tooltip")).toHaveStyle({ left: "44px", right: "auto" });
  });

  it("leaves a tip that already fits where it is", async () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1280);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute("role") === "tooltip"
        ? new DOMRect(157, 350, 260, 80)
        : new DOMRect(0, 0, 0, 0);
    });
    render(<HelpTip>Cabe na tela.</HelpTip>);
    await userEvent.tab();
    expect(screen.getByRole("tooltip").style.left).toBe("");
  });
});
