# Backend Admin Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的后台管理中心交互原型落地为具备服务端权限控制、数据看板、轻量审计、独立保存和安全运维操作的真实功能。

**Architecture:** 保留原生 HTML/CSS/JavaScript 单页结构和统一 API 入口；新增 `admin-access`、`admin-audit`、`admin-dashboard` 三个纯领域模块，API 只负责鉴权、参数校验和持久化。现有 `/api/admin/settings` 继续承担页面级部分更新，避免增加重复配置接口；新增只读看板、审计查询接口，并在现有高风险操作路径写入审计记录。

**Tech Stack:** Node.js ESM、原生 HTML/CSS/JavaScript、`node:test`、现有 state-store、现有管理员 Bearer Token 会话。

---

## 执行边界与 Session 切分

- Session A：Task 1–2，权限保护与审计基础。
- Session B：Task 3–4，看板领域与后台 API。
- Session C：Task 5–6，后台框架与管理概览。
- Session D：Task 7–8，管理页面、独立保存与运行中心。
- Session E：Task 9，跨角色回归、构建和架构文档。

每个 Session 只执行对应目标。进入下一 Session 前，当前任务必须通过针对性测试并提交；连续两次同路径失败则停止。实现期间不得改动原型目录，它只作为视觉和交互参照。

## 文件结构

**Create:**

- `lib/admin-access.mjs`：后台角色范围和设置变更保护。
- `lib/admin-audit.mjs`：审计记录清洗、追加、保留和授权查询。
- `lib/admin-dashboard.mjs`：周期范围、指标口径和待处理事项聚合。
- `test/admin-access.test.mjs`：权限范围和角色保护单元测试。
- `test/admin-audit.test.mjs`：敏感信息、保留策略和部门裁剪测试。
- `test/admin-dashboard.test.mjs`：指标、零分母、异常和角色范围测试。

**Modify:**

- `api/[...path].mjs`：注册新领域模块、初始化审计状态、增加看板与审计路由、记录高风险操作。
- `public/index.html`：按确认原型重组后台导航、页面、状态和交互。
- `test/leader-admin.test.mjs`：后台 API 权限、范围、保护和审计集成测试。
- `test/workbench-ui.test.mjs`：信息架构、角色可见、状态、保存和补跑交互测试。
- `PROJECT_ARCHITECTURE.md`：登记三个后台领域模块和验证映射。
- `SESSION_HANDOFF.md`：每个 Session 结束时只记录当前阶段与下一入口。

## Session A — 权限保护与审计基础

### Task 1: 统一后台范围与角色保护

**Files:**

- Create: `lib/admin-access.mjs`
- Create: `test/admin-access.test.mjs`
- Modify: `api/[...path].mjs:1116-1189`

- [ ] **Step 1: 写后台范围和设置保护失败测试**

```js
// test/admin-access.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { adminScope, validateAdminSettingsTransition } from "../lib/admin-access.mjs";

const departments = [
  { id: "data", leaderUsername: "leader", modules: ["BI"] },
  { id: "app", leaderUsername: "", modules: ["研发"] },
];

test("global admin may select all or one existing department", () => {
  assert.deepEqual(adminScope({ role: "admin" }, departments, ""), { departmentIds: ["data", "app"], selectedDepartmentId: "" });
  assert.deepEqual(adminScope({ role: "admin" }, departments, "data"), { departmentIds: ["data"], selectedDepartmentId: "data" });
});

test("department leader is always fixed to their own department", () => {
  assert.deepEqual(adminScope({ role: "leader", departmentId: "data" }, departments, "app"), { departmentIds: ["data"], selectedDepartmentId: "data" });
});

test("a department leader account must be reassigned before disabling", () => {
  const current = { departments, accounts: [{ username: "leader", departmentId: "data", enabled: true, role: "member", managedModules: [] }] };
  const next = { ...current, accounts: [{ ...current.accounts[0], enabled: false }] };
  assert.throws(() => validateAdminSettingsTransition(current, next), /先更换部门负责人/);
});

test("module leaders require at least one module in their department", () => {
  const current = { departments, accounts: [] };
  const next = { departments, accounts: [{ username: "owner", departmentId: "data", enabled: true, role: "module_leader", managedModules: [] }] };
  assert.throws(() => validateAdminSettingsTransition(current, next), /至少负责一个工作模块/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/admin-access.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现纯权限模块**

```js
// lib/admin-access.mjs
function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

export function adminScope(actor, departments, requestedDepartmentId = "") {
  if (actor?.role === "admin") {
    if (requestedDepartmentId && !departments.some((item) => item.id === requestedDepartmentId)) {
      badRequest("部门范围不存在");
    }
    return {
      departmentIds: requestedDepartmentId ? [requestedDepartmentId] : departments.map((item) => item.id),
      selectedDepartmentId: requestedDepartmentId,
    };
  }
  if (actor?.role === "leader" && departments.some((item) => item.id === actor.departmentId)) {
    return { departmentIds: [actor.departmentId], selectedDepartmentId: actor.departmentId };
  }
  const error = new Error("无权访问后台管理范围");
  error.statusCode = 403;
  throw error;
}

export function validateAdminSettingsTransition(current, next) {
  for (const department of current.departments) {
    if (!department.leaderUsername) continue;
    const account = next.accounts.find((item) => item.username === department.leaderUsername && item.departmentId === department.id);
    const nextDepartment = next.departments.find((item) => item.id === department.id);
    if (nextDepartment?.leaderUsername === department.leaderUsername && account?.enabled === false) {
      badRequest("请先更换部门负责人，再停用该成员账号");
    }
  }
  for (const account of next.accounts) {
    if (account.role !== "module_leader") continue;
    const department = next.departments.find((item) => item.id === account.departmentId);
    if (!account.managedModules?.length || account.managedModules.some((name) => !department?.modules.includes(name))) {
      badRequest("模块负责人至少负责一个工作模块，且工作模块必须属于本部门");
    }
  }
}
```

- [ ] **Step 4: 在设置保存前调用统一保护**

```js
// api/[...path].mjs，在构造 next 后、写入 state.settings 前
validateAdminSettingsTransition(current, next);
state.settings = { ...next, updatedAt: now };
```

- [ ] **Step 5: 运行单元和现有负责人测试**

Run: `node --test test/admin-access.test.mjs test/leader-admin.test.mjs`

Expected: PASS；现有负责人登录、角色和账号启停规则不回归。

- [ ] **Step 6: 提交 Session A 第一部分**

```powershell
git add -- lib/admin-access.mjs test/admin-access.test.mjs 'api/[...path].mjs'
git commit -m "feat: centralize admin access safeguards"
```

### Task 2: 建立轻量审计领域模块

**Files:**

- Create: `lib/admin-audit.mjs`
- Create: `test/admin-audit.test.mjs`
- Modify: `api/[...path].mjs:315-342`

- [ ] **Step 1: 写审计清洗、保留和范围失败测试**

```js
// test/admin-audit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { appendAdminAudit, listAdminAudit } from "../lib/admin-audit.mjs";

test("audit summaries remove sensitive values", () => {
  const state = { adminAudit: [] };
  appendAdminAudit(state, { actorUsername: "admin", actorRole: "admin", action: "ai-key", targetType: "settings", targetId: "ai", result: "success", summary: "apiKey=sk-secret token=abc" }, { now: Date.UTC(2026, 7, 31) });
  assert.doesNotMatch(state.adminAudit[0].summary, /sk-secret|abc/);
  assert.match(state.adminAudit[0].summary, /\[REDACTED\]/);
});

test("leader audit listing is clipped to their department", () => {
  const state = { adminAudit: [{ id: "a", departmentId: "data" }, { id: "b", departmentId: "app" }] };
  assert.deepEqual(listAdminAudit(state, { role: "leader", departmentId: "data" }).map((item) => item.id), ["a"]);
});

test("audit retention keeps records within 180 days and 5000 rows", () => {
  const now = Date.UTC(2026, 7, 31);
  const state = { adminAudit: Array.from({ length: 5000 }, (_, index) => ({ id: `old-${index}`, createdAt: now - 181 * 86_400_000 })) };
  appendAdminAudit(state, { actorUsername: "admin", actorRole: "admin", action: "save", targetType: "settings", targetId: "login", result: "success", summary: "updated" }, { now });
  assert.equal(state.adminAudit.length, 1);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/admin-audit.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现审计追加和裁剪**

```js
// lib/admin-audit.mjs
import { randomUUID } from "node:crypto";

const RETENTION_MS = 180 * 86_400_000;
const MAX_RECORDS = 5_000;
const SENSITIVE = /(password|api[_-]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi;

function safeSummary(value) {
  return String(value || "").replace(SENSITIVE, "$1=[REDACTED]").slice(0, 500);
}

export function appendAdminAudit(state, record, { now = Date.now() } = {}) {
  const next = {
    id: randomUUID(), actorUsername: String(record.actorUsername || "system"), actorRole: record.actorRole,
    departmentId: String(record.departmentId || ""), action: record.action, targetType: record.targetType,
    targetId: String(record.targetId || ""), result: record.result, summary: safeSummary(record.summary), createdAt: now,
  };
  const cutoff = now - RETENTION_MS;
  state.adminAudit = [...(state.adminAudit || []).filter((item) => item.createdAt >= cutoff), next]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_RECORDS);
  return next;
}

export function listAdminAudit(state, actor) {
  const records = [...(state.adminAudit || [])].sort((a, b) => b.createdAt - a.createdAt);
  return actor.role === "admin" ? records : records.filter((item) => item.departmentId === actor.departmentId);
}
```

- [ ] **Step 4: 初始化并水合审计状态**

```js
// api/[...path].mjs：在 emptyState 返回对象末尾增加字段
adminAudit: [],

// hydrateState 中紧跟 const merged = { ...emptyState(), ...state } 后增加
merged.adminAudit = Array.isArray(merged.adminAudit) ? merged.adminAudit : [];
```

- [ ] **Step 5: 运行审计和持久化相关测试**

Run: `node --test test/admin-audit.test.mjs test/persistence-api.test.mjs`

Expected: PASS，旧状态没有 `adminAudit` 时仍可加载。

- [ ] **Step 6: 提交 Session A 第二部分**

```powershell
git add -- lib/admin-audit.mjs test/admin-audit.test.mjs 'api/[...path].mjs'
git commit -m "feat: add bounded admin audit records"
```

## Session B — 看板领域与后台 API

### Task 3: 实现纯看板聚合

**Files:**

- Create: `lib/admin-dashboard.mjs`
- Create: `test/admin-dashboard.test.mjs`
- Modify: `lib/report-auto-archive.mjs`

- [ ] **Step 1: 写范围、指标和零分母失败测试**

```js
// test/admin-dashboard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { buildAdminDashboard } from "../lib/admin-dashboard.mjs";

const state = {
  settings: {
    departments: [{ id: "data", name: "数据产品部", enabled: true, leaderUsername: "leader", modules: ["BI"] }],
    accounts: [
      { username: "leader", departmentId: "data", enabled: true, role: "member", managedModules: [] },
      { username: "owner", departmentId: "data", enabled: true, role: "module_leader", managedModules: [] },
    ],
  },
  weeks: {}, tasks: {}, reports: {}, adminAudit: [],
};

test("dashboard returns null completion rate when no tasks exist", () => {
  const result = buildAdminDashboard(state, { departmentIds: ["data"], periodType: "week", anchorDate: "2026-08-31", now: Date.UTC(2026, 7, 31) });
  assert.equal(result.metrics.tasks.total, 0);
  assert.equal(result.metrics.tasks.completionRate, null);
});

test("dashboard flags module leaders without managed modules", () => {
  const result = buildAdminDashboard(state, { departmentIds: ["data"], periodType: "week", anchorDate: "2026-08-31", now: Date.UTC(2026, 7, 31) });
  assert.ok(result.alerts.some((item) => item.type === "module-scope-missing" && item.targetId === "owner"));
});

test("dashboard never includes departments outside scope", () => {
  const expanded = structuredClone(state);
  expanded.settings.departments.push({ id: "app", name: "应用产品部", enabled: true, leaderUsername: "", modules: ["研发"] });
  const result = buildAdminDashboard(expanded, { departmentIds: ["data"], periodType: "week", anchorDate: "2026-08-31", now: Date.UTC(2026, 7, 31) });
  assert.deepEqual(result.scope.departmentIds, ["data"]);
  assert.equal(result.metrics.organization.missingLeaderCount, 0);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/admin-dashboard.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 提取纯“应归档”查询**

```js
// lib/report-auto-archive.mjs
export function reportsDueForArchive(state, { triggeredAt = Date.now(), departmentIds = null } = {}) {
  const allowed = departmentIds ? new Set(departmentIds) : null;
  return Object.values(state.reports || {}).filter((report) => {
    if (allowed && !allowed.has(report.departmentId)) return false;
    if (!report || report.status === "final") return false;
    const schedule = normalizeReportArchiveSchedule(state.settings?.reportArchive);
    const scheduledAt = scheduledTimestamp(report, schedule);
    return Number.isFinite(scheduledAt) && triggeredAt >= scheduledAt;
  });
}

// archiveDueReports 将原 Object.values(...).forEach 改为：
reportsDueForArchive(state, { triggeredAt }).forEach((report) => {
  const scheduledAt = scheduledTimestamp(report, schedule);
  report.status = "final";
  report.archivedAt = triggeredAt;
  report.archivedBy = { type: "scheduled-task", trigger };
  report.archiveRunKey = `${report.departmentId || "unknown"}:${report.id}:${scheduledAt}`;
  report.updatedAt = triggeredAt;
  delete report.editLock;
  archivedReportIds.push(report.id);
});
```

- [ ] **Step 4: 实现看板聚合**

```js
// lib/admin-dashboard.mjs
import { reportsDueForArchive } from "./report-auto-archive.mjs";

function rate(done, total) { return total ? Math.round((done / total) * 100) : null; }

function isoDate(date) { return date.toISOString().slice(0, 10); }

function periodBounds(periodType, anchorDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
    const error = new Error("统计周期无效"); error.statusCode = 400; throw error;
  }
  const anchor = new Date(`${anchorDate}T00:00:00.000Z`);
  if (Number.isNaN(anchor.getTime()) || isoDate(anchor) !== anchorDate) {
    const error = new Error("统计周期无效"); error.statusCode = 400; throw error;
  }
  let start;
  let end;
  if (periodType === "week") {
    const mondayOffset = (anchor.getUTCDay() + 6) % 7;
    start = new Date(anchor); start.setUTCDate(anchor.getUTCDate() - mondayOffset);
    end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  } else if (periodType === "month") {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  } else if (periodType === "quarter") {
    const firstMonth = Math.floor(anchor.getUTCMonth() / 3) * 3;
    start = new Date(Date.UTC(anchor.getUTCFullYear(), firstMonth, 1));
    end = new Date(Date.UTC(anchor.getUTCFullYear(), firstMonth + 3, 0));
  } else {
    const error = new Error("统计周期无效"); error.statusCode = 400; throw error;
  }
  return { start: isoDate(start), end: isoDate(end) };
}

function weekOverlapsPeriod(week, periodType, anchorDate) {
  const period = periodBounds(periodType, anchorDate);
  return String(week.startDate || "") <= period.end && String(week.endDate || "") >= period.start;
}

export function buildAdminDashboard(state, { departmentIds, periodType, anchorDate, now = Date.now() }) {
  const allowed = new Set(departmentIds);
  const departments = state.settings.departments.filter((item) => allowed.has(item.id));
  const accounts = state.settings.accounts.filter((item) => allowed.has(item.departmentId));
  const weeks = Object.values(state.weeks || {}).filter((item) => allowed.has(item.departmentId));
  const periodWeekIds = new Set(weeks.filter((week) => weekOverlapsPeriod(week, periodType, anchorDate)).map((week) => `${week.departmentId}:${week.id}`));
  const tasks = Object.values(state.tasks || {}).filter((task) => periodWeekIds.has(`${task.departmentId}:${task.weekId}`));
  const completed = tasks.filter((task) => task.status === "已完成").length;
  const dueReports = reportsDueForArchive(state, { triggeredAt: now, departmentIds });
  const alerts = [];
  for (const department of departments.filter((item) => item.enabled && !item.leaderUsername)) alerts.push({ type: "leader-missing", departmentId: department.id, targetId: department.id });
  for (const account of accounts.filter((item) => item.enabled !== false && item.role === "module_leader" && !item.managedModules?.length)) alerts.push({ type: "module-scope-missing", departmentId: account.departmentId, targetId: account.username });
  for (const report of dueReports) alerts.push({ type: "report-archive-due", departmentId: report.departmentId, targetId: report.id });
  return {
    generatedAt: now,
    scope: { departmentIds, periodType, anchorDate },
    metrics: {
      organization: {
        enabledDepartments: departments.filter((item) => item.enabled).length,
        enabledAccounts: accounts.filter((item) => item.enabled !== false).length,
        disabledAccounts: accounts.filter((item) => item.enabled === false).length,
        missingLeaderCount: departments.filter((item) => item.enabled && !item.leaderUsername).length,
      },
      tasks: { total: tasks.length, completed, completionRate: rate(completed, tasks.length) },
      reports: { dueUnarchived: dueReports.length },
    },
    alerts,
  };
}
```

- [ ] **Step 5: 补齐周期边界测试并运行**

在 `test/admin-dashboard.test.mjs` 增加周跨月、季度末、无效日期和已完成任务计数用例。

Run: `node --test test/admin-dashboard.test.mjs test/report-auto-archive.test.mjs`

Expected: PASS；提取纯查询后原归档行为和 due-only 规则不变。

- [ ] **Step 6: 提交看板领域**

```powershell
git add -- lib/admin-dashboard.mjs lib/report-auto-archive.mjs test/admin-dashboard.test.mjs test/report-auto-archive.test.mjs
git commit -m "feat: aggregate scoped admin dashboard metrics"
```

### Task 4: 暴露看板、审计 API 并记录高风险操作

**Files:**

- Modify: `api/[...path].mjs:1229-1430`
- Modify: `test/leader-admin.test.mjs`

- [ ] **Step 1: 写后台 API 失败测试**

```js
// test/leader-admin.test.mjs：先让现有 helper 接受独立查询参数
async function api(path, { method = "GET", body, token = "", admin = false, adminToken = "", includeSyncKey = true, headers = {}, query = {} } = {}) {
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
    query: { path: resolvedPath.split("/").filter(Boolean), ...query },
    body,
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

// 追加测试
test("leader dashboard is forced to their own department", async () => {
  const leader = await setupLeader("dashscope");
  const session = await api("/admin/login", { method: "POST", includeSyncKey: false, body: { username: leader.username, password: leader.password } });
  const result = await api("/admin/dashboard", {
    adminToken: session.body.token,
    query: { departmentId: "data-product", periodType: "week", anchorDate: "2026-08-31" },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.dashboard.scope.departmentIds, [leader.departmentId]);
});

test("leader audit response excludes other departments", async () => {
  const leader = await setupLeader("auditscope");
  const session = await api("/admin/login", { method: "POST", includeSyncKey: false, body: { username: leader.username, password: leader.password } });
  const result = await api("/admin/audit", { adminToken: session.body.token });
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.records.every((item) => item.departmentId === leader.departmentId));
});

test("disabling a current department leader is rejected", async () => {
  const leader = await setupLeader("protectleader");
  const current = await api("/settings", { admin: true });
  const result = await api("/admin/settings", { method: "PATCH", admin: true, body: { accounts: current.body.settings.accounts.map((item) => item.username === leader.username ? { ...item, enabled: false } : item) } });
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /先更换部门负责人/);
});
```

- [ ] **Step 2: 运行集成测试并确认失败**

Run: `node --test test/leader-admin.test.mjs`

Expected: 新增看板和审计用例返回 404，负责人停用保护用例返回错误口径不匹配。

- [ ] **Step 3: 增加 actor 和新路由**

```js
// api/[...path].mjs：放在 handleAdmin 前
function handleAdminReadModel(req, res, state, parts, now, actor) {
  const action = parts[1] || "";
  if (action === "dashboard" && req.method === "GET") {
  const settings = getSettings(state);
  const scope = adminScope(actor, settings.departments, String(req.query.departmentId || ""));
  return json(res, { dashboard: buildAdminDashboard({ ...state, settings }, {
    departmentIds: scope.departmentIds,
    periodType: String(req.query.periodType || "week"),
    anchorDate: String(req.query.anchorDate || new Date(now + 8 * 3_600_000).toISOString().slice(0, 10)),
    now,
  }) });
  }
  if (action === "audit" && req.method === "GET") {
    return json(res, { records: listAdminAudit(state, actor).slice(0, 200) });
  }
  return null;
}

// handleAdmin 中 decoded.role === "leader" 分支在 scheduled-tasks 判断前增加
const leaderActor = { role: "leader", username: decoded.username, departmentId: department.id };
const leaderReadModel = handleAdminReadModel(req, res, state, parts, now, leaderActor);
if (leaderReadModel) return leaderReadModel;

// leader 分支 return 后、全局管理员路由判断前增加
const adminActor = { role: "admin", username: decoded.username, departmentId: "" };
const adminReadModel = handleAdminReadModel(req, res, state, parts, now, adminActor);
if (adminReadModel) return adminReadModel;
```

- [ ] **Step 4: 为高风险操作写显式审计**

在以下成功路径、`saveState(state)` 之前调用 `appendAdminAudit`：

```js
appendAdminAudit(state, {
  actorUsername: adminActor.username,
  actorRole: adminActor.role,
  departmentId: affectedDepartmentId,
  action: "account-role-change",
  targetType: "account",
  targetId: targetUsername,
  result: "success",
  summary: `${previousRole} -> ${role}; modules=${managedModules.join(",")}`,
}, { now });
```

覆盖：负责人更换、账号启停、角色与模块范围、密码重置、登录策略、归档规则、AI 密钥配置或清除、周任务补跑、报告归档补跑。失败审计只记录已经进入受控业务校验且可安全识别的失败，不记录密码、密钥、请求头和异常堆栈。

- [ ] **Step 5: 验证 API、权限和敏感信息**

Run: `node --test test/admin-access.test.mjs test/admin-audit.test.mjs test/admin-dashboard.test.mjs test/leader-admin.test.mjs`

Expected: PASS；部门负责人不能读取其他部门看板或审计，全局管理员可查看全部范围。

- [ ] **Step 6: 提交 Session B**

```powershell
git add -- 'api/[...path].mjs' test/leader-admin.test.mjs
git commit -m "feat: expose admin dashboard and audit APIs"
```

## Session C — 后台框架与管理概览

### Task 5: 重组后台信息架构和角色化导航

**Files:**

- Modify: `public/index.html:52-132,370-458`
- Modify: `test/workbench-ui.test.mjs:564-604`

- [ ] **Step 1: 写信息架构失败测试**

```js
// test/workbench-ui.test.mjs
test("admin center uses responsibility navigation and merged entries", () => {
  for (const section of ["overview", "departments", "members", "roles", "modules", "business", "security", "audit", "operations"]) {
    assert.match(html, new RegExp(`data-admin-section="${section}"`));
  }
  assert.doesNotMatch(html, /data-admin-section="accounts"/);
  assert.doesNotMatch(html, /data-admin-section="leader-accounts"/);
  assert.doesNotMatch(html, /data-admin-section="leader-modules"/);
  assert.match(html, /工作模块/);
});

test("leader admin navigation omits global configuration and operations", () => {
  assert.match(html, /adminSectionAllowedForRole/);
  assert.match(html, /new Set\(\["overview", "members", "roles", "modules", "audit"\]\)/);
});
```

- [ ] **Step 2: 运行 UI 测试并确认失败**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL；页面仍包含旧 `accounts`、`leader-accounts` 和 `leader-modules` 入口。

- [ ] **Step 3: 替换后台框架标记**

```html
<div class="admin-center-v2" id="adminManagePanel" hidden>
  <aside class="admin-sidebar panel" aria-label="后台管理导航">
    <div id="adminScopeControl"></div>
    <nav id="adminResponsibilityNav">
      <button data-admin-section="overview">管理概览</button>
      <button data-admin-section="departments">部门管理</button>
      <button data-admin-section="members">成员管理</button>
      <button data-admin-section="roles">角色与负责范围</button>
      <button data-admin-section="modules">工作模块</button>
      <button data-admin-section="business">业务配置</button>
      <button data-admin-section="security">系统与安全</button>
      <button data-admin-section="audit">操作审计</button>
      <button data-admin-section="operations">运行中心</button>
    </nav>
  </aside>
  <div class="admin-workspace-v2"><div id="adminPageHeader"></div><div id="adminPageContent"></div></div>
</div>
```

- [ ] **Step 4: 增加角色可见函数**

```js
const leaderAdminSections = new Set(["overview", "members", "roles", "modules", "audit"]);
function adminSectionAllowedForRole(section) {
  return adminRole === "admin" || leaderAdminSections.has(section);
}
function setAdminSection(section) {
  const next = adminSectionAllowedForRole(section) ? section : "overview";
  adminSection = next;
  renderAdminCenter();
}
```

- [ ] **Step 5: 添加与原型一致的作用域样式**

所有新增 CSS 以 `.admin-center-v2` 为根，复用现有 `--primary`、`--line`、`--text`、`--muted`，实现 224px 深色职责导航、84px 页面头、中等密度卡片与 1280px 适配。不得覆盖工作台现有 `.nav`、`.panel`、`.data-table` 的全局行为。

- [ ] **Step 6: 运行 UI 测试和构建**

Run: `node --test test/workbench-ui.test.mjs`

Run: `npm.cmd run build`

Expected: PASS；内联脚本语法校验成功，旧业务页面不受影响。

- [ ] **Step 7: 提交后台框架**

```powershell
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "feat: reorganize admin center navigation"
```

### Task 6: 实现管理概览和角色范围

**Files:**

- Modify: `public/index.html`
- Modify: `test/workbench-ui.test.mjs`

- [ ] **Step 1: 写看板渲染与下钻失败测试**

```js
test("admin overview renders scoped metrics and drill-down filters", () => {
  assert.match(html, /async function loadAdminDashboard/);
  assert.match(html, /completionRate == null \? "—"/);
  assert.match(html, /data-admin-drilldown/);
  assert.match(html, /adminInheritedFilters/);
  assert.match(html, /generatedAt/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL，缺少看板加载和下钻函数。

- [ ] **Step 3: 实现看板加载状态**

```js
let adminDashboard = null;
let adminDashboardState = "idle";
let adminPeriodType = "week";
let adminAnchorDate = new Date().toISOString().slice(0, 10);
let adminInheritedFilters = null;

async function loadAdminDashboard() {
  adminDashboardState = "loading";
  renderAdminOverview();
  const query = new URLSearchParams({ periodType: adminPeriodType, anchorDate: adminAnchorDate });
  if (adminRole === "admin" && adminDepartmentScope) query.set("departmentId", adminDepartmentScope);
  try {
    const response = await fetch(`/api/admin/dashboard?${query}`, { headers: adminRequestHeaders() });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "管理概览加载失败");
    adminDashboard = payload.dashboard;
    adminDashboardState = "ready";
  } catch (error) {
    adminDashboardState = "error";
  }
  renderAdminOverview();
}
```

- [ ] **Step 4: 实现指标、异常和下钻**

`renderAdminOverview` 必须输出范围、周期、更新时间、待处理事项、任务、总结、组织和健康状态；比例使用：

```js
const completionText = dashboard.metrics.tasks.completionRate == null
  ? "—"
  : `${dashboard.metrics.tasks.completionRate}%`;

function openAdminDrilldown(section, filters) {
  adminInheritedFilters = filters;
  setAdminSection(section);
}
```

异常映射固定为：`module-scope-missing → members`、`leader-missing → departments`、`report-archive-due → business`、运行失败 → `operations`。部门负责人不渲染全局系统、AI 和运行状态。

- [ ] **Step 5: 实现加载、空、错误状态**

加载时保留页面头并显示骨架；数据为空时显示清除范围或周期入口；失败时保留当前筛选并提供“重新加载”。不使用模拟数字兜底。

- [ ] **Step 6: 运行 UI、API 和构建验证**

Run: `node --test test/workbench-ui.test.mjs test/admin-dashboard.test.mjs test/leader-admin.test.mjs`

Run: `npm.cmd run build`

Expected: PASS。

- [ ] **Step 7: 提交 Session C**

```powershell
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "feat: add scoped admin management overview"
```

## Session D — 管理页面与安全交互

### Task 7: 合并成员和工作模块，改为每页独立保存

**Files:**

- Modify: `public/index.html`
- Modify: `test/workbench-ui.test.mjs`
- Modify: `test/leader-admin.test.mjs`

- [ ] **Step 1: 写合并入口和未保存保护失败测试**

```js
test("admin pages save independently and protect dirty input", () => {
  assert.match(html, /adminPageDirty/);
  assert.match(html, /confirmAdminNavigation/);
  assert.match(html, /保存并离开/);
  assert.doesNotMatch(html, /class="admin-savebar panel"/);
});

test("member management uses a detail drawer and explicit risky actions", () => {
  assert.match(html, /id="adminMemberDrawer"/);
  assert.match(html, /data-admin-member-detail/);
  assert.match(html, /data-admin-reset-password/);
  assert.match(html, /data-admin-account-enabled/);
});
```

- [ ] **Step 2: 运行 UI 测试并确认失败**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL，旧全局保存条仍存在，成员仍采用行内编辑。

- [ ] **Step 3: 实现统一成员列表与详情抽屉**

全局管理员从 `/api/admin/settings` 读取全部账号；部门负责人从 `/api/admin/leader/accounts` 读取本部门账号。列表只负责筛选和打开详情，抽屉保存分别调用：全局管理员使用 `/api/admin/settings` 的 `PATCH { accounts }`，部门负责人使用现有 `/api/admin/leader/accounts/:username/role` 和 `/enabled`。

```js
function markAdminPageDirty() {
  adminPageDirty = true;
  document.querySelector("#adminDirtyIndicator")?.removeAttribute("hidden");
}

async function confirmAdminNavigation(nextSection) {
  if (!adminPageDirty) return setAdminSection(nextSection);
  adminPendingSection = nextSection;
  openAdminUnsavedModal();
}
```

- [ ] **Step 4: 实现工作模块单入口**

全局管理员选择部门后用 `/api/admin/settings` 部分更新对应 `departments[].modules`；部门负责人使用 `/api/admin/leader/modules`。界面统一显示“工作模块”，API 和数据字段继续使用 `modules`，不迁移历史数据。

- [ ] **Step 5: 拆分业务配置与系统安全保存**

- 归档规则：`PATCH /api/admin/settings`，只发送 `{ reportArchive }`。
- 登录策略：只发送 `{ sessionDurationMinutes }`。
- AI 普通配置：只发送 `{ ai: { enabled, provider, model } }`。
- AI 密钥配置或清除：独立确认后单独发送 `{ ai: { apiKey } }` 或 `{ ai: { clearApiKey: true } }`。

保存失败时不得重建表单，保留 DOM 输入值并在页面内显示错误；保存成功后才清除 `adminPageDirty`。

- [ ] **Step 6: 增加负责人更换与停用集成测试**

在 `test/leader-admin.test.mjs` 验证：更换负责人会更新 `leaderAssignedAt`；旧负责人获得明确新角色；未更换前停用返回 400；部门负责人不能修改自己或其他负责人。

- [ ] **Step 7: 运行最小回归**

Run: `node --test test/leader-admin.test.mjs test/workbench-ui.test.mjs`

Run: `npm.cmd run build`

Expected: PASS。

- [ ] **Step 8: 提交管理页面**

```powershell
git add -- public/index.html test/workbench-ui.test.mjs test/leader-admin.test.mjs
git commit -m "feat: add role-aware admin management pages"
```

### Task 8: 实现运行中心、审计和高风险确认

**Files:**

- Modify: `public/index.html`
- Modify: `test/workbench-ui.test.mjs`
- Modify: `test/leader-admin.test.mjs`

- [ ] **Step 1: 写运行与审计页面失败测试**

```js
test("operations use due-only check-and-catch-up wording", () => {
  assert.match(html, /检查并补跑/);
  assert.match(html, /只处理已经到期但尚未完成/);
  assert.match(html, /不会重复创建/);
  assert.match(html, /执行来源/);
});

test("audit UI exposes safe filters without export", () => {
  assert.match(html, /id="adminAuditList"/);
  assert.match(html, /data-admin-audit-filter/);
  assert.doesNotMatch(html, /导出审计/);
});
```

- [ ] **Step 2: 运行 UI 测试并确认失败**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL，缺少审计列表和新操作命名。

- [ ] **Step 3: 实现运行中心**

复用 `/api/admin/scheduled-tasks` 和两个现有运行接口。页面分开展示计划状态、执行状态、执行来源、检查范围、成功、跳过、失败数量和安全错误摘要。点击“检查并补跑”后按钮立即禁用，单次只发送一个请求，完成后同时刷新运行列表和看板。

```js
async function runAdminCatchUp(kind) {
  if (adminRunPending) return;
  adminRunPending = true;
  renderAdminOperations();
  try {
    const response = await fetch(`/api/admin/scheduled-tasks/${kind}/run`, { method: "POST", headers: adminRequestHeaders() });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "检查并补跑失败");
    await Promise.all([loadScheduledTasks(), loadAdminDashboard()]);
  } finally {
    adminRunPending = false;
    renderAdminOperations();
  }
}
```

- [ ] **Step 4: 实现审计页面**

调用 `GET /api/admin/audit`，在浏览器内按部门、操作者、操作类型、结果和日期过滤。首版最多显示服务端返回的 200 条，不提供导出和批量操作。部门负责人页面不出现其他部门记录或全局敏感配置操作。

- [ ] **Step 5: 补齐状态和键盘行为**

抽屉和对话框打开时聚焦首个可操作控件，关闭后返回触发按钮；Escape 关闭当前浮层。加载、空、无匹配、无权限和失败状态分别使用独立文案；按钮进行中不可重复提交，颜色不是唯一状态信号。

- [ ] **Step 6: 运行运行中心、UI 和权限验证**

Run: `node --test test/workbench-ui.test.mjs test/leader-admin.test.mjs test/report-auto-archive.test.mjs`

Expected: PASS；部门负责人请求运行接口仍返回 403，补跑沿用 due-only 与防重逻辑。

- [ ] **Step 7: 提交 Session D**

```powershell
git add -- public/index.html test/workbench-ui.test.mjs test/leader-admin.test.mjs
git commit -m "feat: add admin operations and audit views"
```

## Session E — 独立验证与交接

### Task 9: 完成跨角色验收和架构更新

**Files:**

- Modify: `PROJECT_ARCHITECTURE.md`
- Modify: `SESSION_HANDOFF.md`
- Verify: `public/index.html`
- Verify: `api/[...path].mjs`

- [ ] **Step 1: 运行领域与 API 定向测试**

Run: `node --test test/admin-access.test.mjs test/admin-audit.test.mjs test/admin-dashboard.test.mjs test/leader-admin.test.mjs test/report-auto-archive.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 2: 运行 UI 与生产构建验证**

Run: `node --test test/workbench-ui.test.mjs test/production-build.test.mjs`

Run: `npm.cmd run build`

Expected: 全部 PASS，构建清单包含更新后的后台页面。

- [ ] **Step 3: 运行静态检查**

Run: `npm.cmd run lint`

Run: `npm.cmd run format:check`

Expected: PASS；若出现改动前已存在的失败，记录具体测试和错误，不扩大修复范围。

- [ ] **Step 4: 浏览器走查已确认路径**

按交互规范依次验证：全局概览异常下钻；成员角色范围修正；未保存离开保护；运行失败到检查并补跑；部门负责人只见本部门概览、成员、工作模块和审计。验证 1440×900 与 1280×720，不执行移动端扩展。

- [ ] **Step 5: 更新架构入口**

在 `PROJECT_ARCHITECTURE.md` 增加：

```markdown
- 后台管理：`lib/admin-access.mjs` 负责角色范围与设置保护；`lib/admin-dashboard.mjs` 负责授权范围内指标和异常聚合；`lib/admin-audit.mjs` 负责有界、脱敏的操作审计。对应测试为 `test/admin-access.test.mjs`、`test/admin-dashboard.test.mjs`、`test/admin-audit.test.mjs` 和 `test/leader-admin.test.mjs`。
```

- [ ] **Step 6: 更新交接文件**

`SESSION_HANDOFF.md` 只记录：完成范围、最终提交、验证摘要、未解决事项；不复制测试日志或完整 Diff。

- [ ] **Step 7: 核对 Diff 与提交**

Run: `git diff --check`

Run: `git status --short`

Expected: 只有本计划列出的文件；不得包含 `.claude/`、原型目录、构建产物或其他用户改动。

```powershell
git add -- PROJECT_ARCHITECTURE.md SESSION_HANDOFF.md
git commit -m "docs: record backend admin center architecture"
```

## 完成条件

1. 全局管理员和部门负责人所有后台读取、统计、修改均由服务端统一裁剪。
2. 看板数字可由同范围原始列表复核，零分母显示“—”。
3. 旧账号、部门和 `modules` 数据无需迁移即可使用。
4. 页面不存在跨域全局保存；失败不会丢失输入。
5. 高风险操作独立确认并生成脱敏审计。
6. 补跑保持 due-only、幂等和单次触发。
7. 新增领域、API、UI、权限、归档与生产构建验证全部通过。
8. 原型和 `.claude/` 不进入业务提交。
