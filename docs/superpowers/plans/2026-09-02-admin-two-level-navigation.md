# Admin Two-Level Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the backend admin center into three top-level navigation groups with six role-aware second-level pages, while merging related content and preserving existing permissions and APIs.

**Architecture:** Keep the existing single-page architecture and API contracts. Add a small declarative navigation map in `public/index.html`, reuse the existing admin panels and controls under new shared page shells, and track dirty state per second-level page so each page can save independently without discarding drafts on other pages.

**Tech Stack:** Native HTML/CSS/JavaScript, Node.js ESM, `node:test`, existing admin settings and leader APIs.

---

## File map

- Modify `PRD.MD`: replace the superseded five-domain admin-center description with the confirmed three-group navigation and page/role rules.
- Modify `public/index.html`: add two-level navigation, merge page shells, update role-aware rendering, add per-page draft/save state, and preserve dangerous-operation confirmations.
- Modify `test/workbench-ui.test.mjs`: replace legacy section assertions and add navigation, role, merged-page, dirty-state, and responsive-layout regression coverage.

No backend API, persistence schema, authorization module, or build configuration changes are required.

### Task 1: Synchronize the confirmed product behavior

**Files:**
- Modify: `PRD.MD:66-71`

- [ ] **Step 1: Replace the old five-domain admin-center requirements**

Replace the current `后台管理中心` items with:

```markdown
### 后台管理中心

1. 后台使用两级导航：一级导航位于顶部，二级导航位于内容区左侧；窄屏下两级导航均可横向滚动。
2. 一级导航固定为“组织管理、规则配置、系统运维”。组织管理包含“部门管理、成员管理”，规则配置包含“保持登录、归档设置”，系统运维包含“API 密钥、定时任务”。
3. “部门管理”合并部门基础信息、负责人、启停状态和工作模块；“成员管理”合并成员账号、所属部门、角色、负责模块、启停和密码重置。
4. “项目类型”在界面中统一命名为“工作模块”；底层字段和历史数据保持兼容，不执行数据迁移。
5. 全局管理员可访问全部导航。部门负责人只显示“组织管理”，可维护本部门工作模块及成员角色、负责模块、启停和密码，不可新增或删除成员账号。
6. 每个二级页面独立保存配置。切换页面保留未保存草稿并标记对应菜单；保存失败保留输入并显示原因。
7. 清除 API 密钥和人工补跑继续要求显式确认，菜单可见性不替代服务端权限校验。
```

- [ ] **Step 2: Review the surrounding PRD for contradictions**

Run:

```powershell
rg -n -m 80 "五个职责域|组织与权限|业务配置|系统与安全|运行中心|项目类型|工作模块|后台管理中心" PRD.MD
```

Expected: no remaining requirement describes the replaced five-domain navigation; historical changelog text may remain only if clearly historical.

- [ ] **Step 3: Commit the product requirement update**

```powershell
git add -- PRD.MD
git commit -m "docs: define admin two-level navigation"
```

### Task 2: Add failing tests for the new information architecture

**Files:**
- Modify: `test/workbench-ui.test.mjs:564-606`
- Test: `test/workbench-ui.test.mjs`

- [ ] **Step 1: Replace the legacy categorized-settings test**

Use explicit group and section contracts:

```js
test("admin uses three top-level groups and six second-level pages", () => {
  for (const group of ["organization", "rules", "operations"]) {
    assert.match(html, new RegExp(`data-admin-group="${group}"`));
  }
  for (const section of ["departments", "members", "login", "archive", "api-key", "scheduled-tasks"]) {
    assert.match(html, new RegExp(`data-admin-section="${section}"`));
    assert.match(html, new RegExp(`data-admin-panel="${section}"`));
  }
  assert.match(html, /组织管理/);
  assert.match(html, /规则配置/);
  assert.match(html, /系统运维/);
  assert.match(html, /部门管理/);
  assert.match(html, /成员管理/);
  assert.match(html, /保持登录/);
  assert.match(html, /归档设置/);
  assert.match(html, /API 密钥/);
});

test("admin navigation maps groups to their default and remembered sections", () => {
  assert.match(html, /organization:\s*"departments"/);
  assert.match(html, /rules:\s*"login"/);
  assert.match(html, /operations:\s*"api-key"/);
  assert.match(html, /adminLastSectionByGroup\[adminActiveGroup\]/);
});
```

- [ ] **Step 2: Replace the leader-only legacy-section assertions**

Keep the API coverage and assert the new navigation boundary:

```js
test("a department leader only gets organization management scoped to their department", () => {
  assert.match(html, /let adminRole = adminSession\.role === "leader" \? "leader" : "admin"/);
  assert.match(html, /function renderLeaderAdmin\(\)/);
  assert.match(html, /async function loadLeaderWorkspace\(\)/);
  assert.match(html, /\/api\/admin\/leader\/accounts/);
  assert.match(html, /\/api\/admin\/leader\/modules/);
  assert.match(html, /adminRole === "leader"[\s\S]{0,300}group\.id === "organization"/);
  assert.match(html, /data-leader-account-enabled=/);
  assert.doesNotMatch(html, /data-admin-section="leader-accounts"/);
  assert.doesNotMatch(html, /data-admin-section="leader-modules"/);
});
```

- [ ] **Step 3: Add merged-page, dirty-state, and responsive assertions**

```js
test("admin merged pages keep the existing controls under the new sections", () => {
  assert.match(html, /data-admin-panel="departments"[\s\S]*id="adminDepartmentsList"[\s\S]*id="adminModulesList"/);
  assert.match(html, /data-admin-panel="members"[\s\S]*id="adminAccountsList"/);
  assert.match(html, /data-admin-panel="login"[\s\S]*id="adminSessionDurationMinutes"/);
  assert.match(html, /data-admin-panel="archive"[\s\S]*id="adminWeeklyArchiveTime"/);
  assert.match(html, /data-admin-panel="api-key"[\s\S]*id="adminAiApiKey"/);
});

test("admin tracks unsaved settings by second-level page", () => {
  assert.match(html, /new Set\(\)/);
  assert.match(html, /markAdminDirty\("departments"/);
  assert.match(html, /markAdminDirty\("members"/);
  assert.match(html, /markAdminDirty\("login"/);
  assert.match(html, /markAdminDirty\("archive"/);
  assert.match(html, /markAdminDirty\("api-key"/);
  assert.match(html, /classList\.toggle\("dirty"/);
});

test("admin navigation becomes horizontally scrollable on narrow screens", () => {
  assert.match(html, /@media\(max-width:900px\)[\s\S]*\.admin-primary-nav[\s\S]*overflow-x:auto/);
  assert.match(html, /@media\(max-width:900px\)[\s\S]*\.settings-nav[\s\S]*overflow-x:auto/);
});
```

- [ ] **Step 4: Run the focused test and confirm RED**

Run:

```powershell
node --test test/workbench-ui.test.mjs
```

Expected: FAIL only in the new navigation/merged-page tests because the legacy markup and single dirty flag still exist.

### Task 3: Implement the two-level navigation and merged page shells

**Files:**
- Modify: `public/index.html:52-53`
- Modify: `public/index.html:370-460`
- Modify: `public/index.html:842-854`
- Modify: `public/index.html:3923-4028`
- Modify: `public/index.html:5079-5092`
- Test: `test/workbench-ui.test.mjs`

- [ ] **Step 1: Add desktop and narrow-screen navigation styles**

Add these focused styles beside the existing `.settings-center` rules:

```css
.admin-primary-nav{display:flex;gap:6px;margin-bottom:14px;padding:6px;border:1px solid var(--line);border-radius:12px;background:#fff;overflow-x:auto}
.admin-primary-nav button{flex:0 0 auto;border:0;background:transparent;color:#475467;border-radius:9px;padding:10px 16px;cursor:pointer;font-weight:700;white-space:nowrap}
.admin-primary-nav button:hover{background:#f5f7fb;color:var(--text)}
.admin-primary-nav button.active{background:var(--primary-soft);color:var(--primary)}
.settings-nav button.dirty:after{content:"";display:inline-block;width:7px;height:7px;margin-left:7px;border-radius:50%;background:var(--orange);vertical-align:middle}
@media(max-width:900px){.admin-primary-nav{overflow-x:auto}.settings-center{grid-template-columns:1fr}.settings-nav{position:static;display:flex;overflow-x:auto}.settings-nav button{flex:0 0 auto;white-space:nowrap}.settings-center+.admin-savebar{margin-left:0}}
```

- [ ] **Step 2: Replace the legacy navigation markup**

Put the primary navigation before `.settings-center`, and use only the six confirmed secondary buttons:

```html
<nav class="admin-primary-nav" aria-label="后台一级导航">
  <button class="active" data-admin-group="organization" aria-current="page">组织管理</button>
  <button data-admin-group="rules">规则配置</button>
  <button data-admin-group="operations">系统运维</button>
</nav>
<div class="settings-center">
  <nav class="settings-nav panel" aria-label="后台二级导航">
    <button class="active" data-admin-group="organization" data-admin-section="departments" aria-current="page">部门管理</button>
    <button data-admin-group="organization" data-admin-section="members">成员管理</button>
    <button data-admin-group="rules" data-admin-section="login">保持登录</button>
    <button data-admin-group="rules" data-admin-section="archive">归档设置</button>
    <button data-admin-group="operations" data-admin-section="api-key">API 密钥</button>
    <button data-admin-group="operations" data-admin-section="scheduled-tasks">定时任务</button>
  </nav>
  <div class="settings-editor">
  </div>
</div>
```

Insert the six page shells from Step 3 inside `.settings-editor`; the empty container above only shows the exact navigation nesting.

- [ ] **Step 3: Re-home existing controls into six shared page shells**

Move the existing control blocks without renaming their element IDs:

```text
departments: adminDepartmentsList + adminDepartmentModulesSelect + adminModulesList + leaderModulesList
members: adminAccountsList + leaderAccountsList
login: adminSessionDurationMinutes
archive: adminWeeklyArchiveTime + adminMonthlyArchiveTime + adminQuarterlyArchiveTime
api-key: adminAiProvider + adminAiModel + adminAiEnabled + adminAiApiKey + adminAiKeyStatus + adminAiTestBtn + adminAiClearBtn + adminAiEnvHint
scheduled-tasks: reloadScheduledTasksBtn + scheduledTaskList
```

Each shell must use exactly one of these attributes:

```html
data-admin-panel="departments"
data-admin-panel="members"
data-admin-panel="login"
data-admin-panel="archive"
data-admin-panel="api-key"
data-admin-panel="scheduled-tasks"
```

Within `departments` and `members`, use `adminDepartmentManagementBody`, `leaderDepartmentManagementBody`, `adminMemberManagementBody`, and `leaderMemberManagementBody` wrappers. Put a read-only `<div id="leaderDepartmentSummary"></div>` before `leaderModulesList`, and render it with `currentDepartment().name`. Toggle these four wrappers from the global and leader render functions. Delete the old `leader-accounts`, `leader-modules`, `modules`, `accounts`, `ai`, and `session` panel attributes after their controls have moved.

- [ ] **Step 4: Add the declarative navigation state**

Replace `adminActiveSection` initialization with:

```js
const adminNavigation = [
  { id: "organization", sections: ["departments", "members"] },
  { id: "rules", sections: ["login", "archive"] },
  { id: "operations", sections: ["api-key", "scheduled-tasks"] },
];
const adminGroupDefaults = { organization: "departments", rules: "login", operations: "api-key" };
let adminActiveGroup = "organization";
let adminActiveSection = "departments";
let adminLastSectionByGroup = { ...adminGroupDefaults };
```

Add a role filter and one navigation renderer:

```js
function adminVisibleGroups() {
  return adminRole === "leader"
    ? adminNavigation.filter((group) => group.id === "organization")
    : adminNavigation;
}

function renderAdminNavigation() {
  const visibleGroups = adminVisibleGroups();
  if (!visibleGroups.some((group) => group.id === adminActiveGroup)) adminActiveGroup = "organization";
  const activeGroup = visibleGroups.find((group) => group.id === adminActiveGroup);
  if (!activeGroup.sections.includes(adminActiveSection)) {
    adminActiveSection = adminLastSectionByGroup[adminActiveGroup] || adminGroupDefaults[adminActiveGroup];
  }
  document.querySelectorAll(".admin-primary-nav [data-admin-group]").forEach((button) => {
    const visible = visibleGroups.some((group) => group.id === button.dataset.adminGroup);
    button.hidden = !visible;
    const active = visible && button.dataset.adminGroup === adminActiveGroup;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  document.querySelectorAll(".settings-nav [data-admin-section]").forEach((button) => {
    const visible = activeGroup.sections.includes(button.dataset.adminSection);
    button.hidden = !visible;
    const active = visible && button.dataset.adminSection === adminActiveSection;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.adminPanel !== adminActiveSection;
  });
}
```

- [ ] **Step 5: Wire primary and secondary navigation clicks**

```js
document.querySelector(".admin-primary-nav").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-admin-group]");
  if (!button || button.hidden) return;
  adminActiveGroup = button.dataset.adminGroup;
  adminActiveSection = adminLastSectionByGroup[adminActiveGroup] || adminGroupDefaults[adminActiveGroup];
  if (adminActiveSection === "scheduled-tasks") await loadScheduledTasks().catch((error) => setSyncStatus(error.message || "定时任务状态读取失败", "warn"));
  renderAdmin();
});

document.querySelector(".settings-nav").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-admin-section]");
  if (!button || button.hidden) return;
  adminActiveSection = button.dataset.adminSection;
  adminActiveGroup = button.dataset.adminGroup;
  adminLastSectionByGroup[adminActiveGroup] = adminActiveSection;
  if (adminActiveSection === "scheduled-tasks") await loadScheduledTasks().catch((error) => setSyncStatus(error.message || "定时任务状态读取失败", "warn"));
  renderAdmin();
});
```

- [ ] **Step 6: Update global and leader rendering**

Call `renderAdminNavigation()` from both `renderAdmin()` and `renderLeaderAdmin()`. Global rendering fills `adminDepartmentsList`, `adminModulesList`, and `adminAccountsList`; leader rendering fills `leaderModulesList` and `leaderAccountsList`. Toggle the two role-specific bodies inside `departments` and `members`, while keeping department information read-only for leaders.

Use these role toggles and leader summary:

```js
$("adminDepartmentManagementBody").hidden = adminRole === "leader";
$("leaderDepartmentManagementBody").hidden = adminRole !== "leader";
$("adminMemberManagementBody").hidden = adminRole === "leader";
$("leaderMemberManagementBody").hidden = adminRole !== "leader";
$("leaderDepartmentSummary").textContent = `当前部门：${currentDepartment().name}`;
```

After successful admin login, reset navigation consistently:

```js
adminActiveGroup = "organization";
adminActiveSection = "departments";
adminLastSectionByGroup = { ...adminGroupDefaults };
```

- [ ] **Step 7: Run the focused tests**

Run:

```powershell
node --test test/workbench-ui.test.mjs
```

Expected: navigation, merged-page, role, and responsive tests PASS; dirty-state tests remain failing until Task 4.

- [ ] **Step 8: Commit the navigation and page merge**

```powershell
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "feat: reorganize admin navigation"
```

### Task 4: Make save and draft state page-specific

**Files:**
- Modify: `public/index.html:854`
- Modify: `public/index.html:4030-4100`
- Modify: `public/index.html:4890-5170`
- Modify: `test/workbench-ui.test.mjs`
- Test: `test/workbench-ui.test.mjs`

- [ ] **Step 1: Replace the global dirty flag with section state**

```js
const adminDirtySections = new Set();
const adminSectionFields = {
  departments: ["departments"],
  members: ["accounts"],
  login: ["sessionDurationMinutes"],
  archive: ["reportArchive"],
  "api-key": ["ai"],
};
let adminPersistedSettings = structuredClone(adminDraftSettings);
```

Replace `markAdminDirty` with:

```js
function markAdminDirty(section, message = "存在未保存修改") {
  adminDirtySections.add(section);
  $("adminSaveHint").textContent = message;
  renderAdminNavigation();
  document.querySelector(".admin-savebar").hidden = !adminDirtySections.has(adminActiveSection);
}
```

In `renderAdminNavigation`, add:

```js
button.classList.toggle("dirty", adminDirtySections.has(button.dataset.adminSection));
```

- [ ] **Step 2: Route every existing change event to its page**

Use these exact calls:

```js
markAdminDirty("departments"); // department name, enabled, leader, module add/edit/remove
markAdminDirty("members"); // account add/edit/remove, department, role, managed modules, enabled
markAdminDirty("login"); // adminSessionDurationMinutes
markAdminDirty("archive"); // weekly/monthly/quarterly archive time
markAdminDirty("api-key"); // provider, model, enabled, API key input
```

- [ ] **Step 3: Build a payload for only the active page and preserve other drafts**

```js
function copyAdminSection(target, source, section) {
  for (const field of adminSectionFields[section] || []) target[field] = structuredClone(source[field]);
}

function adminSectionPayload(section) {
  const payload = structuredClone(adminPersistedSettings);
  copyAdminSection(payload, adminDraftSettings, section);
  if (section === "api-key") {
    const apiKey = $("adminAiApiKey").value.trim();
    if (apiKey) payload.ai = { ...payload.ai, apiKey };
  }
  return payload;
}

function rebaseUnsavedAdminSections(savedSettings, savedSection, draftBeforeSave) {
  adminPersistedSettings = structuredClone(savedSettings);
  adminDraftSettings = structuredClone(savedSettings);
  for (const section of adminDirtySections) {
    if (section !== savedSection) copyAdminSection(adminDraftSettings, draftBeforeSave, section);
  }
}
```

When `loadSettings({ admin: true })` succeeds, capture the server baseline and clear stale dirty markers:

```js
if (admin) {
  adminPersistedSettings = structuredClone(adminDraftSettings);
  adminDirtySections.clear();
}
```

In `renderAdmin()`, replace the old Boolean save-bar rule with:

```js
document.querySelector(".admin-savebar").hidden = !adminDirtySections.has(adminActiveSection);
```

- [ ] **Step 4: Save only the active page**

Refactor `saveAdminSettings()` to accept a section:

```js
async function saveAdminSettings(section = adminActiveSection) {
  if (!adminSectionFields[section]) return;
  if (section === "members" && adminDirtySections.has("departments")) {
    throw new Error("请先保存部门管理，再保存成员管理");
  }
  if (section === "departments") {
    adminDraftSettings.departments = normalizeDepartmentsList(adminDraftSettings.departments);
  }
  if (section === "members") {
    adminDraftSettings.accounts = normalizeAccountsList(adminDraftSettings.accounts);
  }
  if (section === "login") {
    adminDraftSettings.sessionDurationMinutes = Number($("adminSessionDurationMinutes").value);
    if (!Number.isInteger(adminDraftSettings.sessionDurationMinutes) || adminDraftSettings.sessionDurationMinutes < 5 || adminDraftSettings.sessionDurationMinutes > 43200) {
      throw new Error("登录保持时间必须是 5 到 43200 分钟之间的整数");
    }
  }
  if (section === "archive") {
    adminDraftSettings.reportArchive = {
      timezone: "Asia/Shanghai",
      weeklyTime: $("adminWeeklyArchiveTime").value || "20:00",
      monthlyTime: $("adminMonthlyArchiveTime").value || "20:00",
      quarterlyTime: $("adminQuarterlyArchiveTime").value || "20:00",
    };
  }
  if (section === "api-key") {
    adminDraftSettings.ai = {
      enabled: adminDraftSettings.ai?.enabled === true,
      provider: adminDraftSettings.ai?.provider === "kimi" ? "kimi" : "deepseek",
      model: String(adminDraftSettings.ai?.model || "").trim(),
    };
  }
  const draftBeforeSave = structuredClone(adminDraftSettings);
  const payload = adminSectionPayload(section);
  const result = await apiJson("/api/admin/settings", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...adminRequestHeaders(),
    },
    body: JSON.stringify(payload),
  });
  const savedSettings = result.settings || payload;
  applySettings(savedSettings);
  rebaseUnsavedAdminSections(adminDraftSettings, section, draftBeforeSave);
  adminDirtySections.delete(section);
  if (section === "api-key") $("adminAiApiKey").value = "";
  setSyncStatus("当前页面配置已保存", "ok");
  renderAdmin();
}
```

On rejection, do not delete the section from `adminDirtySections`.

- [ ] **Step 5: Make reload page-specific**

```js
function reloadAdminSection(section = adminActiveSection) {
  copyAdminSection(adminDraftSettings, adminPersistedSettings, section);
  adminDirtySections.delete(section);
  if (section === "api-key") $("adminAiApiKey").value = "";
  renderAdmin();
  setSyncStatus("当前页面修改已撤销", "ok");
}

$("adminReloadBtn").addEventListener("click", () => reloadAdminSection());
$("adminSaveBtn").addEventListener("click", () => saveAdminSettings().catch((error) => {
  setSyncStatus(error.message || "配置保存失败", "warn");
  renderAdmin();
}));
```

- [ ] **Step 6: Preserve existing safety confirmations**

Keep the existing `confirm("确认清除当前 AI API 密钥？清除后 AI 功能将停用。")`. Keep scheduled-task confirmation and ensure report archive text states that only due, unfinished reports are handled and no report is archived early.

- [ ] **Step 7: Run the focused test and confirm GREEN**

Run:

```powershell
node --test test/workbench-ui.test.mjs
```

Expected: all tests in `test/workbench-ui.test.mjs` PASS.

- [ ] **Step 8: Commit page-specific saving**

```powershell
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "feat: save admin settings by page"
```

### Task 5: Independent verification and handoff

**Files:**
- Verify: `PRD.MD`
- Verify: `public/index.html`
- Verify: `test/workbench-ui.test.mjs`

- [ ] **Step 1: Run the focused UI suite**

```powershell
node --test test/workbench-ui.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run the production build check**

```powershell
npm.cmd run build
```

Expected: exit code 0 and the inline browser script validates successfully.

- [ ] **Step 3: Inspect the actual diff**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only the three planned files are changed by this feature, while pre-existing unrelated files remain untouched.

- [ ] **Step 4: Perform targeted browser checks**

Verify at desktop and below 900 px:

```text
Global admin: three top groups; 2/2/2 child pages; remembered child per group.
Department leader: only Organization; department modules and member controls work; no create/delete account controls.
Dirty draft: edit two pages, switch between them, save one page, confirm the other remains marked and retains its value.
Failure: force one settings request to fail, confirm the draft and dirty marker remain.
Safety: API-key clear and scheduled-task rerun both require confirmation.
```

- [ ] **Step 5: Commit any verification-only test correction if required**

Only if verification exposed a test defect, stage the exact test file and commit it separately:

```powershell
git add -- test/workbench-ui.test.mjs
git commit -m "test: cover admin navigation regression"
```

If no correction is required, do not create an empty commit.
