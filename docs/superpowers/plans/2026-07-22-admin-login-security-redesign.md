# 后台、登录与密钥管理优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建账号密码优先的独立登录页、可用的后台设置中心，以及可由管理员安全维护的 AI API 密钥。

**Architecture:** 取消浏览器与业务 API 的全局同步口令门槛，普通业务接口统一依赖用户会话。管理员首次认证后换取独立短期令牌；AI 密钥由独立加密模块使用 AES-256-GCM 加密并写入现有 CloudBase 状态，接口只返回脱敏信息。

**Tech Stack:** Node.js ESM、原生 Web Crypto、CloudBase Node SDK、原生 HTML/CSS/JavaScript、Node test runner。

---

## 文件职责

- `lib/admin-session.mjs`：签发和校验短期管理员令牌，不读取业务状态。
- `lib/encrypted-secret.mjs`：加密、解密和脱敏 AI API 密钥，不处理 HTTP。
- `api/[...path].mjs`：路由、用户/管理员鉴权、设置保存和 AI 连接测试。
- `public/index.html`：独立登录页、工作台登录门禁和后台设置中心交互。
- `test/admin-session.test.mjs`：管理员令牌单元测试。
- `test/encrypted-secret.test.mjs`：密钥加密单元测试。
- `test/department-api.test.mjs`：普通登录、设置与管理员 API 集成测试。
- `test/report-api.test.mjs`：AI 密钥读取、替换和失败保护测试。
- `test/workbench-ui.test.mjs`：登录页和后台界面静态行为测试。
- `test/production-server.test.mjs`：生产服务器无需同步口令的路由验证。

### Task 1: 移除同步口令并收紧用户会话边界

**Files:**
- Modify: `api/[...path].mjs`
- Modify: `test/department-api.test.mjs`
- Modify: `test/production-server.test.mjs`
- Modify: `test/runtime-config.test.mjs`

- [ ] **Step 1: 写失败测试，证明登录无需同步口令且业务接口仍需用户会话**

```js
test("login does not require the legacy report sync key", async () => {
  const response = await api("/auth/login", {
    method: "POST",
    body: { username: "zhongnanhai", password: "password123" },
    includeSyncKey: false,
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.token);
});

test("business data still requires a user session", async () => {
  const response = await api("/weeks", { includeSyncKey: false });
  assert.equal(response.status, 401);
  assert.equal(response.body.error, "请先登录");
});
```

- [ ] **Step 2: 运行测试并确认因全局 `requireKey` 失败**

Run: `node --test test/department-api.test.mjs test/production-server.test.mjs test/runtime-config.test.mjs`

Expected: FAIL，登录请求返回 `Unauthorized` 或运行配置仍强制要求 `REPORT_SYNC_KEY`。

- [ ] **Step 3: 将公开路由与会话保护写入 API 路由**

```js
export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  const state = await loadState();
  const now = Date.now();
  const parts = routeParts(req);
  const actor = currentUser(req, state, now);
  if (parts[0] === "auth") return handleAuth(req, res, state, parts[1], now);
  if (parts[0] === "settings" && req.method === "GET") return handleSettings(req, res, state, now);
  if (parts[0] === "admin") return handleAdmin(req, res, state, parts, now);
  if (!actor) return json(res, { error: "请先登录" }, 401);
  return handleAuthenticatedRoute(req, res, state, parts, now, actor);
}
```

同时从 `requiredRuntimeConfig()` 中移除 `REPORT_SYNC_KEY`，保留旧变量但不再读取。

- [ ] **Step 4: 运行目标测试确认通过**

Run: `node --test test/department-api.test.mjs test/production-server.test.mjs test/runtime-config.test.mjs`

Expected: PASS，登录无同步口令，未登录业务请求为 401。

- [ ] **Step 5: 提交同步口令移除改动**

```bash
git add api/[...path].mjs lib/runtime-config.mjs test/department-api.test.mjs test/production-server.test.mjs test/runtime-config.test.mjs
git commit -m "Remove sync key from user authentication"
```

### Task 2: 管理员短期会话

**Files:**
- Create: `lib/admin-session.mjs`
- Create: `test/admin-session.test.mjs`
- Modify: `api/[...path].mjs`
- Modify: `test/department-api.test.mjs`

- [ ] **Step 1: 写管理员令牌失败测试**

```js
test("admin tokens are signed, expire, and reject tampering", async () => {
  const env = { ADMIN_SESSION_SECRET: "a".repeat(64) };
  const token = await issueAdminToken({ username: "admin", now: 1000, ttlMs: 60_000, env });
  assert.equal((await verifyAdminToken(token, { now: 2000, env })).username, "admin");
  assert.equal(await verifyAdminToken(`${token}x`, { now: 2000, env }), null);
  assert.equal(await verifyAdminToken(token, { now: 62_000, env }), null);
});
```

- [ ] **Step 2: 运行测试确认模块尚不存在**

Run: `node --test test/admin-session.test.mjs`

Expected: FAIL，无法导入 `lib/admin-session.mjs`。

- [ ] **Step 3: 实现 HMAC-SHA256 管理员令牌**

```js
export async function issueAdminToken({ username, now = Date.now(), ttlMs = 30 * 60_000, env = process.env }) {
  const payload = base64url(JSON.stringify({ username, issuedAt: now, expiresAt: now + ttlMs }));
  return `${payload}.${await sign(payload, env.ADMIN_SESSION_SECRET)}`;
}

export async function verifyAdminToken(token, { now = Date.now(), env = process.env } = {}) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || !(await timingSafeSignature(payload, signature, env.ADMIN_SESSION_SECRET))) return null;
  const decoded = JSON.parse(fromBase64url(payload));
  return decoded.expiresAt > now ? decoded : null;
}
```

- [ ] **Step 4: 新增 `/api/admin/login` 并以 Bearer 令牌保护后台设置**

```js
if (parts[1] === "login" && req.method === "POST") {
  const { username, password } = await readBody(req);
  if (!credentialsMatch(username, password)) return json(res, { error: "后台账号或密码错误" }, 401);
  const token = await issueAdminToken({ username, now });
  return json(res, { token, expiresAt: now + ADMIN_SESSION_TTL_MS });
}
const admin = await currentAdmin(req, now);
if (!admin) return json(res, { error: "后台登录已过期" }, 401);
```

- [ ] **Step 5: 运行管理员单元和 API 测试**

Run: `node --test test/admin-session.test.mjs test/department-api.test.mjs`

Expected: PASS，账号密码只用于换取令牌，错误、篡改和过期令牌均被拒绝。

- [ ] **Step 6: 提交管理员会话改动**

```bash
git add lib/admin-session.mjs api/[...path].mjs test/admin-session.test.mjs test/department-api.test.mjs
git commit -m "Add short-lived admin sessions"
```

### Task 3: AI API 密钥加密模块

**Files:**
- Create: `lib/encrypted-secret.mjs`
- Create: `test/encrypted-secret.test.mjs`

- [ ] **Step 1: 写加密、解密、脱敏和错误主密钥测试**

```js
test("AI keys round-trip without storing plaintext", async () => {
  const env = { SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
  const encrypted = await encryptSecret("sk-secret-1234", { env });
  assert.equal(JSON.stringify(encrypted).includes("sk-secret-1234"), false);
  assert.equal(await decryptSecret(encrypted, { env }), "sk-secret-1234");
  assert.equal(maskSecret("sk-secret-1234"), "•••• 1234");
});

test("missing encryption key never falls back to plaintext", async () => {
  await assert.rejects(() => encryptSecret("secret", { env: {} }), /SETTINGS_ENCRYPTION_KEY/);
});
```

- [ ] **Step 2: 运行测试确认缺少模块**

Run: `node --test test/encrypted-secret.test.mjs`

Expected: FAIL，无法导入加密模块。

- [ ] **Step 3: 使用 AES-256-GCM 实现加密边界**

```js
export async function encryptSecret(secret, { env = process.env } = {}) {
  const key = decodeEncryptionKey(env.SETTINGS_ENCRYPTION_KEY);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret)));
  return { version: 1, algorithm: "AES-256-GCM", iv: toBase64(iv), ciphertext: toBase64(encrypted) };
}
```

`decryptSecret()` 只接受版本 1 和 `AES-256-GCM`；`maskSecret()` 只保留末尾四位。

- [ ] **Step 4: 运行加密单元测试**

Run: `node --test test/encrypted-secret.test.mjs`

Expected: PASS，密文不包含明文，错误主密钥被拒绝。

- [ ] **Step 5: 提交加密模块**

```bash
git add lib/encrypted-secret.mjs test/encrypted-secret.test.mjs
git commit -m "Encrypt stored AI API keys"
```

### Task 4: 后台 AI 密钥配置和连接测试 API

**Files:**
- Modify: `api/[...path].mjs`
- Modify: `test/department-api.test.mjs`
- Modify: `test/report-api.test.mjs`

- [ ] **Step 1: 写失败测试，覆盖脱敏、替换、清除和测试失败保护**

```js
test("admin settings save encrypted AI keys and return only a mask", async () => {
  const saved = await adminApi("/admin/settings", { method: "PATCH", body: { ai: { apiKey: "sk-new-5678" } } });
  assert.equal(saved.body.settings.ai.apiKeyMask, "•••• 5678");
  assert.equal(JSON.stringify(saved.body).includes("sk-new-5678"), false);
  assert.equal(JSON.stringify(await readRawState()).includes("sk-new-5678"), false);
});

test("failed connection tests do not replace the active key", async () => {
  const before = await readRawState();
  const response = await adminApi("/admin/ai/test", { method: "POST", body: { apiKey: "sk-bad" } });
  assert.equal(response.status, 502);
  assert.deepEqual((await readRawState()).settings.ai.encryptedApiKey, before.settings.ai.encryptedApiKey);
});
```

- [ ] **Step 2: 运行目标测试并确认缺少新接口**

Run: `node --test test/department-api.test.mjs test/report-api.test.mjs`

Expected: FAIL，后台密钥字段或 `/admin/ai/test` 尚不存在。

- [ ] **Step 3: 实现后台设置返回值和密钥命令**

```js
if (body.ai?.apiKey) next.ai.encryptedApiKey = await encryptSecret(body.ai.apiKey);
if (body.ai?.clearApiKey === true) {
  delete next.ai.encryptedApiKey;
  next.ai.enabled = false;
}
return json(res, { settings: adminSettingsView(state) });
```

`adminSettingsView()` 只返回 `configured`、`apiKeyMask`、供应商、模型和启用状态。`requestAiSummary()` 优先解密已保存密钥；没有加密记录时只读兼容现有供应商环境变量。

- [ ] **Step 4: 实现连接测试且不写状态**

```js
const candidate = body.apiKey || await resolveStoredAiKey(state.settings.ai);
await testAiConnection({ provider: body.provider, model: body.model, apiKey: candidate });
return json(res, { ok: true, message: "连接成功" });
```

- [ ] **Step 5: 运行 API 和 AI 测试**

Run: `node --test test/department-api.test.mjs test/report-api.test.mjs`

Expected: PASS，返回值无完整密钥，失败测试不改状态。

- [ ] **Step 6: 提交 AI 配置接口**

```bash
git add api/[...path].mjs test/department-api.test.mjs test/report-api.test.mjs
git commit -m "Manage AI keys from admin settings"
```

### Task 5: 独立登录页和工作台门禁

**Files:**
- Modify: `public/index.html`
- Modify: `test/workbench-ui.test.mjs`

- [ ] **Step 1: 写失败测试，要求独立登录页且无协同口令逻辑**

```js
test("unauthenticated visitors see a dedicated login page without sync keys", () => {
  assert.match(html, /id="loginView"/);
  assert.match(html, /id="workspaceShell"[^>]+hidden/);
  assert.doesNotMatch(html, /syncKeyStorageKey|getSyncKey|x-report-key|周报协同口令/);
});
```

- [ ] **Step 2: 运行 UI 测试确认失败**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL，页面仍使用弹窗登录并包含同步口令逻辑。

- [ ] **Step 3: 增加登录页结构与响应式样式**

```html
<main id="loginView" class="login-page">
  <section class="login-brand">...</section>
  <section class="login-form-panel">
    <form id="loginForm">账号、密码、登录按钮、注册入口</form>
  </section>
</main>
<div id="workspaceShell" hidden>现有工作台</div>
```

桌面端双栏，`@media (max-width: 720px)` 隐藏 `.login-brand`。登录失败留在当前表单；成功后隐藏 `loginView` 并显示 `workspaceShell`。

- [ ] **Step 4: 删除同步口令前端代码并改造请求头**

```js
async function authedFetch(url, options = {}) {
  ensureLoginAlive();
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...(userToken ? { "x-user-token": userToken } : {}) },
  });
}
```

- [ ] **Step 5: 运行 UI 与生产服务器测试**

Run: `node --test test/workbench-ui.test.mjs test/production-server.test.mjs`

Expected: PASS，首次访问只显示登录页且源码无同步口令。

- [ ] **Step 6: 提交登录页**

```bash
git add public/index.html test/workbench-ui.test.mjs test/production-server.test.mjs
git commit -m "Add account-first login page"
```

### Task 6: 后台设置中心界面

**Files:**
- Modify: `public/index.html`
- Modify: `test/workbench-ui.test.mjs`

- [ ] **Step 1: 写失败测试，要求分类导航、会话令牌和安全密钥控件**

```js
test("admin uses categorized settings and a short-lived token", () => {
  for (const section of ["departments", "modules", "accounts", "ai", "session"]) {
    assert.match(html, new RegExp(`data-admin-section="${section}"`));
  }
  assert.match(html, /adminSessionToken/);
  assert.match(html, /id="adminAiApiKey"/);
  assert.match(html, /id="adminAiTestBtn"/);
  assert.match(html, /id="adminAiClearBtn"/);
  assert.doesNotMatch(html, /x-admin-password/);
});
```

- [ ] **Step 2: 运行 UI 测试确认旧后台结构不满足要求**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL，缺少分类导航、管理员令牌和密钥操作。

- [ ] **Step 3: 重构后台为侧边分类与单区编辑**

```html
<div class="settings-center">
  <nav class="settings-nav" aria-label="后台设置分类">...</nav>
  <section class="settings-editor" aria-live="polite">...</section>
</div>
```

分类切换只改变当前编辑区，不清除 `adminDraftSettings`。输入变更设置 `adminDirty = true` 并显示保存栏；成功保存后设为 `false`。

- [ ] **Step 4: 改造管理员登录和请求头**

```js
const result = await apiJson("/api/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
adminSessionToken = result.token;
sessionStorage.setItem(adminSessionStorageKey, JSON.stringify(result));

function adminRequestHeaders() {
  return { Authorization: `Bearer ${adminSessionToken}` };
}
```

- [ ] **Step 5: 实现 AI 密钥测试、替换和清除交互**

测试按钮调用 `/api/admin/ai/test`；保存时仅在输入新密钥后发送 `apiKey`；清除操作确认后发送 `clearApiKey: true`。服务端返回掩码后立即清空密钥输入框。

- [ ] **Step 6: 增加未保存离开保护和中文反馈**

```js
window.addEventListener("beforeunload", (event) => {
  if (!adminDirty) return;
  event.preventDefault();
  event.returnValue = "";
});
```

- [ ] **Step 7: 运行 UI 与 API 测试**

Run: `node --test test/workbench-ui.test.mjs test/department-api.test.mjs test/report-api.test.mjs`

Expected: PASS，后台分类可识别、管理员密码不再随请求发送、密钥操作齐全。

- [ ] **Step 8: 提交后台设置中心**

```bash
git add public/index.html test/workbench-ui.test.mjs test/department-api.test.mjs test/report-api.test.mjs
git commit -m "Redesign admin settings center"
```

### Task 7: 全量验证、生产配置和腾讯云部署

**Files:**
- Modify: `.env.example`
- Modify: `docs/superpowers/plans/2026-07-22-admin-login-security-redesign.md`

- [ ] **Step 1: 更新运行环境示例**

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password
ADMIN_SESSION_SECRET=replace-with-at-least-32-random-bytes
SETTINGS_ENCRYPTION_KEY=replace-with-a-base64-encoded-32-byte-key
```

移除 `REPORT_SYNC_KEY` 的必填说明，保留 AI 供应商环境密钥为只读兼容项。

- [ ] **Step 2: 执行完整自动化测试**

Run: `npm.cmd test`

Expected: 所有测试通过，0 failures。

- [ ] **Step 3: 执行生产依赖安全检查**

Run: `npm.cmd audit --omit=dev --audit-level=high`

Expected: 0 high/critical vulnerabilities。

- [ ] **Step 4: 执行生产构建**

Run: `npm.cmd run build`

Expected: exit 0，生成生产静态资源并包含当前 Git 版本。

- [ ] **Step 5: 配置腾讯云安全环境变量并部署默认环境**

在已绑定的 CloudBase 默认环境中新增 `ADMIN_SESSION_SECRET` 和 `SETTINGS_ENCRYPTION_KEY`，保留现有管理员账号密码，随后发布当前提交到 `department-workbench` 服务。

- [ ] **Step 6: 查询真实云端状态并访问验证**

验证项：CloudRun 服务状态为 `normal`；健康接口版本等于部署提交；根路径返回 200 且显示登录页；无令牌 `/api/weeks` 返回 401；账号密码登录成功；管理员令牌可读取设置；后台接口不返回完整 AI 密钥。

- [ ] **Step 7: 提交运行配置文档并推送分支**

```bash
git add .env.example docs/superpowers/plans/2026-07-22-admin-login-security-redesign.md
git commit -m "Document secure production configuration"
git push origin codex/department-workbench
```
