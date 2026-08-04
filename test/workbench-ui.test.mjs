import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

function aiReportHelpersRuntime() {
  const source = html.match(/    function reportPeriodsOverlap[\s\S]*?(?=\r?\n\r?\n    function setAiReportStatus)/)?.[0];
  assert.ok(source, "missing executable AI report source/apply helpers");
  return new Function(`${source}\nreturn { reportPeriodsOverlap, selectAiReportSources, aiReportSourceText, findAiReportApplyTarget, applyAiReportText, aiReportContextMatches };`)();
}

test("monthly and quarterly AI source selection filters overlap and type with stable ordering", () => {
  const { selectAiReportSources } = aiReportHelpersRuntime();
  const reports = [
    { id: "w2", summaryType: "weekly", startDate: "2026/08/03", endDate: "2026/08/09" },
    { id: "self", summaryType: "monthly", startDate: "2026/08/01", endDate: "2026/08/31" },
    { id: "w1b", summaryType: "weekly", startDate: "2026/07/27", endDate: "2026/08/02" },
    { id: "w1a", summaryType: "weekly", startDate: "2026/07/27", endDate: "2026/08/02" },
    { id: "old", summaryType: "weekly", startDate: "2026/07/01", endDate: "2026/07/07" },
    { id: "m1", summaryType: "monthly", startDate: "2026/07/01", endDate: "2026/07/31" },
  ];
  assert.deepEqual(selectAiReportSources(reports, { id: "self", summaryType: "monthly", startDate: "2026/08/01", endDate: "2026/08/31" }).map(({ id }) => id), ["w1a", "w1b", "w2"]);
  assert.deepEqual(selectAiReportSources(reports, { id: "q", summaryType: "quarterly", startDate: "2026/07/01", endDate: "2026/09/30" }).map(({ id }) => id), ["m1", "self"]);
  assert.deepEqual(selectAiReportSources(reports, { id: "w", summaryType: "weekly", startDate: "2026/08/01", endDate: "2026/08/07" }), []);
});

test("AI source text is structured and includes each source period and title", () => {
  const { aiReportSourceText } = aiReportHelpersRuntime();
  const text = aiReportSourceText([
    { id: "w1", title: "第31周", startDate: "2026/07/27", endDate: "2026/08/02", data: { modules: [{ title: "经营", sections: [{ title: "本周进展", items: ["完成A", "完成B"] }] }] } },
  ]);
  assert.match(text, /来源 1：第31周/);
  assert.match(text, /周期：2026\/07\/27—2026\/08\/02/);
  assert.match(text, /经营/);
  assert.match(text, /本周进展：完成A；完成B/);
});

test("AI apply mapping prefers the first progress module and preserves structure", () => {
  const { findAiReportApplyTarget, applyAiReportText } = aiReportHelpersRuntime();
  const data = { summaryType: "monthly", modules: [
    { title: "汇总", sections: [{ title: "目标", items: ["目标"] }, { title: "本月进展", items: ["旧内容"] }] },
    { title: "本月进展", sections: [{ title: "内容", items: ["旧内容"] }] },
  ] };
  assert.deepEqual(findAiReportApplyTarget(data), { moduleIndex: 0, sectionIndex: 1 });
  assert.equal(applyAiReportText(data, "第一行\n\n 第二行 "), true);
  assert.deepEqual(data.modules[0].sections[1].items, ["第一行", "第二行"]);
  assert.deepEqual(data.modules[0].sections[0].items, ["目标"]);
});

test("AI apply falls back to first visible section and rejects stale or readonly context", () => {
  const { findAiReportApplyTarget, applyAiReportText, aiReportContextMatches } = aiReportHelpersRuntime();
  const data = { summaryType: "quarterly", startDate: "2026/07/01", endDate: "2026/09/30", modules: [{ title: "其他", sections: [{ title: "隐藏", hidden: true, items: [] }, { title: "可见", items: ["旧"] }] }] };
  assert.deepEqual(findAiReportApplyTarget(data), { moduleIndex: 0, sectionIndex: 1 });
  assert.equal(applyAiReportText(data, "新内容", { canEdit: false }), false);
  assert.deepEqual(data.modules[0].sections[1].items, ["旧"]);
  const context = { reportId: "r1", summaryType: "quarterly", startDate: "2026/07/01", endDate: "2026/09/30" };
  assert.equal(aiReportContextMatches(context, "r1", data, true), true);
  assert.equal(aiReportContextMatches(context, "r2", data, true), false);
  assert.equal(aiReportContextMatches(context, "r1", { ...data, endDate: "2026/12/31" }, true), false);
  assert.equal(aiReportContextMatches(context, "r1", data, false), false);
});

test("AI summary UI exposes conditional apply and guards empty sources and stale results", () => {
  assert.match(buttonMarkup("applyAiReportBtn"), /写入当前总结/);
  assert.match(html, /applyAiReportBtn[\s\S]*summaryType === "weekly"/);
  assert.match(html, /未找到当前周期内可用于汇总的已保存/);
  assert.match(html, /await apiJson\(`\/api\/report\/\$\{encodeURIComponent\(source\.id\)\}`\)/);
  assert.match(html, /pendingAiReportContext = null/);
  assert.match(html, /window\.confirm/);
});

function buttonMarkup(id) {
  const match = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`));
  assert.ok(match, `missing ${id}`);
  return match[0];
}

function clipboardRuntime({ clipboard, execCommand = () => true, activeElement = null, selection = null } = {}) {
  const source = html.match(/    async function copyTextToClipboard\(text\) \{[\s\S]*?\r?\n    \}(?=\r?\n\r?\n)/)?.[0];
  assert.ok(source, "missing executable clipboard helper");
  const children = [];
  const document = {
    activeElement,
    body: {
      appendChild(node) { children.push(node); node.parentNode = this; },
      removeChild(node) { children.splice(children.indexOf(node), 1); node.parentNode = null; },
    },
    createElement(tag) {
      assert.equal(tag, "textarea");
      return { style: {}, focus() {}, select() {}, setSelectionRange() {} };
    },
    execCommand,
  };
  const window = { getSelection: () => selection };
  const navigator = clipboard === undefined ? {} : { clipboard };
  const copyTextToClipboard = new Function("navigator", "document", "window", `${source}\nreturn copyTextToClipboard;`)(navigator, document, window);
  return { copyTextToClipboard, children };
}

test("clipboard helper uses the async Clipboard API when available", async () => {
  const writes = [];
  const runtime = clipboardRuntime({ clipboard: { writeText: async (text) => writes.push(text) } });
  await runtime.copyTextToClipboard("report");
  assert.deepEqual(writes, ["report"]);
  assert.equal(runtime.children.length, 0);
});

test("clipboard helper falls back after Clipboard API rejection and always cleans up", async () => {
  const restored = [];
  const originalRange = { id: "original" };
  const selection = {
    rangeCount: 1,
    getRangeAt: () => originalRange,
    removeAllRanges: () => restored.push("cleared"),
    addRange: (range) => restored.push(range),
  };
  const activeElement = { isConnected: true, focus: () => restored.push("focused") };
  const runtime = clipboardRuntime({ clipboard: { writeText: async () => { throw new Error("denied"); } }, execCommand: (command) => command === "copy", activeElement, selection });
  await runtime.copyTextToClipboard("report");
  assert.equal(runtime.children.length, 0);
  assert.deepEqual(restored, ["cleared", originalRange, "focused"]);
});

test("clipboard helper rejects empty text without creating a textarea", async () => {
  const emptyRuntime = clipboardRuntime();
  await assert.rejects(emptyRuntime.copyTextToClipboard("   "), /没有可复制的内容/);
  assert.equal(emptyRuntime.children.length, 0);
});

test("clipboard fallback throw reports a stable error and restores DOM state", async () => {
  const restored = [];
  const selection = { rangeCount: 0, removeAllRanges: () => restored.push("cleared"), addRange: () => {} };
  const activeElement = { isConnected: true, focus: () => restored.push("focused") };
  const failedRuntime = clipboardRuntime({ execCommand: () => { throw new Error("sensitive DOM failure"); }, activeElement, selection });
  await assert.rejects(failedRuntime.copyTextToClipboard("report"), (error) => error.message === "复制失败，请手动复制");
  assert.equal(failedRuntime.children.length, 0);
  assert.deepEqual(restored, ["cleared", "focused"]);
});

test("clipboard fallback false and missing APIs report the same stable error", async () => {
  const falseRuntime = clipboardRuntime({ execCommand: () => false });
  await assert.rejects(falseRuntime.copyTextToClipboard("report"), (error) => error.message === "复制失败，请手动复制");
  assert.equal(falseRuntime.children.length, 0);

  const missingRuntime = clipboardRuntime({ execCommand: null });
  await assert.rejects(missingRuntime.copyTextToClipboard("report"), (error) => error.message === "复制失败，请手动复制");
  assert.equal(missingRuntime.children.length, 0);
});

function inlineReportActionRuntime() {
  const source = html.match(/    function inlineReportClickAction\(event\) \{[\s\S]*?\r?\n    \}(?=\r?\n\r?\n)/)?.[0];
  assert.ok(source, "missing executable inline report action helper");
  return new Function(`${source}\nreturn inlineReportClickAction;`)();
}

test("inline report list opens by row and only renders delete for the active saved report", () => {
  const source = html.match(/    function renderInlineReportHistory\(\) \{[\s\S]*?\r?\n    \}(?=\r?\n\r?\n    function reportHistoryLabel)/)?.[0];
  assert.ok(source, "missing inline report renderer");
  assert.doesNotMatch(source, />打开<\/button>/);
  assert.match(source, /isActive && report\.id[\s\S]*data-report-delete/);
  assert.match(source, /data-report-open="\$\{report\.id\}"/);
  assert.match(html, /function inlineReportClickAction[\s\S]*?event\.stopPropagation\(\)[\s\S]*?type: "delete"[\s\S]*?type: "open"/);
});

test("inline report item and click decisions keep delete exclusive to the active row", () => {
  const renderer = html.match(/    function renderInlineReportHistory\(\) \{[\s\S]*?\r?\n    \}(?=\r?\n\r?\n    function reportHistoryLabel)/)?.[0];
  assert.match(renderer, /isActive && report\.id/);
  const decide = inlineReportActionRuntime();
  let stopped = false;
  const deleteButton = { dataset: { reportDelete: "active" } };
  const row = { dataset: { reportOpen: "active" } };
  const action = decide({
    stopPropagation: () => { stopped = true; },
    target: { closest: (selector) => selector.includes("report-delete") ? deleteButton : row },
  });
  assert.deepEqual(action, { type: "delete", id: "active" });
  assert.equal(stopped, true);
  assert.notEqual(action.type, "open");
});

function goalColumnWidthRuntime(storage = new Map(), setItem = (key, value) => storage.set(key, value)) {
  const source = html.match(/    const goalTableColumns = \[[\s\S]*?(?=\r?\n\r?\n    const initialGoalsRows)/)?.[0];
  assert.ok(source, "missing executable goal column width functions");
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem,
  };
  return new Function("localStorage", "storageKey", "currentUser", "currentDepartment", `${source}\nreturn { goalTableColumns, normalizeGoalColumnWidths, loadGoalColumnWidths, saveGoalColumnWidths, goalColumnWidthStorageKey, clampGoalColumnWidth, keyboardGoalColumnWidth, updateGoalColumnResizeHandle };`)(
    localStorage,
    "dp-workbench",
    { username: "alice", department: { id: "dept-a" } },
    () => ({ id: "dept-a" }),
  );
}

test("goal column widths recover defaults, clamp bounds, and restore isolated storage", () => {
  const storage = new Map();
  const runtime = goalColumnWidthRuntime(storage);
  assert.deepEqual(runtime.goalTableColumns.map(({ key }) => key), ["seq", "name", "definition", "owner", "lastYearActual", "target", "current", "progress", "status", "artifact", "actions"]);
  assert.equal(runtime.goalTableColumns.find(({ key }) => key === "artifact").defaultWidth, 150);

  storage.set(runtime.goalColumnWidthStorageKey(), "not-json");
  assert.equal(runtime.loadGoalColumnWidths().artifact, 150);

  storage.set(runtime.goalColumnWidthStorageKey(), JSON.stringify({ name: -999, artifact: 99999, owner: 88 }));
  const restored = runtime.loadGoalColumnWidths();
  const name = runtime.goalTableColumns.find(({ key }) => key === "name");
  const artifact = runtime.goalTableColumns.find(({ key }) => key === "artifact");
  assert.equal(restored.name, name.defaultWidth, "out-of-range values fall back to defaults");
  assert.equal(restored.artifact, artifact.defaultWidth, "oversized values fall back to defaults");
  assert.equal(restored.owner, 88);

  runtime.saveGoalColumnWidths({ owner: 104, artifact: 160 });
  assert.deepEqual(runtime.loadGoalColumnWidths(), { ...Object.fromEntries(runtime.goalTableColumns.map((column) => [column.key, column.defaultWidth])), owner: 104, artifact: 160 });
  assert.match(runtime.goalColumnWidthStorageKey(), /dept-a-alice$/);
});

test("goal column keyboard math clamps and storage failures remain non-throwing", () => {
  const runtime = goalColumnWidthRuntime(new Map(), () => { throw new Error("quota"); });
  assert.equal(runtime.clampGoalColumnWidth("owner", -100), 76);
  assert.equal(runtime.clampGoalColumnWidth("owner", 999), 220);
  assert.equal(runtime.keyboardGoalColumnWidth("owner", 100, "ArrowLeft", false), 92);
  assert.equal(runtime.keyboardGoalColumnWidth("owner", 100, "ArrowRight", true), 132);
  assert.equal(runtime.keyboardGoalColumnWidth("owner", 219, "ArrowRight", false), 220);
  assert.equal(runtime.saveGoalColumnWidths({ owner: 104 }), false);
});

test("goal resize handle aria follows clamped width", () => {
  const runtime = goalColumnWidthRuntime();
  const attributes = new Map();
  const handle = { setAttribute: (key, value) => attributes.set(key, String(value)) };
  const width = runtime.updateGoalColumnResizeHandle(handle, "artifact", 999);
  assert.equal(width, 320);
  assert.equal(attributes.get("aria-valuemin"), "120");
  assert.equal(attributes.get("aria-valuemax"), "320");
  assert.equal(attributes.get("aria-valuenow"), "320");
});

test("goal table renders eleven stable columns with accessible pointer resize handles", () => {
  assert.match(html, /<colgroup>\$\{goalTableColumns\.map/);
  assert.match(html, /data-goal-column="\$\{column\.key\}"/);
  assert.match(html, /class="goal-column-resize"/);
  assert.match(html, /role="separator"/);
  assert.match(html, /aria-orientation="vertical"/);
  assert.match(html, /aria-valuemin=/);
  assert.match(html, /aria-valuemax=/);
  assert.match(html, /aria-valuenow=/);
  assert.match(html, /data-goal-column-resize=/);
  assert.match(html, /goalColumnResizeState/);
  assert.match(html, /setPointerCapture/);
  assert.match(html, /document\.addEventListener\("pointermove"[\s\S]*applyGoalColumnWidth/);
  assert.match(html, /document\.addEventListener\("pointerup", finishGoalColumnResize\)/);
  assert.match(html, /ArrowLeft|ArrowRight/);
  assert.match(html, /cancelGoalColumnResize/);
  assert.match(html, /goalColumnWidthsKey !== goalColumnWidthStorageKey\(\)/);
  assert.match(html, /\.goal-artifact-cell\{min-width:0\}/);
});

function overdueMigrationRuntime(tasks, persistTask, setSyncStatus = () => {}) {
  const blockerFunction = html.match(/    function overdueBlockerText\(task\) \{[\s\S]*?\r?\n    \}/)?.[0];
  const migrationFunction = html.match(/    async function blockOverdueTasksForListMode\(\) \{[\s\S]*?\r?\n    \}(?=\r?\n\r?\n    function scheduleSaveTask)/)?.[0];
  assert.ok(blockerFunction && migrationFunction, "missing executable overdue migration functions");
  return new Function("tasks", "todayIso", "persistTask", "setSyncStatus", `async function flushPendingTaskSave() {}\n${blockerFunction}\n${migrationFunction}\nreturn blockOverdueTasksForListMode;`)(
    tasks,
    () => "2026-08-04",
    persistTask,
    setSyncStatus,
  );
}

function overdueSaveRuntime(tasks, persistTask, setSyncStatus = () => {}, timers = {}) {
  const blockerFunction = html.match(/    function overdueBlockerText\(task\) \{[\s\S]*?\r?\n    \}/)?.[0];
  const saveFunctions = html.match(/    function drainPendingTaskSave[\s\S]*?(?=\r?\n\r?\n    function decodeReportEscapes)/)?.[0];
  assert.ok(blockerFunction && saveFunctions, "missing executable overdue save serialization functions");
  const pendingTaskSaves = new Map();
  return new Function("tasks", "todayIso", "persistTask", "setSyncStatus", "pendingTaskSaves", "setTimeout", "clearTimeout", `${blockerFunction}\n${saveFunctions}\nreturn { scheduleSaveTask, flushPendingTaskSave, blockOverdueTasksForListMode };`)(
    tasks,
    () => "2026-08-04",
    persistTask,
    setSyncStatus,
    pendingTaskSaves,
    timers.setTimeout || (() => 1),
    timers.clearTimeout || (() => {}),
  );
}

test("workbench uses the generic page title and custom favicon", () => {
  assert.match(html, /<title>部门工作台<\/title>/);
  assert.match(html, /<link rel="icon"[^>]+href="favicon\.svg"/);
  assert.doesNotMatch(html, /<div class="logo">DP<\/div>/);
});

test("admin and guide navigation use accessible icon-only buttons", () => {
  const adminButton = buttonMarkup("adminEntryBtn");
  const guideButton = buttonMarkup("openOnboardingBtn");

  assert.match(adminButton, /class="[^"]*icon-btn/);
  assert.match(adminButton, /aria-label="后台管理"/);
  assert.match(adminButton, /<svg/);
  assert.doesNotMatch(adminButton, />\s*后台管理\s*</);

  assert.match(guideButton, /class="[^"]*icon-btn/);
  assert.match(guideButton, /aria-label="指引"/);
  assert.match(guideButton, /<svg/);
  assert.doesNotMatch(guideButton, />\s*指引\s*</);
});

test("client branding and login lifetime come from authenticated server data", () => {
  assert.match(html, /id="brandTitle"/);
  assert.match(html, /currentUser\?\.department\?\.name|currentUser\.department\.name/);
  assert.doesNotMatch(html, /const loginKeepAliveMs/);
  assert.doesNotMatch(html, /本次登录将保持30分钟/);
});

test("admin page exposes department and session duration controls", () => {
  assert.match(html, /id="adminDepartmentsList"/);
  assert.match(html, /id="adminDepartmentModulesSelect"/);
  assert.match(html, /data-admin-account-department/);
  assert.match(html, /id="adminSessionDurationMinutes"[^>]+min="5"[^>]+max="43200"/);
});

test("data product starter goals are not copied into other departments", () => {
  assert.match(html, /currentDepartment\(\)\.id === defaultDepartment\.id/);
  assert.match(html, /function defaultGoalsForCurrentDepartment/);
});

test("admin credentials are entered by the operator and are not hard-coded", () => {
  assert.doesNotMatch(html, /默认账号|默认密码|888888/);
  assert.doesNotMatch(html, /"x-admin-user":\s*"Admin"/);
  assert.match(html, /adminSessionStorageKey = `\$\{storageKey\}-admin-session`/);
  assert.match(html, /sessionStorage\.setItem\(adminSessionStorageKey/);
  assert.match(html, /adminRequestHeaders\(\)/);
  assert.doesNotMatch(html, /x-admin-password/);
});

test("unauthenticated visitors see a dedicated login page without sync keys", () => {
  assert.match(html, /id="loginView"/);
  assert.match(html, /id="workspaceShell"[^>]+hidden/);
  assert.match(html, /id="loginForm"/);
  assert.doesNotMatch(html, /syncKeyStorageKey|getSyncKey|x-report-key|周报协同口令/);
});

test("registration and password help are dedicated authentication views", () => {
  assert.match(html, /id="registerView"/);
  assert.match(html, /id="registerForm"/);
  assert.match(html, /id="registerConfirmPassword"/);
  assert.match(html, /id="registerMessage"[^>]+aria-live="polite"/);
  assert.match(html, /id="forgotPasswordView"/);
  assert.match(html, /id="loginForgotPasswordBtn"/);
  assert.match(html, /id="loginUsername"[^>]+name="username"/);
  assert.match(html, /id="loginPassword"[^>]+name="password"/);
  assert.match(html, /id="registerDisplayName"[^>]+name="displayName"/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(html, /id="showRegisterBtn"/);
  assert.doesNotMatch(html, /id="displayNameField"/);
});

test("registration returns to login without storing a session", () => {
  assert.match(html, /注册成功，请重新登录/);
  assert.match(html, /showAuthView\("login"/);
  assert.match(html, /async function registerAccount/);
  assert.doesNotMatch(html, /action === "register"[\s\S]{0,800}localStorage\.setItem\(userTokenStorageKey/);
});

test("login page shows the configured session duration directly", () => {
  assert.match(html, /id="loginDurationHint"/);
  assert.match(html, /保持登录：/);
  assert.match(html, /function formatSessionDuration/);
  assert.doesNotMatch(html, /登录状态将按后台设置的时间保持/);
});

test("admin account management exposes registered-user password reset", () => {
  assert.match(html, /data-admin-reset-password/);
  assert.match(html, /id="adminResetPasswordModal"/);
  assert.match(html, /id="adminResetPassword"/);
  assert.match(html, /id="adminResetPasswordConfirm"/);
  assert.match(html, /\/api\/admin\/users\/\$\{encodeURIComponent\(adminResetUsername\)\}\/reset-password/);
});

test("report import shows all permitted department tasks with a this-week/all scope toggle", () => {
  assert.match(html, /let reportImportTasks = \[\]/);
  assert.match(html, /let reportImportState = "idle"/);
  assert.match(html, /apiJson\("\/api\/tasks"\)/);
  assert.match(html, /id="reportImportScopeFilter"/);
  assert.match(html, /<option value="week" selected>本周有更新<\/option>/);
  assert.match(html, /正在加载待办/);
  assert.match(html, /当前周期和模块暂无可导入待办/);
  assert.match(html, /data-retry-report-task-import/);
  assert.match(html, /reportImportTasks[\s\S]{0,500}\.filter\(\(task\) => task\.module === moduleName\)/);
  assert.match(html, /scope === "all" \|\| dateInWeek/);
});

test("admin uses categorized settings and safe AI key controls", () => {
  for (const section of ["departments", "modules", "accounts", "ai", "session"]) {
    assert.match(html, new RegExp(`data-admin-section="${section}"`));
  }
  assert.match(html, /id="adminAiApiKey"/);
  assert.match(html, /id="adminAiTestBtn"/);
  assert.match(html, /id="adminAiClearBtn"/);
  assert.match(html, /adminDirty/);
});

test("department rows expose a leader picker and account rows expose an enable toggle", () => {
  assert.match(html, /data-admin-department-leader="\$\{index\}"/);
  assert.match(html, /department\.leaderUsername/);
  assert.match(html, /data-admin-account-enabled="\$\{index\}"/);
  assert.match(html, /account\.enabled !== false/);
});

test("a department leader gets a cut-down admin panel scoped to their own department", () => {
  assert.match(html, /let adminRole = adminSession\.role === "leader" \? "leader" : "admin"/);
  assert.match(html, /function renderLeaderAdmin\(\)/);
  assert.match(html, /async function loadLeaderWorkspace\(\)/);
  assert.match(html, /\/api\/admin\/leader\/accounts/);
  assert.match(html, /\/api\/admin\/leader\/modules/);
  assert.match(html, /data-admin-section="leader-accounts"/);
  assert.match(html, /data-admin-section="leader-modules"/);
  assert.match(html, /data-leader-account-enabled=/);
});

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

test("quadrant interactions create select and persist priority safely", () => {
  assert.match(html, /data-add-priority/);
  assert.match(html, /data-select-priority/);
  assert.match(html, /data-drop-priority/);
  assert.match(html, /const previousPriority = normalizePriority\(task\.priority\)/);
  assert.match(html, /task\.priority = previousPriority/);
  assert.match(html, /分类更新失败/);
  assert.match(html, /status: "待开始"/);
});

test("quadrant layout is bounded resettable and keyboard accessible", () => {
  assert.match(html, /function clampQuadrantRatio/);
  assert.match(html, /Math\.max\(25, Math\.min\(75/);
  assert.match(html, /id="resetQuadrantLayoutBtn"/);
  assert.match(html, /id="quadrantHandle"/);
  assert.match(html, /pointerdown/);
  assert.match(html, /handle\.focus\(\{ preventScroll: true \}\)/);
  assert.match(html, /ArrowLeft|ArrowRight/);
  assert.match(html, /saveTaskViewPreferences\(\)/);
  assert.match(html, /saveTaskViewPreferences\(\);\s+applyQuadrantLayoutToBoard\(\);/);
});

test("overdue task cards are visibly warned without changing their quadrant", () => {
  assert.match(html, /task-card[^\n]*\$\{isOverdue\(task\) \? "overdue" : ""\}/);
  assert.match(html, /class="tag overdue-badge">已逾期/);
  assert.match(html, /\.task-card\.overdue\{/);
  assert.match(html, /\.overdue-badge\{/);
  assert.match(html, /\.task-desc,\.risk-box\{[^}]*-webkit-line-clamp:2/);
  assert.match(html, /normalizePriority\(task\.priority\) === definition\.priority/);
});

test("entering list mode blocks overdue tasks independently and idempotently", () => {
  assert.match(html, /function overdueBlockerText\(task\)/);
  assert.match(html, /任务已逾期（原计划完成日期：\$\{task\.dueDate\}）/);
  assert.match(html, /task\.status !== "已完成" && task\.status !== "阻塞" && task\.dueDate && task\.dueDate < todayIso\(\)/);
  assert.match(html, /includes\(overdueText\)/);
  assert.match(html, /await persistTask\(updatedTask\)/);
  assert.match(html, /tasks\[taskIndex\] = updatedTask/);
  assert.match(html, /catch \(error\)[\s\S]{0,300}逾期任务自动阻塞失败/);
  assert.match(html, /await blockOverdueTasksForListMode\(\);\s*renderBoard\(\)/);
  assert.match(html, /previousMode !== "list" && nextMode === "list"/);
});

test("overdue migration preserves blocker characters and appends its message once", async () => {
  const tasks = [{ id: "a", title: "A", status: "进行中", dueDate: "2026-08-01", blocker: "  原风险  " }];
  const saved = [];
  const migrate = overdueMigrationRuntime(tasks, async (task) => saved.push({ ...task }));

  await migrate();
  await migrate();

  assert.equal(tasks[0].blocker, "  原风险  \n任务已逾期（原计划完成日期：2026-08-01）");
  assert.equal(tasks[0].blocker.match(/任务已逾期/g)?.length, 1);
  assert.equal(saved.length, 1);
});

test("overdue migration continues after failure and updates only successful local tasks", async () => {
  const tasks = [
    { id: "fail", title: "失败项", status: "进行中", dueDate: "2026-08-01", blocker: "" },
    { id: "ok", title: "成功项", status: "待开始", dueDate: "2026-08-02", blocker: "已有" },
  ];
  const attempts = [];
  const messages = [];
  const migrate = overdueMigrationRuntime(tasks, async (task) => {
    attempts.push(task.id);
    if (task.id === "fail") throw new Error("save failed");
  }, (message) => messages.push(message));

  await migrate();

  assert.deepEqual(attempts, ["fail", "ok"]);
  assert.equal(tasks[0].status, "进行中");
  assert.equal(tasks[1].status, "阻塞");
  assert.equal(tasks[1].blocker, "已有\n任务已逾期（原计划完成日期：2026-08-02）");
  assert.ok(messages.some((message) => message.includes("1 项逾期任务自动阻塞失败")));
});

test("pending user edits persist before the final overdue block save", async () => {
  const tasks = [{ id: "a", title: "A", status: "进行中", dueDate: "2026-08-01", blocker: "", description: "最新编辑" }];
  const persisted = [];
  const runtime = overdueSaveRuntime(tasks, async (task) => persisted.push({ ...task }));

  runtime.scheduleSaveTask(tasks[0]);
  await runtime.blockOverdueTasksForListMode();

  assert.deepEqual(persisted.map((task) => task.status), ["进行中", "阻塞"]);
  assert.deepEqual(persisted.map((task) => task.description), ["最新编辑", "最新编辑"]);
  assert.equal(tasks[0].status, "阻塞");
  assert.deepEqual(tasks[0], persisted.at(-1));
});

test("a failed pending edit remains pending and prevents an overdue overwrite", async () => {
  const tasks = [{ id: "a", title: "A", status: "进行中", dueDate: "2026-08-01", blocker: "", description: "不能丢失" }];
  const attempts = [];
  const messages = [];
  const runtime = overdueSaveRuntime(tasks, async (task) => {
    attempts.push({ ...task });
    throw new Error("offline");
  }, (message) => messages.push(message));

  runtime.scheduleSaveTask(tasks[0]);
  await runtime.blockOverdueTasksForListMode();

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].description, "不能丢失");
  assert.equal(tasks[0].status, "进行中");
  assert.ok(messages.includes("同步失败"));
  assert.match(html, /pendingTaskSaves\.set\(task\.id/);
});

test("concurrent flushes share one drain through v2 before overdue blocking", async () => {
  const tasks = [{ id: "a", title: "A", status: "进行中", dueDate: "2026-08-01", blocker: "", description: "v1" }];
  const deferred = [];
  const writes = [];
  let serverTask = null;
  const runtime = overdueSaveRuntime(tasks, async (task) => {
    const snapshot = { ...task };
    writes.push(snapshot);
    if (writes.length <= 2) {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      deferred.push({ resolve });
      await promise;
    }
    serverTask = snapshot;
  });

  runtime.scheduleSaveTask(tasks[0]);
  const firstFlush = runtime.flushPendingTaskSave("a");
  await Promise.resolve();
  tasks[0].description = "v2";
  runtime.scheduleSaveTask(tasks[0]);
  const migration = runtime.blockOverdueTasksForListMode();

  deferred[0].resolve();
  while (deferred.length < 2) await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 2, "overdue write must wait for v2 drain");
  deferred[1].resolve();
  await Promise.all([firstFlush, migration]);

  assert.deepEqual(writes.map((task) => [task.description, task.status]), [
    ["v1", "进行中"],
    ["v2", "进行中"],
    ["v2", "阻塞"],
  ]);
  assert.equal(serverTask.status, "阻塞");
  assert.equal(serverTask.description, "v2");
  assert.deepEqual(tasks[0], serverTask);
});

test("flush-all drains a newly pending second task before overdue migration", async () => {
  const tasks = [
    { id: "a", title: "A", status: "进行中", dueDate: "2026-08-01", blocker: "", description: "A编辑" },
    { id: "b", title: "B", status: "进行中", dueDate: "2026-08-02", blocker: "", description: "B编辑" },
  ];
  const deferredById = new Map();
  const timers = new Map();
  let nextTimerId = 0;
  const writes = [];
  const serverTasks = new Map();
  const runtime = overdueSaveRuntime(tasks, async (task) => {
    const snapshot = { ...task };
    writes.push(snapshot);
    if (snapshot.status !== "阻塞") {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      deferredById.set(snapshot.id, { resolve });
      await promise;
    }
    serverTasks.set(snapshot.id, snapshot);
  }, () => {}, {
    setTimeout(callback) {
      nextTimerId += 1;
      timers.set(nextTimerId, callback);
      return nextTimerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
  });

  runtime.scheduleSaveTask(tasks[0]);
  const migration = runtime.blockOverdueTasksForListMode();
  await Promise.resolve();
  runtime.scheduleSaveTask(tasks[1]);
  deferredById.get("a").resolve();
  for (let index = 0; index < 3 && !deferredById.has("b"); index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(deferredById.has("b"), "newly pending B must join the active flush-all drain");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(writes.map((task) => [task.id, task.status]), [["a", "进行中"], ["b", "进行中"]]);
  deferredById.get("b").resolve();
  await migration;

  assert.deepEqual(writes.map((task) => [task.id, task.status]), [
    ["a", "进行中"],
    ["b", "进行中"],
    ["a", "阻塞"],
    ["b", "阻塞"],
  ]);
  assert.equal(serverTasks.get("b").description, "B编辑");
  assert.equal(serverTasks.get("b").status, "阻塞");
  for (const callback of timers.values()) callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 4, "no delayed timer save may overwrite B");
});
