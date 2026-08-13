import test from "node:test";
import assert from "node:assert/strict";

test("timer function invokes the protected rollover endpoint with a stable timestamp", async () => {
  const module = await import("../cloudfunctions/weekly-task-rollover/index.js").catch(() => ({}));
  assert.equal(typeof module.createWeeklyRolloverHandler, "function", "timer function handler is missing");
  const calls = [];
  const handler = module.createWeeklyRolloverHandler({
    env: { WORKBENCH_URL: "https://workbench.example", WEEKLY_ROLLOVER_SECRET: "secret" },
    now: () => Date.parse("2026-08-16T16:05:00.000Z"),
    fetchImpl: async (...args) => {
      calls.push(args);
      return { ok: true, status: 200, json: async () => ({ changed: true, rolledTaskCount: 2 }) };
    },
  });

  const result = await handler({ Type: "Timer" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://workbench.example/api/internal/weekly-rollover");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].headers["x-weekly-rollover-secret"], "secret");
  assert.deepEqual(JSON.parse(calls[0][1].body), { triggeredAt: "2026-08-16T16:05:00.000Z" });
  assert.equal(result.rolledTaskCount, 2);
});

test("timer function preserves the timer event timestamp across retries", async () => {
  const { createWeeklyRolloverHandler } = await import("../cloudfunctions/weekly-task-rollover/index.js");
  let requestBody;
  const handler = createWeeklyRolloverHandler({
    env: { WORKBENCH_URL: "https://workbench.example", WEEKLY_ROLLOVER_SECRET: "secret" },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ changed: false }) };
    },
    now: () => Date.parse("2026-08-23T16:05:00.000Z"),
  });

  await handler({ Time: "2026-08-16T16:05:00Z" });
  assert.deepEqual(requestBody, { triggeredAt: "2026-08-16T16:05:00.000Z" });
});

test("timer function throws when the rollover endpoint fails", async () => {
  const module = await import("../cloudfunctions/weekly-task-rollover/index.js").catch(() => ({}));
  assert.equal(typeof module.createWeeklyRolloverHandler, "function", "timer function handler is missing");
  const handler = module.createWeeklyRolloverHandler({
    env: { WORKBENCH_URL: "https://workbench.example", WEEKLY_ROLLOVER_SECRET: "secret" },
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => "unavailable" }),
  });

  await assert.rejects(() => handler({ Type: "Timer" }), /503/);
});
