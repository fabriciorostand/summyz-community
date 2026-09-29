import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDateFormat, setLanguage, setTimeFormat } from "../i18n/store";
import { api } from "../lib/api";
import { aTask, dashboardContext, guildSelection, renderScreen } from "../tests/test-utils";
import { TasksPage } from "./tasks-page";

vi.mock("../lib/api", () => ({
  api: { listTasks: vi.fn(), setTaskCompleted: vi.fn() },
}));

const listTasks = vi.mocked(api.listTasks);
const setTaskCompleted = vi.mocked(api.setTaskCompleted);

beforeEach(() => {
  listTasks.mockResolvedValue([
    aTask(),
    aTask({
      overdue: true,
      taskId: "33333333-3333-4333-8333-333333333333",
      text: "Abrir o repro do desync",
    }),
    aTask({
      ownerDisplayName: "RespawnRita",
      ownerUserId: "u2",
      taskId: "44444444-4444-4444-8444-444444444444",
      text: "Assinar o build",
    }),
  ]);
  setTaskCompleted.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TasksPage", () => {
  it("groups the open tasks by owner", async () => {
    renderScreen(<TasksPage />);
    expect(await screen.findByText("Marcar a branch de release")).toBeInTheDocument();
    expect(screen.getByText("Assinar o build")).toBeInTheDocument();
    expect(screen.getAllByText("2 abertas")).toHaveLength(1);
  });

  it("leaves the open and overdue counts out of the header", async () => {
    renderScreen(<TasksPage />);
    await screen.findByText("Marcar a branch de release");
    expect(screen.queryByText(/abertas ·/)).toBeNull();
  });

  it("marks a task as overdue", async () => {
    renderScreen(<TasksPage />);
    expect(await screen.findByText("1 atrasada")).toBeInTheDocument();
  });

  it("links each task to the call that produced it", async () => {
    renderScreen(<TasksPage />);
    const link = await screen.findAllByRole("link", { name: "Launch Week Sync" });
    expect(link[0]).toHaveAttribute("href", "/history/m1");
  });

  it("shows the deadline of each task", async () => {
    renderScreen(<TasksPage />);
    expect(await screen.findAllByText("SEX 04/09")).not.toHaveLength(0);
  });

  it("dates a deadline even when the task carries no time zone of its own", async () => {
    listTasks.mockResolvedValue([aTask({ deadlineTimeZone: null })]);
    renderScreen(<TasksPage />);
    expect(await screen.findByText("SEX 04/09")).toBeInTheDocument();
  });

  it("says when a task has no deadline", async () => {
    listTasks.mockResolvedValue([aTask({ deadlineDate: null, deadlinePrecision: null })]);
    renderScreen(<TasksPage />);
    expect(await screen.findByText("sem prazo")).toBeInTheDocument();
  });

  it("uses the singular for a single open task", async () => {
    listTasks.mockResolvedValue([aTask()]);
    renderScreen(<TasksPage />);
    expect(await screen.findByText("1 aberta")).toBeInTheDocument();
  });

  it("reads in English with the chosen formats", async () => {
    setLanguage("en");
    setDateFormat("MM/DD/YYYY");
    setTimeFormat("12h");
    listTasks.mockResolvedValue([
      aTask({ deadlinePrecision: "minute", deadlineTime: "14:30:00" }),
      aTask({ deadlineDate: null, taskId: "55555555-5555-4555-8555-555555555555", text: "Plan" }),
    ]);
    renderScreen(<TasksPage />);
    expect(await screen.findByText("FRI 09/04 2:30 PM")).toBeInTheDocument();
    expect(screen.getByText("no deadline")).toBeInTheDocument();
    expect(screen.getByText("2 open")).toBeInTheDocument();
    expect(screen.getByText("Show completed")).toBeInTheDocument();
  });

  it("completes a task and refreshes the counters", async () => {
    const reloadDashboard = vi.fn();
    renderScreen(<TasksPage />, { context: dashboardContext({ reloadDashboard }) });
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Marcar a branch de release" }),
    );
    await waitFor(() =>
      expect(setTaskCompleted).toHaveBeenCalledWith(
        "g1",
        "22222222-2222-4222-8222-222222222222",
        true,
      ),
    );
    expect(reloadDashboard).toHaveBeenCalled();
  });

  it("completes a task from the enlarged touch area around its checkbox", async () => {
    renderScreen(<TasksPage />);
    const checkbox = await screen.findByRole("checkbox", { name: "Marcar a branch de release" });
    const touchArea = checkbox.closest("label");
    expect(touchArea).not.toBeNull();
    if (touchArea !== null) await userEvent.click(touchArea);
    await waitFor(() =>
      expect(setTaskCompleted).toHaveBeenCalledWith(
        "g1",
        "22222222-2222-4222-8222-222222222222",
        true,
      ),
    );
  });

  it("rolls the checkbox back when the update fails", async () => {
    setTaskCompleted.mockRejectedValue(new Error("offline"));
    renderScreen(<TasksPage />);
    const checkbox = await screen.findByRole("checkbox", { name: "Marcar a branch de release" });
    await userEvent.click(checkbox);
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });

  it("filters by owner", async () => {
    renderScreen(<TasksPage />);
    await screen.findByText("Assinar o build");
    await userEvent.click(screen.getByRole("button", { name: /RespawnRita/ }));
    expect(screen.getByText("Assinar o build")).toBeInTheDocument();
    expect(screen.queryByText("Marcar a branch de release")).toBeNull();
  });

  it("asks the API for completed tasks when they are shown", async () => {
    renderScreen(<TasksPage />);
    await screen.findByText("Assinar o build");
    await userEvent.click(screen.getByRole("checkbox", { name: "Mostrar concluídas" }));
    await waitFor(() => expect(listTasks).toHaveBeenLastCalledWith("g1", {}));
  });

  it("says when there is nothing open", async () => {
    listTasks.mockResolvedValue([]);
    renderScreen(<TasksPage />);
    expect(
      await screen.findByRole("heading", { name: "Nenhuma tarefa aberta" }),
    ).toBeInTheDocument();
  });

  it("offers a retry when the tasks fail to load", async () => {
    listTasks.mockRejectedValue(new Error("offline"));
    renderScreen(<TasksPage />);
    expect(
      await screen.findByRole("heading", { name: "Tarefas indisponíveis" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(2));
  });

  it("asks the operator to install the bot when no server has it", () => {
    renderScreen(<TasksPage />, {
      context: dashboardContext({
        guilds: guildSelection({ guilds: [], selectedGuildId: "" }),
      }),
    });
    expect(screen.getByRole("heading", { name: "Nenhum servidor instalado" })).toBeInTheDocument();
  });

  it("groups tasks with no known owner", async () => {
    listTasks.mockResolvedValue([
      aTask({ ownerDisplayName: null, ownerName: null, ownerUserId: null }),
    ]);
    renderScreen(<TasksPage />);
    // The name shows up twice: once on the filter chip, once on the group heading.
    expect(await screen.findAllByText("Sem responsável")).toHaveLength(2);
  });

  it("omits the published-summary helper text", async () => {
    renderScreen(<TasksPage />);
    await screen.findByText("Marcar a branch de release");
    expect(
      screen.queryByText(/Marcar como concluída não altera o resumo publicado no Discord/),
    ).not.toBeInTheDocument();
  });
});
