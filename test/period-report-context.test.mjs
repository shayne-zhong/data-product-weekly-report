import assert from "node:assert/strict";
import test from "node:test";

import { buildPeriodSnapshot, requiredSummaryPeriods } from "../lib/period-report-context.mjs";

const department = { id: "alpha", name: "研发部" };
const period = { kind: "quarter", year: 2026, part: 3 };

function summary(id, summaryType, startDate, endDate, extra = {}) {
  return {
    id,
    departmentId: "alpha",
    status: "final",
    summaryType,
    data: { startDate, endDate, title: id },
    ...extra,
  };
}

function fixture() {
  return {
    goalsByDepartment: {
      alpha: { year: 2026, rows: [{ id: "goal-1", title: "年度目标" }] },
    },
    reports: {
      jul: summary("jul", "monthly", "2026/07/01", "2026/07/31"),
      aug: summary("aug", "monthly", "2026-08-01", "2026-08-31"),
      sep: summary("sep", "monthly", "2026-09-01", "2026-09-30"),
      q1: summary("q1", "quarterly", "2026-01-01", "2026-03-31"),
      q2: summary("q2", "quarterly", "2026-04-01", "2026-06-30"),
      q3: summary("q3", "quarterly", "2026-07-01", "2026-09-30"),
      q4: summary("q4", "quarterly", "2026-10-01", "2026-12-31"),
      task: { id: "task", departmentId: "alpha", status: "final", summaryType: "task" },
      weekly: summary("weekly", "weekly", "2026-07-01", "2026-07-07"),
    },
  };
}

test("quarter requires its three exact monthly summaries and annual goals", () => {
  const requirements = requiredSummaryPeriods(period);
  assert.deepEqual(
    requirements.map(({ type, start, end }) => [type, start, end]),
    [
      ["monthly", "2026-07-01", "2026-07-31"],
      ["monthly", "2026-08-01", "2026-08-31"],
      ["monthly", "2026-09-01", "2026-09-30"],
    ],
  );

  const snapshot = buildPeriodSnapshot(fixture(), department, period, 123);
  assert.equal(snapshot.sources.filter((source) => source.type === "monthly").length, 3);
  assert.equal(snapshot.sources.filter((source) => source.type === "goals").length, 1);
  assert.equal(snapshot.sources[0].id, "goals-2026");
  assert.equal(
    snapshot.sources.some((source) => ["task", "weekly"].includes(source.type)),
    false,
  );
  assert.equal(snapshot.capturedAt, 123);
  assert.match(snapshot.hash, /^[a-f0-9]{64}$/);
});

test("half-year and annual requirements use only formal quarterly summaries", () => {
  assert.deepEqual(
    requiredSummaryPeriods({ kind: "half", year: 2026, part: 1 }).map(({ type, part }) => [type, part]),
    [
      ["quarterly", 1],
      ["quarterly", 2],
    ],
  );
  assert.deepEqual(
    requiredSummaryPeriods({ kind: "year", year: 2026, part: 1 }).map(({ type, part }) => [type, part]),
    [
      ["quarterly", 1],
      ["quarterly", 2],
      ["quarterly", 3],
      ["quarterly", 4],
    ],
  );
  const snapshot = buildPeriodSnapshot(fixture(), department, { kind: "half", year: 2026, part: 1 });
  assert.equal(snapshot.sources.filter((source) => source.type === "quarterly").length, 2);
});

test("only same-department final exact reports satisfy requirements", () => {
  for (const invalidAugust of [
    summary("aug-draft", "monthly", "2026-08-01", "2026-08-31", { status: "draft" }),
    summary("foreign", "monthly", "2026-08-01", "2026-08-31", { departmentId: "beta" }),
    summary("overlap", "monthly", "2026-07-31", "2026-08-31"),
  ]) {
    const state = fixture();
    state.reports.aug = invalidAugust;
    assert.throws(
      () => buildPeriodSnapshot(state, department, period),
      (error) => error.statusCode === 409 && error.missing.includes("2026年8月月度总结"),
    );
  }
});

test("snapshot sources are frozen copies and annual goals are required", () => {
  const state = fixture();
  const snapshot = buildPeriodSnapshot(state, department, period);
  state.reports.jul.data.title = "已篡改";
  state.goalsByDepartment.alpha.rows[0].title = "已篡改";
  assert.equal(JSON.stringify(snapshot).includes("已篡改"), false);

  state.goalsByDepartment.alpha = { year: 2026, rows: [] };
  assert.throws(
    () => buildPeriodSnapshot(state, department, period),
    (error) => error.statusCode === 409 && error.message.includes("2026年度目标"),
  );
});
