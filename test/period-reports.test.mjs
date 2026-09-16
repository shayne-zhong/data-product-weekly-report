import test from "node:test";
import assert from "node:assert/strict";
import * as serviceApi from "../lib/period-report-service.mjs";
import { renderReport } from "../lib/period-report-engine.mjs";

const now = Date.UTC(2026, 8, 14);
const input = { departmentId: "alpha", year: 2026, kind: "quarter", part: 3 };

function fixture() {
  return {
    settings: {
      departments: [
        { id: "alpha", name: "研发部", enabled: true },
        { id: "beta", name: "销售部", enabled: true },
      ],
      accounts: [
        { username: "alice", departmentId: "alpha", enabled: true },
        { username: "bob", departmentId: "beta", enabled: true },
      ],
    },
    goalsByDepartment: {
      alpha: { year: 2026, rows: [{ id: "goal-1", title: "交付目标" }] },
      beta: { year: 2026, rows: [{ id: "goal-2", title: "销售目标" }] },
    },
    reports: Object.fromEntries([7, 8, 9].map((month) => [
      `m${month}`,
      { id: `m${month}`, departmentId: "alpha", summaryType: "monthly", status: "final", data: { title: `研发${month}月总结`, startDate: `2026-${String(month).padStart(2, "0")}-01`, endDate: new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10) } },
    ]).concat([["secret", { id: "secret", departmentId: "beta", summaryType: "monthly", status: "final", data: { title: "销售机密", startDate: "2026-07-01", endDate: "2026-07-31" } }]])),
  };
}

function output(job) {
  return {
    schemaVersion: 1, title: "研发季度经营报告", organization: job.departmentName, period: structuredClone(job.period),
    domains: [{ id: "all", label: "部门总览", color: "#bd252b" }],
    sources: job.snapshot.sources.map(({ id, title }) => ({ id, title })),
    slides: [
      { id: "cover", kind: "cover", title: "研发季度经营报告", domainId: "all", summary: "基于冻结资料编制，业务结论仍待复核。" },
      { id: "metrics", kind: "metrics", title: "资料已汇集", domainId: "all", metrics: [{ label: "待核对指标", value: null, unit: "项", definition: "本报告保留待核对指标", sourceIds: [] }] },
      { id: "cards", kind: "cards", title: "季度总结", domainId: "all", cards: [{ title: "经营资料", body: "季度总结已纳入本次冻结资料。", sourceIds: [job.snapshot.sources[0].id] }] },
    ],
  };
}

function create(state = fixture(), actor = { username: "admin", role: "admin" }) {
  return serviceApi.createPeriodJob(state, input, actor, now, { model: "test-model", skillVersion: "skill-v1" });
}

function complete(state, jobId, clock = now) {
  const job = state.periodReports.jobs[jobId];
  serviceApi.beginPeriodJob(state, jobId, clock);
  serviceApi.markPeriodJobValidating(state, jobId, clock + 1);
  return serviceApi.publishPeriodJob(state, jobId, output(job), { usage: { inputTokens: 10 }, contentHash: "server-hash" }, clock + 2);
}

test("preparation freezes strict source context and duplicate active creation reuses the queued job", () => {
  const state = fixture(); const prepared = serviceApi.preparePeriodJob(state, input, { username: "admin", role: "admin" }, now);
  assert.equal(state.periodReports, undefined);
  const job = serviceApi.persistPreparedPeriodJob(state, prepared, { username: "admin" }, now, { model: "test-model", skillVersion: "skill-v1" });
  assert.equal(job.status, "queued"); assert.equal(job.version, undefined);
  assert.equal(JSON.stringify(job.snapshot).includes("销售机密"), false);
  state.goalsByDepartment.alpha.rows[0].title = "后来修改";
  assert.equal(job.snapshot.sources[0].content.rows[0].title, "交付目标");
  const duplicate = create(state); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.job.id, job.id);
});

test("preparation retains department authorization and validates supported nonfuture periods", () => {
  assert.throws(() => create(fixture(), { username: "bob", departmentId: "beta" }), /无权/);
  assert.throws(() => serviceApi.createPeriodJob(fixture(), { ...input, departmentId: "beta" }, {}, now), /资料不完整|无权/);
  assert.equal(serviceApi.periodFromInput({ ...input, kind: "half", part: 2 }, now).start, "2026-07-01");
  assert.equal(serviceApi.periodFromInput({ ...input, kind: "year", part: 1 }, now).end, "2026-12-31");
  assert.throws(() => serviceApi.periodFromInput({ ...input, year: 2030 }, now), /起始日/);
  assert.throws(() => serviceApi.periodFromInput({ ...input, kind: "quarter", part: 5 }, now), /周期/);
});

test("lifecycle accepts only queued to generating to validating and formally publishes version one", () => {
  const state = fixture(); const { job: queued } = create(state);
  assert.throws(() => serviceApi.markPeriodJobValidating(state, queued.id, now), /报告任务状态已变化/);
  assert.throws(() => serviceApi.publishPeriodJob(state, queued.id, {}, {}, now), /报告任务不可发布/);
  const generating = serviceApi.beginPeriodJob(state, queued.id, now);
  assert.equal(generating.startedAt, now);
  generating.status = "tampered";
  assert.equal(state.periodReports.jobs[queued.id].status, "generating");
  const validating = serviceApi.markPeriodJobValidating(state, queued.id, now + 1);
  validating.status = "tampered";
  assert.equal(state.periodReports.jobs[queued.id].status, "validating");
  serviceApi.publishPeriodJob(state, queued.id, output(generating), { usage: { inputTokens: 10 }, contentHash: "server-hash" }, now + 2);
  const published = state.periodReports.jobs[queued.id];
  assert.equal(published.status, "published"); assert.equal(published.version, 1); assert.equal(published.publishedAt, now + 2);
  assert.equal(published.contentHash, "server-hash"); assert.match(published.html, /正式版本 · skill-v1 · test-model/);
  assert.throws(() => serviceApi.beginPeriodJob(state, queued.id, now + 3), /报告任务不可执行/);
  const next = create(state).job; assert.notEqual(next.id, queued.id); assert.equal(next.version, undefined);
});

test("publication rejects invalid frozen-source output and renderer escapes trusted provenance", () => {
  const state = fixture(); const { job } = create(state); serviceApi.beginPeriodJob(state, job.id, now); serviceApi.markPeriodJobValidating(state, job.id, now);
  const invalid = output(state.periodReports.jobs[job.id]); invalid.sources.push({ id: "foreign", title: "伪造来源" });
  assert.throws(() => serviceApi.publishPeriodJob(state, job.id, invalid, {}, now), /快照/);
  const wrongDepartment = output(state.periodReports.jobs[job.id]); wrongDepartment.organization = "错误部门";
  assert.throws(() => serviceApi.publishPeriodJob(state, job.id, wrongDepartment, {}, now), /部门/);
  const wrongPeriod = output(state.periodReports.jobs[job.id]); wrongPeriod.period.start = "2026-01-01";
  assert.throws(() => serviceApi.publishPeriodJob(state, job.id, wrongPeriod, {}, now), /周期/);
  assert.match(renderReport(output(state.periodReports.jobs[job.id]), { provenance: "正式 <来源>" }), /正式 &lt;来源&gt;/);
});

test("migration retires workers, maps legacy completion, and restart recovery fails every active job", () => {
  const state = fixture(); state.periodReports = { workers: { old: { id: "old", tokenHash: "secret" } }, jobs: {
    done: { id: "done", status: "completed", workerId: "old", lease: "lease", heartbeatAt: 1, deadline: 2 },
    queued: { id: "queued", status: "queued", workerId: "old" }, running: { id: "running", status: "running", lease: "lease" }, validating: { id: "validating", status: "validating", heartbeatAt: 1 },
  } };
  const data = serviceApi.migratePeriodReportState(state, now); assert.equal(data, state.periodReports); assert.equal("workers" in data, false); assert.equal(data.jobs.done.status, "published");
  for (const id of ["queued", "running", "validating"]) { assert.equal(data.jobs[id].status, "failed"); assert.equal(data.jobs[id].error, "旧版本机生成流程已停用，请重新生成"); assert.equal(data.jobs[id].updatedAt, now); }
  assert.equal("workerId" in data.jobs.done, false);
  Object.assign(data.jobs, { restartQueued: { id: "restartQueued", status: "queued" }, restart: { id: "restart", status: "generating" }, restartValidating: { id: "restartValidating", status: "validating" } });
  assert.deepEqual(serviceApi.recoverInterruptedPeriodJobs(state, now + 1), ["restartQueued", "restart", "restartValidating"]);
  assert.equal(data.jobs.restart.error, "服务重启导致生成中断，请重试");
});

test("migration publishes completed legacy jobs even after worker state was removed", () => {
  const state = fixture(); state.periodReports = { jobs: { done: { id: "done", status: "completed" } } };
  serviceApi.migratePeriodReportState(state, now);
  assert.equal(state.periodReports.jobs.done.status, "published");
});

test("lifecycle functions retire legacy worker jobs before applying their transitions", () => {
  const legacy = (status) => ({ periodReports: { workers: { old: { id: "old" } }, jobs: { old: { id: "old", status, workerId: "old", lease: "lease" } } } });
  const queued = legacy("queued");
  assert.throws(() => serviceApi.beginPeriodJob(queued, "old", now), /不可执行/);
  assert.equal(queued.periodReports.jobs.old.status, "failed");
  assert.equal("workerId" in queued.periodReports.jobs.old, false);
  const running = legacy("running");
  assert.throws(() => serviceApi.markPeriodJobValidating(running, "old", now), /状态已变化/);
  assert.equal(running.periodReports.jobs.old.error, "旧版本机生成流程已停用，请重新生成");
  const failing = legacy("queued");
  assert.equal(serviceApi.failPeriodJob(failing, "old", "new", now), null);
  const publishing = legacy("validating");
  assert.throws(() => serviceApi.publishPeriodJob(publishing, "old", {}, {}, now), /报告任务不可发布/);
  assert.equal(publishing.periodReports.jobs.old.error, "旧版本机生成流程已停用，请重新生成");
  const recovering = legacy("validating");
  assert.deepEqual(serviceApi.recoverInterruptedPeriodJobs(recovering, now), []);
  assert.equal(recovering.periodReports.jobs.old.status, "failed");
});

test("failure handles active jobs only and caps its error", () => {
  const state = fixture(); const { job } = create(state); const failed = serviceApi.failPeriodJob(state, job.id, "x".repeat(400), now);
  assert.equal(failed.status, "failed"); assert.equal(failed.error.length, 300); failed.error = "tampered"; assert.equal(state.periodReports.jobs[job.id].error.length, 300); assert.equal(serviceApi.failPeriodJob(state, job.id, "again", now), null);
  const errored = create(state).job;
  assert.equal(serviceApi.failPeriodJob(state, errored.id, new Error("连接失败"), now).error, "连接失败");
  const defaulted = create(state).job;
  assert.equal(serviceApi.failPeriodJob(state, defaulted.id, undefined, now).error, "生成失败");
});

test("published-only views keep historical job URLs while stable keys resolve the highest formal version", async () => {
  const state = fixture(); const first = create(state).job; complete(state, first.id); const second = create(state).job; complete(state, second.id, now + 10);
  const service = serviceApi.createPeriodReportService({ saveState: async () => {}, json: (res, value, code = 200) => Object.assign(res, { value, code }), prepareGeneration: async () => ({ model: "test-model", skillVersion: "skill-v1" }), enqueue: async () => {} });
  const stable = await service.view({ method: "GET" }, {}, state, ["period-reports", first.key], now, { departmentId: "alpha" }); assert.equal(stable.value.job.id, second.id);
  const historical = await service.view({ method: "GET" }, {}, state, ["period-reports", first.id], now, { departmentId: "alpha" }); assert.equal(historical.value.job.id, first.id); assert.equal("snapshot" in historical.value.job, false); assert.equal(historical.value.job.snapshotCapturedAt, now);
  await assert.rejects(service.view({ method: "GET" }, {}, state, ["period-reports", first.id], now, { departmentId: "beta" }), /无权/);
});

test("admin prepares before generation, persists generated metadata, and retries a published report as a new job", async () => {
  const state = fixture(); const calls = [];
  const service = serviceApi.createPeriodReportService({
    saveState: async () => calls.push("save"), json: (res, value, code = 200) => Object.assign(res, { value, code }),
    prepareGeneration: async (_state, _actor, prepared) => { calls.push(`prepare:${prepared.key}`); return { model: "deepseek", skillVersion: "period-report-v2" }; },
    enqueue: async (id) => calls.push(`enqueue:${id}`),
  });
  const actor = { username: "admin", role: "admin" }; const created = await service.admin({ method: "POST", body: input }, {}, state, ["admin", "period-reports"], now, actor); const job = state.periodReports.jobs[created.value.job.id];
  assert.equal(created.code, 201); assert.equal(job.model, "deepseek"); assert.equal(job.skillVersion, "period-report-v2"); assert.deepEqual(calls.slice(0, 3), [`prepare:${job.key}`, "save", `enqueue:${job.id}`]);
  const duplicate = await service.admin({ method: "POST", body: input }, {}, state, ["admin", "period-reports"], now, actor); assert.equal(duplicate.code, 200); assert.equal(calls.filter((entry) => entry.startsWith("prepare:")).length, 1);
  complete(state, job.id); const retry = await service.admin({ method: "POST", body: { jobId: job.id } }, {}, state, ["admin", "period-reports", "retry"], now + 4, actor); assert.equal(retry.code, 201); assert.notEqual(retry.value.job.id, job.id);
});

test("concurrent admin creates reuse the first active job after generation preparation", async () => {
  const state = fixture(); const queued = []; let prepared = 0; let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = serviceApi.createPeriodReportService({
    saveState: async () => {}, json: (res, value, code = 200) => Object.assign(res, { value, code }),
    prepareGeneration: async () => { prepared++; await gate; return { model: "deepseek", skillVersion: "period-report-v2" }; },
    enqueue: async (id) => queued.push(id),
  });
  const actor = { username: "admin", role: "admin" };
  const first = service.admin({ method: "POST", body: input }, {}, state, ["admin", "period-reports"], now, actor);
  const second = service.admin({ method: "POST", body: input }, {}, state, ["admin", "period-reports"], now, actor);
  await Promise.resolve();
  assert.equal(prepared, 2);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(Object.keys(state.periodReports.jobs).length, 1);
  assert.equal(queued.length, 1);
  assert.equal(a.value.job.id, b.value.job.id);
  assert.deepEqual([a.code, b.code].sort(), [200, 201]);
});
