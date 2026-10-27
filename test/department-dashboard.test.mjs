import test from "node:test";
import assert from "node:assert/strict";
import {
  DASHBOARD_METRICS,
  resolveDashboardContext,
  previewDashboardImport,
  commitDashboardImport,
  buildDepartmentDashboard,
} from "../lib/department-dashboard.mjs";
const NOW = Date.parse("2026-10-26T08:00:00Z");
const admin = { role: "admin" };
const leader = { role: "leader", departmentId: "a" };
function state() {
  return {
    settings: {
      departments: [
        { id: "a", name: "甲部门", enabled: true },
        { id: "b", name: "乙部门", enabled: true },
      ],
      accounts: [
        { username: "alice", name: "同名", departmentId: "a", enabled: true, role: "member", passwordHash: "SECRET" },
        { username: "amy", name: "同名", departmentId: "a", enabled: true },
        { username: "bob", name: "乙员工", departmentId: "b", enabled: true },
      ],
    },
    weeks: {
      "a:w": { id: "w", departmentId: "a", startDate: "2026-01-05", endDate: "2026-01-11" },
      "b:w": { id: "w", departmentId: "b", startDate: "2026-01-05", endDate: "2026-01-11" },
    },
    tasks: {
      t: {
        id: "t",
        departmentId: "a",
        weekId: "w",
        title: "完成工作",
        status: "已完成",
        ownerUsername: "alice",
        module: "数据",
        dueDate: "2026-01-08",
        goalLinks: [{ goalId: "g", contribution: 3 }],
      },
      amb: {
        id: "amb",
        departmentId: "a",
        weekId: "w",
        title: "未明确负责人",
        owner: "同名",
        status: "阻塞",
        dueDate: "2026-01-09",
        blocker: "需要依赖",
      },
      other: { id: "other", departmentId: "b", weekId: "w", title: "OTHER SECRET", status: "已完成" },
    },
    goalsByDepartment: {
      a: {
        year: "2026",
        rows: [
          {
            id: "g",
            title: "年度指标",
            current: 999,
            expectedCurrent: "5",
            annualTarget: "10",
            artifact: { secret: "SECRET" },
          },
        ],
      },
    },
  };
}
function doc(patch = {}) {
  return {
    schemaVersion: 1,
    batchId: "batch1",
    departmentId: "a",
    sourceId: "bi",
    sourceName: "报表平台",
    asOf: "2026-10-26T15:00:00+08:00",
    records: [
      {
        metric: "report_visits",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        value: 0,
        unit: "count",
        coverage: "complete",
      },
    ],
    ...patch,
  };
}
function commit(s, d = doc(), actor = admin) {
  const p = previewDashboardImport(s, actor, { departmentId: d.departmentId, document: d }, NOW);
  return commitDashboardImport(
    s,
    actor,
    { departmentId: d.departmentId, document: p.document, previewHash: p.previewHash, expectedRevision: p.revision },
    NOW,
  );
}
const reject = (fn, status = 422) => assert.throws(fn, (e) => e.statusCode === status && typeof e.code === "string");
test("catalog, tenant isolation, Beijing dates and explicit future months", () => {
  const s = state();
  assert.equal(DASHBOARD_METRICS.length, 19);
  assert.equal(resolveDashboardContext(s, admin, {}, Date.parse("2026-10-25T17:00:00Z")).endDate, "2026-10-26");
  assert.equal(resolveDashboardContext(s, leader, { year: 2026, period: "m12" }, NOW).endDate, "2026-12-31");
  reject(() => resolveDashboardContext(s, leader, { departmentId: "b" }, NOW), 403);
  reject(() => resolveDashboardContext(s, admin, { departmentId: "missing" }, NOW), 404);
  reject(() => resolveDashboardContext(s, { role: "member", departmentId: "a" }, {}, NOW), 403);
  reject(() => resolveDashboardContext(s, admin, { year: 1 }, NOW), 400);
});
test("empty external values stay missing, operation and people scopes are safe", () => {
  const s = state();
  const r = buildDepartmentDashboard(s, leader, { period: "m01", year: 2026 }, NOW);
  assert.equal(r.metrics.find((x) => x.id === "report_visits").value, null);
  assert.equal(r.operations.tasks, 2);
  assert.equal(r.operations.completedTasks, 1);
  assert.equal(r.operations.unassignedTasks, 1);
  assert.equal(r.people[0].tasks, 1);
  assert.equal(r.people[0].keyTaskRate, null);
  assert.equal(r.goals[0].current, 3);
  assert.equal(s.goalsByDepartment.a.rows[0].current, 999);
  assert.match(r.goals[0].scopeNote, /不按/);
  assert.doesNotMatch(JSON.stringify(r), /SECRET|OTHER/);
  assert.equal(buildDepartmentDashboard(s, leader, { period: "m02", year: 2026 }, NOW).operations.tasks, 0);
});
test("preview is immutable and canonical, commit is durable and idempotent", () => {
  const s = state(),
    before = structuredClone(s);
  const p = previewDashboardImport(s, admin, { departmentId: "a", document: doc() }, NOW);
  assert.deepEqual(s, before);
  assert.equal(p.document.records[0].dimensionType, "total");
  const r = commitDashboardImport(
    s,
    admin,
    { departmentId: "a", document: p.document, previewHash: p.previewHash, expectedRevision: 0 },
    NOW,
  );
  assert.equal(r.revision, 1);
  assert.equal(s.dashboard.departments.a.observations.length, 1);
  assert.equal(
    commitDashboardImport(
      s,
      admin,
      { departmentId: "a", document: doc(), previewHash: p.previewHash, expectedRevision: 0 },
      NOW,
    ).duplicate,
    true,
  );
  const roundtrip = JSON.parse(JSON.stringify(s));
  assert.equal(
    buildDepartmentDashboard(roundtrip, leader, { period: "m01", year: 2026 }, NOW).metrics.find(
      (x) => x.id === "report_visits",
    ).value,
    0,
  );
  reject(() => commit(s, doc({ sourceName: "更换" })), 409);
  reject(
    () =>
      commitDashboardImport(
        s,
        admin,
        { departmentId: "a", document: doc({ batchId: "b2" }), previewHash: p.previewHash, expectedRevision: 1 },
        NOW,
      ),
    409,
  );
});
test("stale revision and stale source updates are rejected without mutations", () => {
  const s = state();
  const p = previewDashboardImport(s, admin, { departmentId: "a", document: doc({ batchId: "other" }) }, NOW);
  commit(s);
  reject(
    () =>
      commitDashboardImport(
        s,
        admin,
        { departmentId: "a", document: p.document, previewHash: p.previewHash, expectedRevision: 0 },
        NOW,
      ),
    409,
  );
  const before = structuredClone(s);
  reject(() => commit(s, doc({ batchId: "older", asOf: "2026-10-25T15:00:00+08:00" })), 409);
  assert.deepEqual(s, before);
});
test("ratios require integer numerator/denominator and preserve no denominator as null", () => {
  const s = state();
  const r = {
    metric: "report_active_rate",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    value: null,
    numerator: 0,
    denominator: 0,
    unit: "percent",
    coverage: "complete",
  };
  commit(s, doc({ records: [r] }));
  const metric = buildDepartmentDashboard(s, admin, { period: "m01", year: 2026 }, NOW).metrics.find(
    (x) => x.id === r.metric,
  );
  assert.equal(metric.value, null);
  assert.equal(metric.denominator, 0);
  assert.equal(metric.status, "not_applicable");
  reject(() => commit(state(), doc({ records: [{ ...r, value: 0 }] })));
  reject(() => commit(state(), doc({ records: [{ ...r, value: 60, numerator: 1, denominator: 2 }] })));
  reject(() => commit(state(), doc({ records: [{ ...r, value: 50, numerator: 1.2, denominator: 2.4 }] })));
});
test("strict fields, types, tenant dimensions and periods reject malformed imports", () => {
  const r = doc().records[0];
  for (const bad of [
    doc({ extra: true }),
    doc({ schemaVersion: "1" }),
    doc({ asOf: "2026-10-26T15:00:00" }),
    doc({ asOf: "2026-02-30T00:00:00Z" }),
    doc({ asOf: "2027-01-01T00:00:00Z" }),
    doc({ records: [{ ...r, value: "0" }] }),
    doc({ records: [{ ...r, periodEnd: "2026-02-30" }] }),
    doc({ records: [{ ...r, periodEnd: "2027-01-31" }] }),
    doc({ records: [{ ...r, metric: "unknown" }] }),
    doc({ records: [{ ...r, unit: "people" }] }),
    doc({ records: [{ ...r, secret: "x" }] }),
    doc({ records: [r, r] }),
    doc({ records: [{ ...r, metric: "quality_pass_rate", unit: "percent", value: 50, numerator: 1, denominator: 2 }] }),
    doc({
      records: [
        {
          ...r,
          metric: "employee_goal_rate",
          unit: "percent",
          dimensionType: "person",
          dimension: "bob",
          value: 50,
          numerator: 1,
          denominator: 2,
        },
      ],
    }),
  ])
    reject(() => previewDashboardImport(state(), admin, { departmentId: "a", document: bad }, NOW));
  reject(
    () => previewDashboardImport(state(), leader, { departmentId: "b", document: doc({ departmentId: "b" }) }, NOW),
    403,
  );
});
test("latest source wins once, exact period only, freshness and partial provenance survive", () => {
  const s = state(),
    base = doc().records[0];
  commit(s, doc({ records: [{ ...base, value: 11 }] }));
  commit(
    s,
    doc({
      batchId: "platform2",
      sourceId: "bi2",
      sourceName: "平台2",
      asOf: "2026-10-26T15:30:00+08:00",
      records: [{ ...base, value: 7, coverage: "partial" }],
    }),
  );
  const r = buildDepartmentDashboard(s, admin, { period: "m01", year: 2026 }, NOW);
  const m = r.metrics.find((x) => x.id === "report_visits");
  assert.equal(m.value, 7);
  assert.equal(m.status, "partial");
  assert.equal(m.source.sourceId, "bi2");
  assert.equal(r.trends.report_visits.length, 1);
  assert.equal(
    buildDepartmentDashboard(s, admin, { period: "ytd", year: 2026 }, NOW).metrics.find((x) => x.id === "report_visits")
      .value,
    null,
  );
  assert.equal(
    buildDepartmentDashboard(s, admin, { period: "m01", year: 2026 }, NOW + 2 * 86400000).metrics.find(
      (x) => x.id === "report_visits",
    ).status,
    "stale",
  );
});
test("distribution, person metrics and safe goal values are surfaced without creating totals", () => {
  const s = state(),
    base = { periodStart: "2026-01-01", periodEnd: "2026-01-31", coverage: "complete" };
  commit(
    s,
    doc({
      records: [
        { ...base, metric: "token_total", unit: "tokens", value: 12, dimensionType: "platform", dimension: "平台A" },
        {
          ...base,
          metric: "employee_goal_rate",
          unit: "percent",
          value: 50,
          numerator: 1,
          denominator: 2,
          dimensionType: "person",
          dimension: "alice",
        },
        {
          ...base,
          metric: "quality_pass_rate",
          unit: "percent",
          value: 90,
          numerator: 9,
          denominator: 10,
          dimensionType: "domain",
          dimension: "销售|完整性",
        },
      ],
    }),
  );
  const r = buildDepartmentDashboard(s, admin, { period: "m01", year: 2026 }, NOW);
  assert.equal(r.distributions.token_total[0].value, 12);
  assert.equal(r.metrics.find((x) => x.id === "token_total").value, null);
  assert.equal(r.people.find((x) => x.username === "alice").kpiRate, 50);
  assert.equal(r.people.find((x) => x.username === "amy").kpiRate, null);
  assert.equal(r.distributions.quality_pass_rate[0].dimension, "销售|完整性");
});

test("preview catches rollback, retained ledger prevents reused batch IDs, and capacity has explicit bounds", () => {
  const s = state();
  commit(s);
  reject(
    () =>
      previewDashboardImport(
        s,
        admin,
        { departmentId: "a", document: doc({ batchId: "older", asOf: "2026-10-25T15:00:00+08:00" }) },
        NOW,
      ),
    409,
  );
  s.dashboard.departments.a.batches = [];
  assert.equal(commit(s).duplicate, true);
  reject(() => commit(s, doc({ sourceName: "不同内容" })), 409);
  s.dashboard.departments.a.batchIndex = Object.fromEntries(
    Array.from({ length: 10000 }, (_, i) => [`batch-${i}`, { hash: "x", revision: i }]),
  );
  const before = structuredClone(s);
  reject(
    () => previewDashboardImport(s, admin, { departmentId: "a", document: doc({ batchId: "overflow" }) }, NOW),
    422,
  );
  assert.deepEqual(s, before);
});
test("zero rates remain available, disabled names are not joined, and task contribution opt-out stays intact", () => {
  const s = state();
  s.settings.accounts[1].enabled = false;
  s.tasks.amb.owner = "同名";
  s.tasks.t.contributesToAnnualGoal = false;
  const base = { periodStart: "2026-01-01", periodEnd: "2026-01-31", coverage: "complete" };
  commit(
    s,
    doc({
      records: [{ ...base, metric: "report_active_rate", unit: "percent", value: 0, numerator: 0, denominator: 4 }],
    }),
  );
  const r = buildDepartmentDashboard(s, leader, { year: 2026, period: "m01" }, NOW);
  assert.equal(r.metrics.find((m) => m.id === "report_active_rate").value, 0);
  assert.equal(r.metrics.find((m) => m.id === "report_active_rate").status, "available");
  assert.equal(r.people.length, 1);
  assert.equal(r.people[0].tasks, 2);
  assert.equal(r.goals[0].current, 0);
});
test("annual goal targets and expected values preserve original textual business units", () => {
  const s = state();
  Object.assign(s.goalsByDepartment.a.rows[0], {
    name: "AI降本",
    title: "",
    annualTarget: undefined,
    target: "500万",
    expectedCurrent: "55000+",
  });
  const r = buildDepartmentDashboard(s, leader, { year: 2026, period: "m01" }, NOW);
  assert.equal(r.goals[0].title, "AI降本");
  assert.equal(r.goals[0].annualTarget, "500万");
  assert.equal(r.goals[0].expectedCurrent, "55000+");
  assert.equal(s.goalsByDepartment.a.rows[0].target, "500万");
});
test("same-asOf updates cannot remove optional measurement fields", () => {
  const s = state();
  const withoutTarget = doc({ batchId: "remove-target" });
  const originalPreview = previewDashboardImport(s, admin, { departmentId: "a", document: withoutTarget }, NOW);
  commit(s, doc({ records: [{ ...doc().records[0], annualTarget: 200 }] }));
  const before = structuredClone(s);
  reject(() => previewDashboardImport(s, admin, { departmentId: "a", document: withoutTarget }, NOW), 409);
  reject(
    () =>
      commitDashboardImport(
        s,
        admin,
        { departmentId: "a", document: withoutTarget, previewHash: originalPreview.previewHash, expectedRevision: 1 },
        NOW,
      ),
    409,
  );
  assert.deepEqual(s, before);
  assert.equal(s.dashboard.departments.a.observations[0].annualTarget, 200);
});
