import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { renderWithRouter } from "../../tests/test-utils";
import { DeviceChoice } from "./device-choice";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { ...actual.api, getHardware: vi.fn() } };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("local stage device choice", () => {
  it("blocks unavailable GPU without changing an explicit selection to CPU", async () => {
    vi.mocked(api.getHardware).mockResolvedValue({
      hardware: { gpuAvailability: { ollama: true, "faster-whisper": false } },
    });
    const onChange = vi.fn();
    renderWithRouter(
      <DeviceChoice
        provider="faster-whisper"
        stage="transcription"
        value="gpu"
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(screen.getByRole("radio", { name: "GPU" })).toBeDisabled());
    expect(screen.getByRole("radio", { name: "GPU" })).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("radio", { name: "CPU" }));
    expect(onChange).toHaveBeenCalledWith("cpu");
  });
  it("enables GPU only for the available provider", async () => {
    vi.mocked(api.getHardware).mockResolvedValue({
      hardware: { gpuAvailability: { ollama: true, "faster-whisper": false } },
    });
    renderWithRouter(
      <DeviceChoice provider="ollama" stage="summary" value="auto" onChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole("radio", { name: "GPU" })).toBeEnabled());
  });
});
