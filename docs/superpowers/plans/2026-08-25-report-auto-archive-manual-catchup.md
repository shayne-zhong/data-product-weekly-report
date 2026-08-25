# Report Auto-Archive Manual Catch-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global-admin-only “报告自动归档” task card whose manual action re-runs the existing due-only archive logic and persists an observable, idempotent result.

**Architecture:** Keep `archiveDueReports` as the single source of truth for eligibility. Add execution-state helpers beside it, orchestrate state transitions in the API, then render both scheduled tasks through the existing admin list with task-specific metrics and confirmation copy.

**Tech Stack:** Node.js ESM, native HTML/CSS/JavaScript, Node test runner, existing JSON/CloudBase state store.

---

## File map

- `PRD.MD`: approved product rules.
- `lib/report-auto-archive.mjs`: report-archive execution lifecycle and task summary.
- `api/[...path].mjs`: persistence orchestration, task list, and manual run endpoint.
- `public/index.html`: heterogeneous scheduled-task cards and feedback.
- `test/report-auto-archive.test.mjs`: domain lifecycle tests.
- `test/persistence-api.test.mjs`: permission, persistence, and idempotency tests.
- `test/workbench-ui.test.mjs`: UI wiring tests.

### Task 1: Synchronize the product rule

**Files:**
- Modify: `PRD.MD:232-242`

- [ ] **Step 1: Add the approved rules**

```markdown
9. 后台“定时任务”提供报告自动归档的人工补跑入口，仅全局管理员可操作。
10. 人工补跑与自动归档共用同一套到期判断，只归档已经到期且尚未归档的报告，不允许提前强制归档。
11. 补跑结果展示最近执行状态、触发方式、完成时间、归档数量和简短错误；重复补跑不得重复归档。
```

- [ ] **Step 2: Check and commit**

```powershell
git diff --check -- PRD.MD
git add -- PRD.MD
git commit -m "docs: specify report archive catch-up"
```

Expected: diff check exits 0 and the PRD-only commit succeeds.

### Task 2: Add durable execution state

**Files:**
- Modify: `test/report-auto-archive.test.mjs`
- Modify: `lib/report-auto-archive.mjs`

- [ ] **Step 1: Write failing lifecycle tests**

Extend the import with `startReportArchiveExecution`, `completeReportArchiveExecution`, `failReportArchiveExecution`, and `reportArchiveTaskSummary`, then add:

```js
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
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/report-auto-archive.test.mjs`

Expected: FAIL because the four new exports do not exist.

- [ ] **Step 3: Implement the minimal helpers**

```js
const REPORT_ARCHIVE_TASK_ID = "report-auto-archive";
const STALE_RUNNING_MS = 15 * 60 * 1000;

function archiveExecution(state) {
  if (!state.reportArchiveExecution || typeof state.reportArchiveExecution !== "object") state.reportArchiveExecution = {};
  return state.reportArchiveExecution;
}

export function startReportArchiveExecution(state, { now = Date.now(), trigger = "scheduled" } = {}) {
  state.reportArchiveExecution = { status: "running", startedAt: now, finishedAt: 0, trigger, archivedCount: 0, error: "" };
  return state.reportArchiveExecution;
}

export function completeReportArchiveExecution(state, { now = Date.now(), result = {} } = {}) {
  const execution = archiveExecution(state);
  Object.assign(execution, { status: "success", finishedAt: now, archivedCount: Number(result.archivedCount || 0), error: "" });
  return execution;
}

export function failReportArchiveExecution(state, { now = Date.now(), error } = {}) {
  const execution = archiveExecution(state);
  Object.assign(execution, { status: "failed", finishedAt: now, error: String(error?.message || error || "执行失败").slice(0, 200) });
  return execution;
}

export function reportArchiveTaskSummary(state, { now = Date.now() } = {}) {
  const schedule = normalizeReportArchiveSchedule(state.settings?.reportArchive);
  const execution = state.reportArchiveExecution || {};
  const stale = execution.status === "running" && now - Number(execution.startedAt || 0) > STALE_RUNNING_MS;
  return {
    id: REPORT_ARCHIVE_TASK_ID, kind: REPORT_ARCHIVE_TASK_ID, name: "报告自动归档",
    schedule: `周日 ${schedule.weeklyTime} · 月末 ${schedule.monthlyTime} · 季末 ${schedule.quarterlyTime}（北京时间）`,
    status: stale ? "failed" : execution.status || "never",
    startedAt: Number(execution.startedAt || 0), finishedAt: Number(execution.finishedAt || 0),
    trigger: execution.trigger || "", archivedCount: Number(execution.archivedCount || 0),
    error: stale ? "上次执行未正常完成" : execution.error || "",
  };
}
```

- [ ] **Step 4: Verify GREEN and commit**

```powershell
node --test test/report-auto-archive.test.mjs
git add -- lib/report-auto-archive.mjs test/report-auto-archive.test.mjs
git commit -m "feat: track report archive executions"
```

Expected: all domain tests pass before the commit.

### Task 3: Add the admin API

**Files:**
- Modify: `test/persistence-api.test.mjs:137-170`
- Modify: `api/[...path].mjs:23,380-392,1213-1223`

- [ ] **Step 1: Write a failing API test**

Use the existing `api()` helper and global-admin login pattern:

```js
test("global admin can manually catch up only due report archives", async () => {
  const adminLogin = await api("/admin/login", { method: "POST", token: "", body: { username: "Admin", password: "888888" } });
  const headers = { authorization: `Bearer ${adminLogin.body.token}` };
  const list = await api("/admin/scheduled-tasks", { token: "", headers });
  assert.deepEqual(list.body.tasks.map((task) => task.id), ["weekly-task-rollover", "report-auto-archive"]);
  const anonymous = await api("/admin/scheduled-tasks/report-auto-archive/run", { method: "POST", token: "" });
  assert.equal(anonymous.statusCode, 401);
  const run = await api("/admin/scheduled-tasks/report-auto-archive/run", { method: "POST", token: "", headers });
  assert.equal(run.statusCode, 200);
  assert.equal(run.body.task.status, "success");
  assert.equal(run.body.result.trigger.startsWith("manual:"), true);
  const repeat = await api("/admin/scheduled-tasks/report-auto-archive/run", { method: "POST", token: "", headers });
  assert.equal(repeat.body.result.archivedCount, 0);
  const readBack = await api("/admin/scheduled-tasks", { token: "", headers });
  assert.equal(readBack.body.tasks[1].status, "success");
});
```

Before `run`, create a due report through `/reports` using `summaryType: "weekly"`, `startDate: "2000/01/01"`, `endDate: "2000/01/02"`, `status: "draft"`, and one non-empty module. Assert the first run archives exactly one report. The existing leader test remains the 403 proof.

- [ ] **Step 2: Verify RED**

Run: `node --test test/persistence-api.test.mjs`

Expected: FAIL because only the weekly task is listed and the report run route is absent.

- [ ] **Step 3: Add the persistence-aware executor**

Import the four execution helpers. Add:

```js
async function executeReportAutoArchive(state, { triggeredAt = Date.now(), trigger = "scheduled" } = {}) {
  startReportArchiveExecution(state, { now: triggeredAt, trigger });
  await saveState(state);
  try {
    const result = archiveDueReports(state, { triggeredAt, trigger });
    completeReportArchiveExecution(state, { now: Date.now(), result });
    await saveState(state);
    return result;
  } catch (error) {
    failReportArchiveExecution(state, { now: Date.now(), error });
    try { await saveState(state); } catch (saveError) { console.error("Report archive failure status save failed:", saveError?.message || saveError); }
    throw error;
  }
}
```

Make both `runReportAutoArchiveFromServer` and `/api/internal/report-auto-archive` call this executor.

- [ ] **Step 4: Add list and run routes**

```js
if (parts[2] === "report-auto-archive" && parts[3] === "run") {
  if (req.method !== "POST") return methodNotAllowed(res);
  const result = await executeReportAutoArchive(state, { triggeredAt: now, trigger: `manual:${decoded.username}` });
  return json(res, { task: reportArchiveTaskSummary(state, { now: Date.now() }), result });
}
if (parts.length === 2) {
  if (req.method !== "GET") return methodNotAllowed(res);
  return json(res, { tasks: [weeklyRolloverTaskSummary(state, { now }), reportArchiveTaskSummary(state, { now })] });
}
```

Keep the existing leader 403 gate unchanged.

- [ ] **Step 5: Verify and commit**

```powershell
node --test test/persistence-api.test.mjs test/report-auto-archive.test.mjs
git add -- 'api/[...path].mjs' test/persistence-api.test.mjs
git commit -m "feat: add report archive catch-up API"
```

Expected: selected tests pass; repeated execution returns zero new archives.

### Task 4: Add the admin control

**Files:**
- Modify: `test/workbench-ui.test.mjs`
- Modify: `public/index.html:3854-3880,5005-5024`

- [ ] **Step 1: Write failing UI assertions**

```js
test("scheduled task UI supports due-only report archive catch-up", () => {
  assert.match(html, /task\.kind === "report-auto-archive"/);
  assert.match(html, /只会归档已经到期的报告/);
  assert.match(html, /不会提前归档/);
  assert.match(html, /archivedCount/);
  assert.match(html, /scheduledTasks\.map/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL because rendering and confirmation are weekly-only.

- [ ] **Step 3: Render task-specific results**

Inside `renderScheduledTasks`, add:

```js
const taskResult = (task) => task.kind === "report-auto-archive"
  ? `归档 ${Number(task.archivedCount || 0)} 份`
  : `结转 ${Number(task.rolledTaskCount || 0)} 项 · ${Number(task.completedDepartmentCount || 0)}/${Number(task.departmentCount || 0)} 个部门`;
```

Hide “结转周次” for the report task, display `taskResult(task)`, and label its button “立即补跑”.

- [ ] **Step 4: Make confirmation and feedback task-specific**

```js
const task = scheduledTasks.find((item) => item.id === button.dataset.runScheduledTask);
const isReportArchive = task?.kind === "report-auto-archive";
const message = isReportArchive
  ? "确认立即补跑报告自动归档？只会归档已经到期的报告，不会提前归档仍在编辑的报告。"
  : "确认立即重新启动周任务结转？已成功结转的部门不会重复创建任务。";
if (!confirm(message)) return;
```

After success, replace only the returned card and show the right metric:

```js
scheduledTasks = result.task ? scheduledTasks.map((task) => task.id === result.task.id ? result.task : task) : scheduledTasks;
setSyncStatus(isReportArchive
  ? `补跑完成，归档 ${Number(result.result?.archivedCount || 0)} 份`
  : `定时任务执行完成，结转 ${Number(result.result?.rolledTaskCount || 0)} 项`, "ok");
```

- [ ] **Step 5: Verify and commit**

```powershell
node --test test/workbench-ui.test.mjs
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "feat: add report archive catch-up control"
```

Expected: all UI tests pass.

### Task 5: Full verification

**Files:**
- Verify all files above.

- [ ] **Step 1: Run focused tests**

Run: `node --test test/report-auto-archive.test.mjs test/persistence-api.test.mjs test/workbench-ui.test.mjs`

Expected: zero failures.

- [ ] **Step 2: Run project checks**

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
git diff --check
```

Expected: full tests, lint, build, and diff check all exit 0.

- [ ] **Step 3: Inspect scope**

```powershell
git status --short
git log --oneline -5
```

Expected: only the pre-existing unrelated `.claude/` remains untracked; all feature files are committed.
