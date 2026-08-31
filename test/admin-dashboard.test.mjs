import test from "node:test";
import assert from "node:assert/strict";

import { buildAdminDashboard } from "../lib/admin-dashboard.mjs";

function baseState() {
  return {
    settings: {
      departments: [
        { id: "d1", name: "一部", enabled: true, leaderUsername: "leader" },
        { id: "d2", name: "二部", enabled: true },
        { id: "d3", name: "停用部", enabled: false },
      ],
      accounts: [
        { username: "leader", departmentId: "d1", role: "department_leader", enabled: true },
        { username: "module", departmentId: "d1", role: "module_leader", enabled: true, managedModules: [] },
        { username: "disabled", departmentId: "d1", role: "member", enabled: false },
        { username: "outside", departmentId: "d2", role: "member", enabled: true },
      ],
    },
    weeks: {},
    tasks: {},
    reports: {},
  };
}

test("empty task scope returns a null completion rate and scoped organization alerts", () => {
  const state = baseState();
  const departmentIds = ["d1"];
  const dashboard = buildAdminDashboard(state, {
    departmentIds,
    periodType: "month",
    anchorDate: "2026-08-15",
  });
  departmentIds.push("d2");

  assert.deepEqual(dashboard.scope.departmentIds, ["d1"]);
  assert.deepEqual(dashboard.metrics.organization, {
    enabledDepartments: 1,
    enabledAccounts: 2,
    disabledAccounts: 1,
    missingLeaderCount: 0,
  });
  assert.deepEqual(dashboard.metrics.tasks, { total: 0, completed: 0, completionRate: null });
  assert.ok(dashboard.alerts.some((alert) => alert.type === "module-scope-missing" && alert.username === "module"));
  assert.ok(!dashboard.alerts.some((alert) => alert.departmentId === "d2"));
});

test("counts only tasks in allowed departments whose weeks overlap a cross-month week period", () => {
  const state = baseState();
  state.weeks = {
    d1current: { id: "w1", departmentId: "d1", startDate: "2026-08-31", endDate: "2026-09-06" },
    d1old: { id: "w0", departmentId: "d1", startDate: "2026-08-24", endDate: "2026-08-30" },
    d2current: { id: "w1", departmentId: "d2", startDate: "2026-08-31", endDate: "2026-09-06" },
  };
  state.tasks = {
    done: { id: "done", departmentId: "d1", weekId: "w1", status: "已完成" },
    open: { id: "open", departmentId: "d1", weekId: "w1", status: "进行中" },
    old: { id: "old", departmentId: "d1", weekId: "w0", status: "已完成" },
    outside: { id: "outside", departmentId: "d2", weekId: "w1", status: "已完成" },
  };

  const dashboard = buildAdminDashboard(state, {
    departmentIds: ["d1"], periodType: "week", anchorDate: "2026-09-02",
  });
  assert.deepEqual(dashboard.metrics.tasks, { total: 2, completed: 1, completionRate: 50 });
});

test("quarter period includes a week overlapping quarter end", () => {
  const state = baseState();
  state.weeks = {
    boundary: { id: "boundary", departmentId: "d1", startDate: "2026-06-29", endDate: "2026-07-05" },
  };
  state.tasks = {
    task: { id: "task", departmentId: "d1", weekId: "boundary", status: "已完成" },
  };
  const dashboard = buildAdminDashboard(state, {
    departmentIds: ["d1"], periodType: "quarter", anchorDate: "2026-04-01",
  });
  assert.deepEqual(dashboard.metrics.tasks, { total: 1, completed: 1, completionRate: 100 });
});

for (const options of [
  { departmentIds: ["d1"], periodType: "year", anchorDate: "2026-08-01" },
  { departmentIds: ["d1"], periodType: "month", anchorDate: "2026-02-30" },
  { departmentIds: ["d1"], periodType: "week", anchorDate: "2026-8-01" },
]) {
  test(`rejects invalid statistics period ${JSON.stringify(options)}`, () => {
    assert.throws(
      () => buildAdminDashboard(baseState(), options),
      (error) => error?.statusCode === 400 && error.message === "统计周期无效",
    );
  });
}

test("reports due for archive are scoped and surfaced as alerts without mutation", () => {
  const state = baseState();
  state.reports = {
    due: { id: "due", departmentId: "d1", summaryType: "monthly", status: "draft", data: { endDate: "2026-08-31" } },
    outside: { id: "outside", departmentId: "d2", summaryType: "monthly", status: "draft", data: { endDate: "2026-08-31" } },
  };
  const before = structuredClone(state);
  const dashboard = buildAdminDashboard(state, {
    departmentIds: ["d1"], periodType: "month", anchorDate: "2026-08-31", now: Date.parse("2026-08-31T12:00:00Z"),
  });
  assert.equal(dashboard.metrics.reports.dueUnarchived, 1);
  assert.ok(dashboard.alerts.some((alert) => alert.type === "report-archive-due" && alert.reportId === "due"));
  assert.deepEqual(state, before);
});
