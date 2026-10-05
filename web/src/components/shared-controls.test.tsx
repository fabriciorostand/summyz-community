import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../lib/api";
import { leaveDashboardFor } from "../lib/browser-navigation";
import { ConfirmDialog } from "./confirm-dialog";
import { CopyableValue } from "./copyable-value";
import { DiscordConnectButton } from "./discord-connect-button";
import { Notice } from "./ui";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  api: { startDiscordConnection: vi.fn() },
}));
vi.mock("../lib/browser-navigation", () => ({ leaveDashboardFor: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe("CopyableValue", () => {
  it("copies the value it shows", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(
      <CopyableValue copyLabel="Copiar URL" value="http://127.0.0.1:8787/api/discord/callback" />,
    );
    expect(screen.getByText("http://127.0.0.1:8787/api/discord/callback")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copiar URL" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/discord/callback",
    );
  });
});

describe("ConfirmDialog", () => {
  it("keeps the confirm button red by default and uses the action color for safe steps", () => {
    const { rerender } = render(
      <ConfirmDialog confirmLabel="Apagar" onCancel={vi.fn()} onConfirm={vi.fn()} open title="T">
        <p>Corpo</p>
      </ConfirmDialog>,
    );
    expect(screen.getByRole("button", { name: "Apagar" })).not.toHaveClass("bg-action-gradient");
    rerender(
      <ConfirmDialog
        confirmLabel="Continuar"
        confirmTone="primary"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        open
        title="T"
      >
        <p>Corpo</p>
      </ConfirmDialog>,
    );
    expect(screen.getByRole("button", { name: "Continuar" })).toHaveClass("bg-action-gradient");
  });

  it("asks before acting and treats every close path as cancel", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        confirmLabel="Substituir token"
        onCancel={onCancel}
        onConfirm={onConfirm}
        open={false}
        title="Substituir o token do bot?"
      >
        Corpo
      </ConfirmDialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <ConfirmDialog
        confirmLabel="Substituir token"
        onCancel={onCancel}
        onConfirm={onConfirm}
        open
        title="Substituir o token do bot?"
      >
        Corpo
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Substituir o token do bot?" });
    expect(dialog).toHaveTextContent("Corpo");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Substituir token" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("DiscordConnectButton", () => {
  it("opens the Discord authorization", async () => {
    vi.mocked(api.startDiscordConnection).mockResolvedValue("https://discord.com/oauth2/authorize");
    render(<DiscordConnectButton />);
    await userEvent.click(screen.getByRole("button", { name: /Conectar conta Discord/ }));
    expect(leaveDashboardFor).toHaveBeenCalledWith("https://discord.com/oauth2/authorize");
    expect(screen.getByRole("button", { name: /Abrindo o Discord/ })).toBeDisabled();
  });

  it("explains why the authorization could not start", async () => {
    vi.mocked(api.startDiscordConnection).mockRejectedValue(
      new ApiError(409, "discord_client_secret_missing"),
    );
    render(<DiscordConnectButton label="Trocar conta" variant="secondary" />);
    await userEvent.click(screen.getByRole("button", { name: /Trocar conta/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Salve o Client Secret da aplicação antes de conectar.",
    );
  });

  it("stays inert while something else is missing", () => {
    render(<DiscordConnectButton disabled />);
    expect(screen.getByRole("button", { name: /Conectar conta Discord/ })).toBeDisabled();
  });
});

describe("Notice", () => {
  it("offers a success tone and a trailing action", async () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <Notice
        action={
          <button onClick={onDismiss} type="button">
            Fechar
          </button>
        }
        tone="ok"
      >
        Conta conectada
      </Notice>,
    );
    expect(container.firstElementChild).toHaveClass("text-ok");
    await userEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
