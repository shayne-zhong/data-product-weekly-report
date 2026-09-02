import test from "node:test";
import assert from "node:assert/strict";

import {
  archiveDueReports,
  completeReportArchiveExecution,
  defaultReportArchiveSchedule,
  failReportArchiveExecution,
  normalizeReportArchiveSchedule,
  reportArchiveTaskSummary,
  startReportArchiveExecution,
} from "../lib/report-auto-archive.mjs";

test("report archive schedule defaults to 20:00 Asia/Shanghai", () => {
  assert.deepEqual(defaultReportArchiveSchedule(), {
    timezone: "Asia/Shanghai",
    weeklyTime: "20:00",
    monthlyTime: "20:00",
    quarterlyTime: "20:00",
  });
  assert.deepEqual(normalizeReportArchiveSchedule({ weeklyTime: "09:30", monthlyTime: "bad" }), {
    timezone: "Asia/Shanghai",
    weeklyTime: "09:30",
    monthlyTime: "20:00",
    quarterlyTime: "20:00",
  });
});

test("archives due reports at their configured Beijing time and is idempotent", () => {
  const state = {
    reports: {
      weekly: {
        id: "weekly",
        departmentId: "d1",
        summaryType: "weekly",
        status: "editing",
        data: { endDate: "2026/08/23" },
      },
      monthly: {
        id: "monthly",
        departmentId: "d1",
        summaryType: "monthly",
        status: "draft",
        data: { endDate: "2026/08/31" },
      },
    },
    settings: { reportArchive: defaultReportArchiveSchedule() },
  };

  const before = archiveDueReports(state, { triggeredAt: Date.parse("2026-08-23T11:59:00Z") });
  assert.equal(before.archivedCount, 0);
  const due = archiveDueReports(state, { triggeredAt: Date.parse("2026-08-23T12:00:00Z") });
  assert.deepEqual(due.archivedReportIds, ["weekly"]);
  assert.equal(state.reports.weekly.status, "final");
  assert.equal(state.reports.monthly.status, "draft");
  assert.equal(archiveDueReports(state, { triggeredAt: Date.parse("2026-08-23T12:05:00Z") }).archivedCount, 0);
});

test("late execution compensates after month and quarter end without creating reports", () => {
  const state = {
    reports: {
      month: {
        id: "month",
        departmentId: "d1",
        summaryType: "monthly",
        status: "draft",
        data: { endDate: "2026-06-30" },
      },
      quarter: {
        id: "quarter",
        departmentId: "d1",
        summaryType: "quarterly",
        status: "editing",
        data: { endDate: "2026-06-30" },
      },
    },
    settings: { reportArchive: { monthlyTime: "21:00", quarterlyTime: "20:00" } },
  };
  const result = archiveDueReports(state, { triggeredAt: Date.parse("2026-07-01T01:00:00Z") });
  assert.deepEqual(result.archivedReportIds.sort(), ["month", "quarter"]);
  assert.equal(Object.keys(state.reports).length, 2);
});

test("ignores reports whose end date is not the required Sunday, month end, or quarter end", () => {
  const state = {
    reports: {
      weekly: { id: "weekly", summaryType: "weekly", status: "draft", data: { endDate: "2026-08-22" } },
      monthly: { id: "monthly", summaryType: "monthly", status: "draft", data: { endDate: "2026-08-30" } },
      quarterly: { id: "quarterly", summaryType: "quarterly", status: "draft", data: { endDate: "2026-08-31" } },
    },
    settings: {},
  };
  assert.equal(archiveDueReports(state, { triggeredAt: Date.parse("2026-09-01T00:00:00Z") }).archivedCount, 0);
});

test("report archive execution records running success and a safe summary", () => {
  const state = { settings: { reportArchive: defaultReportArchiveSchedule() } };
  startReportArchiveExecution(state, { now: 1000, trigger: "manual:admin" });
  assert.equal(reportArchiveTaskSummary(state, { now: 1001 }).status, "running");

  completeReportArchiveExecution(state, { now: 2000, result: { archivedCount: 2 } });
  const summary = reportArchiveTaskSummary(state, { now: 2001 });
  assert.equal(summary.id, "report-auto-archive");
  assert.equal(summary.status, "success");
  assert.equal(summary.trigger, "manual:admin");
  assert.equal(summary.archivedCount, 2);
  assert.match(summary.schedule, /周日 20:00.*月末 20:00.*季末 20:00/);
});

test("report archive execution truncates errors and expires stale running state", () => {
  const state = { settings: {}, reportArchiveExecution: { status: "running", startedAt: 1000, trigger: "scheduled" } };
  assert.equal(reportArchiveTaskSummary(state, { now: 1000 + 16 * 60 * 1000 }).status, "failed");

  failReportArchiveExecution(state, { now: 3000, error: new Error("x".repeat(500)) });
  const summary = reportArchiveTaskSummary(state, { now: 3001 });
  assert.equal(summary.status, "failed");
  assert.ok(summary.error.length <= 200);
});
