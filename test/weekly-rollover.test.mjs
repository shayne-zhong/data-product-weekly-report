import test from "node:test";
import assert from "node:assert/strict";

test("weekly rollover records one durable effect and skips repeated execution", async () => {
  const module = await import("../lib/weekly-rollover.mjs").catch(() => ({}));
  assert.equal(typeof module.applyWeeklyRollover, "function", "weekly rollover service is missing");

  const sourceWeekId = "2026-08-10_2026-08-16";
  const targetWeekId = "2026-08-17_2026-08-23";
  const state = {
    settings: {
      departments: [{ id: "data-product", name: "数据产品部", enabled: true }],
    },
    weeks: {
      [`data-product:${sourceWeekId}`]: {
        id: sourceWeekId,
        departmentId: "data-product",
        startDate: "2026-08-10",
        endDate: "2026-08-16",
      },
    },
    tasks: {
      doing: { id: "doing", departmentId: "data-product", weekId: sourceWeekId, title: "继续推进", status: "进行中" },
      blocked: { id: "blocked", departmentId: "data-product", weekId: sourceWeekId, title: "等待资源", status: "阻塞" },
      done: {
        id: "done",
        departmentId: "data-product",
        weekId: sourceWeekId,
        title: "已经完成",
        status: "已完成",
        carryToNextWeek: true,
      },
    },
  };
  const options = { now: Date.parse("2026-08-16T16:05:00.000Z") };

  const first = module.applyWeeklyRollover(state, options);
  const second = module.applyWeeklyRollover(state, options);
  const targetTasks = Object.values(state.tasks).filter((task) => task.weekId === targetWeekId);

  assert.equal(first.changed, true);
  assert.equal(first.rolledTaskCount, 2);
  assert.equal(second.changed, false);
  assert.equal(second.rolledTaskCount, 0);
  assert.deepEqual(targetTasks.map((task) => task.sourceTaskId).sort(), ["blocked", "doing"]);
  assert.ok(state.weeks[`data-product:${targetWeekId}`]);
  assert.equal(Object.keys(state.weeklyRolloverRuns).length, 1);
});

test("weekly rollover task status exposes missed schedules, failures, and recovery", async () => {
  const module = await import("../lib/weekly-rollover.mjs");
  const now = Date.parse("2026-08-17T01:00:00+08:00");
  const state = {
    settings: { departments: [{ id: "data-product", enabled: true }] },
    tasks: {},
    weeks: {},
    weeklyRolloverRuns: {},
  };

  const missed = module.weeklyRolloverTaskSummary(state, { now });
  assert.equal(missed.status, "failed");
  assert.match(missed.error, /未检测到本周执行记录/);

  module.startWeeklyRolloverExecution(state, { now, trigger: "manual:admin" });
  assert.equal(module.weeklyRolloverTaskSummary(state, { now }).status, "running");
  const timedOut = module.weeklyRolloverTaskSummary(state, { now: now + 11 * 60 * 1000 });
  assert.equal(timedOut.status, "failed");
  assert.match(timedOut.error, /超过 10 分钟/);

  module.failWeeklyRolloverExecution(state, new Error("upstream\nsecret-free failure"), { now: now + 1 });
  const failed = module.weeklyRolloverTaskSummary(state, { now: now + 1 });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "upstream secret-free failure");

  const result = module.applyWeeklyRollover(state, { now });
  module.completeWeeklyRolloverExecution(state, result, { now: now + 2 });
  const recovered = module.weeklyRolloverTaskSummary(state, { now: now + 2 });
  assert.equal(recovered.status, "success");
  assert.equal(recovered.completedDepartmentCount, 1);

  module.failWeeklyRolloverExecution(state, new Error("retry failed"), { now: now + 3 });
  const retryFailed = module.weeklyRolloverTaskSummary(state, { now: now + 3 });
  assert.equal(retryFailed.status, "failed");
  assert.equal(retryFailed.error, "retry failed");
});
