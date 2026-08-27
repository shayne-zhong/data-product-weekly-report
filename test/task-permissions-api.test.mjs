import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.ADMIN_USERNAME = "Admin";
process.env.ADMIN_PASSWORD = "888888";
process.env.ADMIN_SESSION_SECRET = "task-permissions-admin-session-secret-32-bytes";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64");

const { default: handler } = await import(`../api/[...path].mjs?task-permissions=${Date.now()}`);

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function api(route, { method = "GET", body, token = "", adminToken = "" } = {}) {
  const req = {
    method,
    headers: {
      ...(token ? { "x-user-token": token } : {}),
      ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
    },
    query: { path: route.split("/").filter(Boolean) },
    body,
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

function username(prefix) {
  return `${prefix}${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

async function login(usernameValue, password = "12345678") {
  const response = await api("/auth/login", { method: "POST", body: { username: usernameValue, password } });
  assert.equal(response.statusCode, 200);
  return response.body.token;
}

test("task lists respect ordinary, module-leader, and department-leader scopes", async () => {
  const adminLogin = await api("/admin/login", { method: "POST", body: { username: "Admin", password: "888888" } });
  assert.equal(adminLogin.statusCode, 200);
  const adminToken = adminLogin.body.token;
  const current = await api("/admin/settings", { adminToken });
  const settings = current.body.settings;
  const department = settings.departments[0];
  const moduleA = "权限测试模块A";
  const moduleB = "权限测试模块B";
  const ordinary = { username: username("ordinary"), name: "权限普通用户" };
  const moduleLeader = { username: username("moduleleader"), name: "权限模块负责人" };
  const departmentLeader = { username: username("departmentleader"), name: "权限部门负责人" };
  const colleague = { username: username("colleague"), name: "权限同事" };
  const updatedDepartments = settings.departments.map((item) => item.id === department.id
    ? { ...item, modules: [moduleA, moduleB], leaderUsername: departmentLeader.username }
    : item);
  const saved = await api("/admin/settings", {
    method: "PATCH",
    adminToken,
    body: {
      departments: updatedDepartments,
      accounts: [
        ...settings.accounts,
        { ...ordinary, departmentId: department.id, role: "member" },
        { ...moduleLeader, departmentId: department.id, role: "module_leader", managedModules: [moduleA] },
        { ...departmentLeader, departmentId: department.id },
        { ...colleague, departmentId: department.id, role: "member" },
      ],
      sessionDurationMinutes: settings.sessionDurationMinutes,
      ai: settings.ai,
    },
  });
  assert.equal(saved.statusCode, 200);

  for (const account of [ordinary, moduleLeader, departmentLeader, colleague]) {
    const registered = await api("/auth/register", {
      method: "POST",
      body: { username: account.username, password: "12345678", displayName: account.name },
    });
    assert.equal(registered.statusCode, 201);
  }
  const departmentToken = await login(departmentLeader.username);
  const week = await api("/weeks", {
    method: "POST",
    token: departmentToken,
    body: { startDate: "2097-03-02", endDate: "2097-03-08" },
  });
  assert.equal(week.statusCode, 201);
  for (const task of [
    { title: "普通用户任务", module: moduleA, owner: ordinary.name },
    { title: "模块同事任务", module: moduleA, owner: colleague.name },
    { title: "模块负责人个人任务", module: moduleB, owner: moduleLeader.name },
    { title: "无关模块任务", module: moduleB, owner: colleague.name },
  ]) {
    const created = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`, {
      method: "POST",
      token: departmentToken,
      body: { task },
    });
    assert.equal(created.statusCode, 201);
  }

  const ordinaryToken = await login(ordinary.username);
  const ordinaryTasks = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`, { token: ordinaryToken });
  const moduleTasks = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`, { token: await login(moduleLeader.username) });
  const departmentTasks = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`, { token: departmentToken });

  assert.deepEqual(ordinaryTasks.body.tasks.map((task) => task.title), ["普通用户任务"]);
  assert.deepEqual(
    moduleTasks.body.tasks.map((task) => task.title).sort(),
    ["模块负责人个人任务", "模块同事任务", "普通用户任务"].sort(),
  );
  assert.equal(departmentTasks.body.tasks.length, 4);
  const colleagueTask = departmentTasks.body.tasks.find((task) => task.title === "模块同事任务");
  const hiddenUpdate = await api(`/task/${encodeURIComponent(colleagueTask.id)}`, {
    method: "POST",
    token: ordinaryToken,
    body: { task: { title: "越权修改" } },
  });
  assert.equal(hiddenUpdate.statusCode, 404);
});

test("a department leader can assign a member as a module leader for multiple modules", async () => {
  const adminLogin = await api("/admin/login", { method: "POST", body: { username: "Admin", password: "888888" } });
  assert.equal(adminLogin.statusCode, 200);
  const adminToken = adminLogin.body.token;
  const current = await api("/admin/settings", { adminToken });
  const settings = current.body.settings;
  const departmentId = `permission-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const leader = { username: username("scopeleader"), name: "范围负责人" };
  const member = { username: username("scopemember"), name: "范围成员" };
  const modules = ["范围模块A", "范围模块B"];
  const saved = await api("/admin/settings", {
    method: "PATCH",
    adminToken,
    body: {
      departments: [...settings.departments, { id: departmentId, name: "范围权限测试部门", enabled: true, modules, leaderUsername: leader.username }],
      accounts: [
        ...settings.accounts,
        { ...leader, departmentId },
        { ...member, departmentId },
      ],
      sessionDurationMinutes: settings.sessionDurationMinutes,
      ai: settings.ai,
    },
  });
  assert.equal(saved.statusCode, 200);
  for (const account of [leader, member]) {
    const registered = await api("/auth/register", {
      method: "POST",
      body: { username: account.username, password: "12345678", displayName: account.name },
    });
    assert.equal(registered.statusCode, 201);
  }
  const leaderLogin = await api("/admin/login", {
    method: "POST",
    body: { username: leader.username, password: "12345678" },
  });
  assert.equal(leaderLogin.statusCode, 200);
  assert.equal(leaderLogin.body.role, "leader");

  const updated = await api(`/admin/leader/accounts/${encodeURIComponent(member.username)}/role`, {
    method: "PATCH",
    adminToken: leaderLogin.body.token,
    body: { role: "module_leader", managedModules: modules },
  });

  assert.equal(updated.statusCode, 200);
  assert.deepEqual(updated.body.account, {
    username: member.username,
    role: "module_leader",
    managedModules: modules,
  });
});

test("global admin rejects a module leader without responsible modules", async () => {
  const adminLogin = await api("/admin/login", { method: "POST", body: { username: "Admin", password: "888888" } });
  assert.equal(adminLogin.statusCode, 200);
  const adminToken = adminLogin.body.token;
  const current = await api("/admin/settings", { adminToken });
  const settings = current.body.settings;
  const invalid = await api("/admin/settings", {
    method: "PATCH",
    adminToken,
    body: {
      departments: settings.departments,
      accounts: [...settings.accounts, {
        username: username("invalidmoduleleader"),
        name: "无范围模块负责人",
        departmentId: settings.departments[0].id,
        role: "module_leader",
        managedModules: [],
      }],
      sessionDurationMinutes: settings.sessionDurationMinutes,
      ai: settings.ai,
    },
  });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body.error, /至少负责一个模块/);
});
