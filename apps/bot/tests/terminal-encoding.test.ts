import { describe, expect, it, vi } from "vitest";

import { configureTerminalEncoding } from "../src/terminal-encoding.js";

describe("codificação do terminal", () => {
  it("configura a página de código UTF-8 no Windows", () => {
    const runCommand = vi.fn(() => ({ status: 0 }));

    const result = configureTerminalEncoding("win32", runCommand);

    expect(runCommand).toHaveBeenCalledWith("chcp.com", ["65001"]);
    expect(result).toEqual({ attempted: true, configured: true });
  });

  it("não executa comandos em outros sistemas", () => {
    const runCommand = vi.fn(() => ({ status: 0 }));

    const result = configureTerminalEncoding("linux", runCommand);

    expect(runCommand).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: false, configured: true });
  });

  it("informa quando não consegue configurar o Windows", () => {
    const runCommand = vi.fn(() => ({ errorType: "Error", status: null }));

    expect(configureTerminalEncoding("win32", runCommand)).toEqual({
      attempted: true,
      configured: false,
      errorType: "Error",
    });
  });

  it("usa uma categoria estável quando o comando falha sem erro do sistema", () => {
    const runCommand = vi.fn(() => ({ status: 1 }));

    expect(configureTerminalEncoding("win32", runCommand)).toEqual({
      attempted: true,
      configured: false,
      errorType: "TerminalEncodingCommandFailed",
    });
  });
});
