import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import handler from "../api/[...path].mjs";

const syncKey = "DP-WEEKLY-2026-7K4M";

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

async function api(path, { method = "GET", body } = {}) {
  const req = {
    method,
    headers: { "x-report-key": syncKey },
    query: { path: path.split("/").filter(Boolean) },
    body,
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

test("tasks persist multiple linked goal contributions after update and reload", async () => {
  const suffix = randomUUID();
  const startDate = `2093-03-${suffix}`;
  const week = await api("/weeks", {
    method: "POST",
    body: { startDate, endDate: startDate },
  });
  assert.equal(week.statusCode, 201);

  const created = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`, {
    method: "POST",
    body: {
      task: {
        title: `multi-goal-${suffix}`,
        status: "进行中",
        goalLinks: [
          { goalId: "goal-a", contribution: 6, unit: "unit", note: "A" },
          { goalId: "goal-b", contribution: 2, unit: "unit", note: "B" },
        ],
      },
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.task.goalLinks.length, 2);

  const updated = await api(`/task/${encodeURIComponent(created.body.task.id)}`, {
    method: "POST",
    body: {
      task: {
        status: "已完成",
        goalLinks: [
          { goalId: "goal-a", contribution: 8, unit: "unit", note: "A updated" },
          { goalId: "goal-b", contribution: 3, unit: "unit", note: "B updated" },
          { goalId: "goal-c", contribution: 1, unit: "unit", note: "C" },
        ],
      },
    },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.task.status, "已完成");
  assert.equal(updated.body.task.goalLinks.length, 3);

  const loaded = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`);
  assert.equal(loaded.statusCode, 200);
  const task = loaded.body.tasks.find((item) => item.id === created.body.task.id);
  assert.ok(task);
  assert.deepEqual(task.goalLinks.map((link) => link.goalId), ["goal-a", "goal-b", "goal-c"]);
  assert.deepEqual(task.goalLinks.map((link) => link.contribution), [8, 3, 1]);
});
