import test from "node:test";
import assert from "node:assert/strict";

import {
  groupCompletedTasks,
  parseTaskImportTable,
  priorityQuadrants,
  reportTaskImportLine,
  taskCounts,
} from "../lib/workbench-utils.mjs";

test("report import line keeps existing content format with sequence title progress and detail", () => {
  const line = reportTaskImportLine({
    title: "成本还原表",
    progress: 23,
    dailyLogs: [{ progress: "已上线6个报表" }],
  }, 0);
  assert.equal(line, "1、成本还原表：整体进度23%，已上线6个报表");
});

test("task counts match dashboard cards", () => {
  const counts = taskCounts([
    { status: "待开始" },
    { status: "进行中" },
    { status: "阻塞" },
    { status: "已完成" },
    { status: "已完成", carryToNextWeek: true },
  ]);
  assert.deepEqual(counts, { total: 5, todo: 1, doing: 1, blocked: 1, done: 2, carry: 4 });
});

test("completed tasks group by completion month newest first", () => {
  const groups = groupCompletedTasks([
    { title: "旧任务", status: "已完成", completedAt: new Date("2026-05-02").getTime() },
    { title: "新任务", status: "已完成", completedAt: new Date("2026-06-02").getTime() },
    { title: "未完成", status: "进行中" },
  ]);
  assert.deepEqual(Object.keys(groups), ["2026/06", "2026/05"]);
  assert.equal(groups["2026/06"][0].title, "新任务");
});

test("task import table parses Excel-friendly csv or tab text", () => {
  const rows = parseTaskImportTable("任务标题,所属模块,负责人\n成本还原表,财经共享,钟南海");
  assert.deepEqual(rows, [{ 任务标题: "成本还原表", 所属模块: "财经共享", 负责人: "钟南海" }]);
});

test("priority options are four-quadrant labels", () => {
  assert.deepEqual(priorityQuadrants, ["重要紧急", "重要不紧急", "不重要紧急", "不重要不紧急"]);
});
