# Registration, password reset, and report import implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone registration flow, add administrator password resets, simplify the login-duration message, and load report import candidates from the report's own date range.

**Architecture:** Keep the existing single-page frontend and API handler. Add two narrow server operations: an admin-only password reset route and an authenticated date-range task query. The frontend uses explicit authentication views and an asynchronous report-import state so it never falls back to tasks from the wrong week.

**Tech Stack:** Node.js 22, native Node test runner, server-rendered static HTML/CSS/JavaScript, CloudBase state storage

---

## File structure

- `api/[...path].mjs`: change registration response, reset passwords, invalidate sessions, and query department tasks by date range
- `public/index.html`: implement authentication views, admin reset controls, formatted login duration, and asynchronous report imports
- `test/department-api.test.mjs`: cover registration and password reset security
- `test/report-api.test.mjs`: cover date-range task queries and update login setup
- `test/persistence-api.test.mjs`: update registration setup to log in explicitly
- `test/workbench-ui.test.mjs`: cover the new authentication views, admin reset controls, copy, and import loading states

### Task 1: Stop registration from creating a login session

**Files:**

- Modify: `test/department-api.test.mjs`
- Modify: `test/report-api.test.mjs`
- Modify: `test/persistence-api.test.mjs`
- Modify: `api/[...path].mjs:443-463`

- [ ] **Step 1: Write the failing registration test**

Replace the registration assertion in `test/department-api.test.mjs` and add a session check:

```js
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
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```powershell
node --test test/department-api.test.mjs
```

Expected: FAIL because registration still returns `token` and `expiresAt`.

- [ ] **Step 3: Return a public user without creating a session**

Change the registration branch in `handleAuth`:

```js
const salt = randomId("salt");
const user = {
  id: randomId("user"),
  username,
  displayName,
  departmentId: department.id,
  salt,
  passwordHash: await hashPassword(password, salt),
  createdAt: now,
  updatedAt: now,
};
state.users[username] = user;
await saveState(state);
return json(res, { ok: true, user: publicUser(user, state) }, 201);
```

- [ ] **Step 4: Update authenticated test setup**

In `test/report-api.test.mjs` and `test/persistence-api.test.mjs`, register first, then log in:

```js
const registered = await api("/auth/register", {
  method: "POST",
  body: { username, password: "12345678", displayName: "测试成员" },
});
assert.equal(registered.statusCode, 201);

const loggedIn = await api("/auth/login", {
  method: "POST",
  body: { username, password: "12345678" },
});
assert.equal(loggedIn.statusCode, 200);
defaultToken = loggedIn.body.token;
```

Update every `registered.body.token` use in `test/department-api.test.mjs` to perform an explicit login and use `loggedIn.body.token`.

- [ ] **Step 5: Run affected tests**

Run:

```powershell
node --test test/department-api.test.mjs test/report-api.test.mjs test/persistence-api.test.mjs
```

Expected: all affected tests PASS.

- [ ] **Step 6: Commit registration behavior**

```powershell
git add -- api/[...path].mjs test/department-api.test.mjs test/report-api.test.mjs test/persistence-api.test.mjs
git commit -m "Require login after registration"
```

### Task 2: Add administrator password reset

**Files:**

- Modify: `test/department-api.test.mjs`
- Modify: `api/[...path].mjs:833-868`

- [ ] **Step 1: Write failing password reset tests**

Add a test that provisions a member, registers, logs in, and resets the password:

```js
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

  await api("/auth/register", {
    method: "POST",
    includeSyncKey: false,
    body: { username, password: "old-password" },
  });
  const oldLogin = await api("/auth/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username, password: "old-password" },
  });

  const reset = await api(`/admin/users/${username}/reset-password`, {
    method: "POST",
    admin: true,
    includeSyncKey: false,
    body: { password: "new-password" },
  });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.body.ok, true);

  assert.equal((await api("/weeks", {
    token: oldLogin.body.token,
    includeSyncKey: false,
  })).statusCode, 401);
  assert.equal((await api("/auth/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username, password: "old-password" },
  })).statusCode, 401);
  assert.equal((await api("/auth/login", {
    method: "POST",
    includeSyncKey: false,
    body: { username, password: "new-password" },
  })).statusCode, 200);
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
```

- [ ] **Step 2: Run the tests and verify the route is missing**

Run:

```powershell
node --test test/department-api.test.mjs
```

Expected: FAIL with `404` for the reset route.

- [ ] **Step 3: Add the reset helper and route**

Add this helper above `handleAdmin`:

```js
async function resetUserPassword(req, res, state, username, now) {
  if (req.method !== "POST") return methodNotAllowed(res);
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const { password } = await readBody(req);
  const nextPassword = String(password || "");
  if (nextPassword.length < 6) return json(res, { error: "密码至少6位" }, 400);

  const user = state.users[normalizedUsername];
  if (!user) return json(res, { error: "账号尚未注册" }, 404);

  user.salt = randomId("salt");
  user.passwordHash = await hashPassword(nextPassword, user.salt);
  user.updatedAt = now;
  for (const [token, session] of Object.entries(state.sessions || {})) {
    if (session.username === normalizedUsername) delete state.sessions[token];
  }
  await saveState(state);
  return json(res, { ok: true, username: normalizedUsername });
}
```

Route it after admin-token verification:

```js
if (action === "users" && parts[3] === "reset-password") {
  return resetUserPassword(req, res, state, decodeURIComponent(parts[2] || ""), now);
}
```

- [ ] **Step 4: Run the password reset tests**

Run:

```powershell
node --test test/department-api.test.mjs
```

Expected: PASS, including old-password and old-session invalidation.

- [ ] **Step 5: Commit the password reset API**

```powershell
git add -- api/[...path].mjs test/department-api.test.mjs
git commit -m "Add secure admin password reset"
```

### Task 3: Query tasks by report date range

**Files:**

- Modify: `test/report-api.test.mjs`
- Modify: `api/[...path].mjs:500-560`
- Modify: `api/[...path].mjs:870-890`

- [ ] **Step 1: Extend the test helper to accept query values**

Change the `api` helper in `test/report-api.test.mjs`:

```js
async function api(path, { method = "GET", body, token, headers = {}, query = {} } = {}) {
  const resolvedToken = token === undefined ? defaultToken : token;
  const req = {
    method,
    headers: {
      "x-report-key": syncKey,
      ...(resolvedToken ? { "x-user-token": resolvedToken } : {}),
      ...headers,
    },
    query: { path: path.split("/").filter(Boolean), ...query },
    body,
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}
```

- [ ] **Step 2: Write the failing date-range tests**

Add tests that create two weeks and one task in each:

```js
test("task range returns every matching week in the signed-in department", async () => {
  for (const week of [
    { startDate: "2026-07-06", endDate: "2026-07-12", title: "Week one" },
    { startDate: "2026-07-13", endDate: "2026-07-19", title: "Week two" },
  ]) {
    await api("/weeks", { method: "POST", body: week });
    await api(`/week/${week.startDate}_${week.endDate}/tasks`, {
      method: "POST",
      body: { task: { title: week.title, module: "AI+X项目" } },
    });
  }

  const response = await api("/tasks", {
    query: { startDate: "2026-07-01", endDate: "2026-07-31" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.body.tasks.map((task) => task.title).sort(),
    ["Week one", "Week two"],
  );
});

test("task range rejects invalid dates and anonymous access", async () => {
  assert.equal((await api("/tasks", {
    query: { startDate: "2026-07-31", endDate: "2026-07-01" },
  })).statusCode, 400);
  assert.equal((await api("/tasks", {
    token: "",
    query: { startDate: "2026-07-01", endDate: "2026-07-31" },
  })).statusCode, 401);
});
```

- [ ] **Step 3: Run the tests and verify the route is missing**

Run:

```powershell
node --test test/report-api.test.mjs
```

Expected: FAIL because `/tasks` returns `404`.

- [ ] **Step 4: Implement the department-scoped date-range query**

Add:

```js
function validIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function listTasksForPeriod(state, departmentId, startDate, endDate) {
  const weekIds = new Set(
    Object.values(state.weeks || {})
      .filter((week) =>
        week.departmentId === departmentId &&
        week.startDate <= endDate &&
        week.endDate >= startDate
      )
      .map((week) => week.id),
  );
  return Object.values(state.tasks || {})
    .filter((task) => task.departmentId === departmentId && weekIds.has(task.weekId))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function handleTasksByPeriod(req, res, state, actor) {
  if (req.method !== "GET") return methodNotAllowed(res);
  const startDate = String(req.query.startDate || "");
  const endDate = String(req.query.endDate || "");
  if (!validIsoDate(startDate) || !validIsoDate(endDate) || endDate < startDate) {
    return json(res, { error: "请输入有效的开始日期和结束日期" }, 400);
  }
  return json(res, {
    tasks: listTasksForPeriod(state, actor.departmentId, startDate, endDate),
  });
}
```

Add this authenticated route before the single-task route:

```js
if (parts[0] === "tasks") return handleTasksByPeriod(req, res, state, actor);
```

- [ ] **Step 5: Run the API tests**

Run:

```powershell
node --test test/report-api.test.mjs test/department-api.test.mjs
```

Expected: PASS with period filtering and department isolation preserved.

- [ ] **Step 6: Commit the date-range API**

```powershell
git add -- api/[...path].mjs test/report-api.test.mjs
git commit -m "Query report tasks by date range"
```

### Task 4: Replace modal registration with focused authentication views

**Files:**

- Modify: `test/workbench-ui.test.mjs`
- Modify: `public/index.html:51-130`
- Modify: `public/index.html:680-735`
- Modify: `public/index.html:3300-3375`
- Modify: `public/index.html:4000-4065`

- [ ] **Step 1: Write failing authentication UI tests**

Add:

```js
test("registration and password help are dedicated authentication views", () => {
  assert.match(html, /id="registerView"/);
  assert.match(html, /id="registerForm"/);
  assert.match(html, /id="registerConfirmPassword"/);
  assert.match(html, /id="forgotPasswordView"/);
  assert.match(html, /id="loginForgotPasswordBtn"/);
  assert.doesNotMatch(html, /id="showRegisterBtn"/);
  assert.doesNotMatch(html, /id="displayNameField"/);
});

test("registration returns to login without storing a session", () => {
  assert.match(html, /注册成功，请重新登录/);
  assert.match(html, /showAuthView\("login"/);
  assert.doesNotMatch(html, /action === "register"[\s\S]{0,600}localStorage\.setItem\(userTokenStorageKey/);
});

test("login page shows the configured session duration directly", () => {
  assert.match(html, /id="loginDurationHint"/);
  assert.match(html, /保持登录：/);
  assert.doesNotMatch(html, /登录状态将按后台设置的时间保持/);
});
```

- [ ] **Step 2: Run the UI tests and verify they fail**

Run:

```powershell
node --test test/workbench-ui.test.mjs
```

Expected: FAIL because the registration and forgot-password views do not exist.

- [ ] **Step 3: Add three focused authentication views**

Keep `loginView`, add `registerView` and `forgotPasswordView` as sibling `<main>` elements. Use the selected centered-card design:

```html
<main id="registerView" class="auth-page" hidden>
  <form id="registerForm" class="auth-focus-card">
    <button class="auth-back" id="registerBackBtn" type="button">← 返回登录</button>
    <div class="login-kicker">创建账号</div>
    <h2>注册部门工作台</h2>
    <p>账号须由管理员提前加入部门成员清单</p>
    <div class="login-field"><label for="registerUsername">账号</label><input id="registerUsername" autocomplete="username"></div>
    <div class="login-field"><label for="registerDisplayName">姓名</label><input id="registerDisplayName" autocomplete="name"></div>
    <div class="login-field"><label for="registerPassword">密码</label><input id="registerPassword" type="password" autocomplete="new-password"></div>
    <div class="login-field"><label for="registerConfirmPassword">确认密码</label><input id="registerConfirmPassword" type="password" autocomplete="new-password"></div>
    <button class="primary-btn login-submit" id="registerSubmitBtn" type="submit">完成注册</button>
    <div class="login-message" id="registerMessage" role="alert"></div>
  </form>
</main>

<main id="forgotPasswordView" class="auth-page" hidden>
  <section class="auth-focus-card auth-help-card">
    <div class="auth-help-icon" aria-hidden="true">?</div>
    <h2>忘记密码</h2>
    <p>请联系后台管理员重置密码。为保护账号安全，此处不会查询账号是否存在。</p>
    <button class="primary-btn login-submit" id="forgotPasswordBackBtn" type="button">返回登录</button>
  </section>
</main>
```

Add CSS for `.auth-page`, `.auth-focus-card`, `.auth-back`, `.auth-help-card`, success feedback, focus states, and the existing mobile breakpoint. Remove the obsolete authentication modal markup.

- [ ] **Step 4: Add explicit authentication view state**

Add:

```js
function formatSessionDuration(minutes) {
  const value = Math.max(1, Number(minutes) || 30);
  if (value % 1440 === 0) return `${value / 1440}天`;
  if (value % 60 === 0) return `${value / 60}小时`;
  return `${value}分钟`;
}

function showAuthView(view) {
  $("loginView").hidden = view !== "login";
  $("registerView").hidden = view !== "register";
  $("forgotPasswordView").hidden = view !== "forgot-password";
  $("workspaceShell").hidden = true;
  if (view === "login") {
    $("loginDurationHint").textContent = `保持登录：${formatSessionDuration(sessionDurationMinutes)}`;
  }
}
```

Call `showAuthView("login")` when no valid user session exists. Wire **注册账号**, **忘记密码**, and both back buttons to `showAuthView`.

- [ ] **Step 5: Make registration return to login**

Separate registration from `authAction`:

```js
async function registerAccount({ username, password, confirmPassword, displayName }) {
  if (!username || !displayName || !password || !confirmPassword) {
    throw new Error("请完整填写注册信息");
  }
  if (password.length < 6) throw new Error("密码至少6位");
  if (password !== confirmPassword) throw new Error("两次输入的密码不一致");
  await apiJson("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, displayName }),
  });
}
```

In `registerForm` submit:

```js
await registerAccount({
  username: $("registerUsername").value.trim(),
  displayName: $("registerDisplayName").value.trim(),
  password: $("registerPassword").value,
  confirmPassword: $("registerConfirmPassword").value,
});
$("registerMessage").textContent = "注册成功，请重新登录";
$("registerMessage").classList.add("success");
$("loginUsername").value = $("registerUsername").value.trim();
setTimeout(() => showAuthView("login"), 2000);
```

Do not write `currentUser`, `userToken`, or user-session storage during registration.

- [ ] **Step 6: Run the UI and API tests**

Run:

```powershell
node --test test/workbench-ui.test.mjs test/department-api.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit the authentication UI**

```powershell
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "Add focused registration and password help"
```

### Task 5: Add password reset controls to account management

**Files:**

- Modify: `test/workbench-ui.test.mjs`
- Modify: `public/index.html:365-370`
- Modify: `public/index.html:3180-3235`
- Modify: `public/index.html:3380-3420`

- [ ] **Step 1: Write the failing admin UI test**

Add:

```js
test("admin account management exposes registered-user password reset", () => {
  assert.match(html, /data-admin-reset-password/);
  assert.match(html, /id="adminResetPasswordModal"/);
  assert.match(html, /id="adminResetPassword"/);
  assert.match(html, /id="adminResetPasswordConfirm"/);
  assert.match(html, /\/api\/admin\/users\/\$\{encodeURIComponent\(adminResetUsername\)\}\/reset-password/);
});
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run:

```powershell
node --test test/workbench-ui.test.mjs
```

Expected: FAIL because reset controls do not exist.

- [ ] **Step 3: Render the reset action only for registered accounts**

In the account row renderer, add:

```js
${registered ? `<button class="ghost-btn" data-admin-reset-password="${escapeHtml(account.username)}">重置密码</button>` : ""}
```

Add `adminResetUsername` state and a modal with two password inputs, a message element, **取消**, and **确认重置**.

- [ ] **Step 4: Submit the reset through the admin session**

Add:

```js
async function submitAdminPasswordReset() {
  const password = $("adminResetPassword").value;
  const confirmPassword = $("adminResetPasswordConfirm").value;
  if (password.length < 6) throw new Error("密码至少6位");
  if (password !== confirmPassword) throw new Error("两次输入的密码不一致");
  await apiJson(`/api/admin/users/${encodeURIComponent(adminResetUsername)}/reset-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...adminRequestHeaders(),
    },
    body: JSON.stringify({ password }),
  });
  $("adminResetPasswordModal").hidden = true;
  setSyncStatus(`已重置 ${adminResetUsername} 的密码`, "ok");
}
```

Disable the submit button while the request is running. Restore the button and show the returned error if the request fails.

- [ ] **Step 5: Run admin reset tests**

Run:

```powershell
node --test test/workbench-ui.test.mjs test/department-api.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the admin reset UI**

```powershell
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "Manage member password resets in admin"
```

### Task 6: Load report import candidates from the report period

**Files:**

- Modify: `test/workbench-ui.test.mjs`
- Modify: `public/index.html:700-720`
- Modify: `public/index.html:2745-2805`
- Modify: `public/index.html:3395-3410`
- Modify: `public/index.html:3800-3815`

- [ ] **Step 1: Write the failing import UI test**

Add:

```js
test("report import loads candidates for the report period", () => {
  assert.match(html, /let reportImportTasks = \[\]/);
  assert.match(html, /let reportImportState = "idle"/);
  assert.match(html, /\/api\/tasks\?startDate=/);
  assert.match(html, /正在加载待办/);
  assert.match(html, /当前周期和模块暂无可导入待办/);
  assert.match(html, /data-retry-report-task-import/);
  assert.match(html, /\.filter\(\(task\) => task\.module === moduleName\)/);
});
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run:

```powershell
node --test test/workbench-ui.test.mjs
```

Expected: FAIL because imports still read the global `tasks` array.

- [ ] **Step 3: Add import candidate state**

Add:

```js
let reportImportTasks = [];
let reportImportState = "idle";
let reportImportError = "";
```

Update the renderer:

```js
function renderReportTaskImportList() {
  if (reportImportState === "loading") {
    $("reportTaskImportList").innerHTML = `<div class="import-state">正在加载待办…</div>`;
    return;
  }
  if (reportImportState === "error") {
    $("reportTaskImportList").innerHTML = `
      <div class="import-state error">
        <span>${escapeHtml(reportImportError || "待办加载失败")}</span>
        <button class="ghost-btn" data-retry-report-task-import>重新加载</button>
      </div>`;
    return;
  }
  const moduleName = $("reportImportModuleFilter").value;
  const sectionTitle = $("reportImportSectionSelect").value;
  const rows = reportImportTasks
    .filter((task) => task.module === moduleName)
    .filter((task) => task.includeInReport !== false)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  $("reportTaskImportList").innerHTML = rows.map((task) => {
    const text = reportTaskImportText(task, sectionTitle, 1);
    return `<label class="import-preview-row">
      <input type="checkbox" data-report-task-import="${task.id}">
      <span><strong>${escapeHtml(task.title || "未命名任务")}</strong><br><small>${escapeHtml(text)}</small></span>
      <span>${escapeHtml(task.status || "")}</span>
      <span>${taskProgressPercent(task)}%</span>
    </label>`;
  }).join("") || `<div class="import-state">当前周期和模块暂无可导入待办</div>`;
}
```

- [ ] **Step 4: Fetch by the active report range**

Add:

```js
async function loadReportImportTasks() {
  reportImportState = "loading";
  reportImportError = "";
  renderReportTaskImportList();
  try {
    const query = new URLSearchParams({
      startDate: reportData.startDate,
      endDate: reportData.endDate,
    });
    const result = await apiJson(`/api/tasks?${query}`);
    reportImportTasks = result.tasks || [];
    reportImportState = "success";
  } catch (error) {
    reportImportTasks = [];
    reportImportState = "error";
    reportImportError = error.message || "待办加载失败";
  }
  renderReportTaskImportList();
}
```

Change `openReportTaskImport` to set up the controls, show the modal, and `await loadReportImportTasks()`. Use `reportImportTasks` instead of global `tasks` in `confirmReportTaskImport`.

Wire `[data-retry-report-task-import]` to `loadReportImportTasks`. Module and section changes only call `renderReportTaskImportList`.

- [ ] **Step 5: Run report import tests**

Run:

```powershell
node --test test/workbench-ui.test.mjs test/report-api.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the report import fix**

```powershell
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "Load report tasks from the report period"
```

### Task 7: Verify the complete change

**Files:**

- Verify: `api/[...path].mjs`
- Verify: `public/index.html`
- Verify: `test/*.test.mjs`

- [ ] **Step 1: Run the complete test suite**

Run:

```powershell
npm.cmd test
```

Expected: all tests PASS with no warnings or unhandled errors.

- [ ] **Step 2: Run the production dependency audit**

Run:

```powershell
npm.cmd audit --omit=dev --audit-level=high
```

Expected: `found 0 vulnerabilities`.

- [ ] **Step 3: Build the production package**

Run:

```powershell
npm.cmd run build
```

Expected: `Production build ready` with the current commit prefix.

- [ ] **Step 4: Perform browser smoke tests**

Start the production server and verify:

1. The root route shows the login card and formatted duration.
2. **注册账号** opens the centered standalone registration page.
3. A successful registration returns to login and pre-fills the account.
4. **忘记密码** shows administrator-reset guidance.
5. An administrator can reset a registered member's password.
6. The old member session fails after reset.
7. A historical weekly report loads tasks from its own date range.
8. Monthly and quarterly reports aggregate matching weekly tasks.
9. Mobile width keeps each authentication view readable without horizontal scrolling.

- [ ] **Step 5: Check repository state**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted implementation files.
