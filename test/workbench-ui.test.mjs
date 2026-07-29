import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

function buttonMarkup(id) {
  const match = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`));
  assert.ok(match, `missing ${id}`);
  return match[0];
}

test("workbench uses the generic page title and custom favicon", () => {
  assert.match(html, /<title>部门工作台<\/title>/);
  assert.match(html, /<link rel="icon"[^>]+href="favicon\.svg"/);
  assert.doesNotMatch(html, /<div class="logo">DP<\/div>/);
});

test("admin and guide navigation use accessible icon-only buttons", () => {
  const adminButton = buttonMarkup("adminEntryBtn");
  const guideButton = buttonMarkup("openOnboardingBtn");

  assert.match(adminButton, /class="[^"]*icon-btn/);
  assert.match(adminButton, /aria-label="后台管理"/);
  assert.match(adminButton, /<svg/);
  assert.doesNotMatch(adminButton, />\s*后台管理\s*</);

  assert.match(guideButton, /class="[^"]*icon-btn/);
  assert.match(guideButton, /aria-label="指引"/);
  assert.match(guideButton, /<svg/);
  assert.doesNotMatch(guideButton, />\s*指引\s*</);
});

test("client branding and login lifetime come from authenticated server data", () => {
  assert.match(html, /id="brandTitle"/);
  assert.match(html, /currentUser\?\.department\?\.name|currentUser\.department\.name/);
  assert.doesNotMatch(html, /const loginKeepAliveMs/);
  assert.doesNotMatch(html, /本次登录将保持30分钟/);
});

test("admin page exposes department and session duration controls", () => {
  assert.match(html, /id="adminDepartmentsList"/);
  assert.match(html, /id="adminDepartmentModulesSelect"/);
  assert.match(html, /data-admin-account-department/);
  assert.match(html, /id="adminSessionDurationMinutes"[^>]+min="5"[^>]+max="43200"/);
});

test("data product starter goals are not copied into other departments", () => {
  assert.match(html, /currentDepartment\(\)\.id === defaultDepartment\.id/);
  assert.match(html, /function defaultGoalsForCurrentDepartment/);
});

test("admin credentials are entered by the operator and are not hard-coded", () => {
  assert.doesNotMatch(html, /默认账号|默认密码|888888/);
  assert.doesNotMatch(html, /"x-admin-user":\s*"Admin"/);
  assert.match(html, /adminSessionStorageKey = `\$\{storageKey\}-admin-session`/);
  assert.match(html, /sessionStorage\.setItem\(adminSessionStorageKey/);
  assert.match(html, /adminRequestHeaders\(\)/);
  assert.doesNotMatch(html, /x-admin-password/);
});

test("unauthenticated visitors see a dedicated login page without sync keys", () => {
  assert.match(html, /id="loginView"/);
  assert.match(html, /id="workspaceShell"[^>]+hidden/);
  assert.match(html, /id="loginForm"/);
  assert.doesNotMatch(html, /syncKeyStorageKey|getSyncKey|x-report-key|周报协同口令/);
});

test("registration and password help are dedicated authentication views", () => {
  assert.match(html, /id="registerView"/);
  assert.match(html, /id="registerForm"/);
  assert.match(html, /id="registerConfirmPassword"/);
  assert.match(html, /id="registerMessage"[^>]+aria-live="polite"/);
  assert.match(html, /id="forgotPasswordView"/);
  assert.match(html, /id="loginForgotPasswordBtn"/);
  assert.match(html, /id="loginUsername"[^>]+name="username"/);
  assert.match(html, /id="loginPassword"[^>]+name="password"/);
  assert.match(html, /id="registerDisplayName"[^>]+name="displayName"/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(html, /id="showRegisterBtn"/);
  assert.doesNotMatch(html, /id="displayNameField"/);
});

test("registration returns to login without storing a session", () => {
  assert.match(html, /注册成功，请重新登录/);
  assert.match(html, /showAuthView\("login"/);
  assert.match(html, /async function registerAccount/);
  assert.doesNotMatch(html, /action === "register"[\s\S]{0,800}localStorage\.setItem\(userTokenStorageKey/);
});

test("login page shows the configured session duration directly", () => {
  assert.match(html, /id="loginDurationHint"/);
  assert.match(html, /保持登录：/);
  assert.match(html, /function formatSessionDuration/);
  assert.doesNotMatch(html, /登录状态将按后台设置的时间保持/);
});

test("admin account management exposes registered-user password reset", () => {
  assert.match(html, /data-admin-reset-password/);
  assert.match(html, /id="adminResetPasswordModal"/);
  assert.match(html, /id="adminResetPassword"/);
  assert.match(html, /id="adminResetPasswordConfirm"/);
  assert.match(html, /\/api\/admin\/users\/\$\{encodeURIComponent\(adminResetUsername\)\}\/reset-password/);
});

test("report import shows all permitted department tasks with a this-week/all scope toggle", () => {
  assert.match(html, /let reportImportTasks = \[\]/);
  assert.match(html, /let reportImportState = "idle"/);
  assert.match(html, /apiJson\("\/api\/tasks"\)/);
  assert.match(html, /id="reportImportScopeFilter"/);
  assert.match(html, /<option value="week" selected>本周有更新<\/option>/);
  assert.match(html, /正在加载待办/);
  assert.match(html, /当前周期和模块暂无可导入待办/);
  assert.match(html, /data-retry-report-task-import/);
  assert.match(html, /reportImportTasks[\s\S]{0,500}\.filter\(\(task\) => task\.module === moduleName\)/);
  assert.match(html, /scope === "all" \|\| dateInWeek/);
});

test("admin uses categorized settings and safe AI key controls", () => {
  for (const section of ["departments", "modules", "accounts", "ai", "session"]) {
    assert.match(html, new RegExp(`data-admin-section="${section}"`));
  }
  assert.match(html, /id="adminAiApiKey"/);
  assert.match(html, /id="adminAiTestBtn"/);
  assert.match(html, /id="adminAiClearBtn"/);
  assert.match(html, /adminDirty/);
});
