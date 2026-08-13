import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWeekId,
  buildEmptyTask,
  completedGoalContributionById,
  applyTaskStatus,
  rolloverTasks,
  summarizeTasksForReport,
  taskStatuses,
  weekDisplayLabel,
} from "../lib/task-core.mjs";

test("completed goal contributions sum only completed task links", () => {
  const totals = completedGoalContributionById([
    buildEmptyTask({ status: "已完成", goalLinks: [{ goalId: "g1", contribution: 2 }] }),
    buildEmptyTask({ status: "进行中", goalLinks: [{ goalId: "g1", contribution: 99 }] }),
    buildEmptyTask({ status: "已完成", goalLinks: [{ goalId: "g1", contribution: 3 }, { goalId: "g2", contribution: 4 }] }),
    { status: "已完成", goalLinks: [{ goalId: "g1", contribution: -1 }, { goalId: "", contribution: 8 }] },
  ]);

  assert.deepEqual(totals, { g1: 5, g2: 4 });
});

test("buildWeekId joins ISO start and end dates", () => {
  assert.equal(buildWeekId("2026-06-15", "2026-06-21"), "2026-06-15_2026-06-21");
});

test("task status order and week labels follow PRD rules", () => {
  assert.deepEqual(taskStatuses, ["待开始", "进行中", "阻塞", "已完成"]);
  assert.equal(weekDisplayLabel("2026-06-01"), "6月第1周");
  assert.equal(weekDisplayLabel("2026-06-22"), "6月第4周");
  assert.equal(weekDisplayLabel("2026-06-29"), "6月第5周");
});

test("applyTaskStatus requires blockers and records completion lifecycle", () => {
  const task = buildEmptyTask({ id: "task", status: "进行中", now: 1000 });
  assert.throws(() => applyTaskStatus(task, "阻塞", { now: 2000 }), /阻塞原因/);

  const blocked = applyTaskStatus(task, "阻塞", { blocker: "供应商未排期", now: 2000 });
  assert.equal(blocked.status, "阻塞");
  assert.equal(blocked.blocker, "供应商未排期");

  assert.throws(() => applyTaskStatus(blocked, "已完成", { now: 3000 }), /年度指标/);

  const linked = { ...blocked, goalId: "goal-1", goalContribution: 6 };
  const done = applyTaskStatus(linked, "已完成", { now: 3000 });
  assert.equal(done.status, "已完成");
  assert.equal(done.completedAt, 3000);
  assert.equal(done.carryToNextWeek, false);
  assert.equal(done.goalId, "goal-1");
  assert.equal(done.goalContribution, 6);

  const reopened = applyTaskStatus(done, "进行中", { now: 4000 });
  assert.equal(reopened.completedAt, "");
});

test("rolloverTasks carries only unfinished tasks into the target week", () => {
  const sourceTasks = [
    buildEmptyTask({ id: "done", weekId: "2026-06-08_2026-06-14", title: "已完成", status: "已完成" }),
    buildEmptyTask({ id: "doing", weekId: "2026-06-08_2026-06-14", title: "继续推进", status: "进行中" }),
    buildEmptyTask({ id: "blocked", weekId: "2026-06-08_2026-06-14", title: "存在阻塞", status: "阻塞" }),
    buildEmptyTask({ id: "carry", weekId: "2026-06-08_2026-06-14", title: "显式带入", status: "已完成", carryToNextWeek: true }),
  ];

  const rolled = rolloverTasks(sourceTasks, {
    targetWeekId: "2026-06-15_2026-06-21",
    sourceWeekId: "2026-06-08_2026-06-14",
    now: 1000,
  });

  assert.deepEqual(rolled.map((task) => task.title), ["继续推进", "存在阻塞"]);
  assert.equal(rolled[0].weekId, "2026-06-15_2026-06-21");
  assert.equal(rolled[0].sourceTaskId, "doing");
  assert.equal(rolled[0].sourceWeekId, "2026-06-08_2026-06-14");
  assert.equal(rolled[0].status, "进行中");
});

test("rolloverTasks skips source tasks already carried into the target week", () => {
  const sourceTasks = [
    buildEmptyTask({ id: "doing", weekId: "2026-06-08_2026-06-14", title: "继续推进", status: "进行中" }),
  ];
  const existingTargetTasks = [
    buildEmptyTask({ id: "rolled", weekId: "2026-06-15_2026-06-21", title: "继续推进", sourceTaskId: "doing" }),
  ];

  const rolled = rolloverTasks(sourceTasks, {
    targetWeekId: "2026-06-15_2026-06-21",
    sourceWeekId: "2026-06-08_2026-06-14",
    existingTargetTasks,
    now: 1000,
  });

  assert.deepEqual(rolled, []);
});

test("summarizeTasksForReport maps completed logs, blockers, and unfinished work to report sections", () => {
  const tasks = [
    buildEmptyTask({
      title: "上线移动端看板",
      module: "数据治理与经营分析",
      status: "已完成",
      includeInReport: true,
      dailyLogs: [{ date: "2026-06-17", progress: "完成业务验收并上线" }],
    }),
    buildEmptyTask({
      title: "销售助手优化",
      module: "AI应用项目",
      status: "阻塞",
      blocker: "等待外部团队排期",
      includeInReport: true,
    }),
    buildEmptyTask({
      title: "HR问数Agent",
      module: "数据治理与经营分析",
      status: "进行中",
      includeInReport: true,
      carryToNextWeek: true,
    }),
  ];

  const summary = summarizeTasksForReport(tasks);

  assert.deepEqual(summary.progress["数据治理与经营分析"], ["上线移动端看板：完成业务验收并上线"]);
  assert.deepEqual(summary.risks["AI应用项目"], ["销售助手优化：等待外部团队排期"]);
  assert.deepEqual(summary.next["数据治理与经营分析"], ["HR问数Agent"]);
});
