import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  archiveDueReports,
  completeReportArchiveExecution,
  defaultReportArchiveSchedule,
  failReportArchiveExecution,
  normalizeReportArchiveSchedule,
  reportArchiveTaskSummary,
  startReportArchiveExecution,
} from "../lib/report-auto-archive.mjs";

const reportUiSource = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const reportApiSource = readFileSync(new URL("../api/[...path].mjs", import.meta.url), "utf8");

test("half-year and annual summaries use explicit structured templates across UI and API", () => {
  assert.match(reportUiSource, /<option value="half">半年总结<\/option>/);
  assert.match(reportUiSource, /<option value="year">年度总结<\/option>/);
  assert.match(reportUiSource, /\["上年度目标", "上年度进展", "下半年计划"\]/);
  assert.match(reportUiSource, /\["年度目标", "年度总结", "差距与分析", "明年计划"\]/);
  for (const id of ["adminHalfArchiveTime", "adminYearArchiveTime"]) {
    assert.match(reportUiSource, new RegExp(`id="${id}"`));
  }
  assert.match(reportApiSource, /\["weekly", "monthly", "quarterly", "half", "year"\]/);
});

test("report archive schedule defaults to 20:00 Asia/Shanghai", () => {
  assert.deepEqual(defaultReportArchiveSchedule(), {
    timezone: "Asia/Shanghai",
    weeklyTime: "20:00",
    monthlyTime: "20:00",
    quarterlyTime: "20:00",
    halfTime: "20:00",
    yearTime: "20:00",
  });
  assert.deepEqual(normalizeReportArchiveSchedule({ weeklyTime: "09:30", monthlyTime: "bad" }), {
    timezone: "Asia/Shanghai",
    weeklyTime: "09:30",
    monthlyTime: "20:00",
    quarterlyTime: "20:00",
    halfTime: "20:00",
    yearTime: "20:00",
  });
});

test("archives due half-year and annual summaries and reports per-type counts", () => {
  const state = {
    reports: {
      half: { id: "half", departmentId: "d1", summaryType: "half", status: "draft", data: { endDate: "2026-06-30" } },
      year: { id: "year", departmentId: "d1", summaryType: "year", status: "editing", data: { endDate: "2026-12-31" } },
      futureYear: { id: "futureYear", departmentId: "d1", summaryType: "year", status: "draft", data: { endDate: "2027-12-31" } },
      finalHalf: { id: "finalHalf", departmentId: "d1", summaryType: "half", status: "final", data: { endDate: "2026-06-30" } },
    },
    settings: { reportArchive: { halfTime: "19:30", yearTime: "21:00" } },
  };

  const halfResult = archiveDueReports(state, { triggeredAt: Date.parse("2026-06-30T11:30:00Z") });
  assert.deepEqual(halfResult.archivedReportIds, ["half"]);
  assert.deepEqual(halfResult.typeCounts.half, { checked: 2, archived: 1, skipped: 1 });
  assert.deepEqual(halfResult.typeCounts.year, { checked: 2, archived: 0, skipped: 2 });

  const yearResult = archiveDueReports(state, { triggeredAt: Date.parse("2026-12-31T13:00:00Z") });
  assert.deepEqual(yearResult.archivedReportIds, ["year"]);
  assert.deepEqual(yearResult.typeCounts.year, { checked: 2, archived: 1, skipped: 1 });
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

  const typeCounts = {
    weekly: { checked: 3, archived: 2, skipped: 1 },
    monthly: { checked: 1, archived: 0, skipped: 1 },
  };
  completeReportArchiveExecution(state, { now: 2000, result: { archivedCount: 2, typeCounts } });
  const summary = reportArchiveTaskSummary(state, { now: 2001 });
  assert.equal(summary.id, "report-auto-archive");
  assert.equal(summary.status, "success");
  assert.equal(summary.trigger, "manual:admin");
  assert.equal(summary.archivedCount, 2);
  assert.deepEqual(summary.typeCounts, typeCounts);
  assert.match(summary.schedule, /周日 20:00.*月末 20:00.*季末 20:00.*半年末 20:00.*年末 20:00/);
});

test("report archive execution truncates errors and expires stale running state", () => {
  const state = { settings: {}, reportArchiveExecution: { status: "running", startedAt: 1000, trigger: "scheduled" } };
  assert.equal(reportArchiveTaskSummary(state, { now: 1000 + 16 * 60 * 1000 }).status, "failed");

  failReportArchiveExecution(state, { now: 3000, error: new Error("x".repeat(500)) });
  const summary = reportArchiveTaskSummary(state, { now: 3001 });
  assert.equal(summary.status, "failed");
  assert.ok(summary.error.length <= 200);
});
