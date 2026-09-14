import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPeriodReportService,
  createPeriodJob,
  publicPeriodJob,
  validatePeriodOutput,
  REPORT_TIMEOUT,
} from "../lib/period-report-service.mjs";
import { renderReport } from "../lib/period-report-engine.mjs";
import { executeReportJob } from "../scripts/report-worker.mjs";

const now = Date.UTC(2026, 8, 14),
  input = { departmentId: "alpha", year: 2026, kind: "quarter", part: 3 };
function fixture() {
  return {
    settings: {
      departments: [
        { id: "alpha", name: "研发部", enabled: true, modules: ["研发"] },
        { id: "beta", name: "销售部", enabled: true, modules: ["销售"] },
      ],
      accounts: [
        { username: "alice", name: "甲", departmentId: "alpha", enabled: true },
        { username: "bob", name: "乙", departmentId: "beta", enabled: true },
      ],
    },
    users: {
      alice: { id: "alice", username: "alice", departmentId: "alpha" },
      bob: { id: "bob", username: "bob", departmentId: "beta" },
    },
    sessions: {
      tokenA: { username: "alice", departmentId: "alpha", expiresAt: Date.now() + 3600_000 },
      tokenB: { username: "bob", departmentId: "beta", expiresAt: Date.now() + 3600_000 },
    },
    weeks: {
      w1: { id: "w1", departmentId: "alpha", startDate: "2026-07-06", endDate: "2026-07-12" },
      w2: { id: "w2", departmentId: "alpha", startDate: "2026-07-13", endDate: "2026-07-19" },
      old: { id: "old", departmentId: "alpha", startDate: "2026-04-01", endDate: "2026-04-07" },
    },
    tasks: {
      t1: { id: "t1", departmentId: "alpha", weekId: "w1", title: "项目交付", status: "进行中" },
      t2: { id: "t2", departmentId: "alpha", weekId: "w2", sourceTaskId: "t1", title: "项目交付", status: "已完成" },
      secret: { id: "secret", departmentId: "beta", weekId: "w1", title: "他部门机密" },
      old: { id: "old", departmentId: "alpha", weekId: "old", title: "旧季度" },
    },
    reports: {
      r1: {
        id: "r1",
        departmentId: "alpha",
        summaryType: "weekly",
        status: "final",
        data: { title: "研发周报", startDate: "2026/07/06", endDate: "2026/07/12", modules: [] },
      },
      r2: {
        id: "r2",
        departmentId: "alpha",
        summaryType: "monthly",
        status: "draft",
        data: { title: "研发月报", startDate: "2026/07/01", endDate: "2026/07/31", modules: [] },
      },
    },
  };
}
function output(job) {
  return {
    schemaVersion: 1,
    title: "研发季度经营报告",
    organization: "研发部",
    period: job.period,
    domains: [{ id: "all", label: "部门总览", color: "#bd252b" }],
    sources: [
      { id: "snapshot", title: "资料快照统计（不代表期间完成量）" },
      { id: "task-1", title: "项目交付" },
    ],
    slides: [
      {
        id: "cover",
        kind: "cover",
        title: "研发季度经营报告",
        domainId: "all",
        summary: "基于任务及工作总结编制，保留业务待确认事项。",
      },
      {
        id: "metrics",
        kind: "metrics",
        title: "资料已汇集，期间完成情况仍需核对",
        domainId: "all",
        metrics: [
          {
            label: "去重任务资料",
            value: 1,
            unit: "项",
            definition: "本次资料快照数量，不代表期间完成量",
            sourceIds: ["snapshot"],
            evidence: { sourceId: "snapshot", path: ["taskCount"] },
          },
        ],
      },
      {
        id: "results",
        kind: "cards",
        title: "项目交付记录已进入复核",
        domainId: "all",
        cards: [
          {
            title: "项目交付",
            body: "任务目前标记已完成，具体完成期间及业务成效仍需负责人复核。",
            sourceIds: ["task-1"],
          },
        ],
      },
    ],
  };
}
function check(html, report) {
  return {
    passed: true,
    slides: report.slides.length,
    htmlHash: createHash("sha256").update(html).digest("hex"),
    errors: [],
  };
}
function harness(state = fixture()) {
  const service = createPeriodReportService({
    saveState: async () => {},
    json: (res, value, code = 200) => Object.assign(res, { value, code }),
  });
  const actor = { username: "admin", role: "admin" };
  return {
    state,
    actor,
    service,
    admin: async (action = "", body, who = actor) =>
      service.admin(
        { method: body === undefined ? "GET" : "POST", body },
        {},
        state,
        ["admin", "period-reports", ...(action ? [action] : [])],
        now,
        who,
      ),
    worker: async (token, action, body = {}, clock = now) =>
      service.worker(
        { method: "POST", headers: { authorization: `Bearer ${token}` }, body },
        {},
        state,
        ["report-worker", action],
        clock,
      ),
  };
}
test("snapshot isolates department and period, deduplicates rollovers and stays frozen", () => {
  const state = fixture(),
    result = createPeriodJob(state, input, { username: "admin" }, now);
  const snapshot = state.periodReports.jobs[result.job.id].snapshot;
  assert.deepEqual(snapshot.stats, { taskCount: 1, weeklyReportCount: 1, monthlyReportCount: 1 });
  assert.equal(JSON.stringify(snapshot).includes("他部门机密"), false);
  assert.equal(JSON.stringify(snapshot).includes("旧季度"), false);
  state.tasks.t2.title = "修改后的任务";
  assert.equal(snapshot.sources.find((s) => s.id === "task-1").content.title, "项目交付");
  assert.equal(snapshot.sources.find((s) => s.id === "report-2").content.status, "draft");
});
test("duplicate clicks reuse active task; unauthorized and empty departments are rejected", () => {
  const state = fixture();
  const first = createPeriodJob(state, input, { username: "a" }, now);
  assert.equal(createPeriodJob(state, input, { username: "a" }, now).job.id, first.job.id);
  assert.throws(() => createPeriodJob(state, input, { username: "b", departmentId: "beta" }, now), /无权/);
  assert.throws(() => createPeriodJob(state, { ...input, departmentId: "beta" }, {}, now), /没有任务/);
});
test("half/year boundaries are exact and future periods rejected", () => {
  for (const [kind, part, start, end] of [
    ["half", 2, "2026-07-01", "2026-12-31"],
    ["year", 1, "2026-01-01", "2026-12-31"],
  ]) {
    const result = createPeriodJob(fixture(), { ...input, kind, part }, {}, now);
    assert.equal(result.job.period.start, start);
    assert.equal(result.job.period.end, end);
    assert.equal(result.job.period.asOf, "2026-09-14");
  }
  assert.equal(
    createPeriodJob(fixture(), { ...input, kind: "quarter", part: 2 }, {}, now).job.period.asOf,
    "2026-06-30",
  );
  assert.throws(() => createPeriodJob(fixture(), { ...input, year: 2030 }, {}, now), /起始日/);
});
test("forged values, unknown sources and changed periods fail independent validation", () => {
  const state = fixture(),
    { job: meta } = createPeriodJob(state, input, {}, now),
    job = state.periodReports.jobs[meta.id];
  const valid = output(job);
  assert.deepEqual(validatePeriodOutput(job, valid).errors, []);
  const changed = structuredClone(valid);
  changed.slides[1].metrics[0].value = 100;
  assert.match(validatePeriodOutput(job, changed).errors.join(), /数字证据/);
  changed.sources.push({ id: "foreign", title: "外部来源" });
  changed.period.start = "2026-01-01";
  assert.match(validatePeriodOutput(job, changed).errors.join(), /快照/);
  assert.match(validatePeriodOutput(job, changed).errors.join(), /周期/);
});
test("worker claims once, reconnects original lease, and other devices cannot steal", async () => {
  const h = harness();
  const a = (await h.admin("pair", {})).value,
    b = (await h.admin("pair", {})).value;
  await h.admin("", input);
  const first = (await h.worker(a.token, "claim")).value.job;
  assert.equal((await h.worker(a.token, "claim")).value.job.lease, first.lease);
  assert.equal((await h.worker(b.token, "claim")).value.job, null);
  await assert.rejects(h.worker(b.token, "heartbeat", { jobId: first.id, lease: first.lease }), /归属/);
  assert.match(publicPeriodJob(h.state.periodReports.jobs[first.id], now + 100_000).message, /连接中断/);
  await h.admin("revoke", { workerId: a.workerId });
  await assert.rejects(h.worker(a.token, "claim"), /停用/);
});
test("cancel/timeout reject late results and manual retry preserves versions", async () => {
  const h = harness(),
    paired = (await h.admin("pair", {})).value;
  await h.admin("", input);
  const job = (await h.worker(paired.token, "claim")).value.job;
  await h.admin("cancel", { jobId: job.id });
  await assert.rejects(h.worker(paired.token, "complete", { jobId: job.id, lease: job.lease }), /已结束/);
  const second = (await h.admin("", input)).value.job;
  assert.equal(second.version, 2);
  const claimed = (await h.worker(paired.token, "claim")).value.job;
  await assert.rejects(
    h.worker(paired.token, "heartbeat", { jobId: claimed.id, lease: claimed.lease }, now + REPORT_TIMEOUT + 1),
    /已结束/,
  );
  assert.equal(h.state.periodReports.jobs[claimed.id].status, "failed");
});
test("HTML completion requires matching browser evidence, is idempotent, and stable URL resolves latest", async () => {
  const h = harness(),
    paired = (await h.admin("pair", {})).value;
  await h.admin("", input);
  const claimed = (await h.worker(paired.token, "claim")).value.job;
  const report = output(claimed),
    payload = { jobId: claimed.id, lease: claimed.lease, report };
  await assert.rejects(h.worker(paired.token, "complete", payload), /浏览器校验/);
  payload.browserCheck = check(renderReport(report), report);
  await h.worker(paired.token, "complete", payload);
  await h.worker(paired.token, "complete", payload);
  const stateJob = h.state.periodReports.jobs[claimed.id];
  const viewed = await h.service.view(
    { method: "GET" },
    {},
    h.state,
    ["period-reports", encodeURIComponent(stateJob.key)],
    now,
    { departmentId: "alpha" },
  );
  assert.match(viewed.value.html, /<!doctype html>/);
  assert.equal(viewed.value.job.version, 1);
  await assert.rejects(
    h.service.view({ method: "GET" }, {}, h.state, ["period-reports", claimed.id], now, { departmentId: "beta" }),
    /无权/,
  );
  assert.equal((await h.admin("", input)).value.job.version, 2);
});
test("worker resumes upload after network failure without invoking generator again", async () => {
  const state = fixture(),
    meta = createPeriodJob(state, input, {}, now).job;
  const job = { ...state.periodReports.jobs[meta.id], lease: "lease", deadline: Date.now() + 60_000 };
  const root = await mkdtemp(join(tmpdir(), "period-worker-test-"));
  let generated = 0,
    completed = 0;
  const config = { workerId: "test-worker", skillPath: fileURLToPath(new URL("../docs", import.meta.url)) };
  const options = {
    config,
    root,
    call: async (action) => {
      if (action === "complete" && ++completed === 1) throw new Error("连接中断");
    },
    generate: async (_job, dir) => {
      generated++;
      await writeFile(join(dir, "report.json"), JSON.stringify(output(job)));
    },
    check: async (html) => check(html, output(job)),
  };
  await assert.rejects(executeReportJob(job, options), /连接中断/);
  await executeReportJob(job, options);
  assert.equal(generated, 1);
  assert.equal(completed, 2);
});
test("actual API rejects anonymous/foreign access, accepts admin queue and persists output", async () => {
  const root = await mkdtemp(join(tmpdir(), "period-api-test-"));
  process.env.STATE_PATH = join(root, "state.json");
  process.env.ADMIN_USERNAME = "ReportAdmin";
  process.env.ADMIN_PASSWORD = "Test-password-928!";
  process.env.ADMIN_SESSION_SECRET = "report-integration-session-secret-12345678";
  await writeFile(process.env.STATE_PATH, JSON.stringify(fixture()));
  const { default: handler } = await import("../api/[...path].mjs");
  async function api(path, { method = "GET", body, token = "", user = "" } = {}) {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(value) {
        this.value = value;
        return this;
      },
    };
    await handler(
      {
        method,
        body,
        headers: { authorization: token ? `Bearer ${token}` : "", "x-user-token": user },
        query: { path: path.split("/") },
      },
      res,
    );
    return res;
  }
  assert.equal((await api("period-reports")).statusCode, 401);
  assert.equal((await api("admin/period-reports", { method: "POST", body: input, user: "tokenA" })).statusCode, 401);
  const login = await api("admin/login", {
    method: "POST",
    body: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(login.statusCode, 200);
  const token = login.value.token;
  const pair = await api("admin/period-reports/pair", { method: "POST", body: {}, token });
  const [a, b] = await Promise.all([
    api("admin/period-reports", { method: "POST", body: input, token }),
    api("admin/period-reports", { method: "POST", body: input, token }),
  ]);
  assert.equal(a.value.job.id, b.value.job.id);
  const claimed = await api("report-worker/claim", { method: "POST", body: {}, token: pair.value.token });
  const job = claimed.value.job,
    report = output(job);
  const complete = await api("report-worker/complete", {
    method: "POST",
    token: pair.value.token,
    body: { jobId: job.id, lease: job.lease, report, browserCheck: check(renderReport(report), report) },
  });
  assert.equal(complete.statusCode, 200, JSON.stringify(complete.value));
  assert.equal((await api(`period-reports/${job.id}`, { user: "tokenB" })).statusCode, 404);
  assert.equal((await api(`period-reports/${job.id}`, { user: "tokenA" })).statusCode, 200);
  const saved = JSON.parse(await readFile(process.env.STATE_PATH, "utf8"));
  assert.equal(saved.periodReports.jobs[job.id].status, "completed");
  assert.equal(JSON.stringify(saved).includes(pair.value.token), false);
});
