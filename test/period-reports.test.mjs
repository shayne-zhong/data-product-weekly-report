import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as serviceApi from "../lib/period-report-service.mjs";
import { renderReport } from "../lib/period-report-engine.mjs";
import { defaultLocalStatePath } from "../lib/state-store.mjs";
import handler, { recoverPeriodReportJobsFromServer, runPeriodReportJobFromServer } from "../api/[...path].mjs";

const now = Date.UTC(2026, 8, 14);
const input = { departmentId: "alpha", year: 2026, kind: "quarter", part: 3 };

process.env.ADMIN_USERNAME = "period-test-admin";
process.env.ADMIN_PASSWORD = "period-test-password";
process.env.ADMIN_SESSION_SECRET = "period-reports-admin-session-secret-32-bytes";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function api(path, { method = "GET", body, headers = {}, token = "" } = {}) {
  const res = mockRes();
  await handler(
    {
      method,
      body,
      headers: { ...(token ? { "x-user-token": token } : {}), ...headers },
      query: { path: path.split("/").filter(Boolean) },
    },
    res,
  );
  return res;
}

async function prepareApiPeriodSources(accountIndex) {
  const login = await api("admin/login", {
    method: "POST",
    body: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(login.statusCode, 200);
  const adminHeaders = { authorization: `Bearer ${login.body.token}` };
  const settings = await api("admin/settings", { headers: adminHeaders });
  const account = settings.body.settings.accounts[accountIndex];
  const registered = await api("auth/register", {
    method: "POST",
    body: { username: account.username, password: "12345678", displayName: account.name },
  });
  assert.equal(registered.statusCode, 201);
  const user = await api("auth/login", { method: "POST", body: { username: account.username, password: "12345678" } });
  assert.equal(user.statusCode, 200);
  const userToken = user.body.token;
  assert.equal(
    (
      await api("goals", {
        method: "POST",
        token: userToken,
        body: { year: 2026, rows: [{ name: "交付", target: 1 }] },
      })
    ).statusCode,
    200,
  );
  for (const month of [7, 8, 9]) {
    const endDate = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10);
    const report = await api("reports", {
      method: "POST",
      token: userToken,
      body: {
        status: "final",
        data: {
          summaryType: "monthly",
          title: `${month}月总结`,
          startDate: `2026-${String(month).padStart(2, "0")}-01`,
          endDate,
          modules: [{ title: "交付", sections: [{ title: "进展", items: ["已完成"] }] }],
        },
      },
    });
    assert.ok([201, 409].includes(report.statusCode));
  }
  return { adminHeaders, departmentId: settings.body.settings.departments[0].id, userToken };
}

async function configurePeriodAi(adminHeaders, ai) {
  const settings = await api("admin/settings", { headers: adminHeaders });
  const response = await api("admin/settings", {
    method: "POST",
    headers: adminHeaders,
    body: { ...settings.body.settings, ai: { ...settings.body.settings.ai, ...ai } },
  });
  assert.equal(response.statusCode, 200);
}

async function createQueuedApiPeriodJob(context) {
  const queuedCallbacks = [];
  const originalQueueMicrotask = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (callback) => queuedCallbacks.push(callback);
  try {
    const created = await api("admin/period-reports", {
      method: "POST",
      headers: context.adminHeaders,
      body: { departmentId: context.departmentId, year: 2026, kind: "quarter", part: 3 },
    });
    return { created, queuedCallbacks };
  } finally {
    globalThis.queueMicrotask = originalQueueMicrotask;
  }
}

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
    reports: Object.fromEntries(
      [7, 8, 9]
        .map((month) => [
          `m${month}`,
          {
            id: `m${month}`,
            departmentId: "alpha",
            summaryType: "monthly",
            status: "final",
            data: {
              title: `研发${month}月总结`,
              startDate: `2026-${String(month).padStart(2, "0")}-01`,
              endDate: new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10),
            },
          },
        ])
        .concat([
          [
            "secret",
            {
              id: "secret",
              departmentId: "beta",
              summaryType: "monthly",
              status: "final",
              data: { title: "销售机密", startDate: "2026-07-01", endDate: "2026-07-31" },
            },
          ],
        ]),
    ),
  };
}

function output(job) {
  return {
    schemaVersion: 1,
    title: "研发季度经营报告",
    organization: job.departmentName,
    period: structuredClone(job.period),
    domains: [{ id: "all", label: "部门总览", color: "#bd252b" }],
    sources: job.snapshot.sources.map(({ id, title }) => ({ id, title })),
    slides: [
      {
        id: "cover",
        kind: "cover",
        title: "研发季度经营报告",
        domainId: "all",
        summary: "基于冻结资料编制，业务结论仍待复核。",
      },
      {
        id: "metrics",
        kind: "metrics",
        title: "资料已汇集",
        domainId: "all",
        metrics: [{ label: "待核对指标", value: null, unit: "项", definition: "本报告保留待核对指标", sourceIds: [] }],
      },
      {
        id: "cards",
        kind: "cards",
        title: "季度总结",
        domainId: "all",
        cards: [{ title: "经营资料", body: "季度总结已纳入本次冻结资料。", sourceIds: [job.snapshot.sources[0].id] }],
      },
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
  return serviceApi.publishPeriodJob(
    state,
    jobId,
    output(job),
    { usage: { inputTokens: 10 }, contentHash: "server-hash" },
    clock + 2,
  );
}

test("monthly periods can publish and reject invalid or future months", () => {
  const state = fixture();
  const job = serviceApi.createPeriodJob(state, { ...input, kind: "month", part: 8 }, {}, now).job;
  assert.equal(job.period.label, "2026年8月");
  assert.equal(job.period.end, "2026-08-31");
  assert.equal(complete(state, job.id).status, "published");
  assert.throws(() => serviceApi.periodFromInput({ ...input, kind: "month", part: 13 }, now), /周期/);
  assert.throws(() => serviceApi.periodFromInput({ ...input, kind: "month", part: 10 }, now), /起始日/);
});

test("Codex HTML upload publishes a department-scoped version and deduplicates matching content", () => {
  const state = fixture();
  const file = { filename: "codex-q3.html", mimeType: "text/html", buffer: Buffer.from("<html><body>Q3</body></html>") };
  const uploaded = serviceApi.uploadPeriodHtml(state, input, file, { username: "admin" }, now);
  assert.equal(uploaded.status, "published");
  assert.equal(uploaded.origin, "codex-html-upload");
  assert.equal(uploaded.filename, "codex-q3.html");
  assert.equal(uploaded.version, 1);
  assert.equal(uploaded.html, "<html><body>Q3</body></html>");
  assert.equal(uploaded.snapshot.sources.length, 0);
  const duplicate = serviceApi.uploadPeriodHtml(state, input, file, { username: "admin" }, now + 1);
  assert.equal(duplicate.id, uploaded.id);
  assert.equal(Object.keys(state.periodReports.jobs).length, 1);
  assert.throws(
    () => serviceApi.uploadPeriodHtml(state, input, { ...file, filename: "codex.txt" }, { username: "admin" }, now),
    /HTML/,
  );
  assert.throws(
    () => serviceApi.uploadPeriodHtml(state, input, { ...file, buffer: Buffer.alloc(0) }, { username: "admin" }, now),
    /不能为空/,
  );
  assert.throws(
    () => serviceApi.uploadPeriodHtml(state, input, file, { departmentId: "beta" }, now),
    /无权/,
  );
});

test("admin upload persists the multipart HTML and exposes it through the protected report view", async () => {
  const state = fixture();
  const saves = [];
  const service = serviceApi.createPeriodReportService({
    saveState: async () => saves.push("saved"),
    json: (res, value, code = 200) => Object.assign(res, { value, code }),
    readUpload: async () => ({
      fields: { ...input },
      filename: "codex.html",
      mimeType: "text/html",
      buffer: Buffer.from("<html><body>Codex report</body></html>"),
    }),
  });
  const response = await service.admin(
    { method: "POST" }, {}, state, ["admin", "period-reports", "upload"], now, { username: "admin", departmentId: "alpha" },
  );
  assert.equal(response.code, 201);
  assert.equal(response.value.job.origin, "codex-html-upload");
  assert.equal(response.value.job.html, undefined);
  assert.deepEqual(saves, ["saved"]);
  const viewed = await service.view({ method: "GET" }, {}, state, ["period-reports", response.value.job.id], now, { departmentId: "alpha" });
  assert.equal(viewed.value.html, "<html><body>Codex report</body></html>");
});

test("cancel is durable at every active stage and prevents late failure or publication", () => {
  for (const stage of ["queued", "generating", "validating"]) {
    const state = fixture();
    const job = create(state).job;
    if (stage !== "queued") serviceApi.beginPeriodJob(state, job.id, now);
    if (stage === "validating") serviceApi.markPeriodJobValidating(state, job.id, now);
    serviceApi.cancelPeriodJob(state, job.id, { departmentId: "alpha" }, now + 1);
    assert.equal(state.periodReports.jobs[job.id].status, "cancelled");
    assert.equal(serviceApi.failPeriodJob(state, job.id, "late failure"), null);
    assert.throws(() => serviceApi.publishPeriodJob(state, job.id, output(state.periodReports.jobs[job.id])), /不可发布/);
    assert.deepEqual(serviceApi.recoverInterruptedPeriodJobs(state), []);
    assert.equal(create(state).duplicate, false);
  }
});

test("admin cancel and delete enforce department scopes, save before abort, and retain version sequence", async () => {
  const state = fixture();
  const sourceBefore = JSON.stringify({ reports: state.reports, goals: state.goalsByDepartment });
  const calls = [];
  const service = serviceApi.createPeriodReportService({
    saveState: async () => calls.push("save"),
    abort: (id) => calls.push(`abort:${id}`),
    json: (res, value, code = 200) => Object.assign(res, { value, code }),
  });
  const operate = (method, id, suffix, actor = { departmentId: "alpha" }) => service.admin(
    { method }, {}, state, ["admin", "period-reports", id, ...suffix], now, actor,
  );
  const queued = create(state).job;
  await assert.rejects(operate("POST", queued.id, ["cancel"], { departmentId: "beta" }), /无权/);
  await assert.rejects(operate("DELETE", queued.id, []), /先终止/);
  await operate("POST", queued.id, ["cancel"]);
  assert.deepEqual(calls, ["save", `abort:${queued.id}`]);
  await operate("DELETE", queued.id, []);
  assert.equal(state.periodReports.jobs[queued.id], undefined);
  const first = create(state).job;
  complete(state, first.id);
  const second = create(state).job;
  complete(state, second.id);
  await assert.rejects(operate("DELETE", second.id, [], { departmentId: "beta" }), /无权/);
  await operate("DELETE", second.id, []);
  await assert.rejects(service.view({ method: "GET" }, {}, state, ["period-reports", second.id], now), /不存在/);
  const latest = await service.view({ method: "GET" }, {}, state, ["period-reports", first.key], now);
  assert.equal(latest.value.job.id, first.id);
  const third = create(state).job;
  assert.equal(complete(state, third.id).version, 3);
  assert.equal(JSON.stringify({ reports: state.reports, goals: state.goalsByDepartment }), sourceBefore);
});

test("preparation freezes strict source context and duplicate active creation reuses the queued job", () => {
  const state = fixture();
  const prepared = serviceApi.preparePeriodJob(state, input, { username: "admin", role: "admin" }, now);
  assert.equal(state.periodReports, undefined);
  const job = serviceApi.persistPreparedPeriodJob(state, prepared, { username: "admin" }, now, {
    model: "test-model",
    skillVersion: "skill-v1",
  });
  assert.equal(job.status, "queued");
  assert.equal(job.version, undefined);
  assert.equal(JSON.stringify(job.snapshot).includes("销售机密"), false);
  state.goalsByDepartment.alpha.rows[0].title = "后来修改";
  assert.equal(job.snapshot.sources[0].content.rows[0].title, "交付目标");
  const duplicate = create(state);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.job.id, job.id);
});

test("preparation retains department authorization and validates supported nonfuture periods", () => {
  assert.throws(() => create(fixture(), { username: "bob", departmentId: "beta" }), /无权/);
  assert.throws(
    () => serviceApi.createPeriodJob(fixture(), { ...input, departmentId: "beta" }, {}, now),
    /资料不完整|无权/,
  );
  assert.equal(serviceApi.periodFromInput({ ...input, kind: "half", part: 2 }, now).start, "2026-07-01");
  assert.equal(serviceApi.periodFromInput({ ...input, kind: "year", part: 1 }, now).end, "2026-12-31");
  assert.throws(() => serviceApi.periodFromInput({ ...input, year: 2030 }, now), /起始日/);
  assert.throws(() => serviceApi.periodFromInput({ ...input, kind: "quarter", part: 5 }, now), /周期/);
});

test("lifecycle accepts only queued to generating to validating and formally publishes version one", () => {
  const state = fixture();
  const { job: queued } = create(state);
  assert.throws(() => serviceApi.markPeriodJobValidating(state, queued.id, now), /报告任务状态已变化/);
  assert.throws(() => serviceApi.publishPeriodJob(state, queued.id, {}, {}, now), /报告任务不可发布/);
  const generating = serviceApi.beginPeriodJob(state, queued.id, now);
  assert.equal(generating.startedAt, now);
  generating.status = "tampered";
  assert.equal(state.periodReports.jobs[queued.id].status, "generating");
  const validating = serviceApi.markPeriodJobValidating(state, queued.id, now + 1);
  validating.status = "tampered";
  assert.equal(state.periodReports.jobs[queued.id].status, "validating");
  serviceApi.publishPeriodJob(
    state,
    queued.id,
    output(generating),
    { usage: { inputTokens: 10 }, contentHash: "server-hash" },
    now + 2,
  );
  const published = state.periodReports.jobs[queued.id];
  assert.equal(published.status, "published");
  assert.equal(published.version, 1);
  assert.equal(published.publishedAt, now + 2);
  assert.equal(published.contentHash, "server-hash");
  assert.match(published.html, /正式版本 · skill-v1 · test-model/);
  assert.throws(() => serviceApi.beginPeriodJob(state, queued.id, now + 3), /报告任务不可执行/);
  const next = create(state).job;
  assert.notEqual(next.id, queued.id);
  assert.equal(next.version, undefined);
});

test("publication rejects invalid frozen-source output and renderer escapes trusted provenance", () => {
  const state = fixture();
  const { job } = create(state);
  serviceApi.beginPeriodJob(state, job.id, now);
  serviceApi.markPeriodJobValidating(state, job.id, now);
  const invalid = output(state.periodReports.jobs[job.id]);
  invalid.sources.push({ id: "foreign", title: "伪造来源" });
  assert.throws(() => serviceApi.publishPeriodJob(state, job.id, invalid, {}, now), /快照/);
  const wrongDepartment = output(state.periodReports.jobs[job.id]);
  wrongDepartment.organization = "错误部门";
  assert.throws(() => serviceApi.publishPeriodJob(state, job.id, wrongDepartment, {}, now), /部门/);
  const wrongPeriod = output(state.periodReports.jobs[job.id]);
  wrongPeriod.period.start = "2026-01-01";
  assert.throws(() => serviceApi.publishPeriodJob(state, job.id, wrongPeriod, {}, now), /周期/);
  assert.match(
    renderReport(output(state.periodReports.jobs[job.id]), { provenance: "正式 <来源>" }),
    /正式 &lt;来源&gt;/,
  );
});

test("migration retires workers, maps legacy completion, and restart recovery fails every active job", () => {
  const state = fixture();
  state.periodReports = {
    workers: { old: { id: "old", tokenHash: "secret" } },
    jobs: {
      done: { id: "done", status: "completed", workerId: "old", lease: "lease", heartbeatAt: 1, deadline: 2 },
      queued: { id: "queued", status: "queued", workerId: "old" },
      running: { id: "running", status: "running", lease: "lease" },
      validating: { id: "validating", status: "validating", heartbeatAt: 1 },
    },
  };
  const data = serviceApi.migratePeriodReportState(state, now);
  assert.equal(data, state.periodReports);
  assert.equal("workers" in data, false);
  assert.equal(data.jobs.done.status, "published");
  for (const id of ["queued", "running", "validating"]) {
    assert.equal(data.jobs[id].status, "failed");
    assert.equal(data.jobs[id].error, "旧版本机生成流程已停用，请重新生成");
    assert.equal(data.jobs[id].updatedAt, now);
  }
  assert.equal("workerId" in data.jobs.done, false);
  Object.assign(data.jobs, {
    restartQueued: { id: "restartQueued", status: "queued" },
    restart: { id: "restart", status: "generating" },
    restartValidating: { id: "restartValidating", status: "validating" },
  });
  assert.deepEqual(serviceApi.recoverInterruptedPeriodJobs(state, now + 1), [
    "restartQueued",
    "restart",
    "restartValidating",
  ]);
  assert.equal(data.jobs.restart.error, "服务重启导致生成中断，请重试");
});

test("migration publishes completed legacy jobs even after worker state was removed", () => {
  const state = fixture();
  state.periodReports = { jobs: { done: { id: "done", status: "completed" } } };
  serviceApi.migratePeriodReportState(state, now);
  assert.equal(state.periodReports.jobs.done.status, "published");
});

test("lifecycle functions retire legacy worker jobs before applying their transitions", () => {
  const legacy = (status) => ({
    periodReports: {
      workers: { old: { id: "old" } },
      jobs: { old: { id: "old", status, workerId: "old", lease: "lease" } },
    },
  });
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
  const state = fixture();
  const { job } = create(state);
  const failed = serviceApi.failPeriodJob(state, job.id, "x".repeat(400), now);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.length, 300);
  failed.error = "tampered";
  assert.equal(state.periodReports.jobs[job.id].error.length, 300);
  assert.equal(serviceApi.failPeriodJob(state, job.id, "again", now), null);
  const errored = create(state).job;
  assert.equal(serviceApi.failPeriodJob(state, errored.id, new Error("连接失败"), now).error, "连接失败");
  const defaulted = create(state).job;
  assert.equal(serviceApi.failPeriodJob(state, defaulted.id, undefined, now).error, "生成失败");
});

test("published-only views keep historical job URLs while stable keys resolve the highest formal version", async () => {
  const state = fixture();
  const first = create(state).job;
  complete(state, first.id);
  const second = create(state).job;
  complete(state, second.id, now + 10);
  const service = serviceApi.createPeriodReportService({
    saveState: async () => {},
    json: (res, value, code = 200) => Object.assign(res, { value, code }),
    prepareGeneration: async () => ({ model: "test-model", skillVersion: "skill-v1" }),
    enqueue: async () => {},
  });
  const stable = await service.view({ method: "GET" }, {}, state, ["period-reports", first.key], now, {
    departmentId: "alpha",
  });
  assert.equal(stable.value.job.id, second.id);
  const historical = await service.view({ method: "GET" }, {}, state, ["period-reports", first.id], now, {
    departmentId: "alpha",
  });
  assert.equal(historical.value.job.id, first.id);
  assert.equal("snapshot" in historical.value.job, false);
  assert.equal(historical.value.job.snapshotCapturedAt, now);
  await assert.rejects(
    service.view({ method: "GET" }, {}, state, ["period-reports", first.id], now, { departmentId: "beta" }),
    /无权/,
  );
});

test("period report UI provides Codex HTML upload and isolated new-window opening", async () => {
  const ui = await readFile(new URL("../public/period-reports.js", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /连接本机设备|pr-pair|data-pr-revoke|等待本机领取|AI 生成草稿/);
  assert.match(ui, /排队中/);
  assert.match(ui, /已正式发布/);
  assert.match(ui, /月度总结/);
  assert.match(ui, /季度总结/);
  assert.match(ui, /已终止/);
  assert.match(ui, /下载 HTML/);
  assert.match(ui, /data-pr-cancel/);
  assert.match(ui, /data-pr-delete/);
  assert.match(ui, /pr-upload-file/);
  assert.match(ui, /data-pr-window-open/);
  assert.match(ui, /sandbox="allow-scripts allow-modals"/);
  assert.doesNotMatch(ui, /pr-public-details/);
});

test("workbench history renders department report categories and labels the renamed admin entries", async () => {
  const page = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(page, /data-report-type="half"/);
  assert.match(page, /data-report-type="year"/);
  assert.match(page, /data-period-report-open/);
  assert.match(page, /"period-reports": \{ label: "总结报告"/);
  assert.match(page, /企微待办/);
  assert.doesNotMatch(page, /部门 HTML 经营报告/);
});

test("retired report worker entrypoints are absent while legacy state remains migratable", async () => {
  const apiSource = await readFile(new URL("../api/[...path].mjs", import.meta.url), "utf8");
  const uiSource = await readFile(new URL("../public/period-reports.js", import.meta.url), "utf8");
  assert.doesNotMatch(apiSource, /report-worker/);
  assert.doesNotMatch(uiSource, /workbench-report-connection|连接本机设备/);
  await assert.rejects(readFile(new URL("../scripts/report-worker.mjs", import.meta.url)));
  await assert.rejects(readFile(new URL("../scripts/install-report-worker.mjs", import.meta.url)));
});

test("admin prepares before generation, persists generated metadata, and retries a published report as a new job", async () => {
  const state = fixture();
  const calls = [];
  const service = serviceApi.createPeriodReportService({
    saveState: async () => calls.push("save"),
    json: (res, value, code = 200) => Object.assign(res, { value, code }),
    prepareGeneration: async (_state, _actor, prepared) => {
      calls.push(`prepare:${prepared.key}`);
      return { model: "deepseek", skillVersion: "period-report-v2" };
    },
    enqueue: async (id) => calls.push(`enqueue:${id}`),
  });
  const actor = { username: "admin", role: "admin" };
  const created = await service.admin(
    { method: "POST", body: input },
    {},
    state,
    ["admin", "period-reports"],
    now,
    actor,
  );
  const job = state.periodReports.jobs[created.value.job.id];
  assert.equal(created.code, 201);
  assert.equal(job.model, "deepseek");
  assert.equal(job.skillVersion, "period-report-v2");
  assert.deepEqual(calls.slice(0, 3), [`prepare:${job.key}`, "save", `enqueue:${job.id}`]);
  const duplicate = await service.admin(
    { method: "POST", body: input },
    {},
    state,
    ["admin", "period-reports"],
    now,
    actor,
  );
  assert.equal(duplicate.code, 200);
  assert.equal(calls.filter((entry) => entry.startsWith("prepare:")).length, 1);
  complete(state, job.id);
  const retry = await service.admin(
    { method: "POST", body: { jobId: job.id } },
    {},
    state,
    ["admin", "period-reports", "retry"],
    now + 4,
    actor,
  );
  assert.equal(retry.code, 201);
  assert.notEqual(retry.value.job.id, job.id);
});

test("concurrent admin creates reuse the first active job after generation preparation", async () => {
  const state = fixture();
  const queued = [];
  let prepared = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const service = serviceApi.createPeriodReportService({
    saveState: async () => {},
    json: (res, value, code = 200) => Object.assign(res, { value, code }),
    prepareGeneration: async () => {
      prepared++;
      await gate;
      return { model: "deepseek", skillVersion: "period-report-v2" };
    },
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

test("website backend exposes asynchronous DeepSeek execution and startup recovery entrypoints", () => {
  assert.equal(typeof runPeriodReportJobFromServer, "function");
  assert.equal(typeof recoverPeriodReportJobsFromServer, "function");
});

test("admin POST queues immediately, backend publishes after flush, and DeepSeek failure leaves no viewable HTML", async () => {
  const login = await api("admin/login", {
    method: "POST",
    body: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(login.statusCode, 200);
  const adminHeaders = { authorization: `Bearer ${login.body.token}` };
  const settings = await api("admin/settings", { headers: adminHeaders });
  const configured = await api("admin/settings", {
    method: "POST",
    headers: adminHeaders,
    body: {
      ...settings.body.settings,
      ai: {
        ...settings.body.settings.ai,
        enabled: true,
        provider: "deepseek",
        model: "deepseek-chat",
        apiKey: "test-key",
      },
    },
  });
  assert.equal(configured.statusCode, 200);

  const account = settings.body.settings.accounts[0];
  const registered = await api("auth/register", {
    method: "POST",
    body: { username: account.username, password: "12345678", displayName: account.name },
  });
  assert.equal(registered.statusCode, 201);
  const user = await api("auth/login", { method: "POST", body: { username: account.username, password: "12345678" } });
  assert.equal(user.statusCode, 200);
  const userToken = user.body.token;

  assert.equal(
    (
      await api("goals", {
        method: "POST",
        token: userToken,
        body: { year: 2026, rows: [{ name: "交付", target: 1 }] },
      })
    ).statusCode,
    200,
  );
  for (const month of [7, 8, 9]) {
    const endDate = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10);
    const report = await api("reports", {
      method: "POST",
      token: userToken,
      body: {
        status: "final",
        data: {
          summaryType: "monthly",
          title: `${month}月总结`,
          startDate: `2026-${String(month).padStart(2, "0")}-01`,
          endDate,
          modules: [{ title: "交付", sections: [{ title: "进展", items: ["已完成"] }] }],
        },
      },
    });
    assert.equal(report.statusCode, 201);
  }

  const queuedCallbacks = [];
  const originalQueueMicrotask = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (callback) => queuedCallbacks.push(callback);
  let jobId;
  try {
    const created = await api("admin/period-reports", {
      method: "POST",
      headers: adminHeaders,
      body: { departmentId: settings.body.settings.departments[0].id, year: 2026, kind: "quarter", part: 3 },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.job.status, "queued");
    assert.equal(queuedCallbacks.length, 1);
    jobId = created.body.job.id;
  } finally {
    globalThis.queueMicrotask = originalQueueMicrotask;
  }

  const published = await runPeriodReportJobFromServer(jobId, {
    request: async ({ snapshot }) => ({
      report: output({ departmentName: snapshot.department.name, period: snapshot.period, snapshot }),
      usage: { inputTokens: 10 },
    }),
  });
  assert.equal(published.status, "published");
  const viewed = await api(`period-reports/${jobId}`, { token: userToken });
  assert.equal(viewed.statusCode, 200);
  assert.match(viewed.body.html, /正式版本/);

  globalThis.queueMicrotask = () => {};
  let failedId;
  try {
    const retry = await api("admin/period-reports/retry", { method: "POST", headers: adminHeaders, body: { jobId } });
    assert.equal(retry.statusCode, 201);
    failedId = retry.body.job.id;
  } finally {
    globalThis.queueMicrotask = originalQueueMicrotask;
  }
  await assert.rejects(
    runPeriodReportJobFromServer(failedId, {
      request: async () => {
        throw new Error("DeepSeek unavailable");
      },
    }),
    /unavailable/,
  );
  const failedView = await api(`period-reports/${failedId}`, { token: userToken });
  assert.equal(failedView.statusCode, 404);
});

test("period report releases the mutation lock before waiting for DeepSeek", async () => {
  const context = await prepareApiPeriodSources(1);
  await configurePeriodAi(context.adminHeaders, {
    enabled: true,
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: "lock-test-key",
  });
  const { created, queuedCallbacks } = await createQueuedApiPeriodJob(context);
  assert.equal(created.statusCode, 201);
  assert.equal(queuedCallbacks.length, 1);

  let started;
  const requestStarted = new Promise((resolve) => {
    started = resolve;
  });
  let continueRequest;
  const waitForRequest = new Promise((resolve) => {
    continueRequest = resolve;
  });
  const running = runPeriodReportJobFromServer(created.body.job.id, {
    request: async ({ snapshot }) => {
      started();
      await waitForRequest;
      return { report: output({ departmentName: snapshot.department.name, period: snapshot.period, snapshot }) };
    },
  });
  await requestStarted;

  const independentMutation = await api("reports", {
    method: "POST",
    token: context.userToken,
    body: {
      status: "draft",
      data: {
        summaryType: "weekly",
        title: "锁外写入验证",
        startDate: "2026-09-14",
        endDate: "2026-09-20",
        modules: [{ title: "交付", sections: [{ title: "进展", items: ["已保存"] }] }],
      },
    },
  });
  assert.equal(independentMutation.statusCode, 201);
  continueRequest();
  assert.equal((await running).status, "published");

  // A late model response must not resurrect a cancelled and then deleted job.
  const next = await createQueuedApiPeriodJob(context);
  const cancelledId = next.created.body.job.id;
  let requestSignal;
  let releaseLate;
  let announceStarted;
  const lateGate = new Promise((resolve) => { releaseLate = resolve; });
  const startedLate = new Promise((resolve) => { announceStarted = resolve; });
  const lateRun = runPeriodReportJobFromServer(cancelledId, {
    request: async ({ snapshot, signal }) => {
      requestSignal = signal;
      announceStarted();
      await lateGate;
      return { report: output({ departmentName: snapshot.department.name, period: snapshot.period, snapshot }) };
    },
  }).then(() => null, (error) => error);
  await startedLate;
  try {
    const denied = await api(`admin/period-reports/${cancelledId}/cancel`, { method: "POST", token: context.userToken });
    assert.ok([401, 403].includes(denied.statusCode));
    const cancelled = await api(`admin/period-reports/${cancelledId}/cancel`, { method: "POST", headers: context.adminHeaders });
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.body.job.status, "cancelled");
    assert.equal(requestSignal.aborted, true);
    const deleted = await api(`admin/period-reports/${cancelledId}`, { method: "DELETE", headers: context.adminHeaders });
    assert.equal(deleted.statusCode, 200);
  } finally {
    releaseLate();
  }
  assert.ok(await lateRun instanceof Error);
  const persisted = JSON.parse(await readFile(defaultLocalStatePath(), "utf8"));
  assert.equal(persisted.periodReports.jobs[cancelledId], undefined);
  assert.equal((await api(`period-reports/${cancelledId}`, { token: context.userToken })).statusCode, 404);
});

test("request failure reloads and persists a failed job without decrypted key or HTML", async () => {
  const context = await prepareApiPeriodSources(2);
  await configurePeriodAi(context.adminHeaders, {
    enabled: true,
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: "persist-key-1234",
  });
  const { created } = await createQueuedApiPeriodJob(context);
  assert.equal(created.statusCode, 201);
  const jobId = created.body.job.id;
  const beforeRun = JSON.parse(await readFile(defaultLocalStatePath(), "utf8")).periodReports.jobs[jobId];
  assert.equal(beforeRun.model, "deepseek-chat");
  assert.equal(JSON.stringify(beforeRun).includes("persist-key-1234"), false);

  await assert.rejects(
    runPeriodReportJobFromServer(jobId, {
      request: async () => {
        throw new Error("DeepSeek unavailable");
      },
    }),
    /unavailable/,
  );
  const reloaded = JSON.parse(await readFile(defaultLocalStatePath(), "utf8")).periodReports.jobs[jobId];
  assert.equal(reloaded.status, "failed");
  assert.equal("html" in reloaded, false);
  assert.equal(JSON.stringify(reloaded).includes("persist-key-1234"), false);
  assert.equal((await api(`period-reports/${jobId}`, { token: context.userToken })).statusCode, 404);
});

test("disabled or non-DeepSeek settings reject before queueing or consuming quota", async () => {
  const context = await prepareApiPeriodSources(3);
  await configurePeriodAi(context.adminHeaders, { enabled: false, provider: "kimi" });
  const before = JSON.parse(await readFile(defaultLocalStatePath(), "utf8"));
  const jobsBefore = Object.keys(before.periodReports?.jobs || {}).length;
  const quotaBefore = before.aiUsage?.[process.env.ADMIN_USERNAME]?.count || 0;
  const rejected = await createQueuedApiPeriodJob(context);
  assert.equal(rejected.created.statusCode, 503);
  assert.equal(rejected.created.body.error, "请先在后台启用并选择 DeepSeek");
  assert.equal(rejected.queuedCallbacks.length, 0);
  const afterRejected = JSON.parse(await readFile(defaultLocalStatePath(), "utf8"));
  assert.equal(Object.keys(afterRejected.periodReports?.jobs || {}).length, jobsBefore);
  assert.equal(afterRejected.aiUsage?.[process.env.ADMIN_USERNAME]?.count || 0, quotaBefore);

  await configurePeriodAi(context.adminHeaders, { enabled: true, provider: "deepseek", model: "deepseek-chat" });
  const accepted = await createQueuedApiPeriodJob(context);
  assert.equal(accepted.created.statusCode, 201);
  assert.equal(accepted.queuedCallbacks.length, 1);
  const afterAccepted = JSON.parse(await readFile(defaultLocalStatePath(), "utf8"));
  assert.equal(afterAccepted.aiUsage?.[process.env.ADMIN_USERNAME]?.count, quotaBefore + 1);
});
