import { SquareCheckBig } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState, ErrorState, LoadingPanel } from "../components/states";
import { Avatar, Badge, Card } from "../components/ui";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { api, type DashboardTask } from "../lib/api";
import { formatDeadline } from "../lib/format";
import { Screen } from "./screen";

interface OwnerGroup {
  avatarUrl: string | null;
  key: string;
  name: string;
  openCount: number;
  overdueCount: number;
  tasks: DashboardTask[];
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
      setTasks((current) =>
        current?.map((item) =>
          item.taskId === task.taskId
            ? { ...item, completedAt: completed ? new Date().toISOString() : null }
            : item,
        ),
      );
      try {
        await api.setTaskCompleted(guildId, task.taskId, completed);
        reloadDashboard();
      } catch {
        // Put the row back the way the server still sees it.
        setTasks((current) =>
          current?.map((item) =>
            item.taskId === task.taskId ? { ...item, completedAt: task.completedAt } : item,
          ),
        );
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
        {groups !== undefined && groups.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <OwnerChip
              active={ownerFilter === ""}
              count={openCount}
              label="Todos"
              onClick={() => setOwnerFilter("")}
            />
            {groups.map((group) => (
              <OwnerChip
                active={ownerFilter === group.key}
                avatarUrl={group.avatarUrl}
                count={group.openCount}
                key={group.key}
                label={group.name}
                onClick={() => setOwnerFilter(group.key)}
              />
            ))}
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-secondary">
              <input
                checked={showCompleted}
                className="size-3.5 accent-action"
                onChange={(event) => setShowCompleted(event.currentTarget.checked)}
                type="checkbox"
              />
              Mostrar concluídas
            </label>
          </div>
        )}
        {loadError || guilds.error ? (
          <ErrorState
            code="request_failed"
            onRetry={() => setReloadToken((token) => token + 1)}
            title="Tarefas indisponíveis"
          >
            Não foi possível carregar as tarefas deste servidor.
          </ErrorState>
        ) : guilds.guilds?.length === 0 ? (
          <EmptyState title="Nenhum servidor instalado">
            Instale o Summyz em um servidor para acompanhar as tarefas dos resumos.
          </EmptyState>
        ) : tasks === undefined ? (
          <LoadingPanel label="Carregando tarefas…" />
        ) : visibleGroups === undefined || visibleGroups.length === 0 ? (
          <EmptyState icon={<SquareCheckBig className="size-5" />} title="Nenhuma tarefa aberta">
            As tarefas aparecem aqui assim que uma call concluída gerar um resumo com responsáveis.
          </EmptyState>
        ) : (
          visibleGroups.map((group) => (
            <OwnerSection group={group} key={group.key} onToggle={toggleTask} />
          ))
        )}
        <p className="m-0 text-[11.5px] text-ink-dim">
          As tarefas vêm dos resumos gerados pelo pipeline. Marcar como concluída não altera o
          resumo publicado no Discord.
        </p>
      </Screen>
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

/** Groups by the Discord user when known, falling back to the name the summary extracted. */
function groupByOwner(tasks: readonly DashboardTask[]): OwnerGroup[] {
  const groups = new Map<string, OwnerGroup>();
  for (const task of tasks) {
    const name = task.ownerDisplayName ?? task.ownerName ?? "Sem responsável";
    const key = task.ownerUserId ?? name;
    const group = groups.get(key) ?? {
      avatarUrl: task.ownerAvatarUrl,
      key,
      name,
      openCount: 0,
      overdueCount: 0,
      tasks: [],
    };
    group.tasks.push(task);
    if (task.completedAt === null) {
      group.openCount += 1;
      if (task.overdue) group.overdueCount += 1;
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.openCount - left.openCount);
}
