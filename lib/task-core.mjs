export const taskStatuses = ["待开始", "进行中", "阻塞", "已完成"];
export const defaultTaskModule = "数据治理与经营分析";
export const defaultReportModules = ["AI+X项目", "AI应用项目", "数据治理与经营分析", "财经共享"];

export function weekOfMonthByMonday(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 1;
  const month = date.getMonth();
  const year = date.getFullYear();
  const firstDay = new Date(year, month, 1);
  const firstDayNumber = firstDay.getDay() || 7;
  const firstMondayDate = firstDayNumber === 1 ? 1 : 9 - firstDayNumber;
  const day = date.getDate();
  if (day < firstMondayDate) return 1;
  return Math.floor((day - firstMondayDate) / 7) + 1;
}

export function weekDisplayLabel(startDate) {
  if (!startDate) return "本周";
  const [, month] = String(startDate).split("-");
  return `${Number(month)}月第${weekOfMonthByMonday(startDate)}周`;
}

export function buildWeekId(startDate, endDate) {
  return `${startDate}_${endDate}`;
}

export function normalizeTaskGoalLinks(overrides = {}) {
  const goalLinks = Array.isArray(overrides.goalLinks)
    ? overrides.goalLinks.slice(0, 3).map((link) => ({
      goalId: String(link.goalId || ""),
      contribution: Number.isFinite(Number(link.contribution)) ? Math.max(0, Number(link.contribution)) : 0,
      unit: String(link.unit || ""),
      note: String(link.note || ""),
    }))
    : [];
  if (!goalLinks.length && overrides.goalId) {
    goalLinks.push({
      goalId: String(overrides.goalId || ""),
      contribution: Number.isFinite(Number(overrides.goalContribution)) ? Math.max(0, Number(overrides.goalContribution)) : 0,
      unit: String(overrides.goalContributionUnit || ""),
      note: String(overrides.goalContributionNote || ""),
    });
  }
  return goalLinks;
}

export function completedGoalContributionById(tasks = []) {
  const totals = {};
  for (const task of tasks) {
    if (task?.status !== "已完成") continue;
    for (const link of normalizeTaskGoalLinks(task)) {
      const contribution = Number(link.contribution);
      if (!link.goalId || !Number.isFinite(contribution) || contribution <= 0) continue;
      totals[link.goalId] = (totals[link.goalId] || 0) + contribution;
    }
  }
  return totals;
}

export function buildEmptyTask(overrides = {}) {
  const now = overrides.now || Date.now();
  return {
    id: overrides.id || `task_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    weekId: overrides.weekId || "",
    title: overrides.title || "",
    module: overrides.module || defaultTaskModule,
    owner: overrides.owner || "",
    progress: Number.isFinite(Number(overrides.progress)) ? Math.max(0, Math.min(100, Math.round(Number(overrides.progress)))) : 0,
    description: overrides.description || "",
    priority: overrides.priority || "重要不紧急",
    status: taskStatuses.includes(overrides.status) ? overrides.status : "待开始",
    dueDate: overrides.dueDate || "",
    includeInReport: overrides.includeInReport ?? true,
    carryToNextWeek: overrides.carryToNextWeek ?? false,
    blocker: overrides.blocker || "",
    goalId: overrides.goalId || "",
    goalContribution: Number.isFinite(Number(overrides.goalContribution)) ? Math.max(0, Number(overrides.goalContribution)) : 0,
    goalLinks: normalizeTaskGoalLinks(overrides),
    goalContributionNote: overrides.goalContributionNote || "",
    completedAt: overrides.completedAt || "",
    sourceTaskId: overrides.sourceTaskId || "",
    sourceWeekId: overrides.sourceWeekId || "",
    dailyLogs: overrides.dailyLogs || [],
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

export function applyTaskStatus(task, nextStatus, { blocker = "", now = Date.now() } = {}) {
  if (!taskStatuses.includes(nextStatus)) throw new Error("无效任务状态");
  if (nextStatus === "阻塞" && !String(blocker || task.blocker || "").trim()) {
    throw new Error("进入阻塞状态必须填写阻塞原因");
  }
  const goalLinks = Array.isArray(task.goalLinks) && task.goalLinks.length
    ? task.goalLinks
    : (task.goalId ? [{ goalId: task.goalId, contribution: task.goalContribution }] : []);
  const validGoalLinks = goalLinks.filter((link) => link.goalId && Number(link.contribution) > 0);
  if (nextStatus === "已完成" && !validGoalLinks.length) {
    throw new Error("完成任务前必须关联年度指标并填写贡献数");
  }
  const patch = {
    status: nextStatus,
    updatedAt: now,
  };
  if (nextStatus === "阻塞") patch.blocker = String(blocker || task.blocker || "").trim();
  if (nextStatus === "已完成") {
    patch.completedAt = task.completedAt || now;
    patch.carryToNextWeek = false;
    patch.progress = 100;
  }
  if (task.status === "已完成" && nextStatus !== "已完成") patch.completedAt = "";
  return { ...task, ...patch };
}

export function shouldRolloverTask(task) {
  return task.status !== "已完成";
}

export function rolloverTasks(tasks, { targetWeekId, sourceWeekId, existingTargetTasks = [], now = Date.now(), idFactory = null }) {
  const carriedSourceIds = new Set(existingTargetTasks.map((task) => task.sourceTaskId).filter(Boolean));
  return tasks.filter((task) => shouldRolloverTask(task) && !carriedSourceIds.has(task.id)).map((task, index) => ({
    ...buildEmptyTask({
      ...task,
      id: idFactory ? idFactory(task, index) : `task_${now.toString(36)}_${index}`,
      weekId: targetWeekId,
      status: task.status,
      sourceTaskId: task.id,
      sourceWeekId,
      createdAt: now,
      updatedAt: now,
    }),
    dailyLogs: [],
  }));
}

function latestProgress(task) {
  const logs = [...(task.dailyLogs || [])].filter((log) => log.progress?.trim());
  return logs.at(-1)?.progress?.trim() || "";
}

function normalizeModules(modules = defaultReportModules) {
  const rows = (Array.isArray(modules) ? modules : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return rows.length ? [...new Set(rows)] : defaultReportModules;
}

function pushGrouped(target, moduleName, line, modules) {
  const orderedModules = normalizeModules(modules);
  const key = orderedModules.includes(moduleName) ? moduleName : orderedModules[0];
  if (!target[key]) target[key] = [];
  target[key].push(line);
}

export function summarizeTasksForReport(tasks, { modules = defaultReportModules } = {}) {
  const summary = { progress: {}, risks: {}, next: {} };

  tasks.filter((task) => task.includeInReport !== false).forEach((task) => {
    if (task.status === "已完成") {
      const progress = latestProgress(task);
      pushGrouped(summary.progress, task.module, progress ? `${task.title}：${progress}` : task.title, modules);
      return;
    }

    if (task.status === "阻塞" || task.blocker) {
      pushGrouped(summary.risks, task.module, task.blocker ? `${task.title}：${task.blocker}` : task.title, modules);
    }

    if (task.status !== "已完成" || task.carryToNextWeek) {
      pushGrouped(summary.next, task.module, task.title, modules);
    }
  });

  return summary;
}
