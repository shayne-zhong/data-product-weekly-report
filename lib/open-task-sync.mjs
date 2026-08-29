function text(value) {
  return String(value || "");
}

function normalizedUsername(value) {
  return text(value).trim().toLowerCase();
}

function accountKey(departmentId, username) {
  return `${text(departmentId)}\0${normalizedUsername(username)}`;
}

function visibleTaskFingerprint(task, account) {
  return JSON.stringify([
    text(task.title),
    text(task.description),
    normalizedUsername(task.ownerUsername),
    text(task.status),
    text(task.dueDate),
    text(account?.wecomUserId).trim() || null,
  ]);
}

export function nextOpenTaskTimestamp(state, now = Date.now()) {
  const wallClockSeconds = Math.max(0, Math.floor(Number(now) / 1000) || 0);
  const previous = Number.isSafeInteger(state.openTaskClock) && state.openTaskClock >= 0
    ? state.openTaskClock
    : 0;
  const next = Math.max(wallClockSeconds, previous + 1);
  state.openTaskClock = next;
  return next;
}

export function reconcileOpenTasks(state, { departmentId, now = Date.now() } = {}) {
  const accounts = new Map(
    (state.settings?.accounts || []).map((account) => [accountKey(account.departmentId, account.username), account]),
  );
  let changed = false;

  for (const task of Object.values(state.tasks || {})) {
    if (task?.departmentId !== departmentId) continue;
    const account = accounts.get(accountKey(departmentId, task.ownerUsername));
    const fingerprint = visibleTaskFingerprint(task, account);
    const hasTimestamp = Number.isSafeInteger(task.openUpdatedAt) && task.openUpdatedAt >= 0;
    if (task.openFingerprint === fingerprint && hasTimestamp) continue;
    task.openFingerprint = fingerprint;
    task.openUpdatedAt = nextOpenTaskTimestamp(state, now);
    changed = true;
  }

  return changed;
}

export function projectOpenTask(task, account) {
  return {
    task_id: text(task.id),
    title: text(task.title),
    description: text(task.description),
    assignee_userid: text(account?.wecomUserId).trim() || null,
    status: text(task.status),
    due_date: text(task.dueDate) || null,
    updated_at: task.openUpdatedAt,
  };
}
