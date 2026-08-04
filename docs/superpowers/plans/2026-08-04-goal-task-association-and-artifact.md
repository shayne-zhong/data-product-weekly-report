# Goal Task Association and Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make completed todos the sole source of goal contribution, move artifacts from goals to todos, and replace row actions with a read-only linked-todo view plus selectable deletion.

**Architecture:** Keep `task.goalLinks` as the relationship source of truth and derive goal current values from completed tasks. Move artifact metadata and transactional file operations onto task records while retaining the generic store, preview, and multipart modules. The goals save endpoint clears task links for removed goal IDs in the same state save.

**Tech Stack:** Node.js ESM, native HTML/CSS/JavaScript, Node test runner, existing JSON state store and artifact modules.

---

## File map

- Create `lib/task-artifact-service.mjs` plus task artifact service/API tests.
- Rename `lib/goal-artifact-core.mjs` to `lib/artifact-core.mjs` for resource-neutral validation and public metadata.
- Delete the goal artifact service and replace its tests with task artifact coverage.
- Modify `lib/task-core.mjs`, `api/[...path].mjs`, `public/index.html`, focused API/UI tests, `PRD.MD`, and `PROJECT_ARCHITECTURE.md`.

### Task 1: Completed-task contribution domain logic

**Files:**
- Modify: `lib/task-core.mjs`
- Modify: `test/task-core.test.mjs`

- [ ] **Step 1: Write the failing aggregation tests**

```js
import { completedGoalContributionById } from "../lib/task-core.mjs";

test("sums only completed task links", () => {
  const totals = completedGoalContributionById([
    buildEmptyTask({ status: "已完成", goalLinks: [{ goalId: "g1", contribution: 2 }] }),
    buildEmptyTask({ status: "进行中", goalLinks: [{ goalId: "g1", contribution: 99 }] }),
    buildEmptyTask({ status: "已完成", goalLinks: [{ goalId: "g1", contribution: 3 }, { goalId: "g2", contribution: 4 }] }),
  ]);
  assert.deepEqual(totals, { g1: 5, g2: 4 });
});
```

- [ ] **Step 2: Run it and verify failure**

Run: `npm.cmd test -- --test-name-pattern="sums only completed" test/task-core.test.mjs`

Expected: FAIL because the export does not exist.

- [ ] **Step 3: Implement normalized aggregation**

```js
export function completedGoalContributionById(tasks = []) {
  const totals = {};
  for (const task of tasks) {
    if (task?.status !== "已完成") continue;
    for (const link of normalizeGoalLinks(task)) {
      const value = Number(link.contribution);
      if (!link.goalId || !Number.isFinite(value) || value <= 0) continue;
      totals[link.goalId] = (totals[link.goalId] || 0) + value;
    }
  }
  return totals;
}
```

Export a public goal-link normalizer for API cleanup so the same normalization rules are reused.

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- test/task-core.test.mjs`

Expected: PASS.

```powershell
git add -- lib/task-core.mjs test/task-core.test.mjs
git commit -m "feat: derive goal contributions from completed tasks"
```

### Task 2: Task-owned artifact service and routes

**Files:**
- Create: `lib/task-artifact-service.mjs`
- Create: `test/task-artifact-service.test.mjs`
- Create: `test/task-artifact-api.test.mjs`
- Rename: `lib/goal-artifact-core.mjs` to `lib/artifact-core.mjs`
- Rename: `test/goal-artifact-core.test.mjs` to `test/artifact-core.test.mjs`
- Modify: `api/[...path].mjs`
- Delete: `lib/goal-artifact-service.mjs`
- Delete: `test/goal-artifact-service.test.mjs`
- Delete: `test/goal-artifact-api.test.mjs`

- [ ] **Step 1: Write failing service tests**

Use `state.tasks` fixtures and assert public metadata, department isolation, replacement rollback, read, and delete:

```js
test("uploads onto a task and hides storage keys", async () => {
  const state = { tasks: { t1: { id: "t1", departmentId: "data", artifact: null } } };
  const artifact = await service.upload({ state, departmentId: "data", taskId: "t1", actor, file: pdfFile, save });
  assert.equal(state.tasks.t1.artifact.storageKey, "new.pdf");
  assert.equal(artifact.storageKey, undefined);
  assert.equal(artifact.originalName, "结果.pdf");
});
```

- [ ] **Step 2: Write failing API tests**

```js
const uploaded = await multipartApi(`/task/${taskId}/artifact`, { token, file: pdfFile });
assert.equal(uploaded.statusCode, 201);
const saved = await jsonApi(`/task/${taskId}`, { method: "POST", token, body: { task: { artifact: null } } });
assert.equal(saved.body.task.artifact.originalName, "结果.pdf");
assert.equal((await jsonApi(`/task/${taskId}/artifact/preview`, { token })).statusCode, 200);
assert.equal((await jsonApi(`/task/${taskId}/artifact/download`, { token })).statusCode, 200);
assert.equal((await jsonApi(`/task/${taskId}/artifact`, { method: "DELETE", token })).statusCode, 200);
```

- [ ] **Step 3: Verify both tests fail**

Run: `npm.cmd test -- test/task-artifact-service.test.mjs test/task-artifact-api.test.mjs`

Expected: FAIL because the service and routes do not exist.

- [ ] **Step 4: Extract generic artifact helpers**

Move the existing file allowlist, MIME/20 MB validation, preview-kind logic, and public metadata shaping to `lib/artifact-core.mjs`:

```js
export function publicArtifact(artifact) {
  if (!artifact) return null;
  const { originalName, mimeType, size, previewMimeType, updatedAt, updatedBy } = artifact;
  return { originalName, mimeType, size, previewMimeType, updatedAt, updatedBy };
}
```

- [ ] **Step 5: Implement task resolution and transactional service**

```js
function resolveTask(state, departmentId, taskId, actor) {
  const task = state.tasks?.[taskId];
  if (!actor || actor.departmentId !== departmentId || !task || task.departmentId !== departmentId) {
    throw httpError(404, "待办不存在");
  }
  return task;
}
```

Adapt the existing upload/read/remove order exactly: write new files, assign metadata, save state, then clean old files; on failure restore old metadata and remove new files. Mutation permission follows the existing task edit permission, while department members with task visibility may preview/download.

- [ ] **Step 6: Wire `/api/task/:taskId/artifact` and protect metadata**

```js
if (parts[2] === "artifact") {
  const action = parts[3] || "";
  const context = { state, departmentId: actor.departmentId, taskId, actor };
  if (req.method === "POST" && !action) {
    const artifact = await taskArtifactService.upload({ ...context, file: await parseSingleFile(req), save: () => saveState(state) });
    return json(res, { artifact }, 201);
  }
  if (req.method === "GET" && action === "preview") return sendArtifact(res, await taskArtifactService.readPreview(context), { inline: true });
  if (req.method === "GET" && action === "download") return sendArtifact(res, await taskArtifactService.readOriginal(context));
  if (req.method === "DELETE" && !action) {
    await taskArtifactService.remove({ ...context, save: () => saveState(state) });
    return json(res, { ok: true });
  }
}
```

Ordinary task POST must preserve `existing.artifact`. Task deletion saves state before best-effort stored-file cleanup.

- [ ] **Step 7: Remove goal artifact behavior, verify, and commit**

Delete goal artifact routes, response permissions, service and tests. Run:

`npm.cmd test -- test/artifact-core.test.mjs test/artifact-store.test.mjs test/artifact-preview.test.mjs test/task-artifact-service.test.mjs test/task-artifact-api.test.mjs test/persistence-api.test.mjs`

Expected: PASS.

```powershell
git add -- api/[...path].mjs lib test
git commit -m "feat: move artifacts from goals to tasks"
```

### Task 3: Goal aggregation and deletion cleanup API

**Files:**
- Modify: `api/[...path].mjs`
- Modify: `test/department-api.test.mjs`
- Modify: `test/report-api.test.mjs`

- [ ] **Step 1: Write failing response and cleanup tests**

```js
assert.equal((await api("/goals", { token })).body.rows[0].current, 5);
await api("/goals", { method: "POST", token, body: { year: "2026", rows: [] } });
const tasks = (await api("/tasks", { token })).body.tasks;
assert.equal(tasks.length, 3);
assert.ok(tasks.every((task) => task.goalLinks.every((link) => link.goalId !== goalId)));
```

- [ ] **Step 2: Run and verify failure**

Run: `npm.cmd test -- --test-name-pattern="completed contributions|removed goals clear" test/department-api.test.mjs test/report-api.test.mjs`

Expected: FAIL on derived current and link cleanup.

- [ ] **Step 3: Derive goal current values on GET and POST responses**

```js
function publicGoalsWithContributions(rows, state, departmentId) {
  const totals = completedGoalContributionById(listTasksForDepartment(state, departmentId));
  return rows.map((row) => ({ ...row, current: totals[row.id] || 0 }));
}
```

Ignore client-supplied `current` as authoritative.

- [ ] **Step 4: Clear removed links in the same state save**

```js
const removedIds = new Set(current.rows.map((row) => row.id).filter((id) => !incomingIds.has(id)));
for (const task of listTasksForDepartment(state, departmentId)) {
  task.goalLinks = normalizeTaskGoalLinks(task).filter((link) => !removedIds.has(link.goalId));
  const first = task.goalLinks[0] || {};
  task.goalId = first.goalId || "";
  task.goalContribution = first.contribution || 0;
  task.goalContributionUnit = first.unit || "";
  task.goalContributionNote = first.note || "";
}
await saveState(state);
```

- [ ] **Step 5: Verify and commit**

Run: `npm.cmd test -- test/department-api.test.mjs test/report-api.test.mjs`

Expected: PASS.

```powershell
git add -- api/[...path].mjs test/department-api.test.mjs test/report-api.test.mjs
git commit -m "feat: clean task links when goals are deleted"
```

### Task 4: Goal and todo UI behavior

**Files:**
- Modify: `public/index.html`
- Modify: `test/workbench-ui.test.mjs`
- Rename: `test/goal-artifact-ui.test.mjs` to `test/task-artifact-ui.test.mjs`

- [ ] **Step 1: Replace old UI contracts with failing desired contracts**

```js
assert.deepEqual(runtime.goalTableColumns.map(({ key }) => key), [
  "select", "seq", "name", "definition", "owner", "lastYearActual", "target", "current", "progress", "status", "actions",
]);
assert.doesNotMatch(html, /id="resetGoalsBtn"/);
assert.doesNotMatch(html, /data-quarter-goal=/);
assert.match(html, /id="deleteGoalsBtn"/);
assert.match(html, /关联待办/);
assert.match(html, /\/api\/task\/\$\{encodeURIComponent\(taskId\)\}\/artifact/);
```

Also assert the linked-todo view contains no inputs, unlink control, upload, replace, or delete controls.

- [ ] **Step 2: Run and verify failure**

Run: `npm.cmd test -- test/workbench-ui.test.mjs test/task-artifact-ui.test.mjs`

Expected: FAIL on obsolete goal controls and routes.

- [ ] **Step 3: Implement selectable goal deletion**

```js
let goalDeleteMode = false;
const selectedGoalIds = new Set();

function setGoalDeleteMode(enabled) {
  goalDeleteMode = enabled;
  selectedGoalIds.clear();
  $("confirmDeleteGoalsBtn").hidden = !enabled;
  $("cancelDeleteGoalsBtn").hidden = !enabled;
  renderGoals();
}
```

Show checkboxes only in selection mode. Disable confirm with no selection. Confirmation states selected goal count and affected link count; one save filters selected rows, reloads tasks/goals, and exits selection mode.

- [ ] **Step 4: Replace row actions with read-only linked todos**

```js
const link = validGoalLinks(task).find((item) => item.goalId === goalId);
const counted = task.status === "已完成";
const countedContribution = counted ? Number(link.contribution || 0) : 0;
```

Render task title, module, owner, status, entered contribution, counted state, note, public artifact metadata, preview/download, and `打开待办详情`. Remove split and row-delete actions. Do not allow edits in this view.

- [ ] **Step 5: Move artifact UI into task detail**

Rename goal artifact DOM/state to task equivalents and use:

```js
const response = await authedFetch(`/api/task/${encodeURIComponent(taskId)}/artifact/${action}`);
```

Upload/delete through `/api/task/:taskId/artifact`; revoke object URLs on task switch, close, and replacement. Refresh task state and any open linked view after mutations.

- [ ] **Step 6: Make goal current/progress read-only**

Render API-derived `row.current` as text and calculate progress from `current / target`, preserving zero-target behavior. Remove client autosave listeners for current/progress.

- [ ] **Step 7: Verify and commit**

Run: `npm.cmd test -- test/workbench-ui.test.mjs test/task-artifact-ui.test.mjs`

Expected: PASS.

```powershell
git add -- public/index.html test/workbench-ui.test.mjs test/task-artifact-ui.test.mjs
git add -u -- test/goal-artifact-ui.test.mjs
git commit -m "feat: manage goal associations through tasks"
```

### Task 5: PRD and architecture alignment

**Files:**
- Modify: `PRD.MD`
- Modify: `PROJECT_ARCHITECTURE.md`

- [ ] **Step 1: Update confirmed product rules**

```markdown
- 指标贡献仅来源于状态为“已完成”的关联待办，并按贡献数累加。
- 指标关联、贡献数和产物只能在待办详情维护。
- 目标页的关联待办详情只读，可查看贡献与待办产物。
- 目标删除通过顶部选择态完成；删除目标只解除关联，不删除待办。
```

- [ ] **Step 2: Update module ownership**

```markdown
- 待办产物：`lib/task-artifact-service.mjs`、`lib/artifact-core.mjs`、`lib/artifact-store.mjs`、`lib/artifact-preview.mjs`、`lib/multipart-file.mjs`。
```

Document completed-task-derived goal values in the data flow.

- [ ] **Step 3: Validate and commit**

Run: `git diff --check -- PRD.MD PROJECT_ARCHITECTURE.md`

Expected: no output. Re-read changed sections with UTF-8 encoding.

```powershell
git add -- PRD.MD PROJECT_ARCHITECTURE.md
git diff --cached --check
git commit -m "docs: align goals with completed task contributions"
```

### Task 6: Integrated verification

**Files:**
- Verify only; do not modify unrelated files.

- [ ] **Step 1: Run affected tests**

```powershell
npm.cmd test -- test/task-core.test.mjs test/artifact-core.test.mjs test/artifact-store.test.mjs test/artifact-preview.test.mjs test/task-artifact-service.test.mjs test/task-artifact-api.test.mjs test/department-api.test.mjs test/report-api.test.mjs test/workbench-ui.test.mjs test/task-artifact-ui.test.mjs test/persistence-api.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run build and lint**

```powershell
npm.cmd run build
npm.cmd run lint
```

Expected: both exit 0.

- [ ] **Step 3: Review scope and user-owned changes**

```powershell
git status --short
git diff --stat HEAD~4..HEAD
```

Expected: feature commits contain only planned files. Existing user-owned modifications and untracked files remain untouched.

- [ ] **Step 4: Perform manual smoke checks**

Run `npm.cmd start`; verify open/completed contribution changes, single/batch goal deletion, navigation from linked todos to task detail, and a PDF/image upload-preview-download-delete cycle.

Expected: completed-only totals, tasks preserved after goal deletion, read-only linked view, and artifact management only in task detail.
