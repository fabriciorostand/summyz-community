import type { DashboardTask } from "./api";

export interface OwnerGroup {
  avatarUrl: string | null;
  key: string;
  name: string;
  openCount: number;
  overdueCount: number;
  tasks: DashboardTask[];
}

/** Identifies the owner by Discord user when known, falling back to the extracted name. */
function startGroup(task: DashboardTask, noOwner: string, language: string): OwnerGroup {
  if (task.ownerNames !== undefined && task.ownerNames.length !== 1) {
    const owners = [...task.ownerNames].sort((left, right) => left.localeCompare(right));
    return {
      avatarUrl: null,
      key: owners.length === 0 ? noOwner : `owners:${JSON.stringify(owners)}`,
      name: owners.length === 0 ? noOwner : new Intl.ListFormat(language).format(owners),
      openCount: 0,
      overdueCount: 0,
      tasks: [],
    };
  }
  const name = task.ownerDisplayName ?? task.ownerNames?.[0] ?? task.ownerName ?? noOwner;
  return {
    avatarUrl: task.ownerAvatarUrl,
    key: task.ownerUserId ?? name,
    name,
    openCount: 0,
    overdueCount: 0,
    tasks: [],
  };
}

function addTask(group: OwnerGroup, task: DashboardTask): void {
  group.tasks.push(task);
  if (task.completedAt !== null) return;
  group.openCount += 1;
  if (task.overdue) group.overdueCount += 1;
}

/** Groups tasks by owner, busiest owner first, the way both task views present them. */
export function groupByOwner(
  tasks: readonly DashboardTask[],
  noOwner: string,
  language = "pt-BR",
): OwnerGroup[] {
  const groups = new Map<string, OwnerGroup>();
  for (const task of tasks) {
    const started = startGroup(task, noOwner, language);
    const group = groups.get(started.key) ?? started;
    addTask(group, task);
    groups.set(group.key, group);
  }
  return [...groups.values()].sort((left, right) => right.openCount - left.openCount);
}
