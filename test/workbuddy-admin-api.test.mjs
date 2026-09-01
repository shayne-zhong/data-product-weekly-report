import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";

import { defaultLocalStatePath } from "../lib/state-store.mjs";

process.env.ADMIN_USERNAME = "Admin";
process.env.ADMIN_PASSWORD = "888888";
process.env.ADMIN_SESSION_SECRET = "workbuddy-admin-api-session-secret-32-bytes";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.WORKBUDDY_OPEN_API_TOKEN = "environment-open-token-value-1234";
process.env.WORKBUDDY_DEPARTMENT_ID = "data-product";
process.env.WORKBUDDY_OAUTH_RESOLVER_URL = "http://environment.internal/resolve";
process.env.WORKBUDDY_OAUTH_RESOLVER_TOKEN = "environment-oauth-token-value-1234";
process.env.WECOM_OAUTH_CORP_ID = "corp-environment";

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

async function api(path, { method = "GET", body, headers = {} } = {}) {
  const url = new URL(path, "http://workbench.internal");
  const query = { path: url.pathname.split("/").filter(Boolean) };
  for (const [key, value] of url.searchParams) query[key] = value;
  const req = { method, headers, query, body };
  const res = mockRes();
  await handler(req, res);
  return res;
}

function openApi(path, token, options = {}) {
  return api(path, {
    ...options,
    headers: {
      ...options.headers,
      authorization: `Bearer ${token}`,
    },
  });
}

let adminHeaders;
let leaderHeaders;
let taskId;
let activeOpenToken = process.env.WORKBUDDY_OPEN_API_TOKEN;
let handler;

test.before(async () => {
  await rm(defaultLocalStatePath(), { force: true });
  ({ default: handler } = await import(`../api/[...path].mjs?admin-test=${Date.now()}`));
  const adminLogin = await api("/admin/login", {
    method: "POST",
    body: { username: "Admin", password: "888888" },
  });
  assert.equal(adminLogin.statusCode, 200);
  adminHeaders = { authorization: `Bearer ${adminLogin.body.token}` };

  const current = await api("/admin/settings", { headers: adminHeaders });
  const settings = current.body.settings;
  const saved = await api("/admin/settings", {
    method: "PATCH",
    headers: adminHeaders,
    body: {
      departments: settings.departments.map((department) => (
        department.id === "data-product"
          ? { ...department, leaderUsername: "zhongnanhai" }
          : department
      )),
      accounts: settings.accounts,
    },
  });
  assert.equal(saved.statusCode, 200);

  const registered = await api("/auth/register", {
    method: "POST",
    body: { username: "zhongnanhai", password: "12345678", displayName: "钟南海" },
  });
  assert.equal(registered.statusCode, 201);
  const login = await api("/auth/login", {
    method: "POST",
    body: { username: "zhongnanhai", password: "12345678" },
  });
  assert.equal(login.statusCode, 200);
  const userHeaders = { "x-user-token": login.body.token };
  const week = await api("/weeks", {
    method: "POST",
    headers: userHeaders,
    body: { startDate: "2095-01-03", endDate: "2095-01-09" },
  });
  const task = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`, {
    method: "POST",
    headers: userHeaders,
    body: {
      task: {
        title: "后台映射增量任务",
        status: "进行中",
        owner: "钟南海",
        ownerUsername: "zhongnanhai",
      },
    },
  });
  taskId = task.body.task.id;

  const leaderLogin = await api("/admin/login", {
    method: "POST",
    body: { username: "zhongnanhai", password: "12345678" },
  });
  assert.equal(leaderLogin.statusCode, 200);
  leaderHeaders = { authorization: `Bearer ${leaderLogin.body.token}` };
});

test.after(async () => {
  await rm(defaultLocalStatePath(), { force: true });
});

test("only a global administrator can read WorkBuddy operations data", async () => {
  assert.equal((await api("/admin/workbuddy")).statusCode, 401);
  assert.equal((await api("/admin/workbuddy", { headers: leaderHeaders })).statusCode, 403);

  const response = await api("/admin/workbuddy", { headers: adminHeaders });

  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.body.mappings));
  assert.doesNotMatch(
    JSON.stringify(response.body),
    /environment-open-token-value|environment-oauth-token-value|encrypted|ciphertext/,
  );
});

test("saved tokens take effect immediately and are returned only as masks", async () => {
  const saved = await api("/admin/workbuddy/config", {
    method: "PATCH",
    headers: adminHeaders,
    body: {
      enabled: true,
      department_id: "data-product",
      open_api_token: "new-open-token-value-123456789",
      oauth_resolver_token: "new-oauth-token-value-12345678",
      oauth_resolver_url: "http://workbuddy.internal/resolve",
      corp_id: "corp-data-product",
    },
  });

  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.config.openApiToken, {
    configured: true,
    source: "admin",
    mask: "•••• 6789",
  });
  assert.equal(
    (await openApi("/open/tasks?updated_since=0", activeOpenToken)).statusCode,
    401,
  );
  activeOpenToken = "new-open-token-value-123456789";
  assert.equal(
    (await openApi("/open/tasks?updated_since=0", activeOpenToken)).statusCode,
    200,
  );
});

test("mapping edit is unique, audited, and restamps assigned tasks", async () => {
  const before = await openApi("/open/tasks?updated_since=0", activeOpenToken);
  const checkpoint = Math.max(...before.body.tasks.map((task) => task.updated_at));
  const changed = await api("/admin/workbuddy/mappings/zhongnanhai", {
    method: "PATCH",
    headers: adminHeaders,
    body: { wecom_userid: "wx-zhongnanhai" },
  });

  assert.equal(changed.statusCode, 200);
  assert.equal(changed.body.mapping.wecomUserId, "wx-zhongnanhai");
  const persistedMappings = await api("/admin/workbuddy/mappings", { headers: adminHeaders });
  assert.equal(
    persistedMappings.body.mappings.find((row) => row.username === "zhongnanhai")?.wecomUserId,
    "wx-zhongnanhai",
  );
  const allAfterMapping = await openApi("/open/tasks?updated_since=0", activeOpenToken);
  assert.equal(
    allAfterMapping.body.tasks.find((task) => task.task_id === taskId)?.assignee_userid,
    "wx-zhongnanhai",
  );
  const after = await openApi(
    `/open/tasks?updated_since=${checkpoint}`,
    activeOpenToken,
  );
  assert.ok(after.body.tasks.some((task) => (
    task.task_id === taskId && task.assignee_userid === "wx-zhongnanhai"
  )), JSON.stringify(after.body));

  const conflict = await api("/admin/workbuddy/mappings/songquanchen", {
    method: "PATCH",
    headers: adminHeaders,
    body: { wecom_userid: "wx-zhongnanhai" },
  });
  assert.equal(conflict.statusCode, 409);

  const logs = await api("/admin/workbuddy/logs?action=mapping_changed", {
    headers: adminHeaders,
  });
  assert.equal(logs.statusCode, 200);
  assert.equal(logs.body.events.at(0).username, "zhongnanhai");
});
