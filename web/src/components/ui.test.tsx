import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  FormError,
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
  it("labels the select and renders its options", async () => {
    const onChange = vi.fn();
    render(
      <SelectField hint="Escolha um" label="Idioma" onChange={onChange} value="pt-BR">
        <option value="pt-BR">Português</option>
        <option value="en">English</option>
      </SelectField>,
    );
    await userEvent.selectOptions(screen.getByLabelText("Idioma"), "en");
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByText("Escolha um")).toBeInTheDocument();
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
