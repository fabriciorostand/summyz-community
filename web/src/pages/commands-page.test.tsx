import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderScreen } from "../tests/test-utils";
import { CommandsPage } from "./commands-page";

describe("CommandsPage", () => {
  it("groups the commands the bot registers", () => {
    renderScreen(<CommandsPage />);
    expect(screen.getByRole("banner")).toHaveTextContent("Registrados pelo bot no Discord");
    expect(screen.getByText("Gravação")).toBeInTheDocument();
    expect(screen.getByText("Atalhos administrativos")).toBeInTheDocument();
    expect(screen.getByText("Custo — só para o dono do servidor")).toBeInTheDocument();
  });

  it("lists every command with its description", () => {
    renderScreen(<CommandsPage />);
    expect(screen.getByText("/record start")).toBeInTheDocument();
    expect(screen.getByText("Inicia a gravação no canal de voz atual.")).toBeInTheDocument();
    expect(screen.getByText("/recording-cost period")).toBeInTheDocument();
  });

  it("is a plain reference without a second column", () => {
    renderScreen(<CommandsPage />);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.queryByTestId("controls")).toBeNull();
  });
});
