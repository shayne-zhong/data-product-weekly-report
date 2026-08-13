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
