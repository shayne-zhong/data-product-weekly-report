import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import handler from "../api/[...path].mjs";
import { defaultLocalStatePath } from "../lib/state-store.mjs";

const syncKey = "DP-WEEKLY-2026-7K4M";
process.env.REPORT_SYNC_KEY = syncKey;
process.env.ADMIN_USERNAME = "Admin";
process.env.ADMIN_PASSWORD = "888888";
process.env.ADMIN_SESSION_SECRET = "department-api-admin-session-secret-32-bytes";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");

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

async function api(path, { method = "GET", body, token = "", admin = false, adminToken = "", includeSyncKey = true, headers = {} } = {}) {
  const resolvedAdminToken = adminToken || (admin ? await adminSessionToken() : "");
  const resolvedPath = admin && path === "/settings" ? "/admin/settings" : path;
  const req = {
    method,
    headers: {
      ...(includeSyncKey ? { "x-report-key": syncKey } : {}),
      ...(token ? { "x-user-token": token } : {}),
      ...(resolvedAdminToken ? { authorization: `Bearer ${resolvedAdminToken}` } : {}),
      ...headers,
    },
    query: { path: resolvedPath.split("/").filter(Boolean) },
    body,
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

test("legacy admin password headers cannot update settings", async () => {
  const response = await api("/settings", {
    method: "PATCH",
    includeSyncKey: false,
    headers: { "x-admin-user": "Admin", "x-admin-password": "888888" },
    body: { sessionDurationMinutes: 30 },
  });
  assert.equal(response.statusCode, 401);
});

test("admin credentials are exchanged for a short-lived bearer token", async () => {
  const loggedIn = await api("/admin/login", {
    method: "POST",
    body: { username: "Admin", password: "888888" },
    includeSyncKey: false,
  });
  assert.equal(loggedIn.statusCode, 200);
  assert.ok(loggedIn.body.token);
  assert.ok(loggedIn.body.expiresAt > Date.now());

  const settings = await api("/admin/settings", {
    adminToken: loggedIn.body.token,
    includeSyncKey: false,
  });
  assert.equal(settings.statusCode, 200);
  assert.ok(settings.body.settings.accounts.length > 0);

  const rejected = await api("/admin/settings", { adminToken: `${loggedIn.body.token}x`, includeSyncKey: false });
  assert.equal(rejected.statusCode, 401);
});

async function adminSessionToken() {
  const response = await api("/admin/login", {
    method: "POST",
    body: { username: "Admin", password: "888888" },
    includeSyncKey: false,
  });
  assert.equal(response.statusCode, 200);
  return response.body.token;
}

test("admin settings encrypt, mask, test, and clear AI API keys", async () => {
  const token = await adminSessionToken();
  const apiKey = `sk-encrypted-${randomUUID().slice(-8)}`;
  const saved = await api("/admin/settings", {
    method: "PATCH",
    adminToken: token,
    includeSyncKey: false,
    body: { ai: { enabled: true, provider: "deepseek", model: "deepseek-chat", apiKey } },
  });

  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.settings.ai.configured, true);
  assert.equal(saved.body.settings.ai.apiKeyMask, `•••• ${apiKey.slice(-4)}`);
  assert.equal(JSON.stringify(saved.body).includes(apiKey), false);
  assert.equal((await readFile(defaultLocalStatePath(), "utf8")).includes(apiKey), false);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, async json() { return { error: { message: "invalid key" } }; } });
  try {
    const tested = await api("/admin/ai/test", {
      method: "POST",
      adminToken: token,
      includeSyncKey: false,
      body: { provider: "deepseek", model: "deepseek-chat", apiKey: "sk-invalid" },
    });
    assert.equal(tested.statusCode, 502);
    const unchanged = await api("/admin/settings", { adminToken: token, includeSyncKey: false });
    assert.equal(unchanged.body.settings.ai.apiKeyMask, `•••• ${apiKey.slice(-4)}`);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const cleared = await api("/admin/settings", {
    method: "PATCH",
    adminToken: token,
    includeSyncKey: false,
    body: { ai: { clearApiKey: true } },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.body.settings.ai.configured, false);
  assert.equal(cleared.body.settings.ai.enabled, false);
});

test("registration and login do not require the legacy report sync key", async () => {
  const username = uniqueUsername("keyless");
  const current = await api("/settings", { admin: true });
  await saveSettings({
    departments: current.body.settings.departments,
    accounts: [
      ...current.body.settings.accounts,
      { name: "Keyless User", username, departmentId: current.body.settings.departments[0].id },
    ],
    sessionDurationMinutes: 60,
  });

  const registered = await api("/auth/register", {
    method: "POST",
    includeSyncKey: false,
    body: { username, password: "12345678" },
  });
  assert.equal(registered.statusCode, 201);
  assert.equal(registered.body.token, undefined);
  assert.equal(registered.body.expiresAt, undefined);

  const beforeLogin = await api("/auth/me", { includeSyncKey: false });
  assert.equal(beforeLogin.statusCode, 200);
  assert.equal(beforeLogin.body.user, null);

  const loggedIn = await api("/auth/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username, password: "12345678" },
  });
  assert.equal(loggedIn.statusCode, 200);
  assert.ok(loggedIn.body.token);
});

test("admin resets a member password and invalidates existing sessions", async () => {
  const username = uniqueUsername("reset");
  const current = await api("/settings", { admin: true });
  await saveSettings({
    departments: current.body.settings.departments,
    accounts: [
      ...current.body.settings.accounts,
      { name: "Reset User", username, departmentId: current.body.settings.departments[0].id },
    ],
    sessionDurationMinutes: 60,
  });

  const registered = await api("/auth/register", {
    method: "POST",
    includeSyncKey: false,
    body: { username, password: "old-password" },
  });
  assert.equal(registered.statusCode, 201);
  const oldLogin = await api("/auth/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username, password: "old-password" },
  });
  assert.equal(oldLogin.statusCode, 200);

  const reset = await api(`/admin/users/${username}/reset-password`, {
    method: "POST",
    admin: true,
    includeSyncKey: false,
    body: { password: "new-password" },
  });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.body.ok, true);

  const oldSession = await api("/weeks", {
    token: oldLogin.body.token,
    includeSyncKey: false,
  });
  assert.equal(oldSession.statusCode, 401);
  const oldPassword = await api("/auth/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username, password: "old-password" },
  });
  assert.equal(oldPassword.statusCode, 401);
  const newPassword = await api("/auth/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username, password: "new-password" },
  });
  assert.equal(newPassword.statusCode, 200);
});

test("password reset requires an admin session and a valid password", async () => {
  const anonymous = await api("/admin/users/member/reset-password", {
    method: "POST",
    includeSyncKey: false,
    body: { password: "new-password" },
  });
  assert.equal(anonymous.statusCode, 401);

  const weak = await api("/admin/users/member/reset-password", {
    method: "POST",
    admin: true,
    includeSyncKey: false,
    body: { password: "12345" },
  });
  assert.equal(weak.statusCode, 400);
});

test("business data still requires a user session without a sync key", async () => {
  const response = await api("/weeks", { includeSyncKey: false });
  assert.equal(response.statusCode, 401);
});

function uniqueUsername(prefix) {
  return `${prefix}${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

async function saveSettings(settings) {
  const current = await api("/settings", { admin: true });
  const departments = settings.departments
    ? [
        ...settings.departments,
        ...current.body.settings.departments
          .filter((existing) => !settings.departments.some((department) => department.id === existing.id))
          .map((existing) => ({ ...existing, enabled: false })),
      ]
    : undefined;
  return api("/settings", {
    method: "POST",
    admin: true,
    body: { ...settings, ...(departments ? { departments } : {}) },
  });
}

test("public settings contain departments without exposing member accounts", async () => {
  const response = await api("/settings");

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.settings.departments[0].id, "data-product");
  assert.equal(response.body.settings.departments[0].name, "数据产品部");
  assert.equal(response.body.settings.departments[0].enabled, true);
  assert.ok(response.body.settings.departments[0].modules.length > 0);
  assert.ok(Number.isInteger(response.body.settings.sessionDurationMinutes));
  assert.deepEqual(response.body.settings.accounts, []);
});

test("admin settings reject out-of-range session durations", async () => {
  const response = await api("/settings", {
    method: "POST",
    admin: true,
    body: { sessionDurationMinutes: 4 },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /5.*43200/);
});

test("admin settings require existing departments to be disabled instead of removed", async () => {
  const current = await api("/settings", { admin: true });
  const existingDepartments = current.body.settings.departments;
  const extraDepartment = { id: "protected-department", name: "受保护部门", enabled: true, modules: ["受保护项目"] };
  const withExtra = existingDepartments.some((department) => department.id === extraDepartment.id)
    ? existingDepartments
    : [...existingDepartments, extraDepartment];
  const saved = await saveSettings({
    departments: withExtra,
    accounts: current.body.settings.accounts,
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });
  assert.equal(saved.statusCode, 200);

  const removed = await api("/settings", { method: "POST", admin: true, body: {
    departments: withExtra.filter((department) => department.id !== extraDepartment.id),
    accounts: current.body.settings.accounts,
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  } });

  assert.equal(removed.statusCode, 400);
  assert.match(removed.body.error, /停用|删除/);
});

test("registration requires a configured account and binds its department", async () => {
  const username = uniqueUsername("finance");
  const departments = [
    { id: "data-product", name: "数据产品部", enabled: true, modules: ["数据项目"] },
    { id: "finance", name: "财经部", enabled: true, modules: ["财经项目"] },
  ];
  const settings = await saveSettings({
    departments,
    accounts: [{ name: "财务测试", username, departmentId: "finance" }],
    sessionDurationMinutes: 120,
  });
  assert.equal(settings.statusCode, 200);

  const registered = await api("/auth/register", {
    method: "POST",
    body: { username, password: "12345678", displayName: "财务测试" },
  });

  assert.equal(registered.statusCode, 201);
  assert.equal(registered.body.user.departmentId, "finance");
  assert.equal(registered.body.user.department.name, "财经部");
  assert.equal(registered.body.token, undefined);

  const before = Date.now();
  const loggedIn = await api("/auth/login", {
    method: "POST",
    body: { username, password: "12345678" },
  });
  assert.equal(loggedIn.statusCode, 200);
  assert.ok(loggedIn.body.expiresAt >= before + 120 * 60_000);
  assert.ok(loggedIn.body.expiresAt <= Date.now() + 120 * 60_000);
});

test("registration rejects usernames missing from department accounts", async () => {
  const response = await api("/auth/register", {
    method: "POST",
    body: { username: uniqueUsername("unknown"), password: "12345678", displayName: "未知用户" },
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.body.error, /后台|成员账号/);
});

test("moving an account to another department invalidates its existing session", async () => {
  const username = uniqueUsername("moved");
  const departments = [
    { id: "data-product", name: "数据产品部", enabled: true, modules: ["数据项目"] },
    { id: "finance", name: "财经部", enabled: true, modules: ["财经项目"] },
  ];
  await saveSettings({
    departments,
    accounts: [{ name: "调动测试", username, departmentId: "data-product" }],
    sessionDurationMinutes: 60,
  });
  const registered = await api("/auth/register", {
    method: "POST",
    body: { username, password: "12345678" },
  });
  assert.equal(registered.statusCode, 201);
  const loggedIn = await api("/auth/login", {
    method: "POST",
    body: { username, password: "12345678" },
  });
  assert.equal(loggedIn.statusCode, 200);

  await saveSettings({
    departments,
    accounts: [{ name: "调动测试", username, departmentId: "finance" }],
    sessionDurationMinutes: 60,
  });
  const oldSession = await api("/weeks", { token: loggedIn.body.token });

  assert.equal(oldSession.statusCode, 401);
});

test("business data requires login", async () => {
  for (const path of ["/weeks", "/reports", "/goals", "/accounts"]) {
    const response = await api(path);
    assert.equal(response.statusCode, 401, path);
  }
});

test("departments cannot read or update each other's workbench data", async () => {
  const dataUsername = uniqueUsername("data");
  const financeUsername = uniqueUsername("fin");
  const departments = [
    { id: "data-product", name: "数据产品部", enabled: true, modules: ["数据项目"] },
    { id: "finance", name: "财经部", enabled: true, modules: ["财经项目"] },
  ];
  await saveSettings({
    departments,
    accounts: [
      { name: "数据测试", username: dataUsername, departmentId: "data-product" },
      { name: "财务测试", username: financeUsername, departmentId: "finance" },
    ],
    sessionDurationMinutes: 60,
  });
  const dataRegistration = await api("/auth/register", {
    method: "POST",
    body: { username: dataUsername, password: "12345678" },
  });
  const financeRegistration = await api("/auth/register", {
    method: "POST",
    body: { username: financeUsername, password: "12345678" },
  });
  assert.equal(dataRegistration.statusCode, 201);
  assert.equal(financeRegistration.statusCode, 201);
  const dataUser = await api("/auth/login", {
    method: "POST",
    body: { username: dataUsername, password: "12345678" },
  });
  const financeUser = await api("/auth/login", {
    method: "POST",
    body: { username: financeUsername, password: "12345678" },
  });
  assert.equal(dataUser.statusCode, 200);
  assert.equal(financeUser.statusCode, 200);

  const financeSettings = await api("/settings", { token: financeUser.body.token });
  assert.deepEqual(financeSettings.body.settings.departments.map((department) => department.id), ["finance"]);
  assert.deepEqual(financeSettings.body.settings.accounts.map((account) => account.username), [financeUsername]);

  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const startDate = `2097-01-${suffix}`;
  const endDate = startDate;
  const dataWeek = await api("/weeks", {
    method: "POST",
    token: dataUser.body.token,
    body: { startDate, endDate },
  });
  assert.equal(dataWeek.statusCode, 201);
  const dataTask = await api(`/week/${encodeURIComponent(dataWeek.body.week.id)}/tasks`, {
    method: "POST",
    token: dataUser.body.token,
    body: { task: { title: `数据任务-${suffix}`, status: "进行中" } },
  });
  assert.equal(dataTask.statusCode, 201);

  const financeWeeksBefore = await api("/weeks", { token: financeUser.body.token });
  assert.equal(financeWeeksBefore.body.weeks.some((week) => week.id === dataWeek.body.week.id), false);

  const financeWeek = await api("/weeks", {
    method: "POST",
    token: financeUser.body.token,
    body: { startDate, endDate },
  });
  assert.equal(financeWeek.statusCode, 201);
  const financeTasks = await api(`/week/${encodeURIComponent(financeWeek.body.week.id)}/tasks`, {
    token: financeUser.body.token,
  });
  assert.deepEqual(financeTasks.body.tasks, []);

  const financeReport = await api("/reports", {
    method: "POST",
    token: financeUser.body.token,
    body: {
      status: "draft",
      data: { summaryType: "weekly", startDate, endDate, modules: [{ title: "财经项目", sections: [] }] },
    },
  });
  assert.equal(financeReport.statusCode, 201);
  assert.equal(financeReport.body.report.title, "财经部周重点工作汇报");

  const crossDepartmentUpdate = await api(`/task/${encodeURIComponent(dataTask.body.task.id)}`, {
    method: "POST",
    token: financeUser.body.token,
    body: { task: { title: "越权修改" } },
  });
  assert.equal(crossDepartmentUpdate.statusCode, 404);

  await api("/goals", {
    method: "POST",
    token: dataUser.body.token,
    body: { year: "2097", rows: [{ id: `goal-${suffix}`, name: "数据目标" }] },
  });
  const financeGoals = await api("/goals", { token: financeUser.body.token });
  assert.deepEqual(financeGoals.body.rows, []);
});

test("AI summary instructions use the signed-in department name", async () => {
  const username = uniqueUsername("aifin");
  const departments = [
    { id: "data-product", name: "数据产品部", enabled: true, modules: ["数据项目"] },
    { id: "finance", name: "财经部", enabled: true, modules: ["财经项目"] },
  ];
  await saveSettings({
    departments,
    accounts: [{ name: "财经AI测试", username, departmentId: "finance" }],
    sessionDurationMinutes: 60,
    ai: { enabled: true, provider: "deepseek", model: "deepseek-v4-flash" },
  });
  const registered = await api("/auth/register", {
    method: "POST",
    body: { username, password: "12345678" },
  });
  assert.equal(registered.statusCode, 201);
  const loggedIn = await api("/auth/login", {
    method: "POST",
    body: { username, password: "12345678" },
  });
  assert.equal(loggedIn.statusCode, 200);

  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = "department-test-key";
  let upstreamBody = null;
  globalThis.fetch = async (_url, options) => {
    upstreamBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: "财经部工作总结" } }], usage: { total_tokens: 8 } };
      },
    };
  };
  try {
    const response = await api("/ai/report-summary", {
      method: "POST",
      token: loggedIn.body.token,
      body: { sourceText: "这是一段财经部门的工作总结原始内容，长度足够用于部门名称测试。", summaryType: "weekly" },
    });
    assert.equal(response.statusCode, 200);
    assert.match(upstreamBody.messages[0].content, /财经部负责人助理/);
    assert.doesNotMatch(upstreamBody.messages[0].content, /数据产品部负责人助理/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
