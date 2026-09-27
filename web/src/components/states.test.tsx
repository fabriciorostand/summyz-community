import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  EmptyState,
  ErrorState,
  FullPageLoading,
  InstallBotLink,
  LoadingPanel,
  Skeleton,
} from "./states";

describe("loading states", () => {
  it("labels the panel for assistive tech", () => {
    render(<LoadingPanel label="Carregando métricas…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando métricas…");
  });

  it("uses a default label", () => {
    render(<LoadingPanel />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando…");
  });

  it("renders the full page loader", () => {
    render(<FullPageLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Preparando o Summyz Community…");
  });

  it("renders a bare skeleton block", () => {
    const { container } = render(<Skeleton className="h-10" />);
    expect(container.querySelector(".skeleton")).not.toBeNull();
  });
});

describe("EmptyState", () => {
  it("shows the title, body and both actions", () => {
    render(
      <EmptyState
        action={<button type="button">Instalar</button>}
        secondaryAction={<button type="button">Ver comandos</button>}
        title="Nenhum servidor ainda"
      >
        Instale o Summyz em um servidor.
      </EmptyState>,
    );
    expect(screen.getByRole("heading", { name: "Nenhum servidor ainda" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Instalar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver comandos" })).toBeInTheDocument();
  });

  it("renders without actions", () => {
    render(<EmptyState title="Vazio">Nada aqui.</EmptyState>);
    expect(screen.getByRole("heading", { name: "Vazio" })).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("announces the failure and retries on demand", async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState code="request_failed · 503" onRetry={onRetry} title="Falhou">
        A consulta ao servidor falhou.
      </ErrorState>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("request_failed · 503")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders without a retry handler or code", () => {
    render(<ErrorState title="Falhou">Erro.</ErrorState>);
    expect(screen.queryByRole("button", { name: /Tentar novamente/ })).toBeNull();
  });
});

describe("InstallBotLink", () => {
  it("paints the primary link with the action gradient", () => {
    render(<InstallBotLink installUrl="https://discord.com/oauth2/authorize?client_id=1" />);
    expect(screen.getByRole("link", { name: "Adicionar o bot a um servidor" })).toHaveClass(
      "bg-action-gradient",
      "hover:bg-action-gradient-hover",
    );
  });
});
