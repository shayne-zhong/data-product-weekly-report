import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";

import { defaultLocalStatePath } from "../lib/state-store.mjs";

process.env.ADMIN_USERNAME = "Admin";
process.env.ADMIN_PASSWORD = "888888";
process.env.ADMIN_SESSION_SECRET = "workbuddy-events-admin-secret-32-bytes";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 10).toString("base64");
process.env.WORKBUDDY_OPEN_API_TOKEN = "workbuddy-events-open-token";
process.env.WORKBUDDY_DEPARTMENT_ID = "data-product";

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

let handler;
let adminHeaders;
let userHeaders;
let validTaskId;
let invalidTaskId;

async function api(path, { method = "GET", body, headers = {} } = {}) {
  const url = new URL(path, "http://workbench.internal");
  const query = { path: url.pathname.split("/").filter(Boolean) };
  for (const [key, value] of url.searchParams) query[key] = value;
  const req = { method, headers, query, body };
  const res = mockRes();
  await handler(req, res);
  return res;
}

function openApi(path, options = {}) {
  return api(path, {
    ...options,
    headers: {
      ...options.headers,
      authorization: `Bearer ${process.env.WORKBUDDY_OPEN_API_TOKEN}`,
    },
  });
}

test.before(async () => {
  await rm(defaultLocalStatePath(), { force: true });
  ({ default: handler } = await import(`../api/[...path].mjs?events-test=${Date.now()}`));

  const adminLogin = await api("/admin/login", {
    method: "POST",
    body: { username: "Admin", password: "888888" },
  });
  adminHeaders = { authorization: `Bearer ${adminLogin.body.token}` };
  const registered = await api("/auth/register", {
    method: "POST",
    body: { username: "zhongnanhai", password: "12345678", displayName: "钟南海" },
  });
  assert.equal(registered.statusCode, 201);
  const login = await api("/auth/login", {
    method: "POST",
    body: { username: "zhongnanhai", password: "12345678" },
  });
  userHeaders = { "x-user-token": login.body.token };
  const week = await api("/weeks", {
    method: "POST",
    headers: userHeaders,
    body: { startDate: "2094-01-02", endDate: "2094-01-08" },
  });
  const valid = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`, {
    method: "POST",
    headers: userHeaders,
    body: {
      task: {
        title: "企微结果回传任务",
        status: "进行中",
        goalLinks: [{ goalId: "goal-events", contribution: 1 }],
      },
    },
  });
  validTaskId = valid.body.task.id;
  const invalid = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`, {
    method: "POST",
    headers: userHeaders,
    body: { task: { title: "缺少指标的任务", status: "进行中" } },
  });
  invalidTaskId = invalid.body.task.id;
});

test.after(async () => {
  await rm(defaultLocalStatePath(), { force: true });
});

test("WorkBuddy reports one real WeCom result idempotently without changing the task", async () => {
  const before = await api(`/task/${validTaskId}`, { headers: userHeaders });
  const payload = {
    event_id: "event-created-1",
    task_id: validTaskId,
    action: "created",
    result: "success",
    wecom_todo_id: "todo-1",
    attempt: 1,
    message: "created",
    occurred_at: Date.now(),
  };

  const first = await openApi("/open/sync-events", { method: "POST", body: payload });
  const repeat = await openApi("/open/sync-events", { method: "POST", body: payload });
  const after = await api(`/task/${validTaskId}`, { headers: userHeaders });

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.duplicate, false);
  assert.equal(repeat.body.duplicate, true);
  assert.equal(repeat.body.log_id, first.body.log_id);
  assert.deepEqual(after.body, before.body);
});

test("event ingestion rejects invalid actions and timestamps outside 24 hours", async () => {
  const invalidAction = await openApi("/open/sync-events", {
    method: "POST",
    body: {
      event_id: "bad-1",
      task_id: validTaskId,
      action: "deleted",
      result: "success",
      occurred_at: Date.now(),
    },
  });
  assert.equal(invalidAction.statusCode, 400);

  const stale = await openApi("/open/sync-events", {
    method: "POST",
    body: {
      event_id: "bad-2",
      task_id: validTaskId,
      action: "created",
      result: "success",
      occurred_at: Date.now() - 25 * 60 * 60 * 1_000,
    },
  });
  assert.equal(stale.statusCode, 400);
});

test("empty polling updates status without writing another detail event", async () => {
  const first = await openApi("/open/tasks?updated_since=0");
  const checkpoint = Math.max(...first.body.tasks.map((task) => task.updated_at));
  const empty = await openApi(`/open/tasks?updated_since=${checkpoint}`);
  assert.deepEqual(empty.body.tasks, []);

  const logs = await api("/admin/workbuddy/logs?action=polled", {
    headers: adminHeaders,
  });
  assert.equal(logs.body.events.length, 1);
  const overview = await api("/admin/workbuddy", { headers: adminHeaders });
  assert.ok(overview.body.status.lastPollAt > 0);
  assert.equal(overview.body.status.lastPollCount, 0);
  assert.equal(overview.body.status.lastWatermark, checkpoint);
});

test("an authenticated polling failure writes one safe failure event", async () => {
  process.env.WORKBUDDY_DIRECTORY_MAPPINGS_JSON = "{invalid";
  try {
    const failed = await openApi("/open/tasks?updated_since=0");
    assert.equal(failed.statusCode, 503);
  } finally {
    delete process.env.WORKBUDDY_DIRECTORY_MAPPINGS_JSON;
  }

  const logs = await api("/admin/workbuddy/logs?action=poll_failed", {
    headers: adminHeaders,
  });
  assert.equal(logs.body.events.length, 1);
  assert.doesNotMatch(JSON.stringify(logs.body), /Bearer|workbuddy-events-open-token/);
});

test("writeback 200, 409, and 422 create distinct safe events", async () => {
  assert.equal((await openApi(`/open/tasks/${validTaskId}/status`, {
    method: "PUT", body: { status: "completed" },
  })).statusCode, 200);
  assert.equal((await openApi(`/open/tasks/${validTaskId}/status`, {
    method: "PUT", body: { status: "completed" },
  })).statusCode, 409);
  assert.equal((await openApi(`/open/tasks/${invalidTaskId}/status`, {
    method: "PUT", body: { status: "completed" },
  })).statusCode, 422);

  const logs = await api("/admin/workbuddy/logs?keyword=任务", { headers: adminHeaders });
  const actions = new Set(logs.body.events.map((row) => row.action));
  assert.equal(actions.has("writeback_completed"), true);
  assert.equal(actions.has("writeback_terminal"), true);
  assert.equal(actions.has("writeback_rejected"), true);
  assert.doesNotMatch(JSON.stringify(logs.body), /Authorization|Bearer|oauth-code/);
});
