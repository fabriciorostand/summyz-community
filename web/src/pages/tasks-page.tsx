import { SquareCheckBig } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState, ErrorState, LoadingPanel } from "../components/states";
import { Avatar, Badge, Card } from "../components/ui";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { api, type DashboardTask } from "../lib/api";
import { formatDeadline } from "../lib/format";
import { groupByOwner, type OwnerGroup } from "../lib/task-groups";
import { Screen } from "./screen";

/** Rewrites one task's completion in place, leaving the rest of the list untouched. */
function withCompletion(
  tasks: DashboardTask[] | undefined,
  taskId: string,
  completedAt: string | null,
): DashboardTask[] | undefined {
  return tasks?.map((task) => (task.taskId === taskId ? { ...task, completedAt } : task));
}

export function TasksPage() {
  const { controls, guilds, reloadDashboard } = useDashboard();
  const guildId = guilds.selectedGuildId;
  const [tasks, setTasks] = useState<DashboardTask[]>();
  const [loadError, setLoadError] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is the explicit refetch trigger.
  useEffect(() => {
    if (guildId.length === 0) return;
    let active = true;
    setTasks(undefined);
    setLoadError(false);
    void api
      .listTasks(guildId, showCompleted ? {} : { completed: false })
      .then((next) => {
        if (active) setTasks(next);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [guildId, reloadToken, showCompleted]);

  const toggleTask = useCallback(
    async (task: DashboardTask) => {
      const completed = task.completedAt === null;
      const settle = (completedAt: string | null) =>
        setTasks((current) => withCompletion(current, task.taskId, completedAt));
      settle(completed ? new Date().toISOString() : null);
      try {
        await api.setTaskCompleted(guildId, task.taskId, completed);
        reloadDashboard();
      } catch {
        // Put the row back the way the server still sees it.
        settle(task.completedAt);
      }
    },
    [guildId, reloadDashboard],
  );

  const groups = tasks === undefined ? undefined : groupByOwner(tasks);
  const visibleGroups = groups?.filter((group) => ownerFilter === "" || group.key === ownerFilter);
  const openCount = tasks?.filter((task) => task.completedAt === null).length ?? 0;
  const overdueCount =
    tasks?.filter((task) => task.completedAt === null && task.overdue).length ?? 0;

  return (
    <>
      <TopBar
        actions={controls}
        meta={
          tasks === undefined
            ? undefined
            : `${String(openCount)} abertas · ${String(overdueCount)} atrasadas`
        }
        title="Tarefas"
      />
      <Screen>
        <OwnerFilters
          groups={groups}
          onOwnerChange={setOwnerFilter}
          onShowCompletedChange={setShowCompleted}
          openCount={openCount}
          ownerFilter={ownerFilter}
          showCompleted={showCompleted}
        />
        <TasksBody
          failed={loadError || guilds.error}
          hasGuild={guilds.guilds?.length !== 0}
          onRetry={() => setReloadToken((token) => token + 1)}
          onToggle={toggleTask}
          tasks={tasks}
          visibleGroups={visibleGroups}
        />
        <p className="m-0 text-[11.5px] text-ink-dim">
          As tarefas vêm dos resumos gerados pelo pipeline. Marcar como concluída não altera o
          resumo publicado no Discord.
        </p>
      </Screen>
    </>
  );
}

function OwnerFilters({
  groups,
  onOwnerChange,
  onShowCompletedChange,
  openCount,
  ownerFilter,
  showCompleted,
}: {
  groups: OwnerGroup[] | undefined;
  onOwnerChange: (key: string) => void;
  onShowCompletedChange: (value: boolean) => void;
  openCount: number;
  ownerFilter: string;
  showCompleted: boolean;
}) {
  if (groups === undefined || groups.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <OwnerChip
        active={ownerFilter === ""}
        count={openCount}
        label="Todos"
        onClick={() => onOwnerChange("")}
      />
      {groups.map((group) => (
        <OwnerChip
          active={ownerFilter === group.key}
          avatarUrl={group.avatarUrl}
          count={group.openCount}
          key={group.key}
          label={group.name}
          onClick={() => onOwnerChange(group.key)}
        />
      ))}
      <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-secondary">
        <input
          checked={showCompleted}
          className="size-3.5 accent-action"
          onChange={(event) => onShowCompletedChange(event.currentTarget.checked)}
          type="checkbox"
        />
        Mostrar concluídas
      </label>
    </div>
  );
}

function TasksBody({
  failed,
  hasGuild,
  onRetry,
  onToggle,
  tasks,
  visibleGroups,
}: {
  failed: boolean;
  hasGuild: boolean;
  onRetry: () => void;
  onToggle: (task: DashboardTask) => Promise<void>;
  tasks: DashboardTask[] | undefined;
  visibleGroups: OwnerGroup[] | undefined;
}) {
  if (failed) {
    return (
      <ErrorState code="request_failed" onRetry={onRetry} title="Tarefas indisponíveis">
        Não foi possível carregar as tarefas deste servidor.
      </ErrorState>
    );
  }
  if (!hasGuild) {
    return (
      <EmptyState title="Nenhum servidor instalado">
        Instale o Summyz em um servidor para acompanhar as tarefas dos resumos.
      </EmptyState>
    );
  }
  if (tasks === undefined) return <LoadingPanel label="Carregando tarefas…" />;
  if (visibleGroups === undefined || visibleGroups.length === 0) {
    return (
      <EmptyState icon={<SquareCheckBig className="size-5" />} title="Nenhuma tarefa aberta">
        As tarefas aparecem aqui assim que uma call concluída gerar um resumo com responsáveis.
      </EmptyState>
    );
  }
  return (
    <>
      {visibleGroups.map((group) => (
        <OwnerSection group={group} key={group.key} onToggle={onToggle} />
      ))}
    </>
  );
}

function OwnerChip({
  active,
  avatarUrl,
  count,
  label,
  onClick,
}: {
  active: boolean;
  avatarUrl?: string | null;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors ${
        active
          ? "border-action bg-action-soft text-accent"
          : "border-line bg-surface-raised text-ink-secondary hover:text-ink"
      }`}
      onClick={onClick}
      type="button"
    >
      {avatarUrl !== undefined && <Avatar avatarUrl={avatarUrl} name={label} size={18} />}
      {label}
      <span className="font-mono text-[10px] text-ink-dim">{count}</span>
    </button>
  );
}

function OwnerSection({
  group,
  onToggle,
}: {
  group: OwnerGroup;
  onToggle: (task: DashboardTask) => Promise<void>;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2.5">
        <Avatar avatarUrl={group.avatarUrl} name={group.name} size={24} />
        <span className="text-[13.5px] font-medium text-ink">{group.name}</span>
        <span className="label-mono text-ink-muted">{group.openCount} abertas</span>
        {group.overdueCount > 0 && <Badge tone="fail">{group.overdueCount} atrasada</Badge>}
      </div>
      <div className="flex flex-col">
        {group.tasks.map((task) => (
          <TaskRow key={task.taskId} onToggle={onToggle} task={task} />
        ))}
      </div>
    </Card>
  );
}

function TaskRow({
  onToggle,
  task,
}: {
  onToggle: (task: DashboardTask) => Promise<void>;
  task: DashboardTask;
}) {
  const completed = task.completedAt !== null;
  return (
    <div className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
      <input
        aria-label={task.text}
        checked={completed}
        className="size-4 shrink-0 accent-action"
        onChange={() => void onToggle(task)}
        type="checkbox"
      />
      <span
        className={`min-w-0 flex-1 text-[12.5px] ${completed ? "text-ink-dim line-through" : "text-ink"}`}
      >
        {task.text}
      </span>
      <Link
        className="shrink-0 truncate text-[11.5px] text-accent hover:text-accent-hover"
        to={`/history/${task.meetingId}`}
      >
        {task.voiceChannelName ?? task.meetingId}
      </Link>
      <span
        className={`label-mono w-32 shrink-0 text-right ${
          task.overdue && !completed ? "text-fail" : "text-ink-dim"
        }`}
      >
        {formatDeadline(task, task.deadlineTimeZone ?? "America/Sao_Paulo")}
      </span>
    </div>
  );
}
