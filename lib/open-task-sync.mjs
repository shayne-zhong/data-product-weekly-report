function text(value) {
  return String(value || "");
}

function normalizedUsername(value) {
  return text(value).trim().toLowerCase();
}

function visibleTaskFingerprint(task, assignee) {
  return JSON.stringify([
    text(task.title),
    text(task.description),
    assignee.name,
    assignee.username,
    assignee.userId,
    text(task.status),
    text(task.dueDate),
  ]);
}

export function resolveOpenTaskAssignee(task, accounts = [], departmentId) {
  const departmentAccounts = accounts.filter((account) => account.departmentId === departmentId);
  const savedUsername = normalizedUsername(task?.ownerUsername);
  let account = savedUsername
    ? departmentAccounts.find((candidate) => normalizedUsername(candidate.username) === savedUsername) || null
    : null;
  const savedName = text(task?.owner).trim();
  if (!savedUsername && savedName) {
    const matches = departmentAccounts.filter((candidate) => text(candidate.name).trim() === savedName);
    account = matches.length === 1 ? matches[0] : null;
  }
  return {
    name: text(account?.name).trim() || savedName || null,
    username: account ? normalizedUsername(account.username) || null : null,
    userId: text(account?.wecomUserId).trim() || null,
  };
}

export function nextOpenTaskTimestamp(state, now = Date.now()) {
  const wallClockSeconds = Math.max(0, Math.floor(Number(now) / 1000) || 0);
  const previous = Number.isSafeInteger(state.openTaskClock) && state.openTaskClock >= 0 ? state.openTaskClock : 0;
  const next = Math.max(wallClockSeconds, previous + 1);
  state.openTaskClock = next;
  return next;
}

export function reconcileOpenTasks(state, { departmentId, now = Date.now() } = {}) {
  const accounts = state.settings?.accounts || [];
  let changed = false;

  for (const task of Object.values(state.tasks || {})) {
    if (task?.departmentId !== departmentId) continue;
    const assignee = resolveOpenTaskAssignee(task, accounts, departmentId);
    const fingerprint = visibleTaskFingerprint(task, assignee);
    const hasTimestamp = Number.isSafeInteger(task.openUpdatedAt) && task.openUpdatedAt >= 0;
    if (task.openFingerprint === fingerprint && hasTimestamp) continue;
    task.openFingerprint = fingerprint;
    task.openUpdatedAt = nextOpenTaskTimestamp(state, now);
    changed = true;
  }

  return changed;
}

export function projectOpenTask(task, assignee) {
  return {
    task_id: text(task.id),
    title: text(task.title),
    description: text(task.description),
    assignee_name: assignee?.name || null,
    assignee_username: assignee?.username || null,
    assignee_userid: assignee?.userId || null,
    status: text(task.status),
    due_date: text(task.dueDate) || null,
    updated_at: task.openUpdatedAt,
  };
}
