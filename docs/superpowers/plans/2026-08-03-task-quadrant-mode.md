# Task Quadrant Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在部门待办页新增默认启用、可记忆布局的四象限模式，同时保留现有状态列表看板。

**Architecture:** 前端继续使用 `public/index.html` 单页结构，通过一个视图分发函数在现有状态看板与新四象限之间切换。任务分类复用已有 `priority` 字段和任务保存 API；模式与中心点比例按用户和部门保存在 `localStorage`，后端和数据结构不变。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node.js ESM、Node test runner、PowerShell

---

## File Structure

- Modify: `PRD.MD:144-199` — 写入已确认产品行为、验收标准和变更记录；包含用户已授权一并提交的现有 PRD 改动。
- Modify: `public/index.html:28-55,175-208,735-813,2540-2622,2762-2780,3735-3840,4046-4137,4770-4808` — 双视图 UI、四象限渲染、偏好、拖放、新增和中心点交互。
- Modify: `test/workbench-ui.test.mjs:145` — 增加四象限模式的源码级行为契约测试。
- Reference: `docs/superpowers/specs/2026-08-03-task-quadrant-mode-design.md` — 已批准设计。

### Task 1: Synchronize the confirmed product behavior into PRD

**Files:**
- Modify: `PRD.MD:144-199`

- [ ] **Step 1: Add the confirmed requirement and acceptance section**

Insert before `## 功能范围`:

```markdown
## 部门待办四象限模式

### 使用角色与入口

登录用户从“部门待办”进入。页面首次默认显示四象限模式，并可切换到原有列表模式；系统按当前用户和部门记住最后选择。

### 正常流程

1. 四象限按照重要紧急、重要不紧急、不重要紧急、不重要不紧急展示当前筛选范围内的未完成任务。
2. 已完成任务不在四象限展示，继续保留在列表模式和历史任务中。
3. 用户将任务拖入另一象限后，系统只修改优先级，不修改任务状态。
4. 每个象限可直接新增“待开始”任务，并自动带入当前象限优先级。
5. 用户可拖动中心点调整横纵比例，范围为 25%–75%；布局按用户和部门保存在浏览器中，可恢复为 50% × 50%。
6. 搜索、模块筛选、“只看我的”和批量管理同时作用于两种模式。

### 异常与边界

1. 优先级保存失败时任务恢复到原象限并提示失败。
2. 本地模式或布局数据损坏时恢复为四象限和 50% × 50%。
3. 窄屏下四象限纵向排列并隐藏中心拖动点。
4. 列表模式原有按状态拖动、阻塞原因校验和历史任务行为不变。

### 验收标准

1. 首次进入默认四象限，刷新后保留用户最后选择的模式和布局。
2. 四种优先级的未完成任务进入正确象限，已完成任务不出现。
3. 跨象限拖动成功后刷新仍保持分类，保存失败时自动回滚。
4. 中心点可在 25%–75% 范围内鼠标和键盘移动，恢复按钮回到 50% × 50%。
5. 筛选、新增和批量删除在四象限模式正常工作，列表模式无回归。
```

Append under `## 变更记录`:

```markdown
- 2026-08-03：确认部门待办四象限模式、跨象限修改优先级、用户级布局记忆及完成任务展示边界。
```

- [ ] **Step 2: Verify PRD coverage and formatting**

Run:

```powershell
Select-String -LiteralPath 'PRD.MD' -Pattern '^## 部门待办四象限模式|跨象限|25%–75%|2026-08-03' -Encoding UTF8
npx.cmd prettier --check PRD.MD
```

Expected: all four concepts are found and Prettier passes.

- [ ] **Step 3: Commit the PRD baseline**

```powershell
git add -- PRD.MD
git diff --cached --check
git commit -m "docs: define task quadrant mode"
```

Expected: `PRD.MD` is committed, including the pre-existing PRD baseline changes explicitly authorized by the user.

### Task 2: Add the dual-view skeleton and quadrant rendering

**Files:**
- Modify: `test/workbench-ui.test.mjs:145`
- Modify: `public/index.html:28-55,175-208,735-813,2540-2622,2762-2780`

- [ ] **Step 1: Write failing UI contract tests**

Append:

```javascript
test("department tasks default to a remembered quadrant view", () => {
  assert.match(html, /data-task-view-mode="quadrant"/);
  assert.match(html, /data-task-view-mode="list"/);
  assert.match(html, /let taskViewMode = "quadrant"/);
  assert.match(html, /function taskViewPreferenceKey/);
  assert.match(html, /currentUser\?\.username/);
  assert.match(html, /currentDepartment\(\)\?\.id/);
});

test("quadrant view groups only unfinished tasks by normalized priority", () => {
  for (const priority of ["重要紧急", "重要不紧急", "不重要紧急", "不重要不紧急"]) {
    assert.match(html, new RegExp(`data-drop-priority="\\$\\{definition\\.priority\\}"|${priority}`));
  }
  assert.match(html, /function renderQuadrantBoard/);
  assert.match(html, /task\.status !== "已完成"/);
  assert.match(html, /normalizePriority\(task\.priority\) === definition\.priority/);
  assert.match(html, /function renderTaskCard/);
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL because the task view buttons and `renderQuadrantBoard` do not exist.

- [ ] **Step 3: Add mode controls and view state**

Insert in the task toolbar before the spacer:

```html
<div class="seg task-view-switch" aria-label="任务展示模式">
  <button class="active" data-task-view-mode="quadrant">四象限模式</button>
  <button data-task-view-mode="list">列表模式</button>
</div>
<button class="ghost-btn" id="resetQuadrantLayoutBtn">恢复默认布局</button>
```

Add state beside the existing task filters:

```javascript
let taskViewMode = "quadrant";
let quadrantLayout = { x: 50, y: 50 };

function taskViewPreferenceKey() {
  const username = currentUser?.username || "anonymous";
  const departmentId = currentDepartment()?.id || currentUser?.department?.id || "default";
  return `${storageKey}-task-view-${departmentId}-${username}`;
}

function clampQuadrantRatio(value) {
  return Math.max(25, Math.min(75, Number(value) || 50));
}

function loadTaskViewPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(taskViewPreferenceKey()) || "null");
    taskViewMode = saved?.mode === "list" ? "list" : "quadrant";
    quadrantLayout = { x: clampQuadrantRatio(saved?.x), y: clampQuadrantRatio(saved?.y) };
  } catch {
    taskViewMode = "quadrant";
    quadrantLayout = { x: 50, y: 50 };
  }
}

function saveTaskViewPreferences() {
  localStorage.setItem(taskViewPreferenceKey(), JSON.stringify({ mode: taskViewMode, ...quadrantLayout }));
}
```

Call `loadTaskViewPreferences()` in `initializeApp()` after `currentUser` is confirmed and before `showAuthenticatedWorkspace()`.

- [ ] **Step 4: Extract shared task card rendering and dispatch views**

Move the current task card markup into:

```javascript
function renderTaskCard(task) {
  const percent = taskProgressPercent(task);
  return `
    <article class="task-card ${task.id === selectedTaskId ? "active" : ""}" data-task-id="${task.id}" draggable="${!batchMode}">
      ${batchMode ? `<label class="select-box"><input type="checkbox" data-select-task="${task.id}" ${selectedTaskIds.has(task.id) ? "checked" : ""} /> 选择</label>` : ""}
      <div class="task-top"><div class="task-title">${escapeHtml(task.title || "未命名任务")}</div><button class="more" type="button">•••</button></div>
      <div class="tags">
        <span class="tag ${moduleChipClass(task.module)}">${escapeHtml(task.module)}</span>
        <span class="tag ${normalizePriority(task.priority) === "重要紧急" ? "priority-high" : ""}">${escapeHtml(normalizePriority(task.priority))}</span>
        ${validGoalLinks(task).length ? `<span class="tag module-data">目标贡献 ${validGoalLinks(task).length}项</span>` : ""}
        ${latestLog(task)?.date === todayIso() ? `<span class="tag module-data">今日已更新</span>` : ""}
        ${task.completedAt ? `<span class="tag module-data">✓ 已完成</span>` : ""}
      </div>
      <div class="task-meta"><span>${task.dueDate ? `${isOverdue(task) ? "已逾期 " : ""}${escapeHtml(displayDate(task.dueDate))}` : "未设截止日"}</span><span class="mini-avatar">${escapeHtml(ownerInitial(task))}</span></div>
      ${task.description ? `<div class="task-desc">${escapeHtml(task.description).slice(0, 120)}</div>` : ""}
      ${validGoalLinks(task).length ? `<div class="task-desc">关联指标：${escapeHtml(goalLinksSummary(task))}</div>` : ""}
      ${task.blocker ? `<div class="risk-box">${escapeHtml(task.blocker)}</div>` : ""}
      <div class="progress-row"><div class="progress-line"><span style="width:${percent}%;${task.status === "已完成" ? "background:var(--green)" : ""}"></span></div><span class="progress-text">${percent}%</span></div>
    </article>`;
}
```

Rename the existing renderer to `renderStatusBoard()`, replace its inline card markup with `rows.map(renderTaskCard)`, and add:

```javascript
const quadrantDefinitions = [
  { priority: "重要紧急", tone: "critical", hint: "立即处理，优先级最高" },
  { priority: "重要不紧急", tone: "important", hint: "重要但不紧急，规划时间处理" },
  { priority: "不重要紧急", tone: "urgent", hint: "紧急但不重要，尽量授权或快速处理" },
  { priority: "不重要不紧急", tone: "later", hint: "不重要不紧急，有空再做" },
];

function renderQuadrantBoard() {
  const visibleTasks = tasks.filter((task) => task.status !== "已完成").filter(taskMatchesFilters);
  const bulkBar = batchMode ? `<div class="bulk-bar quadrant-bulk-bar"><span>已选择 ${selectedTaskIds.size} 项</span><div class="actions"><button class="btn small secondary" id="cancelBatchBtn">取消</button><button class="btn small danger" id="deleteSelectedBtn">删除所选</button></div></div>` : "";
  $("board").innerHTML = `${bulkBar}<div class="quadrant-board" style="--split-x:${quadrantLayout.x}%;--split-y:${quadrantLayout.y}%">
    ${quadrantDefinitions.map((definition) => {
      const rows = visibleTasks.filter((task) => normalizePriority(task.priority) === definition.priority);
      return `<section class="quadrant quadrant-${definition.tone}" data-drop-priority="${definition.priority}">
        <div class="quadrant-head"><div><strong>${definition.priority}</strong><p>${definition.hint}</p></div><span class="count">${rows.length}</span></div>
        <div class="quadrant-cards">${rows.map(renderTaskCard).join("") || `<div class="quadrant-empty">暂无任务</div>`}</div>
        <button class="add-quadrant-task" data-add-priority="${definition.priority}">＋ 添加任务</button>
      </section>`;
    }).join("")}
    <button class="quadrant-handle" id="quadrantHandle" aria-label="调整四象限布局" aria-valuetext="横向 ${quadrantLayout.x}%，纵向 ${quadrantLayout.y}%"></button>
  </div>`;
}

function renderBoard() {
  $("board").classList.toggle("quadrant-mode", taskViewMode === "quadrant");
  document.querySelectorAll("[data-task-view-mode]").forEach((button) => button.classList.toggle("active", button.dataset.taskViewMode === taskViewMode));
  $("resetQuadrantLayoutBtn").hidden = taskViewMode !== "quadrant";
  if (taskViewMode === "quadrant") renderQuadrantBoard();
  else renderStatusBoard();
}
```

- [ ] **Step 5: Add the basic quadrant styles**

Add:

```css
.task-view-switch button.active{color:var(--primary)}
.kanban.quadrant-mode{display:block;overflow:visible}
.quadrant-board{position:relative;display:grid;grid-template-columns:var(--split-x) minmax(0,1fr);grid-template-rows:var(--split-y) minmax(0,1fr);min-height:620px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff}
.quadrant{min-width:0;min-height:0;padding:16px;overflow:auto;border:1px solid rgba(49,94,251,.12)}
.quadrant-critical{background:linear-gradient(135deg,#fff5f5,#fff)}
.quadrant-important{background:linear-gradient(135deg,#fff9e8,#fff)}
.quadrant-urgent{background:linear-gradient(135deg,#f3f7ff,#fff)}
.quadrant-later{background:linear-gradient(135deg,#effbf7,#fff)}
.quadrant-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.quadrant-head strong{font-size:14px}.quadrant-head p{margin:5px 0 0;color:var(--muted);font-size:12px}
.quadrant-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;align-items:start}
.quadrant-cards .task-card{margin:0}.quadrant-empty{grid-column:1/-1;padding:42px 16px;text-align:center;color:var(--muted)}
.add-quadrant-task{margin-top:12px;border:0;background:transparent;color:var(--primary);cursor:pointer;font-weight:700}
.quadrant-bulk-bar{margin-bottom:10px}.quadrant-handle{position:absolute;left:var(--split-x);top:var(--split-y);width:26px;height:26px;transform:translate(-50%,-50%);border:3px solid #fff;border-radius:50%;background:var(--primary);box-shadow:0 3px 12px rgba(49,94,251,.35);cursor:move;z-index:3}
.quadrant-handle:focus-visible{outline:3px solid rgba(49,94,251,.28);outline-offset:3px}
@media(max-width:760px){.quadrant-board{display:block;min-height:0}.quadrant{min-height:240px}.quadrant-handle{display:none}.quadrant-cards{grid-template-columns:1fr}}
```

- [ ] **Step 6: Run the focused test and commit**

Run: `node --test test/workbench-ui.test.mjs`

Expected: PASS.

```powershell
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "feat: add task quadrant view"
```

### Task 3: Implement quadrant creation, batch selection, and save rollback

**Files:**
- Modify: `test/workbench-ui.test.mjs`
- Modify: `public/index.html:2787-2842,3735-3840,4046-4097`

- [ ] **Step 1: Write failing interaction contract tests**

Append:

```javascript
test("quadrant interactions create select and persist priority safely", () => {
  assert.match(html, /data-add-priority/);
  assert.match(html, /data-select-priority/);
  assert.match(html, /data-drop-priority/);
  assert.match(html, /const previousPriority = normalizePriority\(task\.priority\)/);
  assert.match(html, /task\.priority = previousPriority/);
  assert.match(html, /分类更新失败/);
  assert.match(html, /status: "待开始"/);
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL because priority add/select/drop handlers are incomplete.

- [ ] **Step 3: Reuse one immediate task persistence function**

Add:

```javascript
async function persistTask(task) {
  await apiJson(`/api/task/${encodeURIComponent(task.id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task }),
  });
}
```

Use `persistTask(task)` inside `scheduleSaveTask()` and in the priority drop handler.

- [ ] **Step 4: Reuse one task creation helper**

Add:

```javascript
async function createTask({ status = "待开始", priority = "重要不紧急", blocker = "" } = {}) {
  const result = await apiJson(`/api/week/${encodeURIComponent(currentWeek.id)}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: { title: "新增任务", module: modules[0], status, blocker, priority, progress: 0, description: "", includeInReport: true, goalId: "", goalContribution: 0, goalLinks: [], goalContributionNote: "" } }),
  });
  tasks.unshift(result.task);
  await openTaskModal(result.task.id);
}
```

Use this helper for the existing `data-add-status` path and a new `data-add-priority` path. The priority path calls `createTask({ status: "待开始", priority: normalizePriority(button.dataset.addPriority) })`.

- [ ] **Step 5: Add batch selection by priority**

Render this control in each quadrant header while batch mode is active:

```javascript
${batchMode ? `<button class="btn small ghost" data-select-priority="${definition.priority}">全选</button>` : ""}
```

Add this delegated click handler:

```javascript
const selectPriorityButton = event.target.closest("[data-select-priority]");
if (selectPriorityButton) {
  const priority = normalizePriority(selectPriorityButton.dataset.selectPriority);
  tasks
    .filter((task) => task.status !== "已完成")
    .filter(taskMatchesFilters)
    .filter((task) => normalizePriority(task.priority) === priority)
    .forEach((task) => selectedTaskIds.add(task.id));
  renderBoard();
  return;
}
```

- [ ] **Step 6: Extend drag targets and rollback on failure**

Update dragover, dragleave and dragend cleanup to include both `[data-drop-status]` and `[data-drop-priority]`. At the beginning of `drop` handling, process priority targets with:

```javascript
const priorityTarget = event.target.closest("[data-drop-priority]");
if (priorityTarget) {
  event.preventDefault();
  const taskId = event.dataTransfer.getData("text/plain");
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;
  const previousPriority = normalizePriority(task.priority);
  const nextPriority = normalizePriority(priorityTarget.dataset.dropPriority);
  if (previousPriority === nextPriority) return;
  task.priority = nextPriority;
  task.updatedAt = Date.now();
  selectedTaskId = task.id;
  renderBoard();
  try {
    await persistTask(task);
    setSyncStatus(`已分类到：${nextPriority}`, "ok");
  } catch {
    task.priority = previousPriority;
    renderBoard();
    setSyncStatus("分类更新失败，已恢复原分类", "warn");
  }
  return;
}
```

Leave the existing status-drop branch unchanged after this new branch.

- [ ] **Step 7: Run the focused test and commit**

Run: `node --test test/workbench-ui.test.mjs`

Expected: PASS.

```powershell
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "feat: support quadrant task interactions"
```

### Task 4: Implement remembered mode and movable center point

**Files:**
- Modify: `test/workbench-ui.test.mjs`
- Modify: `public/index.html:4046-4140,4770-4808`

- [ ] **Step 1: Write failing layout interaction tests**

Append:

```javascript
test("quadrant layout is bounded resettable and keyboard accessible", () => {
  assert.match(html, /function clampQuadrantRatio/);
  assert.match(html, /Math\.max\(25, Math\.min\(75/);
  assert.match(html, /id="resetQuadrantLayoutBtn"/);
  assert.match(html, /id="quadrantHandle"/);
  assert.match(html, /pointerdown/);
  assert.match(html, /ArrowLeft|ArrowRight/);
  assert.match(html, /saveTaskViewPreferences\(\)/);
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL because center-point pointer and keyboard handlers do not exist.

- [ ] **Step 3: Add mode and reset handlers**

In the delegated click handler:

```javascript
const taskViewButton = event.target.closest("[data-task-view-mode]");
if (taskViewButton) {
  taskViewMode = taskViewButton.dataset.taskViewMode === "list" ? "list" : "quadrant";
  saveTaskViewPreferences();
  renderBoard();
  return;
}

if (event.target.id === "resetQuadrantLayoutBtn") {
  quadrantLayout = { x: 50, y: 50 };
  saveTaskViewPreferences();
  renderBoard();
  setSyncStatus("已恢复默认布局", "ok");
  return;
}
```

- [ ] **Step 4: Add pointer and keyboard resizing**

Add:

```javascript
let quadrantResizeState = null;

function applyQuadrantLayoutToBoard() {
  const board = document.querySelector(".quadrant-board");
  const handle = $("quadrantHandle");
  if (!board || !handle) return;
  board.style.setProperty("--split-x", `${quadrantLayout.x}%`);
  board.style.setProperty("--split-y", `${quadrantLayout.y}%`);
  handle.setAttribute("aria-valuetext", `横向 ${quadrantLayout.x}%，纵向 ${quadrantLayout.y}%`);
}

document.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest("#quadrantHandle");
  if (!handle) return;
  const board = handle.closest(".quadrant-board");
  quadrantResizeState = { handle, board, rect: board.getBoundingClientRect(), pointerId: event.pointerId };
  handle.setPointerCapture(event.pointerId);
  event.preventDefault();
});

document.addEventListener("pointermove", (event) => {
  if (!quadrantResizeState || event.pointerId !== quadrantResizeState.pointerId) return;
  const { rect } = quadrantResizeState;
  quadrantLayout = {
    x: clampQuadrantRatio(((event.clientX - rect.left) / rect.width) * 100),
    y: clampQuadrantRatio(((event.clientY - rect.top) / rect.height) * 100),
  };
  applyQuadrantLayoutToBoard();
});

function finishQuadrantResize(event) {
  if (!quadrantResizeState || event.pointerId !== quadrantResizeState.pointerId) return;
  quadrantResizeState.handle.releasePointerCapture?.(event.pointerId);
  quadrantResizeState = null;
  saveTaskViewPreferences();
}

document.addEventListener("pointerup", finishQuadrantResize);
document.addEventListener("pointercancel", finishQuadrantResize);

document.addEventListener("keydown", (event) => {
  if (!event.target.closest("#quadrantHandle")) return;
  const step = event.shiftKey ? 5 : 1;
  const changes = {
    ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
    ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
  };
  const change = changes[event.key];
  if (!change) return;
  event.preventDefault();
  quadrantLayout = { x: clampQuadrantRatio(quadrantLayout.x + change.x), y: clampQuadrantRatio(quadrantLayout.y + change.y) };
  saveTaskViewPreferences();
  renderBoard();
});
```

- [ ] **Step 5: Run tests and production build**

Run:

```powershell
node --test test/workbench-ui.test.mjs
npm.cmd run build
```

Expected: focused tests pass and build prints `Production build ready`.

- [ ] **Step 6: Commit layout behavior**

```powershell
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "feat: remember adjustable quadrant layout"
```

### Task 5: Final regression and browser verification

**Files:**
- Verify: `PRD.MD`, `public/index.html`, `test/workbench-ui.test.mjs`

- [ ] **Step 1: Run formatting checks**

Run:

```powershell
npx.cmd prettier --check PRD.MD public/index.html test/workbench-ui.test.mjs docs/superpowers/specs/2026-08-03-task-quadrant-mode-design.md
git diff --check main..HEAD
```

Expected: formatting and whitespace checks pass.

- [ ] **Step 2: Run the full test suite**

Run: `npm.cmd test`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Verify in a browser**

Run `npm.cmd start`, log in with a configured local account, and verify:

1. first visit opens four quadrants;
2. switching modes survives refresh;
3. completed tasks appear only in list/history;
4. search, module, mine-only and batch deletion affect visible quadrant tasks;
5. cross-quadrant drag persists after refresh;
6. a simulated failed save restores the old priority;
7. center drag, Shift+arrow, reset and narrow viewport behavior match the design.

- [ ] **Step 4: Review the final diff**

Run:

```powershell
git diff --stat main..HEAD
git diff --name-only main..HEAD
git status --short
```

Expected: feature commits contain only the PRD, design/plan documents, `public/index.html`, and `test/workbench-ui.test.mjs`; unrelated `PROJECT_STATUS.md`, `SESSION_HANDOFF.md`, and `TASK_TEMPLATES.md` remain untracked.
