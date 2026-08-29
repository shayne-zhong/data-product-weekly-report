import assert from "node:assert/strict";
import test from "node:test";

import handler from "../api/[...path].mjs";

process.env.ADMIN_USERNAME = "Admin";
process.env.ADMIN_PASSWORD = "888888";
process.env.ADMIN_SESSION_SECRET = "workbuddy-open-api-admin-secret-32-bytes";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.WORKBUDDY_OPEN_API_TOKEN = "workbuddy-open-secret";
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
  };
}

let userToken = "";
let validTaskId = "";
let invalidTaskId = "";
let otherDepartmentTaskId = "";

async function api(path, { method = "GET", body, user = true, bearer = "", headers: extraHeaders = {} } = {}) {
  const url = new URL(path, "http://workbench.internal");
  const query = { path: url.pathname.split("/").filter(Boolean) };
  for (const [key, value] of url.searchParams) query[key] = value;
  const headers = {};
  if (user && userToken) headers["x-user-token"] = userToken;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  Object.assign(headers, extraHeaders);
  const req = { method, headers, query, body };
  const res = mockRes();
  await handler(req, res);
  return res;
}

test.before(async () => {
  const adminLogin = await api("/admin/login", {
    method: "POST",
    user: false,
    body: { username: "Admin", password: "888888" },
  });
  assert.equal(adminLogin.statusCode, 200);
  const adminHeaders = { authorization: `Bearer ${adminLogin.body.token}` };
  const current = await api("/admin/settings", { user: false, headers: adminHeaders });
  assert.equal(current.statusCode, 200);
  const saved = await api("/admin/settings", {
    method: "PATCH",
    user: false,
    headers: adminHeaders,
    body: {
      departments: [
        ...current.body.settings.departments,
        { id: "other", name: "其他部门", enabled: true, modules: ["其他模块"] },
      ],
      accounts: [
        ...current.body.settings.accounts,
        { name: "其他员工", username: "otheruser", departmentId: "other" },
      ],
    },
  });
  assert.equal(saved.statusCode, 200);

  const registered = await api("/auth/register", {
    method: "POST",
    user: false,
    body: { username: "zhongnanhai", password: "12345678", displayName: "钟南海" },
  });
  assert.equal(registered.statusCode, 201);
  const login = await api("/auth/login", {
    method: "POST",
    user: false,
    body: { username: "zhongnanhai", password: "12345678" },
  });
  assert.equal(login.statusCode, 200);
  userToken = login.body.token;

  const week = await api("/weeks", {
    method: "POST",
    body: { startDate: "2097-01-07", endDate: "2097-01-13" },
  });
  assert.equal(week.statusCode, 201);

  const valid = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`, {
    method: "POST",
    body: {
      task: {
        title: "准备经营月报",
        description: "补齐指标说明",
        status: "进行中",
        dueDate: "2097-01-12",
        goalLinks: [{ goalId: "goal-1", contribution: 5 }],
      },
    },
  });
  assert.equal(valid.statusCode, 201);
  validTaskId = valid.body.task.id;

  const invalid = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`, {
    method: "POST",
    body: { task: { title: "未关联指标任务", status: "进行中" } },
  });
  assert.equal(invalid.statusCode, 201);
  invalidTaskId = invalid.body.task.id;

  const otherRegistered = await api("/auth/register", {
    method: "POST",
    user: false,
    body: { username: "otheruser", password: "12345678", displayName: "其他员工" },
  });
  assert.equal(otherRegistered.statusCode, 201);
  const otherLogin = await api("/auth/login", {
    method: "POST",
    user: false,
    body: { username: "otheruser", password: "12345678" },
  });
  assert.equal(otherLogin.statusCode, 200);
  const otherHeaders = { "x-user-token": otherLogin.body.token };
  const otherWeek = await api("/weeks", {
    method: "POST",
    user: false,
    headers: otherHeaders,
    body: { startDate: "2097-01-07", endDate: "2097-01-13" },
  });
  assert.equal(otherWeek.statusCode, 201);
  const otherTask = await api(`/week/${encodeURIComponent(otherWeek.body.week.id)}/tasks`, {
    method: "POST",
    user: false,
    headers: otherHeaders,
    body: {
      task: {
        title: "其他部门任务",
        status: "进行中",
        goalLinks: [{ goalId: "other-goal", contribution: 1 }],
      },
    },
  });
  assert.equal(otherTask.statusCode, 201);
  otherDepartmentTaskId = otherTask.body.task.id;
});

test("incremental query requires bearer authentication and a nonnegative integer", async () => {
  assert.equal((await api("/open/tasks?updated_since=0", { user: false })).statusCode, 401);
  assert.equal((await api("/open/tasks", { user: false, bearer: "workbuddy-open-secret" })).statusCode, 400);
  assert.equal((await api("/open/tasks?updated_since=-1", { user: false, bearer: "workbuddy-open-secret" })).statusCode, 400);
  assert.equal((await api("/open/tasks?updated_since=1.5", { user: false, bearer: "workbuddy-open-secret" })).statusCode, 400);
});

test("incremental query returns the exact contract ordered by updated_at", async () => {
  const response = await api("/open/tasks?updated_since=0", {
    user: false,
    bearer: "workbuddy-open-secret",
  });

  assert.equal(response.statusCode, 200);
  const rows = response.body.tasks.filter((task) => [validTaskId, invalidTaskId].includes(task.task_id));
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]), [
    "task_id",
    "title",
    "description",
    "assignee_userid",
    "status",
    "due_date",
    "updated_at",
  ]);
  assert.equal(rows[0].assignee_userid, null);
  assert.equal(rows[0].updated_at < rows[1].updated_at, true);

  const checkpoint = Math.max(...response.body.tasks.map((task) => task.updated_at));
  const empty = await api(`/open/tasks?updated_since=${checkpoint}`, {
    user: false,
    bearer: "workbuddy-open-secret",
  });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.body.tasks, []);
});

test("a website task edit appears after the saved incremental checkpoint", async () => {
  const before = await api("/open/tasks?updated_since=0", { user: false, bearer: "workbuddy-open-secret" });
  const checkpoint = Math.max(...before.body.tasks.map((task) => task.updated_at));
  const edited = await api(`/task/${validTaskId}`, {
    method: "POST",
    body: { task: { title: "准备经营月报 V2" } },
  });
  assert.equal(edited.statusCode, 200);

  const after = await api(`/open/tasks?updated_since=${checkpoint}`, {
    user: false,
    bearer: "workbuddy-open-secret",
  });
  assert.equal(after.statusCode, 200);
  assert.deepEqual(after.body.tasks.map((task) => task.task_id), [validTaskId]);
  assert.equal(after.body.tasks[0].title, "准备经营月报 V2");
});

test("configured directory mapping is applied once and hidden from ordinary account responses", async () => {
  const before = await api("/open/tasks?updated_since=0", { user: false, bearer: "workbuddy-open-secret" });
  const checkpoint = Math.max(...before.body.tasks.map((task) => task.updated_at));
  process.env.WORKBUDDY_DIRECTORY_MAPPINGS_JSON = JSON.stringify([
    { username: "zhongnanhai", wecom_userid: "wx-zhongnanhai" },
  ]);
  process.env.WORKBUDDY_DIRECTORY_BATCH_ID = "open-api-test-directory-v1";

  try {
    const response = await api(`/open/tasks?updated_since=${checkpoint}`, {
      user: false,
      bearer: "workbuddy-open-secret",
    });
    const assigned = response.body.tasks.filter((task) => [validTaskId, invalidTaskId].includes(task.task_id));
    assert.equal(assigned.length, 2);
    assert.equal(assigned.every((task) => task.assignee_userid === "wx-zhongnanhai"), true);

    const accounts = await api("/accounts");
    assert.equal(accounts.statusCode, 200);
    assert.doesNotMatch(JSON.stringify(accounts.body), /wx-zhongnanhai|wecomUserId/);
  } finally {
    delete process.env.WORKBUDDY_DIRECTORY_MAPPINGS_JSON;
    delete process.env.WORKBUDDY_DIRECTORY_BATCH_ID;
  }
});

test("completion writeback succeeds once and terminal retry returns 409 without restamping", async () => {
  const first = await api(`/open/tasks/${validTaskId}/status`, {
    method: "PUT",
    user: false,
    bearer: "workbuddy-open-secret",
    body: { status: "completed" },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.task_id, validTaskId);
  assert.equal(first.body.status, "已完成");
  assert.equal(Number.isSafeInteger(first.body.updated_at), true);

  const repeat = await api(`/open/tasks/${validTaskId}/status`, {
    method: "PUT",
    user: false,
    bearer: "workbuddy-open-secret",
    body: { status: "completed" },
  });
  assert.equal(repeat.statusCode, 409);
  assert.equal(repeat.body.code, "TASK_ALREADY_TERMINAL");

  const noRestamp = await api(`/open/tasks?updated_since=${first.body.updated_at}`, {
    user: false,
    bearer: "workbuddy-open-secret",
  });
  assert.equal(noRestamp.body.tasks.some((task) => task.task_id === validTaskId), false);
});

test("completion writeback preserves domain rules and rejects unsupported statuses", async () => {
  const blocked = await api(`/open/tasks/${invalidTaskId}/status`, {
    method: "PUT",
    user: false,
    bearer: "workbuddy-open-secret",
    body: { status: "completed" },
  });
  assert.equal(blocked.statusCode, 422);
  assert.equal(blocked.body.code, "TASK_COMPLETION_REQUIREMENTS_NOT_MET");

  const unsupported = await api(`/open/tasks/${invalidTaskId}/status`, {
    method: "PUT",
    user: false,
    bearer: "workbuddy-open-secret",
    body: { status: "进行中" },
  });
  assert.equal(unsupported.statusCode, 400);

  const missing = await api("/open/tasks/missing/status", {
    method: "PUT",
    user: false,
    bearer: "workbuddy-open-secret",
    body: { status: "completed" },
  });
  assert.equal(missing.statusCode, 404);

  const crossDepartment = await api(`/open/tasks/${otherDepartmentTaskId}/status`, {
    method: "PUT",
    user: false,
    bearer: "workbuddy-open-secret",
    body: { status: "completed" },
  });
  assert.equal(crossDepartment.statusCode, 404);
});
