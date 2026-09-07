import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import handler from "../api/[...path].mjs";

const syncKey = "DP-WEEKLY-2026-7K4M";
process.env.REPORT_SYNC_KEY = syncKey;
process.env.ADMIN_USERNAME = "Admin";
process.env.ADMIN_PASSWORD = "888888";
process.env.ADMIN_SESSION_SECRET = "leader-admin-admin-session-secret-32-bytes";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

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

async function api(
  path,
  { method = "GET", body, token = "", admin = false, adminToken = "", includeSyncKey = true, headers = {} } = {},
) {
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

async function adminSessionToken() {
  const response = await api("/admin/login", {
    method: "POST",
    body: { username: "Admin", password: "888888" },
    includeSyncKey: false,
  });
  assert.equal(response.statusCode, 200);
  return response.body.token;
}

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

async function setupLeader(prefix, { password = "12345678" } = {}) {
  const username = uniqueUsername(prefix);
  const departmentId = `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 6)}`;
  const departmentName = `${prefix}测试部门`;
  const current = await api("/settings", { admin: true });
  const department = { id: departmentId, name: departmentName, enabled: true, modules: [`${prefix}项目`] };
  const withDepartment = await saveSettings({
    departments: [...current.body.settings.departments, department],
    accounts: [...current.body.settings.accounts, { name: `${prefix}负责人`, username, departmentId }],
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });
  assert.equal(withDepartment.statusCode, 200);
  const registered = await api("/auth/register", { method: "POST", body: { username, password } });
  assert.equal(registered.statusCode, 201);
  const afterRegister = await api("/settings", { admin: true });
  const withLeader = await saveSettings({
    departments: afterRegister.body.settings.departments.map((item) =>
      item.id === departmentId ? { ...item, leaderUsername: username } : item,
    ),
    accounts: afterRegister.body.settings.accounts,
    sessionDurationMinutes: afterRegister.body.settings.sessionDurationMinutes,
  });
  assert.equal(withLeader.statusCode, 200);
  return { username, password, departmentId, departmentName };
}

test("assigning a leader to a department round-trips through settings", async () => {
  const leaderUsername = uniqueUsername("leader");
  const current = await api("/settings", { admin: true });
  const departmentId = current.body.settings.departments[0].id;
  const saved = await saveSettings({
    departments: current.body.settings.departments,
    accounts: [...current.body.settings.accounts, { name: "候选负责人", username: leaderUsername, departmentId }],
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });
  assert.equal(saved.statusCode, 200);

  const withLeader = await saveSettings({
    departments: current.body.settings.departments.map((department) =>
      department.id === departmentId ? { ...department, leaderUsername } : department,
    ),
    accounts: saved.body.settings.accounts,
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });
  assert.equal(withLeader.statusCode, 200);
  const department = withLeader.body.settings.departments.find((item) => item.id === departmentId);
  assert.equal(department.leaderUsername, leaderUsername);
  assert.ok(department.leaderAssignedAt > 0);
});

test("a leaderUsername that doesn't belong to the department is silently cleared", async () => {
  const outsiderUsername = uniqueUsername("outsider");
  const current = await api("/settings", { admin: true });
  const departments = [
    { id: "data-product", name: "数据产品部", enabled: true, modules: ["数据项目"] },
    { id: "finance-outsider", name: "财经部Outsider", enabled: true, modules: ["财经项目"] },
  ];
  const withOutsider = await saveSettings({
    departments,
    accounts: [
      ...current.body.settings.accounts,
      { name: "外部门账号", username: outsiderUsername, departmentId: "finance-outsider" },
    ],
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });
  assert.equal(withOutsider.statusCode, 200);

  const attempted = await saveSettings({
    departments: departments.map((department) =>
      department.id === "data-product" ? { ...department, leaderUsername: outsiderUsername } : department,
    ),
    accounts: withOutsider.body.settings.accounts,
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });
  assert.equal(attempted.statusCode, 200);
  const department = attempted.body.settings.departments.find((item) => item.id === "data-product");
  assert.equal(department.leaderUsername, "");
});

test("re-saving settings without touching leaderUsername does not restamp leaderAssignedAt", async () => {
  const leaderUsername = uniqueUsername("stable");
  const current = await api("/settings", { admin: true });
  const departmentId = current.body.settings.departments[0].id;
  const withAccount = await saveSettings({
    departments: current.body.settings.departments,
    accounts: [...current.body.settings.accounts, { name: "稳定负责人", username: leaderUsername, departmentId }],
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });
  const withLeader = await saveSettings({
    departments: current.body.settings.departments.map((department) =>
      department.id === departmentId ? { ...department, leaderUsername } : department,
    ),
    accounts: withAccount.body.settings.accounts,
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });
  const firstStamp = withLeader.body.settings.departments.find((item) => item.id === departmentId).leaderAssignedAt;

  const resaved = await saveSettings({
    departments: withLeader.body.settings.departments,
    accounts: withLeader.body.settings.accounts,
    sessionDurationMinutes: 45,
  });
  const secondStamp = resaved.body.settings.departments.find((item) => item.id === departmentId).leaderAssignedAt;
  assert.equal(secondStamp, firstStamp);
});

test("disabling an account invalidates its session and blocks future login", async () => {
  const username = uniqueUsername("disableme");
  const current = await api("/settings", { admin: true });
  const departmentId = current.body.settings.departments[0].id;
  await saveSettings({
    departments: current.body.settings.departments,
    accounts: [...current.body.settings.accounts, { name: "待停用账号", username, departmentId }],
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
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

  const withAccounts = await api("/settings", { admin: true });
  const disabled = await saveSettings({
    departments: withAccounts.body.settings.departments,
    accounts: withAccounts.body.settings.accounts.map((account) =>
      account.username === username ? { ...account, enabled: false } : account,
    ),
    sessionDurationMinutes: withAccounts.body.settings.sessionDurationMinutes,
  });
  assert.equal(disabled.statusCode, 200);

  const revokedSession = await api("/weeks", { token: loggedIn.body.token });
  assert.equal(revokedSession.statusCode, 401);

  const blockedLogin = await api("/auth/login", {
    method: "POST",
    body: { username, password: "12345678" },
  });
  assert.equal(blockedLogin.statusCode, 403);
  assert.equal(blockedLogin.body.error, "账号已被停用");
});

test("a department leader logs in through /admin/login with their member credentials", async () => {
  const leader = await setupLeader("loginok");
  const loggedIn = await api("/admin/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username: leader.username, password: leader.password },
  });
  assert.equal(loggedIn.statusCode, 200);
  assert.ok(loggedIn.body.token);
  assert.equal(loggedIn.body.role, "leader");
  assert.equal(loggedIn.body.departmentId, leader.departmentId);
  assert.equal(loggedIn.body.departmentName, leader.departmentName);
});

test("the global admin login response is tagged with role admin", async () => {
  const loggedIn = await api("/admin/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username: "Admin", password: "888888" },
  });
  assert.equal(loggedIn.statusCode, 200);
  assert.equal(loggedIn.body.role, "admin");
  assert.equal(loggedIn.body.departmentId, undefined);
});

test("a registered member who is not a leader cannot log in through /admin/login", async () => {
  const username = uniqueUsername("plainmember");
  const current = await api("/settings", { admin: true });
  await saveSettings({
    departments: current.body.settings.departments,
    accounts: [
      ...current.body.settings.accounts,
      { name: "普通成员", username, departmentId: current.body.settings.departments[0].id },
    ],
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });
  const registered = await api("/auth/register", { method: "POST", body: { username, password: "12345678" } });
  assert.equal(registered.statusCode, 201);

  const rejected = await api("/admin/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username, password: "12345678" },
  });
  assert.equal(rejected.statusCode, 401);
});

test("a leader with the wrong password is rejected", async () => {
  const leader = await setupLeader("wrongpass");
  const rejected = await api("/admin/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username: leader.username, password: "not-the-password" },
  });
  assert.equal(rejected.statusCode, 401);
});

test("failed admin-panel login attempts are throttled per submitted username, not globally shared", async () => {
  const leaderA = await setupLeader("throttlea");
  const leaderB = await setupLeader("throttleb");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = await api("/admin/login", {
      method: "POST",
      includeSyncKey: false,
      body: { username: leaderA.username, password: "wrong" },
    });
    assert.equal(failed.statusCode, 401, `attempt ${attempt}`);
  }
  const lockedOut = await api("/admin/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username: leaderA.username, password: leaderA.password },
  });
  assert.equal(lockedOut.statusCode, 429);

  const stillWorks = await api("/admin/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username: leaderB.username, password: leaderB.password },
  });
  assert.equal(stillWorks.statusCode, 200);

  const adminStillWorks = await api("/admin/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username: "Admin", password: "888888" },
  });
  assert.equal(adminStillWorks.statusCode, 200);
});

async function leaderToken(username, password) {
  const response = await api("/admin/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username, password },
  });
  assert.equal(response.statusCode, 200);
  return response.body.token;
}

test("a leader can view, reset passwords for, and toggle their own department's members", async () => {
  const leader = await setupLeader("caps");
  const token = await leaderToken(leader.username, leader.password);

  const memberUsername = uniqueUsername("member");
  const current = await api("/settings", { admin: true });
  await saveSettings({
    departments: current.body.settings.departments,
    accounts: [
      ...current.body.settings.accounts,
      { name: "普通成员", username: memberUsername, departmentId: leader.departmentId },
    ],
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });
  const registered = await api("/auth/register", {
    method: "POST",
    body: { username: memberUsername, password: "12345678" },
  });
  assert.equal(registered.statusCode, 201);

  const list = await api("/admin/leader/accounts", { adminToken: token, includeSyncKey: false });
  assert.equal(list.statusCode, 200);
  assert.ok(list.body.accounts.some((account) => account.username === memberUsername));
  assert.ok(list.body.accounts.every((account) => account.departmentId === leader.departmentId));

  const memberLogin = await api("/auth/login", {
    method: "POST",
    body: { username: memberUsername, password: "12345678" },
  });
  assert.equal(memberLogin.statusCode, 200);

  const disabled = await api(`/admin/leader/accounts/${memberUsername}/enabled`, {
    method: "POST",
    adminToken: token,
    includeSyncKey: false,
    body: { enabled: false },
  });
  assert.equal(disabled.statusCode, 200);
  const revoked = await api("/weeks", { token: memberLogin.body.token });
  assert.equal(revoked.statusCode, 401);

  const reenabled = await api(`/admin/leader/accounts/${memberUsername}/enabled`, {
    method: "POST",
    adminToken: token,
    includeSyncKey: false,
    body: { enabled: true },
  });
  assert.equal(reenabled.statusCode, 200);

  const reset = await api(`/admin/users/${memberUsername}/reset-password`, {
    method: "POST",
    adminToken: token,
    includeSyncKey: false,
    body: { password: "new-password-1" },
  });
  assert.equal(reset.statusCode, 200);
  const loginWithNewPassword = await api("/auth/login", {
    method: "POST",
    body: { username: memberUsername, password: "new-password-1" },
  });
  assert.equal(loginWithNewPassword.statusCode, 200);
});

test("a leader cannot disable their own account", async () => {
  const leader = await setupLeader("selflock");
  const token = await leaderToken(leader.username, leader.password);
  const response = await api(`/admin/leader/accounts/${leader.username}/enabled`, {
    method: "POST",
    adminToken: token,
    includeSyncKey: false,
    body: { enabled: false },
  });
  assert.equal(response.statusCode, 400);
});

test("a leader can view and edit their own department's module list", async () => {
  const leader = await setupLeader("modules");
  const token = await leaderToken(leader.username, leader.password);

  const before = await api("/admin/leader/modules", { adminToken: token, includeSyncKey: false });
  assert.equal(before.statusCode, 200);
  assert.ok(before.body.modules.length > 0);

  const updated = await api("/admin/leader/modules", {
    method: "POST",
    adminToken: token,
    includeSyncKey: false,
    body: { modules: ["新项目类型A", "新项目类型B"] },
  });
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(updated.body.modules, ["新项目类型A", "新项目类型B"]);

  const rejected = await api("/admin/leader/modules", {
    method: "POST",
    adminToken: token,
    includeSyncKey: false,
    body: { modules: [] },
  });
  assert.equal(rejected.statusCode, 400);
});

test("a leader is blocked from another department's accounts, password resets, and the global admin surface", async () => {
  const leaderA = await setupLeader("cross-a");
  const leaderB = await setupLeader("cross-b");
  const tokenA = await leaderToken(leaderA.username, leaderA.password);

  const bAccounts = await api(`/admin/leader/accounts/${leaderB.username}/enabled`, {
    method: "POST",
    adminToken: tokenA,
    includeSyncKey: false,
    body: { enabled: false },
  });
  assert.equal(bAccounts.statusCode, 404);

  const bReset = await api(`/admin/users/${leaderB.username}/reset-password`, {
    method: "POST",
    adminToken: tokenA,
    includeSyncKey: false,
    body: { password: "whatever1" },
  });
  assert.equal(bReset.statusCode, 404);

  const globalSettings = await api("/admin/settings", { adminToken: tokenA, includeSyncKey: false });
  assert.equal(globalSettings.statusCode, 404);

  const aiTest = await api("/admin/ai/test", {
    method: "POST",
    adminToken: tokenA,
    includeSyncKey: false,
    body: { provider: "deepseek", model: "deepseek-chat", apiKey: "sk-test" },
  });
  assert.equal(aiTest.statusCode, 404);
});

test("unassigning a leader immediately invalidates their still-live token", async () => {
  const leader = await setupLeader("unassign");
  const token = await leaderToken(leader.username, leader.password);

  const current = await api("/settings", { admin: true });
  await saveSettings({
    departments: current.body.settings.departments.map((department) =>
      department.id === leader.departmentId ? { ...department, leaderUsername: "" } : department,
    ),
    accounts: current.body.settings.accounts,
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });

  const afterUnassign = await api("/admin/leader/accounts", { adminToken: token, includeSyncKey: false });
  assert.equal(afterUnassign.statusCode, 401);
});

test("disabling the leader's department immediately invalidates their still-live token", async () => {
  const leader = await setupLeader("deptdisabled");
  const token = await leaderToken(leader.username, leader.password);

  const current = await api("/settings", { admin: true });
  await saveSettings({
    departments: current.body.settings.departments.map((department) =>
      department.id === leader.departmentId ? { ...department, enabled: false } : department,
    ),
    accounts: current.body.settings.accounts,
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });

  const afterDisable = await api("/admin/leader/accounts", { adminToken: token, includeSyncKey: false });
  assert.equal(afterDisable.statusCode, 401);
});

test("reassigning the same username's leadership to a different department invalidates the old token", async () => {
  const leader = await setupLeader("reassign");
  const token = await leaderToken(leader.username, leader.password);

  const worksBefore = await api("/admin/leader/accounts", { adminToken: token, includeSyncKey: false });
  assert.equal(worksBefore.statusCode, 200);

  const newDepartmentId = `reassign-b-${randomUUID().replaceAll("-", "").slice(0, 6)}`;
  const current = await api("/settings", { admin: true });
  const newDepartment = { id: newDepartmentId, name: "重新分配部门", enabled: true, modules: ["新项目"] };
  const moved = await saveSettings({
    departments: [...current.body.settings.departments, newDepartment].map((department) =>
      department.id === newDepartmentId ? { ...department, leaderUsername: leader.username } : department,
    ),
    accounts: current.body.settings.accounts.map((account) =>
      account.username === leader.username ? { ...account, departmentId: newDepartmentId } : account,
    ),
    sessionDurationMinutes: current.body.settings.sessionDurationMinutes,
  });
  assert.equal(moved.statusCode, 200);
  assert.equal(moved.body.settings.departments.find((item) => item.id === leader.departmentId).leaderUsername, "");
  assert.equal(
    moved.body.settings.departments.find((item) => item.id === newDepartmentId).leaderUsername,
    leader.username,
  );

  const staleCheck = await api("/admin/leader/accounts", { adminToken: token, includeSyncKey: false });
  assert.equal(staleCheck.statusCode, 401);
});
