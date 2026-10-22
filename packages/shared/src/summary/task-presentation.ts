export interface TaskPresentationInput {
  ownerName?: string | null | undefined;
  ownerNames?: readonly string[] | undefined;
  deadlineText?: string | null | undefined;
  deadlineDate?: string | null | undefined;
}

export function taskOwners(task: TaskPresentationInput): readonly string[] {
  return task.ownerNames ?? (task.ownerName == null ? [] : [task.ownerName]);
}

export function formatTaskOwners(task: TaskPresentationInput, language: string): string {
  return new Intl.ListFormat(language).format(taskOwners(task));
}

/** The date is already interpreted in the meeting's zone; never shift it to the browser's zone. */
export function formatTaskDeadline(task: TaskPresentationInput): string | undefined {
  const literal = task.deadlineText ?? undefined;
  if (literal === undefined || task.deadlineDate == null || task.ownerNames === undefined) {
    return literal;
  }
  const [, month, day] = task.deadlineDate.split("-");
  const date = `${day}/${month}`;
  return literal.includes(date) ? literal : `${literal} (${date})`;
}
