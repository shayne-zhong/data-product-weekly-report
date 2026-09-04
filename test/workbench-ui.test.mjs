import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("admin record filtering keeps source indices and clamps pagination", () => {
  const source = html.match(/ {4}function adminFilteredPage\([\s\S]*?\r?\n {4}\}/)?.[0];
  assert.ok(source, "missing adminFilteredPage");
  const filter = new Function(`${source}; return adminFilteredPage;`)();
  const rows = [
    { name: "甲", enabled: true },
    { name: "乙", enabled: false },
    { name: "甲二", enabled: true },
  ];
  const result = filter(rows, { query: "甲", enabled: "true", page: 9, size: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.page, 2);
  assert.equal(result.rows[0].index, 2);
  assert.equal(filter(rows, { query: "不存在", enabled: "all", page: 1, size: 20 }).total, 0);
});

test("admin drawer restores cancelled drafts and reports save errors locally", () => {
  assert.match(html, /id="adminRecordDrawer"[\s\S]*aria-modal="true"/);
  assert.match(html, /copyAdminSection\(adminDraftSettings, adminRecordEditor\.snapshot/);
  assert.match(html, /adminRecordError[\s\S]*textContent = error\.message/);
});

test("loading a week only fetches its tasks and never triggers rollover", () => {
  const source = html.match(/ {4}async function loadWeek\(weekId\) \{[\s\S]*?\r?\n {4}\}/)?.[0] || "";
  assert.ok(source, "missing loadWeek");
  assert.doesNotMatch(source, /autoRolloverFromPrevious|\/rollover/);
});

function aiReportHelpersRuntime() {
  const source = html.match(
    / {4}function reportDateTimestamp[\s\S]*?(?=\r?\n\r?\n {4}function setAiReportStatus)/,
  )?.[0];
  assert.ok(source, "missing executable AI report source/apply helpers");
  const normalizeSource = html.match(/ {4}function normalizeDate\(value\) \{[\s\S]*?\r?\n {4}\}/)?.[0];
  const typeSource = html.match(
    / {4}function validReportSummaryType[\s\S]*?(?=\r?\n\r?\n {4}function completedContributionForGoal)/,
  )?.[0];
  const reportTypes = { weekly: {}, monthly: {}, quarterly: {} };
  const { normalizeDate, reportSummaryType } = new Function(
    "reportTypes",
    `${normalizeSource}\n${typeSource}\nreturn { normalizeDate, reportSummaryType };`,
  )(reportTypes);
  return new Function(
    "reportSummaryType",
    "normalizeDate",
    `let aiReportGeneration = 3;\n${source}\nreturn { reportPeriodsOverlap, selectAiReportSources, aiReportSourceText, parseAiReportSections, applyAiReportText, aiReportContextMatches };`,
  )(reportSummaryType, normalizeDate);
}

test("monthly and quarterly AI source selection filters overlap and type with stable ordering", () => {
  const { selectAiReportSources } = aiReportHelpersRuntime();
  const reports = [
    { id: "w2", summaryType: "weekly", status: "final", startDate: "2026/08/03", endDate: "2026/08/09" },
    { id: "self", summaryType: "monthly", status: "final", startDate: "2026/08/01", endDate: "2026/08/31" },
    { id: "w1b", summaryType: "weekly", status: "final", startDate: "2026/07/27", endDate: "2026/08/02" },
    { id: "w1a", summaryType: "weekly", status: "final", startDate: "2026/07/27", endDate: "2026/08/02" },
    { id: "draft-week", summaryType: "weekly", status: "draft", startDate: "2026/08/10", endDate: "2026/08/16" },
    { id: "old", summaryType: "weekly", startDate: "2026/07/01", endDate: "2026/07/07" },
    { id: "m1", summaryType: "monthly", status: "final", startDate: "2026/07/01", endDate: "2026/07/31" },
  ];
  assert.deepEqual(
    selectAiReportSources(reports, {
      id: "self",
      summaryType: "monthly",
      startDate: "2026/08/01",
      endDate: "2026/08/31",
    }).map(({ id }) => id),
    ["w1a", "w1b", "w2", "draft-week"],
  );
  assert.deepEqual(
    selectAiReportSources(reports, {
      id: "q",
      summaryType: "quarterly",
      startDate: "2026/07/01",
      endDate: "2026/09/30",
    }).map(({ id }) => id),
    ["m1", "self"],
  );
  assert.deepEqual(
    selectAiReportSources(reports, { id: "w", summaryType: "weekly", startDate: "2026/08/01", endDate: "2026/08/07" }),
    [],
  );
});

test("quarterly AI sources honor legacy report type inference", () => {
  const { selectAiReportSources } = aiReportHelpersRuntime();
  const reports = [
    { id: "missing-type", status: "final", title: "7月月度总结", startDate: "2026/7/1", endDate: "2026/7/31" },
    {
      id: "wrong-weekly",
      status: "final",
      summaryType: "weekly",
      title: "8月月度总结",
      startDate: "2026/8/1",
      endDate: "2026/8/31",
    },
    {
      id: "actual-weekly",
      status: "final",
      summaryType: "weekly",
      title: "普通周报",
      startDate: "2026/8/1",
      endDate: "2026/8/7",
    },
  ];
  assert.deepEqual(
    selectAiReportSources(reports, {
      id: "q3",
      summaryType: "quarterly",
      startDate: "2026/7/1",
      endDate: "2026/9/30",
    }).map(({ id }) => id),
    ["missing-type", "wrong-weekly"],
  );
});

test("AI source overlap accepts non-padded boundary dates and rejects invalid ranges", () => {
  const { reportPeriodsOverlap, selectAiReportSources } = aiReportHelpersRuntime();
  const target = { id: "month", summaryType: "monthly", startDate: "2026-08-01", endDate: "2026-08-31" };
  assert.equal(reportPeriodsOverlap({ startDate: "2026/7/27", endDate: "2026/8/1" }, target), true);
  assert.equal(reportPeriodsOverlap({ startDate: "2026/8/31", endDate: "2026/9/6" }, target), true);
  assert.equal(reportPeriodsOverlap({ startDate: "2026/8/2", endDate: "2026/8/8" }, target), true);
  assert.equal(reportPeriodsOverlap({ startDate: "2026/2/30", endDate: "2026/3/2" }, target), false);
  assert.equal(reportPeriodsOverlap({ startDate: "invalid", endDate: "2026/8/2" }, target), false);
  assert.equal(reportPeriodsOverlap({ startDate: "2026/8/8", endDate: "2026/8/2" }, target), false);
  const selected = selectAiReportSources(
    [
      { id: "late", summaryType: "weekly", status: "final", startDate: "2026/8/10", endDate: "2026/8/16" },
      { id: "early", summaryType: "weekly", status: "final", startDate: "2026/8/2", endDate: "2026/8/8" },
      { id: "invalid", summaryType: "weekly", status: "final", startDate: "2026/8/40", endDate: "2026/8/41" },
    ],
    target,
  );
  assert.deepEqual(
    selected.map(({ id }) => id),
    ["early", "late"],
  );
});

test("AI source text is structured and includes each source period and title", () => {
  const { aiReportSourceText } = aiReportHelpersRuntime();
  const text = aiReportSourceText([
    {
      id: "w1",
      title: "第31周",
      startDate: "2026/07/27",
      endDate: "2026/08/02",
      data: { modules: [{ title: "经营", sections: [{ title: "本周进展", items: ["完成A", "完成B"] }] }] },
    },
  ]);
  assert.match(text, /来源 1：第31周/);
  assert.match(text, /周期：2026\/07\/27—2026\/08\/02/);
  assert.match(text, /经营/);
  assert.match(text, /本周进展：完成A；完成B/);
});

test("monthly AI result fills target progress and risk without changing next-month plan", () => {
  const { parseAiReportSections, applyAiReportText } = aiReportHelpersRuntime();
  const text = "【本月目标】\n1、目标A\n【本月进展】\n1、进展A\n【下月计划】\n1、模型越权计划\n【当前风险】\n无";
  assert.deepEqual(parseAiReportSections(text, "monthly"), {
    本月目标: ["1、目标A"],
    本月进展: ["1、进展A"],
    当前风险: ["无"],
  });
  const data = {
    summaryType: "monthly",
    modules: [
      { title: "本月目标", sections: [{ title: "内容", items: ["旧目标"] }] },
      { title: "本月进展", sections: [{ title: "内容", items: ["旧进展"] }] },
      { title: "下月计划", sections: [{ title: "内容", items: ["人工计划"] }] },
      { title: "当前风险", sections: [{ title: "内容", items: ["旧风险"] }] },
    ],
  };
  assert.equal(applyAiReportText(data, text), true);
  assert.deepEqual(
    data.modules.map((module) => module.sections[0].items),
    [["1、目标A"], ["1、进展A"], ["人工计划"], ["无"]],
  );
});

test("quarterly AI result preserves next-quarter plan and rejects readonly context", () => {
  const { applyAiReportText, aiReportContextMatches } = aiReportHelpersRuntime();
  const data = {
    summaryType: "quarterly",
    startDate: "2026/07/01",
    endDate: "2026/09/30",
    modules: [
      { title: "本季目标", sections: [{ title: "内容", items: ["旧目标"] }] },
      { title: "本季进展", sections: [{ title: "内容", items: ["旧进展"] }] },
      { title: "下季计划", sections: [{ title: "内容", items: ["人工计划"] }] },
      { title: "当前风险", sections: [{ title: "内容", items: ["旧风险"] }] },
    ],
  };
  assert.equal(applyAiReportText(data, "新内容", { canEdit: false }), false);
  assert.deepEqual(data.modules[2].sections[0].items, ["人工计划"]);
  const context = {
    reportId: "r1",
    summaryType: "quarterly",
    startDate: "2026/07/01",
    endDate: "2026/09/30",
    generation: 3,
  };
  assert.equal(aiReportContextMatches(context, "r1", data, true), true);
  assert.equal(aiReportContextMatches(context, "r2", data, true), false);
  assert.equal(aiReportContextMatches(context, "r1", { ...data, endDate: "2026/12/31" }, true), false);
  assert.equal(aiReportContextMatches(context, "r1", data, false), false);
});

test("monthly and quarterly plan sections do not offer task import", () => {
  assert.match(html, /function reportSectionAllowsTaskImport/);
  assert.match(html, /reportSectionAllowsTaskImport\(summaryType, section\.title\)/);
});

test("AI report generation token rejects a deferred result from the moment switching starts", async () => {
  const helperSource = html.match(
    / {4}function invalidateAiReportContext[\s\S]*?(?=\r?\n\r?\n {4}function setAiReportStatus)/,
  )?.[0];
  assert.ok(helperSource, "missing executable AI result lifecycle helper");
  const elements = {
    aiReportText: { value: "" },
    copyAiReportBtn: { disabled: true },
    applyAiReportBtn: { disabled: true },
  };
  const runtime = new Function(
    "$",
    `${helperSource}
    let pendingAiReportContext = null;
    let aiReportGeneration = 0;
    let currentReportId = "r1";
    let reportData = { summaryType: "monthly", startDate: "2026/8/1", endDate: "2026/8/31", modules: [{ sections: [{ items: ["原草稿"] }] }] };
    let reportCanEdit = true;
    return {
      context: () => ({ reportId: currentReportId, summaryType: reportData.summaryType, startDate: reportData.startDate, endDate: reportData.endDate, generation: aiReportGeneration }),
      settle: async (waiting, context, result) => { await waiting; return acceptAiReportResult(context, result); },
      beginSwitch: () => invalidateAiReportContext(),
      finishSwitch: () => { currentReportId = "r2"; reportData = { summaryType: "monthly", startDate: "2026/9/1", endDate: "2026/9/30", modules: [{ sections: [{ items: ["新草稿"] }] }] }; invalidateAiReportContext(); },
      pending: () => pendingAiReportContext,
      draft: () => reportData.modules[0].sections[0].items,
    };`,
  )((id) => elements[id]);
  const acceptedContext = runtime.context();
  await runtime.settle(Promise.resolve(), acceptedContext, { result: { text: "当前报告AI结果" } });
  assert.equal(runtime.pending(), acceptedContext);
  assert.equal(elements.applyAiReportBtn.disabled, false);

  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const context = runtime.context();
  const settling = runtime.settle(waiting, context, { result: { text: "旧报告AI结果" } });
  runtime.beginSwitch();
  assert.deepEqual(runtime.draft(), ["原草稿"], "globals remain old while report loading is deferred");
  release();
  await assert.rejects(settling, /当前总结已切换/);
  runtime.finishSwitch();
  assert.equal(runtime.pending(), null);
  assert.equal(elements.applyAiReportBtn.disabled, true);
  assert.equal(elements.aiReportText.value, "");
  assert.deepEqual(runtime.draft(), ["新草稿"]);
});

test("AI summary UI exposes conditional apply and guards empty sources and stale results", () => {
  assert.match(buttonMarkup("applyAiReportBtn"), /写入当前总结/);
  assert.match(html, /applyAiReportBtn[\s\S]*summaryType === "weekly"/);
  assert.match(html, /未找到当前周期内可用于汇总的已保存/);
  assert.match(html, /await apiJson\(`\/api\/report\/\$\{encodeURIComponent\(source\.id\)\}`\)/);
  assert.match(html, /pendingAiReportContext = null/);
  assert.match(html, /window\.confirm/);
  assert.match(
    html,
    /async function openReport\(reportId\) \{\s*invalidateAiReportContext\(\)[\s\S]*?currentReportId = result\.report\.id;[\s\S]*?invalidateAiReportContext\(\)/,
  );
  assert.match(html, /async function loadCurrentReportForType\(\) \{\s*invalidateAiReportContext\(\)/);
  assert.match(html, /async function createReportFromModal\(\) \{\s*invalidateAiReportContext\(\)/);
});

function buttonMarkup(id) {
  const match = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`));
  assert.ok(match, `missing ${id}`);
  return match[0];
}

function clipboardRuntime({ clipboard, execCommand = () => true, activeElement = null, selection = null } = {}) {
  const source = html.match(/ {4}async function copyTextToClipboard\(text\) \{[\s\S]*?\r?\n {4}\}(?=\r?\n\r?\n)/)?.[0];
  assert.ok(source, "missing executable clipboard helper");
  const children = [];
  const document = {
    activeElement,
    body: {
      appendChild(node) {
        children.push(node);
        node.parentNode = this;
      },
      removeChild(node) {
        children.splice(children.indexOf(node), 1);
        node.parentNode = null;
      },
    },
    createElement(tag) {
      assert.equal(tag, "textarea");
      return { style: {}, focus() {}, select() {}, setSelectionRange() {} };
    },
    execCommand,
  };
  const window = { getSelection: () => selection };
  const navigator = clipboard === undefined ? {} : { clipboard };
  const copyTextToClipboard = new Function("navigator", "document", "window", `${source}\nreturn copyTextToClipboard;`)(
    navigator,
    document,
    window,
  );
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
  const runtime = clipboardRuntime({
    clipboard: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
    execCommand: (command) => command === "copy",
    activeElement,
    selection,
  });
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
  const failedRuntime = clipboardRuntime({
    execCommand: () => {
      throw new Error("sensitive DOM failure");
    },
    activeElement,
    selection,
  });
  await assert.rejects(
    failedRuntime.copyTextToClipboard("report"),
    (error) => error.message === "复制失败，请手动复制",
  );
  assert.equal(failedRuntime.children.length, 0);
  assert.deepEqual(restored, ["cleared", "focused"]);
});

test("clipboard fallback false and missing APIs report the same stable error", async () => {
  const falseRuntime = clipboardRuntime({ execCommand: () => false });
  await assert.rejects(falseRuntime.copyTextToClipboard("report"), (error) => error.message === "复制失败，请手动复制");
  assert.equal(falseRuntime.children.length, 0);

  const missingRuntime = clipboardRuntime({ execCommand: null });
  await assert.rejects(
    missingRuntime.copyTextToClipboard("report"),
    (error) => error.message === "复制失败，请手动复制",
  );
  assert.equal(missingRuntime.children.length, 0);
});

function inlineReportActionRuntime() {
  const source = html.match(/ {4}function inlineReportClickAction\(event\) \{[\s\S]*?\r?\n {4}\}(?=\r?\n\r?\n)/)?.[0];
  assert.ok(source, "missing executable inline report action helper");
  return new Function(`${source}\nreturn inlineReportClickAction;`)();
}

test("inline report list opens by row and only renders delete for the active saved report", () => {
  const source = html.match(
    / {4}function renderInlineReportHistory\(\) \{[\s\S]*?\r?\n {4}\}(?=\r?\n\r?\n {4}function reportHistoryLabel)/,
  )?.[0];
  assert.ok(source, "missing inline report renderer");
  assert.doesNotMatch(source, />打开<\/button>/);
  assert.match(source, /isActive && report\.id[\s\S]*data-report-delete/);
  assert.match(source, /data-report-open="\$\{report\.id\}"/);
  assert.match(
    html,
    /function inlineReportClickAction[\s\S]*?event\.stopPropagation\(\)[\s\S]*?type: "delete"[\s\S]*?type: "open"/,
  );
});

test("inline report item and click decisions keep delete exclusive to the active row", () => {
  const renderer = html.match(
    / {4}function renderInlineReportHistory\(\) \{[\s\S]*?\r?\n {4}\}(?=\r?\n\r?\n {4}function reportHistoryLabel)/,
  )?.[0];
  assert.match(renderer, /isActive && report\.id/);
  const decide = inlineReportActionRuntime();
  let stopped = false;
  const deleteButton = { dataset: { reportDelete: "active" } };
  const row = { dataset: { reportOpen: "active" } };
  const action = decide({
    stopPropagation: () => {
      stopped = true;
    },
    target: { closest: (selector) => (selector.includes("report-delete") ? deleteButton : row) },
  });
  assert.deepEqual(action, { type: "delete", id: "active" });
  assert.equal(stopped, true);
  assert.notEqual(action.type, "open");
});

function goalColumnWidthRuntime(storage = new Map(), setItem = (key, value) => storage.set(key, value)) {
  const source = html.match(/ {4}const goalTableColumns = \[[\s\S]*?(?=\r?\n\r?\n {4}const initialGoalsRows)/)?.[0];
  assert.ok(source, "missing executable goal column width functions");
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem,
  };
  return new Function(
    "localStorage",
    "storageKey",
    "currentUser",
    "currentDepartment",
    `${source}\nreturn { goalTableColumns, normalizeGoalColumnWidths, loadGoalColumnWidths, saveGoalColumnWidths, goalColumnWidthStorageKey, clampGoalColumnWidth, keyboardGoalColumnWidth, updateGoalColumnResizeHandle };`,
  )(localStorage, "dp-workbench", { username: "alice", department: { id: "dept-a" } }, () => ({ id: "dept-a" }));
}

test("goal column widths recover defaults, clamp bounds, and restore isolated storage", () => {
  const storage = new Map();
  const runtime = goalColumnWidthRuntime(storage);
  assert.deepEqual(
    runtime.goalTableColumns.map(({ key }) => key),
    [
      "seq",
      "name",
      "definition",
      "owner",
      "lastYearActual",
      "target",
      "expectedCurrent",
      "current",
      "progress",
      "status",
      "actions",
    ],
  );

  storage.set(runtime.goalColumnWidthStorageKey(), "not-json");

  storage.set(runtime.goalColumnWidthStorageKey(), JSON.stringify({ name: -999, owner: 88 }));
  const restored = runtime.loadGoalColumnWidths();
  const name = runtime.goalTableColumns.find(({ key }) => key === "name");
  assert.equal(restored.name, name.defaultWidth, "out-of-range values fall back to defaults");
  assert.equal(restored.owner, 88);

  runtime.saveGoalColumnWidths({ owner: 104 });
  assert.deepEqual(runtime.loadGoalColumnWidths(), {
    ...Object.fromEntries(runtime.goalTableColumns.map((column) => [column.key, column.defaultWidth])),
    owner: 104,
  });
  assert.match(runtime.goalColumnWidthStorageKey(), /dept-a-alice$/);
});

test("goal column keyboard math clamps and storage failures remain non-throwing", () => {
  const runtime = goalColumnWidthRuntime(new Map(), () => {
    throw new Error("quota");
  });
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
  const width = runtime.updateGoalColumnResizeHandle(handle, "actions", 999);
  assert.equal(width, 180);
  assert.equal(attributes.get("aria-valuemin"), "100");
  assert.equal(attributes.get("aria-valuemax"), "180");
  assert.equal(attributes.get("aria-valuenow"), "180");
});

test("goal table renders eleven stable columns with accessible pointer resize handles", () => {
  assert.match(html, /<colgroup>\$\{goalDeleteMode/);
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
  assert.doesNotMatch(html, /id="resetGoalsBtn"/);
  assert.match(html, /id="deleteGoalsBtn"/);
  assert.match(html, /label: "预计达成"/);
  assert.match(html, /label: "实际达成"/);
  assert.match(html, /data-goal-key="expectedCurrent"/);
  assert.match(html, /\$\{escapeHtml\(String\(row\.current \|\| 0\)\)\}/);
  assert.doesNotMatch(html, /label: "已达成"/);
  assert.match(html, /"actions".*defaultWidth: 120.*minWidth: 100.*maxWidth: 180/);
});

function overdueMigrationRuntime(tasks, persistTask, setSyncStatus = () => {}) {
  return overdueSaveRuntime(tasks, persistTask, setSyncStatus).blockOverdueTasksForListMode;
}

function overdueSaveRuntime(tasks, persistTask, setSyncStatus = () => {}, timers = {}) {
  const blockerFunction = html.match(/ {4}function overdueBlockerText\(task\) \{[\s\S]*?\r?\n {4}\}/)?.[0];
  const saveFunctions = html.match(
    / {4}function taskWithOverdueSaveBarrier[\s\S]*?(?=\r?\n\r?\n {4}function decodeReportEscapes)/,
  )?.[0];
  assert.ok(blockerFunction && saveFunctions, "missing executable overdue save serialization functions");
  const pendingTaskSaves = new Map();
  const deletingTaskIds = new Set();
  const overdueTaskSaveBarriers = new Map();
  return new Function(
    "tasks",
    "todayIso",
    "persistTask",
    "setSyncStatus",
    "pendingTaskSaves",
    "deletingTaskIds",
    "overdueTaskSaveBarriers",
    "setTimeout",
    "clearTimeout",
    `${blockerFunction}\n${saveFunctions}\nreturn { scheduleSaveTask, flushPendingTaskSave, cancelPendingTaskSave, blockOverdueTasksForListMode };`,
  )(
    tasks,
    () => "2026-08-04",
    persistTask,
    setSyncStatus,
    pendingTaskSaves,
    deletingTaskIds,
    overdueTaskSaveBarriers,
    timers.setTimeout || (() => 1),
    timers.clearTimeout || (() => {}),
  );
}

function goalTaskDisplayRuntime() {
  const source = html.match(/ {4}function latestTasksForGoalDisplay\(tasks\) \{[\s\S]*?\r?\n {4}\}/)?.[0];
  assert.ok(source, "missing goal task rollover-chain deduplication function");
  return new Function(`${source}\nreturn latestTasksForGoalDisplay;`)();
}

function goalTaskSummaryRuntime() {
  const displaySource = html.match(/ {4}function latestTasksForGoalDisplay\(tasks\) \{[\s\S]*?\r?\n {4}\}/)?.[0];
  const summarySource = html.match(
    / {4}function summarizeGoalTaskDisplay\(tasks, goalId, linksForTask\) \{[\s\S]*?\r?\n {4}\}/,
  )?.[0];
  assert.ok(displaySource, "missing goal task rollover-chain deduplication function");
  assert.ok(summarySource, "missing unified goal task display summary function");
  return new Function(`${displaySource}\n${summarySource}\nreturn summarizeGoalTaskDisplay;`)();
}

test("goal task details merge rollover chains and duplicate title module owner records", () => {
  const latestTasksForGoalDisplay = goalTaskDisplayRuntime();
  const tasks = [
    { id: "original", title: "指标上线", module: "数据治理", owner: "黄嘉颖", updatedAt: 10 },
    { id: "rolled-1", sourceTaskId: "original", title: "指标上线", module: "数据治理", owner: "黄嘉颖", updatedAt: 20 },
    { id: "rolled-2", sourceTaskId: "rolled-1", title: "指标上线", module: "数据治理", owner: "黄嘉颖", updatedAt: 30 },
    { id: "imported-duplicate", title: " 指标上线 ", module: "数据治理", owner: "黄嘉颖", updatedAt: 25 },
    { id: "different-owner", title: "指标上线", module: "数据治理", owner: "其他人", updatedAt: 35 },
  ];

  assert.deepEqual(
    latestTasksForGoalDisplay(tasks).map((task) => task.id),
    ["rolled-2", "different-owner"],
  );
});

test("goal task count and completed contribution use the deduplicated displayed tasks", () => {
  const summarizeGoalTaskDisplay = goalTaskSummaryRuntime();
  const tasks = [
    {
      id: "original",
      title: "指标上线",
      module: "数据治理",
      owner: "黄嘉颖",
      status: "已完成",
      updatedAt: 10,
      goalLinks: [{ goalId: "g1", contribution: 20 }],
    },
    {
      id: "rolled",
      sourceTaskId: "original",
      title: "指标上线",
      module: "数据治理",
      owner: "黄嘉颖",
      status: "进行中",
      updatedAt: 30,
      goalLinks: [{ goalId: "g1", contribution: 20 }],
    },
    {
      id: "duplicate",
      title: " 指标上线 ",
      module: "数据治理",
      owner: "黄嘉颖",
      status: "已完成",
      updatedAt: 20,
      goalLinks: [{ goalId: "g1", contribution: 20 }],
    },
    {
      id: "done",
      title: "报表上线",
      module: "数据治理",
      owner: "黄嘉颖",
      status: "已完成",
      updatedAt: 40,
      goalLinks: [{ goalId: "g1", contribution: 11 }],
    },
    {
      id: "other-goal",
      title: "其他指标",
      module: "数据治理",
      owner: "黄嘉颖",
      status: "已完成",
      updatedAt: 50,
      goalLinks: [{ goalId: "g2", contribution: 99 }],
    },
  ];

  const summary = summarizeGoalTaskDisplay(
    tasks.filter((task) => task.goalLinks.some((link) => link.goalId === "g1")),
    "g1",
    (task) => task.goalLinks,
  );

  assert.deepEqual(
    summary.rows.map((task) => task.id),
    ["rolled", "done"],
  );
  assert.equal(summary.count, 2);
  assert.equal(summary.completedContribution, 11);
});

test("report UI removes manual archive and diff preview and exposes archive schedule settings", () => {
  assert.doesNotMatch(html, /id="previewDiffBtn"/);
  assert.doesNotMatch(html, /id="saveReportBtn"/);
  for (const id of ["adminWeeklyArchiveTime", "adminMonthlyArchiveTime", "adminQuarterlyArchiveTime"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("scheduled task UI supports due-only report archive catch-up", () => {
  assert.match(html, /task\.kind === "report-auto-archive"/);
  assert.match(html, /只会归档已经到期的报告/);
  assert.match(html, /不会提前归档/);
  assert.match(html, /archivedCount/);
  assert.match(html, /scheduledTasks\.map/);
});

test("deleting a task cancels queued saves and blocks new saves", async () => {
  const task = { id: "a", title: "A", status: "进行中", dueDate: "2026-08-10" };
  const persisted = [];
  const runtime = overdueSaveRuntime([task], async (value) => persisted.push({ ...value }));

  runtime.scheduleSaveTask(task);
  await runtime.cancelPendingTaskSave(task.id);
  runtime.scheduleSaveTask({ ...task, title: "删除期间的旧编辑" });
  await runtime.flushPendingTaskSave(task.id);

  assert.deepEqual(persisted, []);
});

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

test("admin uses three top-level groups and six second-level pages", () => {
  for (const group of ["organization", "rules", "operations"]) {
    assert.match(html, new RegExp(`data-admin-group="${group}"`));
  }
  for (const section of ["departments", "members", "login", "archive", "api-key", "scheduled-tasks"]) {
    assert.match(html, new RegExp(`data-admin-section="${section}"`));
    assert.match(html, new RegExp(`data-admin-panel="${section}"`));
  }
  assert.match(html, /组织管理/);
  assert.match(html, /规则配置/);
  assert.match(html, /系统运维/);
  assert.match(html, /部门管理/);
  assert.match(html, /成员管理/);
  assert.match(html, /保持登录/);
  assert.match(html, /归档设置/);
  assert.match(html, /API 密钥/);
});

test("admin navigation uses the v2 sidebar and persistent page tabs", () => {
  assert.match(html, /class="admin-shell" id="adminShell"/);
  assert.match(html, /class="admin-sidebar" id="adminSidebar" aria-label="后台导航"/);
  assert.match(html, /class="admin-tabs" id="adminTabs" role="tablist"/);
  assert.match(html, /adminOpenTabs = \["overview"\]/);
  assert.match(html, /data-admin-close/);
  assert.match(html, /adminActiveSection === section[\s\S]{0,180}openAdminSection/);
});

test("admin v2 navigation adapts from full sidebar to icon rail and mobile drawer", () => {
  assert.match(html, /grid-template-columns:216px minmax\(0,1fr\)/);
  assert.match(html, /@media\(max-width:1023px\)[\s\S]*grid-template-columns:64px minmax\(0,1fr\)/);
  assert.match(html, /@media\(max-width:767px\)[\s\S]*\.admin-shell\.nav-open \.admin-sidebar/);
  assert.match(html, /id="adminMobileNavBtn" aria-label="打开后台导航"/);
});

test("admin redesign applies the Dongpeng enterprise shell and compact control tokens", () => {
  assert.match(html, /--dp-brand-red:\s*#E21413/);
  assert.match(html, /--dp-action-gradient:\s*linear-gradient\(148\.66deg,\s*#C94A4D 0%,\s*#E21413 100%\)/);
  assert.match(html, /\.admin-mode \.topbar\s*\{[^}]*height:\s*64px/);
  assert.match(html, /\.admin-mode :is\(button,input,select\)[^{]*\{[^}]*min-height:\s*36px[^}]*border-radius:\s*4px/);
  assert.match(html, /\.admin-mode \.admin-section\s*\{[^}]*border-radius:\s*8px[^}]*padding:\s*24px/);
});

test("admin editable lists retain compact column guidance inside the new workspace", () => {
  assert.match(html, /class="admin-list-guide departments"[\s\S]*部门名称[\s\S]*状态[\s\S]*部门负责人/);
  assert.match(
    html,
    /class="admin-list-guide members"[\s\S]*姓名[\s\S]*账号[\s\S]*所属部门[\s\S]*角色[\s\S]*负责模块[\s\S]*状态/,
  );
  assert.match(html, /class="admin-sidebar"/);
  assert.match(html, /id="adminReloadBtn">放弃更改/);
});

test("admin overview is the fixed default and reads scoped real data", () => {
  assert.match(html, /data-admin-panel="overview"/);
  assert.match(html, /adminActiveSection = "overview"/);
  assert.match(html, /apiJson\("\/api\/admin\/overview"/);
  assert.match(html, /metrics\.completionRate == null \? "—"/);
});

test("scheduled task actions use the due-only catch-up wording and remain separately confirmed", () => {
  assert.match(html, /task\.kind === "report-auto-archive" \? "检查并补跑" : "检查并结转"/);
  assert.match(html, /确认检查并补跑报告自动归档/);
  assert.match(html, /只会归档已经到期的报告，不会提前归档仍在编辑的报告/);
});

test("admin navigation maps groups to their default and remembered sections", () => {
  assert.match(html, /organization:\s*"departments"/);
  assert.match(html, /rules:\s*"login"/);
  assert.match(html, /operations:\s*"api-key"/);
  assert.match(html, /adminLastSectionByGroup\[adminActiveGroup\]/);
});

test("department rows expose a leader picker and account rows expose an enable toggle", () => {
  assert.match(html, /data-admin-department-leader="\$\{index\}"/);
  assert.match(html, /department\.leaderUsername/);
  assert.match(html, /data-admin-account-enabled="\$\{index\}"/);
  assert.match(html, /account\.enabled !== false/);
});

test("account management exposes task roles and multi-module responsibility", () => {
  assert.match(html, /data-admin-account-role="\$\{index\}"/);
  assert.match(html, /data-admin-account-managed-modules="\$\{index\}"/);
  assert.match(html, /data-leader-account-role=/);
  assert.match(html, /\/api\/admin\/leader\/accounts\/\$\{encodeURIComponent\(roleUsername\)\}\/role/);
});

test("task editing uses the signed-in role to limit assignees and modules", () => {
  assert.match(html, /function taskEditorModules\(task\)/);
  assert.match(html, /function taskEditorAccounts\(task\)/);
  assert.match(html, /data-task-field="ownerUsername"/);
  assert.match(html, /currentUser\?\.role === "member"/);
});

test("a department leader only gets organization management scoped to their department", () => {
  assert.match(html, /let adminRole = adminSession\.role === "leader" \? "leader" : "admin"/);
  assert.match(html, /function renderLeaderAdmin\(\)/);
  assert.match(html, /async function loadLeaderWorkspace\(\)/);
  assert.match(html, /\/api\/admin\/leader\/accounts/);
  assert.match(html, /\/api\/admin\/leader\/modules/);
  assert.match(html, /adminRole === "leader"[\s\S]{0,300}group\.id === "organization"/);
  assert.doesNotMatch(html, /data-admin-section="leader-accounts"/);
  assert.doesNotMatch(html, /data-admin-section="leader-modules"/);
  assert.match(html, /data-leader-account-enabled=/);
});

test("department leader module controls remain mounted in the merged department page", () => {
  assert.match(
    html,
    /data-admin-panel="departments"[\s\S]*id="leaderDepartmentManagementBody"[\s\S]*id="leaderDepartmentSummary"[\s\S]*id="addLeaderModuleBtn"[\s\S]*id="leaderModulesList"[\s\S]*id="saveLeaderModulesBtn"/,
  );
});

test("admin merged pages keep the existing controls under the new sections", () => {
  assert.match(html, /data-admin-panel="departments"[\s\S]*id="adminDepartmentsList"[\s\S]*id="adminModulesList"/);
  assert.match(html, /data-admin-panel="members"[\s\S]*id="adminAccountsList"/);
  assert.match(html, /data-admin-panel="login"[\s\S]*id="adminSessionDurationMinutes"/);
  assert.match(html, /data-admin-panel="archive"[\s\S]*id="adminWeeklyArchiveTime"/);
  assert.match(html, /data-admin-panel="api-key"[\s\S]*id="adminAiApiKey"/);
});

test("admin tracks unsaved settings by second-level page", () => {
  assert.match(html, /new Set\(\)/);
  assert.match(html, /markAdminDirty\("departments"/);
  assert.match(html, /markAdminDirty\("members"/);
  assert.match(html, /markAdminDirty\("login"/);
  assert.match(html, /markAdminDirty\("archive"/);
  assert.match(html, /markAdminDirty\("api-key"/);
  assert.match(html, /classList\.toggle\("dirty"/);
});

test("admin navigation remains usable on narrow touch screens", () => {
  assert.match(html, /@media\(max-width:900px\)[\s\S]*\.admin-primary-nav[\s\S]*overflow-x:auto/);
  assert.match(html, /@media\(hover:none\)[\s\S]*\.admin-nav-item\.expanded \.admin-secondary-menu/);
});

test("admin warns before leaving with unsaved settings", () => {
  assert.match(html, /backFromAdminBtn[\s\S]{0,300}adminDirtySections\.size > 0[\s\S]{0,180}当前后台有未保存修改/);
  assert.match(html, /window\.addEventListener\("beforeunload"[\s\S]{0,180}adminDirtySections\.size === 0/);
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
  assert.doesNotMatch(html, /escapeHtml\(task\.description\)\.slice\(0, 120\)/);
  assert.match(html, /normalizePriority\(task\.priority\) === definition\.priority/);
});

test("entering list mode blocks overdue tasks independently and idempotently", () => {
  assert.match(html, /function overdueBlockerText\(task\)/);
  assert.match(html, /任务已逾期（原计划完成日期：\$\{task\.dueDate\}）/);
  assert.match(
    html,
    /task\.status !== "已完成" && task\.status !== "阻塞" && task\.dueDate && task\.dueDate < todayIso\(\)/,
  );
  assert.match(html, /includes\(overdueText\)/);
  assert.match(html, /enqueuePendingTaskSave\(latestTask, \{ delay: false \}\)/);
  assert.match(html, /await flushPendingTaskSave\(task\.id\)/);
  assert.match(html, /tasks\[taskIndex\] = taskWithOverdueSaveBarrier/);
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
  const migrate = overdueMigrationRuntime(
    tasks,
    async (task) => {
      attempts.push(task.id);
      if (task.id === "fail") throw new Error("save failed");
    },
    (message) => messages.push(message),
  );

  await migrate();

  assert.deepEqual(attempts, ["fail", "ok"]);
  assert.equal(tasks[0].status, "进行中");
  assert.equal(tasks[1].status, "阻塞");
  assert.equal(tasks[1].blocker, "已有\n任务已逾期（原计划完成日期：2026-08-02）");
  assert.ok(messages.some((message) => message.includes("1 项逾期任务自动阻塞失败")));
});

test("pending user edits persist before the final overdue block save", async () => {
  const tasks = [
    { id: "a", title: "A", status: "进行中", dueDate: "2026-08-01", blocker: "", description: "最新编辑" },
  ];
  const persisted = [];
  const runtime = overdueSaveRuntime(tasks, async (task) => persisted.push({ ...task }));

  runtime.scheduleSaveTask(tasks[0]);
  await runtime.blockOverdueTasksForListMode();

  assert.deepEqual(
    persisted.map((task) => task.status),
    ["进行中", "阻塞"],
  );
  assert.deepEqual(
    persisted.map((task) => task.description),
    ["最新编辑", "最新编辑"],
  );
  assert.equal(tasks[0].status, "阻塞");
  assert.deepEqual(tasks[0], persisted.at(-1));
});

test("a failed pending edit remains pending and prevents an overdue overwrite", async () => {
  const tasks = [
    { id: "a", title: "A", status: "进行中", dueDate: "2026-08-01", blocker: "", description: "不能丢失" },
  ];
  const attempts = [];
  const messages = [];
  const runtime = overdueSaveRuntime(
    tasks,
    async (task) => {
      attempts.push({ ...task });
      throw new Error("offline");
    },
    (message) => messages.push(message),
  );

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
      const promise = new Promise((done) => {
        resolve = done;
      });
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

  assert.deepEqual(
    writes.map((task) => [task.description, task.status]),
    [
      ["v1", "进行中"],
      ["v2", "进行中"],
      ["v2", "阻塞"],
    ],
  );
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
  const runtime = overdueSaveRuntime(
    tasks,
    async (task) => {
      const snapshot = { ...task };
      writes.push(snapshot);
      if (snapshot.status !== "阻塞") {
        let resolve;
        const promise = new Promise((done) => {
          resolve = done;
        });
        deferredById.set(snapshot.id, { resolve });
        await promise;
      }
      serverTasks.set(snapshot.id, snapshot);
    },
    () => {},
    {
      setTimeout(callback) {
        nextTimerId += 1;
        timers.set(nextTimerId, callback);
        return nextTimerId;
      },
      clearTimeout(timerId) {
        timers.delete(timerId);
      },
    },
  );

  runtime.scheduleSaveTask(tasks[0]);
  const migration = runtime.blockOverdueTasksForListMode();
  await Promise.resolve();
  runtime.scheduleSaveTask(tasks[1]);
  deferredById.get("a").resolve();
  for (let index = 0; index < 3 && !deferredById.has("b"); index += 1)
    await new Promise((resolve) => setImmediate(resolve));
  assert.ok(deferredById.has("b"), "newly pending B must join the active flush-all drain");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    writes.map((task) => [task.id, task.status]),
    [
      ["a", "进行中"],
      ["b", "进行中"],
    ],
  );
  deferredById.get("b").resolve();
  await migration;

  assert.deepEqual(
    writes.map((task) => [task.id, task.status]),
    [
      ["a", "进行中"],
      ["b", "进行中"],
      ["a", "阻塞"],
      ["b", "阻塞"],
    ],
  );
  assert.equal(serverTasks.get("b").description, "B编辑");
  assert.equal(serverTasks.get("b").status, "阻塞");
  for (const callback of timers.values()) callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 4, "no delayed timer save may overwrite B");
});

test("edits during overdue migration remain blocked and preserve latest fields", async () => {
  const tasks = [
    { id: "a", title: "A", status: "进行中", dueDate: "2026-08-01", blocker: "", description: "A旧" },
    { id: "b", title: "B", status: "待开始", dueDate: "2026-08-02", blocker: "", description: "B旧" },
  ];
  const timers = new Map();
  const deferred = [];
  const writes = [];
  const serverTasks = new Map();
  let timerId = 0;
  const runtime = overdueSaveRuntime(
    tasks,
    async (task) => {
      const snapshot = { ...task };
      writes.push(snapshot);
      if (deferred.length < 2) {
        let resolve;
        const promise = new Promise((done) => {
          resolve = done;
        });
        deferred.push({ resolve });
        await promise;
      }
      serverTasks.set(snapshot.id, snapshot);
    },
    () => {},
    {
      setTimeout(callback) {
        timerId += 1;
        timers.set(timerId, callback);
        return timerId;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
  );

  const migration = runtime.blockOverdueTasksForListMode();
  while (deferred.length < 1) await new Promise((resolve) => setImmediate(resolve));
  tasks[0].description = "A最新";
  runtime.scheduleSaveTask(tasks[0]);
  tasks[1].description = "B最新";
  runtime.scheduleSaveTask(tasks[1]);
  deferred[0].resolve();
  while (deferred.length < 2) await new Promise((resolve) => setImmediate(resolve));
  deferred[1].resolve();
  await migration;
  for (const callback of [...timers.values()]) callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(writes.length, 3, "only A in-flight edit requires a second serialized write");
  assert.deepEqual(
    writes.map((task) => [task.id, task.description, task.status]),
    [
      ["a", "A旧", "阻塞"],
      ["a", "A最新", "阻塞"],
      ["b", "B最新", "阻塞"],
    ],
  );
  for (const [id, description] of [
    ["a", "A最新"],
    ["b", "B最新"],
  ]) {
    assert.equal(serverTasks.get(id).status, "阻塞");
    assert.equal(serverTasks.get(id).description, description);
    assert.match(serverTasks.get(id).blocker, /任务已逾期/);
    assert.deepEqual(
      tasks.find((task) => task.id === id),
      serverTasks.get(id),
    );
  }
});

test("failed overdue migration releases its barrier for a later explicit completion", async () => {
  const tasks = [
    { id: "a", title: "A", status: "进行中", dueDate: "2026-08-01", blocker: "", description: "失败前编辑" },
  ];
  const writes = [];
  let shouldFail = true;
  const runtime = overdueSaveRuntime(tasks, async (task) => {
    writes.push({ ...task });
    if (shouldFail) {
      shouldFail = false;
      throw new Error("offline");
    }
  });

  await runtime.blockOverdueTasksForListMode();
  assert.equal(tasks[0].status, "进行中");
  tasks[0].status = "已完成";
  tasks[0].description = "失败后完成并补充说明";
  runtime.scheduleSaveTask(tasks[0]);
  await runtime.flushPendingTaskSave("a");

  assert.equal(writes.length, 2);
  assert.equal(writes[1].status, "已完成");
  assert.equal(writes[1].description, "失败后完成并补充说明");
  assert.equal(writes[1].blocker, "");
  assert.deepEqual(tasks[0], writes[1]);
});
