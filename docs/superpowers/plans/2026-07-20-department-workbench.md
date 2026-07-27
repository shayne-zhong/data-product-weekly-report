# Department workbench implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing single-department workbench into a login-required, multi-department system with server-side data isolation, configurable session duration, icon-only utility navigation, and a new site favicon.

**Architecture:** Keep the current single persisted state and add stable `departmentId` fields to settings, users, sessions, and business records. Treat the session as the only source of department authorization, migrate legacy records into the default department, and keep AI plus session duration as global settings while modules and accounts become department-aware.

**Tech Stack:** Browser HTML/CSS/JavaScript, Node.js ECMAScript modules, Node test runner, Vercel and Netlify function adapter, Vercel/Netlify blob persistence.

---

### Task 1: Add department setting normalization and legacy migration

**Files:**
- Create: `test/department-api.test.mjs`
- Modify: `api/[...path].mjs`

- [ ] **Step 1: Write failing settings and migration tests**

Create a request helper that calls the existing API handler. Add tests that assert:

```javascript
test("public settings contain the default department and session duration", async () => {
  const response = await api("/settings");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.settings.departments[0].id, "data-product");
  assert.equal(response.body.settings.departments[0].name, "数据产品部");
  assert.equal(response.body.settings.departments[0].enabled, true);
  assert.equal(response.body.settings.sessionDurationMinutes, 30);
  assert.ok(response.body.settings.accounts.every((account) => account.departmentId));
});

test("admin settings reject invalid departments and session duration", async () => {
  const response = await adminApi("/settings", {
    method: "POST",
    body: { departments: [], sessionDurationMinutes: 4 },
  });
  assert.equal(response.statusCode, 400);
});
```

- [ ] **Step 2: Run the new tests and verify RED**

Run: `node --test test/department-api.test.mjs`

Expected: FAIL because settings do not expose `departments` or `sessionDurationMinutes`.

- [ ] **Step 3: Implement normalized department settings**

Add these constants and normalizers in `api/[...path].mjs`:

```javascript
const defaultDepartment = { id: "data-product", name: "数据产品部", enabled: true };
const defaultSessionDurationMinutes = 30;
const minSessionDurationMinutes = 5;
const maxSessionDurationMinutes = 43_200;

function normalizeDepartments(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      id: safeId(item?.id || item?.name).toLowerCase(),
      name: String(item?.name || "").trim(),
      enabled: item?.enabled !== false,
    }))
    .filter((item) => item.id && item.name && !seen.has(item.id) && seen.add(item.id));
}

function normalizeSessionDurationMinutes(value, fallback = defaultSessionDurationMinutes) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= minSessionDurationMinutes && minutes <= maxSessionDurationMinutes
    ? minutes
    : fallback;
}
```

Extend `normalizeAccounts()` to retain `departmentId`. Change `defaultSettings()`, `getSettings()`, and `handleSettings()` so they validate department references, retain department-specific modules, and reject invalid submitted durations instead of silently replacing them.

- [ ] **Step 4: Migrate legacy state during hydration**

In `hydrateState()`, assign `data-product` to users, sessions, weeks, tasks, reports, goals, and AI usage entries that lack a department. Keep existing IDs and relationships unchanged. Save migrated state on the next mutation.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test test/department-api.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the settings model**

```bash
git add api/[...path].mjs test/department-api.test.mjs
git commit -m "feat: add department-aware settings"
```

### Task 2: Bind registration and sessions to one department

**Files:**
- Modify: `test/department-api.test.mjs`
- Modify: `api/[...path].mjs`
- Modify: `test/report-api.test.mjs`
- Modify: `test/persistence-api.test.mjs`

- [ ] **Step 1: Write failing registration and session tests**

Add tests for the required behavior:

```javascript
test("registration requires a configured account and binds its department", async () => {
  const username = uniqueUsername("finance");
  await saveDepartmentsAndAccounts([
    { id: "data-product", name: "数据产品部", enabled: true },
    { id: "finance", name: "财经部", enabled: true },
  ], [{ name: "财务测试", username, departmentId: "finance" }]);

  const registered = await api("/auth/register", {
    method: "POST",
    body: { username, password: "12345678", displayName: "财务测试" },
  });

  assert.equal(registered.statusCode, 201);
  assert.equal(registered.body.user.departmentId, "finance");
  assert.equal(registered.body.user.department.name, "财经部");
});

test("registration rejects a username missing from department accounts", async () => {
  const response = await api("/auth/register", {
    method: "POST",
    body: { username: uniqueUsername("unknown"), password: "12345678" },
  });
  assert.equal(response.statusCode, 403);
});
```

Add tests that assert disabled departments cannot log in and a new session expires within one second of `sessionDurationMinutes * 60_000` from the request time.

- [ ] **Step 2: Run the authentication tests and verify RED**

Run: `node --test test/department-api.test.mjs`

Expected: FAIL because registration is open and sessions use a fixed 30-minute duration.

- [ ] **Step 3: Implement account-bound authentication**

Update `publicUser()` to include `departmentId` and a public department summary. During registration, locate the configured account by normalized username and reject missing, invalid, or disabled department assignments. Save `departmentId` on the user and session.

During login, resolve the user's current department assignment, reject disabled departments, update legacy users with the configured assignment, and create the session with:

```javascript
const expiresAt = now + getSettings(state).sessionDurationMinutes * 60_000;
state.sessions[token] = { username, departmentId, createdAt: now, expiresAt };
```

- [ ] **Step 4: Require a valid session for business routes**

Add a helper that returns 401 for missing or expired sessions. Apply it before `weeks`, `week`, `task`, `reports`, `report`, `goals`, `accounts`, and AI routes. Keep `/auth/*` and `GET /settings` accessible before login. Keep admin settings writes protected by the existing admin credentials.

- [ ] **Step 5: Update existing API test setup**

In `test/report-api.test.mjs` and `test/persistence-api.test.mjs`, add a helper that first adds a unique username to the default department's account list, registers it, and passes its token to every business request. Preserve each existing assertion.

- [ ] **Step 6: Run authentication and regression tests**

Run: `node --test test/department-api.test.mjs test/report-api.test.mjs test/persistence-api.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit authentication changes**

```bash
git add api/[...path].mjs test/department-api.test.mjs test/report-api.test.mjs test/persistence-api.test.mjs
git commit -m "feat: bind users and sessions to departments"
```

### Task 3: Enforce department isolation on all business records

**Files:**
- Modify: `test/department-api.test.mjs`
- Modify: `api/[...path].mjs`

- [ ] **Step 1: Write a failing cross-department isolation test**

Create one user in `data-product` and one user in `finance`. With the first token, create a week, task, goals, and report. Assert that the second token cannot list or retrieve those records:

```javascript
assert.deepEqual(financeWeeks.body.weeks, []);
assert.equal(financeTask.statusCode, 404);
assert.deepEqual(financeReports.body.reports, []);
assert.deepEqual(financeGoals.body.rows, []);
```

Also assert that both departments may create the same week range and the same report period without ID collisions.

- [ ] **Step 2: Run the isolation test and verify RED**

Run: `node --test test/department-api.test.mjs`

Expected: FAIL because the current handlers read shared collections.

- [ ] **Step 3: Scope collection helpers by department**

Add helpers in `api/[...path].mjs`:

```javascript
function belongsToDepartment(record, departmentId) {
  return record?.departmentId === departmentId;
}

function departmentRecordId(departmentId, localId) {
  return `${departmentId}:${localId}`;
}
```

Use department-prefixed storage keys for weeks and goals. Keep each returned record's public `id` unchanged. Filter tasks, reports, accounts, and AI usage with the session department. Include `departmentId` on every newly created business record.

- [ ] **Step 4: Protect record mutations**

Before task, report, lock, unlock, delete, and rollover mutations, verify the stored record belongs to the session department. Return 404 on mismatch. Limit report-manager checks and edit-lock actors to the same department.

- [ ] **Step 5: Generate department-specific report titles and modules**

Resolve the active department name and modules from settings. Generate report titles as `${department.name}周重点工作汇报`, `${department.name}月度工作总结`, or `${department.name}季度工作总结`.

- [ ] **Step 6: Run all API tests and verify GREEN**

Run: `node --test test/*.test.mjs`

Expected: all tests PASS.

- [ ] **Step 7: Commit data isolation**

```bash
git add api/[...path].mjs test/department-api.test.mjs
git commit -m "feat: isolate workbench data by department"
```

### Task 4: Replace utility text buttons and add the site identity

**Files:**
- Create: `public/favicon.svg`
- Create: `test/workbench-ui.test.mjs`
- Modify: `public/index.html`

- [ ] **Step 1: Write failing static UI tests**

Read `public/index.html` and assert:

```javascript
assert.match(html, /<title>部门工作台<\/title>/);
assert.match(html, /<link rel="icon"[^>]+href="favicon\.svg"/);
assert.match(html, /id="adminEntryBtn"[^>]+aria-label="后台管理"/);
assert.match(html, /id="openOnboardingBtn"[^>]+aria-label="指引"/);
assert.doesNotMatch(adminButtonHtml, />\s*后台管理\s*</);
assert.doesNotMatch(guideButtonHtml, />\s*指引\s*</);
```

- [ ] **Step 2: Run the UI test and verify RED**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL because the old title and button text remain.

- [ ] **Step 3: Create the favicon**

Create `public/favicon.svg` as a blue rounded square with three white dashboard panels. Keep the SVG self-contained and readable at 16 × 16 pixels.

- [ ] **Step 4: Update title and icon-only buttons**

Set the document title to “部门工作台” and link `favicon.svg`. Replace the two button labels with inline SVG icons. Add `class="icon-btn"`, `title`, and `aria-label` to both buttons. Preserve the existing IDs and event listeners.

- [ ] **Step 5: Run the UI test and verify GREEN**

Run: `node --test test/workbench-ui.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the site identity**

```bash
git add public/index.html public/favicon.svg test/workbench-ui.test.mjs
git commit -m "feat: refresh workbench navigation identity"
```

### Task 5: Add login gating and dynamic department branding

**Files:**
- Modify: `test/workbench-ui.test.mjs`
- Modify: `public/index.html`

- [ ] **Step 1: Write failing client behavior assertions**

Assert that the HTML contains a stable brand target, no fixed `loginKeepAliveMs`, and code paths that use `currentUser.department.name` plus the API-provided `expiresAt`.

- [ ] **Step 2: Run the client assertions and verify RED**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL because the brand and login message remain hardcoded.

- [ ] **Step 3: Implement the login gate**

On startup, load public settings, validate the stored token through `/api/auth/me`, and load weeks, goals, tasks, reports, and accounts only when a valid user exists. If no valid user exists, open the login modal and keep business pages hidden.

When any API returns 401, clear local user, token, and expiry values, stop business loading, and reopen the login modal. Do not treat 401 as an invalid collaboration key.

- [ ] **Step 4: Render department-aware labels**

Give the brand heading an ID and set it to `${currentUser.department.name}工作台` after login or “部门工作台” before login. Build report titles from the active department name. Replace fixed 30-minute login success messages with text derived from the returned expiry.

- [ ] **Step 5: Run UI and API regression tests**

Run: `node --test test/*.test.mjs`

Expected: all tests PASS.

- [ ] **Step 6: Commit client authentication behavior**

```bash
git add public/index.html test/workbench-ui.test.mjs
git commit -m "feat: gate workbench data behind department login"
```

### Task 6: Add department and session controls to the admin page

**Files:**
- Modify: `test/workbench-ui.test.mjs`
- Modify: `public/index.html`

- [ ] **Step 1: Write failing admin markup assertions**

Assert the page contains `adminDepartmentsList`, `adminDepartmentModulesSelect`, a department selector for every account draft row, and `adminSessionDurationMinutes` with `min="5"` and `max="43200"`.

- [ ] **Step 2: Run the admin UI test and verify RED**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL because the controls do not exist.

- [ ] **Step 3: Add department administration**

Add a department card with name and enabled controls. Generate a stable department ID when the admin adds a department. Existing department IDs remain immutable. Prevent disabling the last enabled department in the client and rely on server validation as the authority.

- [ ] **Step 4: Make modules and accounts department-aware**

Add a department selector above the module list and edit the selected department's `modules`. Add a department selector to every account row and include `departmentId` when normalizing and saving drafts.

- [ ] **Step 5: Add the session duration field**

Add a numeric field labeled “登录保持时间（分钟）” with limits 5 and 43200. Include the integer value in the settings payload and show the backend validation error without discarding the draft.

- [ ] **Step 6: Run all tests and verify GREEN**

Run: `node --test test/*.test.mjs`

Expected: all tests PASS.

- [ ] **Step 7: Commit admin controls**

```bash
git add public/index.html test/workbench-ui.test.mjs
git commit -m "feat: manage departments and login duration"
```

### Task 7: Verify both deployment adapters and the finished workflow

**Files:**
- Modify only if a verification failure identifies a scoped defect

- [ ] **Step 1: Run the full automated suite**

Run: `node --test test/*.test.mjs`

Expected: all tests PASS with no warnings or unhandled rejections.

- [ ] **Step 2: Start the local server**

Run: `node scripts/static-server.mjs`

Expected: the server announces `http://127.0.0.1:4177`.

- [ ] **Step 3: Verify the browser workflow**

Check the logged-out gate, registration against a configured account, department branding, icon tooltips, department-specific tasks and goals, admin department editing, and session-duration validation. Confirm the favicon and browser title display correctly.

- [ ] **Step 4: Verify the Netlify adapter contract**

Run the API tests with `NETLIFY` unset so `netlify/functions/api.mjs` continues to delegate to the same primary handler without route changes.

- [ ] **Step 5: Review the final diff**

Run: `git diff --check HEAD~6..HEAD`

Expected: no whitespace errors. Confirm the diff only contains the approved design, API behavior, tests, `public/index.html`, and `public/favicon.svg`.
