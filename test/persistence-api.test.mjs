import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import handler, { runWeeklyRolloverFromServer } from "../api/[...path].mjs";

const syncKey = "DP-WEEKLY-2026-7K4M";
process.env.REPORT_SYNC_KEY = syncKey;
process.env.ADMIN_USERNAME = "Admin";
process.env.ADMIN_PASSWORD = "888888";
process.env.ADMIN_SESSION_SECRET = "persistence-api-admin-session-secret-32-bytes";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString("base64");
process.env.WEEKLY_ROLLOVER_SECRET = "weekly-rollover-test-secret-32-bytes";

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

let defaultToken = "";

async function api(path, { method = "GET", body, token, headers = {} } = {}) {
  const resolvedToken = token === undefined ? defaultToken : token;
  const req = {
    method,
    headers: {
      "x-report-key": syncKey,
      ...(resolvedToken ? { "x-user-token": resolvedToken } : {}),
      ...headers,
    },
    query: { path: path.split("/").filter(Boolean) },
    body,
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

test.before(async () => {
  const adminLogin = await api("/admin/login", { method: "POST", body: { username: "Admin", password: "888888" } });
  assert.equal(adminLogin.statusCode, 200);
  const username = `persist${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const current = await api("/settings");
  const settings = current.body.settings;
  const saved = await api("/admin/settings", {
    method: "POST",
    headers: { authorization: `Bearer ${adminLogin.body.token}` },
    body: {
      departments: settings.departments,
      accounts: [...settings.accounts, { name: "持久化测试", username, departmentId: settings.departments[0].id }],
      sessionDurationMinutes: settings.sessionDurationMinutes,
      ai: settings.ai,
    },
  });
  assert.equal(saved.statusCode, 200);
  const registered = await api("/auth/register", {
    method: "POST",
    body: { username, password: "12345678", displayName: "持久化测试" },
  });
  assert.equal(registered.statusCode, 201);
  const loggedIn = await api("/auth/login", {
    method: "POST",
    body: { username, password: "12345678" },
  });
  assert.equal(loggedIn.statusCode, 200);
  defaultToken = loggedIn.body.token;
});

test("weekly rollover is internal, persistent, and idempotent", async () => {
  const sourceStartDate = "2098-12-29";
  const sourceEndDate = "2099-01-04";
  const targetStartDate = "2099-01-05";
  const targetEndDate = "2099-01-11";
  const sourceWeek = await api("/weeks", { method: "POST", body: { startDate: sourceStartDate, endDate: sourceEndDate } });
  const sourceTask = await api(`/week/${encodeURIComponent(sourceWeek.body.week.id)}/tasks`, {
    method: "POST",
    body: { task: { title: "定时结转测试", status: "进行中" } },
  });
  assert.equal(sourceTask.statusCode, 201);

  const unauthorized = await api("/internal/weekly-rollover", {
    method: "POST",
    token: "",
    body: { triggeredAt: "2099-01-04T16:05:00.000Z" },
  });
  assert.equal(unauthorized.statusCode, 403);

  const headers = { "x-weekly-rollover-secret": process.env.WEEKLY_ROLLOVER_SECRET };
  const first = await api("/internal/weekly-rollover", {
    method: "POST",
    token: "",
    headers,
    body: { triggeredAt: "2099-01-04T16:05:00.000Z" },
  });
  const second = await api("/internal/weekly-rollover", {
    method: "POST",
    token: "",
    headers,
    body: { triggeredAt: "2099-01-04T16:05:00.000Z" },
  });

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.rolledTaskCount, 1);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.rolledTaskCount, 0);
  const startupCatchup = await runWeeklyRolloverFromServer({
    triggeredAt: Date.parse("2099-01-04T16:05:00.000Z"),
    trigger: "server-startup",
  });
  assert.equal(startupCatchup.rolledTaskCount, 0);
  const targetWeekId = `${targetStartDate}_${targetEndDate}`;
  const target = await api(`/week/${encodeURIComponent(targetWeekId)}/tasks`);
  assert.equal(target.statusCode, 200);
  assert.equal(target.body.tasks.filter((task) => task.sourceTaskId === sourceTask.body.task.id).length, 1);

  const publicRollover = await api(`/week/${encodeURIComponent(targetWeekId)}/rollover`, {
    method: "POST",
    body: { sourceWeekId: sourceWeek.body.week.id },
  });
  assert.equal(publicRollover.statusCode, 405);
});

test("global admin can inspect and safely restart scheduled rollover", async () => {
  const adminLogin = await api("/admin/login", {
    method: "POST",
    token: "",
    body: { username: "Admin", password: "888888" },
  });
  assert.equal(adminLogin.statusCode, 200);
  const headers = { authorization: `Bearer ${adminLogin.body.token}` };

  const unauthorized = await api("/admin/scheduled-tasks", { token: "" });
  assert.equal(unauthorized.statusCode, 401);

  const before = await api("/admin/scheduled-tasks", { token: "", headers });
  assert.equal(before.statusCode, 200);
  assert.equal(before.body.tasks[0].id, "weekly-task-rollover");
  assert.doesNotMatch(JSON.stringify(before.body), /WEEKLY_ROLLOVER_SECRET/i);

  const first = await api("/admin/scheduled-tasks/weekly-task-rollover/run", {
    method: "POST",
    token: "",
    headers,
  });
  const second = await api("/admin/scheduled-tasks/weekly-task-rollover/run", {
    method: "POST",
    token: "",
    headers,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.task.status, "success");
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.result.rolledTaskCount, 0);
});

test("global admin can manually catch up only due report archives", async () => {
  const reportPayload = (title, startDate, endDate) => ({
    status: "draft",
    data: {
      summaryType: "weekly",
      title,
      startDate,
      endDate,
      modules: [{ title: "测试", sections: [{ title: "内容", items: ["待归档"] }] }],
    },
  });
  const due = await api("/reports", {
    method: "POST",
    body: reportPayload("漏跑补偿测试周报", "2000/01/01", "2000/01/02"),
  });
  const future = await api("/reports", {
    method: "POST",
    body: reportPayload("未到期测试周报", "2098/12/29", "2099/01/04"),
  });
  assert.equal(due.statusCode, 201);
  assert.equal(future.statusCode, 201);

  const adminLogin = await api("/admin/login", {
    method: "POST",
    token: "",
    body: { username: "Admin", password: "888888" },
  });
  const headers = { authorization: `Bearer ${adminLogin.body.token}` };
  const list = await api("/admin/scheduled-tasks", { token: "", headers });
  assert.deepEqual(list.body.tasks.map((task) => task.id), ["weekly-task-rollover", "report-auto-archive"]);

  const anonymous = await api("/admin/scheduled-tasks/report-auto-archive/run", { method: "POST", token: "" });
  assert.equal(anonymous.statusCode, 401);
  const run = await api("/admin/scheduled-tasks/report-auto-archive/run", { method: "POST", token: "", headers });
  assert.equal(run.statusCode, 200);
  assert.equal(run.body.task.status, "success");
  assert.equal(run.body.result.trigger.startsWith("manual:"), true);
  assert.equal(run.body.result.archivedCount, 1);

  const dueReadBack = await api(`/report/${encodeURIComponent(due.body.report.id)}`);
  const futureReadBack = await api(`/report/${encodeURIComponent(future.body.report.id)}`);
  assert.equal(dueReadBack.body.report.status, "final");
  assert.equal(futureReadBack.body.report.status, "draft");

  const repeat = await api("/admin/scheduled-tasks/report-auto-archive/run", { method: "POST", token: "", headers });
  assert.equal(repeat.statusCode, 200);
  assert.equal(repeat.body.result.archivedCount, 0);
  const readBack = await api("/admin/scheduled-tasks", { token: "", headers });
  assert.equal(readBack.body.tasks[1].status, "success");
  assert.equal(readBack.body.tasks[1].archivedCount, 0);
});

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

test("goals derive current values from completed tasks and deletion clears task links", async () => {
  const savedGoals = await api("/goals", {
    method: "POST",
    body: { year: "2026", rows: [{ name: "交付数", target: 10, current: 999 }] },
  });
  const goalId = savedGoals.body.rows[0].id;
  const week = await api("/weeks", {
    method: "POST",
    body: { startDate: "2095-01-01", endDate: "2095-01-07" },
  });
  for (const [status, contribution] of [["已完成", 5], ["进行中", 90]]) {
    const created = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`, {
      method: "POST",
      body: { task: { title: `${status}任务`, status: "进行中", goalLinks: [{ goalId, contribution, unit: "项", note: status }] } },
    });
    if (status === "已完成") {
      await api(`/task/${encodeURIComponent(created.body.task.id)}`, { method: "POST", body: { task: { status } } });
    }
  }

  assert.equal((await api("/goals")).body.rows[0].current, 5);

  await api("/goals", { method: "POST", body: { year: "2026", rows: [] } });
  const tasks = (await api("/tasks")).body.tasks.filter((task) => task.weekId === week.body.week.id);
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((task) => task.goalLinks.every((link) => link.goalId !== goalId)));
});

test("expectedCurrent persists across saves and is not overwritten by server contribution totals", async () => {
  const savedGoals = await api("/goals", {
    method: "POST",
    body: { year: "2026", rows: [{ name: "预计测试", target: "20项", expectedCurrent: "12项" }] },
  });
  const goalId = savedGoals.body.rows[0].id;
  assert.equal(savedGoals.body.rows[0].expectedCurrent, "12项");
  assert.equal(savedGoals.body.rows[0].current, 0);

  const updated = await api("/goals", {
    method: "POST",
    body: { year: "2026", rows: [{ id: goalId, name: "预计测试", target: "20项", expectedCurrent: "15项" }] },
  });
  assert.equal(updated.body.rows[0].expectedCurrent, "15项");
  assert.equal(updated.body.rows[0].current, 0);

  const reloaded = await api("/goals");
  const row = reloaded.body.rows.find((item) => item.id === goalId);
  assert.ok(row);
  assert.equal(row.expectedCurrent, "15项");
  assert.equal(row.current, 0);
});

test("new goals default expectedCurrent to empty and current remains server-derived", async () => {
  const savedGoals = await api("/goals", {
    method: "POST",
    body: { year: "2026", rows: [{ name: "空预计测试", target: "100" }] },
  });
  const row = savedGoals.body.rows[0];
  assert.equal(row.expectedCurrent || "", "");
  assert.equal(row.current, 0);
});
