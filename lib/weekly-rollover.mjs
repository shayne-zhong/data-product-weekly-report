import { buildWeekId, rolloverTasks } from "./task-core.mjs";

const chinaOffsetMs = 8 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

function isoDateFromChinaDay(timestamp) {
  return new Date(timestamp + chinaOffsetMs).toISOString().slice(0, 10);
}

export function weeklyRolloverWindow(now = Date.now()) {
  const chinaNow = new Date(now + chinaOffsetMs);
  const daysSinceMonday = (chinaNow.getUTCDay() + 6) % 7;
  const targetStartTimestamp =
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate()) -
    chinaOffsetMs -
    daysSinceMonday * dayMs;
  const sourceStartTimestamp = targetStartTimestamp - 7 * dayMs;
  const sourceEndTimestamp = targetStartTimestamp - dayMs;
  const targetEndTimestamp = targetStartTimestamp + 6 * dayMs;
  const sourceStartDate = isoDateFromChinaDay(sourceStartTimestamp);
  const sourceEndDate = isoDateFromChinaDay(sourceEndTimestamp);
  const targetStartDate = isoDateFromChinaDay(targetStartTimestamp);
  const targetEndDate = isoDateFromChinaDay(targetEndTimestamp);
  return {
    sourceStartDate,
    sourceEndDate,
    sourceWeekId: buildWeekId(sourceStartDate, sourceEndDate),
    targetStartDate,
    targetEndDate,
    targetWeekId: buildWeekId(targetStartDate, targetEndDate),
  };
}

export function applyWeeklyRollover(state, { now = Date.now() } = {}) {
  const window = weeklyRolloverWindow(now);
  const departments = (state.settings?.departments || []).filter((department) => department.enabled !== false);
  state.tasks ||= {};
  state.weeks ||= {};
  state.weeklyRolloverRuns ||= {};
  const results = [];

  for (const department of departments) {
    const runKey = `${department.id}:${window.sourceWeekId}:${window.targetWeekId}`;
    if (state.weeklyRolloverRuns[runKey]?.status === "completed") {
      results.push({ departmentId: department.id, alreadyProcessed: true, rolledTaskCount: 0 });
      continue;
    }
    const targetWeekKey = `${department.id}:${window.targetWeekId}`;
    state.weeks[targetWeekKey] ||= {
      id: window.targetWeekId,
      departmentId: department.id,
      startDate: window.targetStartDate,
      endDate: window.targetEndDate,
      createdAt: now,
      updatedAt: now,
      createdBy: { username: "system:weekly-rollover", departmentId: department.id },
      updatedBy: { username: "system:weekly-rollover", departmentId: department.id },
    };
    const departmentTasks = Object.values(state.tasks).filter((task) => task.departmentId === department.id);
    const sourceTasks = departmentTasks.filter((task) => task.weekId === window.sourceWeekId);
    const existingTargetTasks = departmentTasks.filter((task) => task.weekId === window.targetWeekId);
    const rolled = rolloverTasks(sourceTasks, {
      sourceWeekId: window.sourceWeekId,
      targetWeekId: window.targetWeekId,
      existingTargetTasks,
      now,
      idFactory: (task) => `task_roll_${window.targetStartDate.replaceAll("-", "")}_${task.id}`,
    });
    for (const task of rolled) {
      task.departmentId = department.id;
      task.createdBy = { username: "system:weekly-rollover", departmentId: department.id };
      task.updatedBy = task.createdBy;
      state.tasks[task.id] = task;
    }
    state.weeklyRolloverRuns[runKey] = {
      status: "completed",
      departmentId: department.id,
      sourceWeekId: window.sourceWeekId,
      targetWeekId: window.targetWeekId,
      rolledTaskCount: rolled.length,
      completedAt: now,
    };
    results.push({ departmentId: department.id, alreadyProcessed: false, rolledTaskCount: rolled.length });
  }

  return {
    changed: results.some((result) => !result.alreadyProcessed),
    rolledTaskCount: results.reduce((sum, result) => sum + result.rolledTaskCount, 0),
    window,
    departments: results,
  };
}

const weeklyRolloverTaskId = "weekly-task-rollover";

function scheduledAtForWindow(window) {
  return Date.parse(`${window.targetStartDate}T00:05:00+08:00`);
}

function weeklyRolloverExecutionBucket(state) {
  state.scheduledTaskExecutions ||= {};
  return state.scheduledTaskExecutions;
}

export function startWeeklyRolloverExecution(state, { now = Date.now(), trigger = "scheduled" } = {}) {
  const window = weeklyRolloverWindow(now);
  const execution = {
    taskId: weeklyRolloverTaskId,
    taskName: "周任务定时结转",
    status: "running",
    trigger,
    startedAt: now,
    finishedAt: 0,
    sourceWeekId: window.sourceWeekId,
    targetWeekId: window.targetWeekId,
    rolledTaskCount: 0,
    error: "",
  };
  weeklyRolloverExecutionBucket(state)[weeklyRolloverTaskId] = execution;
  return execution;
}

export function completeWeeklyRolloverExecution(state, result, { now = Date.now() } = {}) {
  const bucket = weeklyRolloverExecutionBucket(state);
  const current = bucket[weeklyRolloverTaskId] || startWeeklyRolloverExecution(state, { now });
  bucket[weeklyRolloverTaskId] = {
    ...current,
    status: "success",
    finishedAt: now,
    rolledTaskCount: Number(result?.rolledTaskCount || 0),
    error: "",
  };
  return bucket[weeklyRolloverTaskId];
}

export function failWeeklyRolloverExecution(state, error, { now = Date.now() } = {}) {
  const bucket = weeklyRolloverExecutionBucket(state);
  const current = bucket[weeklyRolloverTaskId] || startWeeklyRolloverExecution(state, { now });
  bucket[weeklyRolloverTaskId] = {
    ...current,
    status: "failed",
    finishedAt: now,
    error: String(error?.message || error || "执行失败")
      .replace(/\s+/g, " ")
      .slice(0, 300),
  };
  return bucket[weeklyRolloverTaskId];
}

export function weeklyRolloverTaskSummary(state, { now = Date.now() } = {}) {
  const window = weeklyRolloverWindow(now);
  const departments = (state.settings?.departments || []).filter((department) => department.enabled !== false);
  const currentRuns = departments.map(
    (department) => state.weeklyRolloverRuns?.[`${department.id}:${window.sourceWeekId}:${window.targetWeekId}`],
  );
  const completedRuns = currentRuns.filter((run) => run?.status === "completed");
  const execution = state.scheduledTaskExecutions?.[weeklyRolloverTaskId] || null;
  const currentExecution = execution?.targetWeekId === window.targetWeekId ? execution : null;
  const allDepartmentsCompleted = departments.length > 0 && completedRuns.length === departments.length;
  const scheduledAt = scheduledAtForWindow(window);
  let status = currentExecution?.status || "never";
  let error = currentExecution?.error || "";
  if (status === "running" && now - Number(currentExecution?.startedAt || now) > 10 * 60 * 1000) {
    status = "failed";
    error = "执行超过 10 分钟仍未完成，请检查服务状态后重新启动";
  }
  if (allDepartmentsCompleted && (!currentExecution || status === "success")) status = "success";
  if (!allDepartmentsCompleted && !currentExecution && now >= scheduledAt) {
    status = "failed";
    error = "计划时间已过，但未检测到本周执行记录";
  }
  const completedAt = Math.max(0, ...completedRuns.map((run) => Number(run.completedAt || 0)));
  return {
    id: weeklyRolloverTaskId,
    name: "周任务定时结转",
    schedule: "每周一 00:05（北京时间）",
    scheduledAt,
    status,
    trigger: currentExecution?.trigger || "scheduled",
    startedAt: currentExecution?.startedAt || 0,
    finishedAt: currentExecution?.finishedAt || completedAt,
    sourceWeekId: window.sourceWeekId,
    targetWeekId: window.targetWeekId,
    rolledTaskCount: allDepartmentsCompleted
      ? completedRuns.reduce((sum, run) => sum + Number(run.rolledTaskCount || 0), 0)
      : Number(currentExecution?.rolledTaskCount || 0),
    completedDepartmentCount: completedRuns.length,
    departmentCount: departments.length,
    error,
  };
}
