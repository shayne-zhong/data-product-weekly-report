# WorkBuddy Production Sync Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PR #9 安全迁移到最新主干，兼容 WorkBuddy 生产结果回传契约，并完成内网生产配置与冒烟验证。

**Architecture:** 保留统一 `api/[...path].mjs` 入口和现有 JSON 状态持久化；`lib/workbuddy-config.mjs` 独立解析加密配置，`lib/workbuddy-sync-log.mjs` 独立负责事件规范化、幂等和保留策略。WorkBuddy 每 5 分钟轮询任务，结果回传使用单条 Bearer 鉴权请求，失败不影响同步主链路。

**Tech Stack:** Node.js ESM、原生 HTML/CSS/JavaScript、Node test runner、现有加密与状态存储模块、PowerShell、GitHub CLI。

---

## File Structure

- `PRD.MD`：保存已确认的生产回传产品规则。
- `docs/superpowers/specs/2026-09-07-workbuddy-sync-events-production-contract-design.md`：保存生产契约设计。
- `lib/workbuddy-config.mjs`：合并环境变量和后台加密配置，不返回 Token 明文。
- `lib/workbuddy-sync-log.mjs`：日志规范化、扩展字段、幂等、清理、统计和查询。
- `api/[...path].mjs`：开放接口鉴权、事件入参校验、字段兼容和管理 API。
- `public/index.html`：把企微同步入口嵌入当前新版后台结构。
- `test/workbuddy-sync-log.test.mjs`：领域行为与扩展字段测试。
- `test/workbuddy-sync-events-api.test.mjs`：正式契约、兼容契约、幂等和安全测试。
- `test/workbuddy-admin-api.test.mjs`、`test/workbench-ui.test.mjs`：后台权限、配置与界面回归测试。
- `docs/workbuddy-integration-api.md`：交付给 WorkBuddy 的正式接口说明。
- `docs/workbuddy-production-checklist.md`：生产配置和冒烟步骤。
- `docs/LOOP_ENGINEERING.md`：记录轮询发现、结果回传、持久化、验证和重试边界。

### Task 1: Integrate Current Main Without Regressing the Admin Redesign

**Files:**
- Modify: `api/[...path].mjs`
- Modify: `public/index.html`
- Restore/merge: `lib/workbuddy-config.mjs`
- Restore/merge: `lib/workbuddy-sync-log.mjs`
- Restore/merge: `test/workbuddy-admin-api.test.mjs`
- Restore/merge: `test/workbuddy-sync-events-api.test.mjs`
- Restore/merge: `test/workbuddy-sync-log.test.mjs`

- [ ] **Step 1: Fetch and merge the latest main into the feature branch**

```powershell
git fetch origin
git merge --no-ff origin/main
```

Expected: Git reports conflicts only in paths changed by both the current admin redesign/runtime consolidation and PR #9; unrelated main changes remain selected from `origin/main`.

- [ ] **Step 2: Resolve conflicts using explicit ownership rules**

For `public/index.html`, retain the current main navigation, dialogs, record tables and detail drawers, then insert the WorkBuddy section into the current global-admin navigation. For `api/[...path].mjs`, retain current main runtime/state/auth changes and reapply only WorkBuddy imports, routes and handlers. Restore the two focused WorkBuddy domain modules and three focused test files from the feature side.

```powershell
git checkout --theirs -- public/index.html api/[...path].mjs
git checkout --ours -- lib/workbuddy-config.mjs lib/workbuddy-sync-log.mjs test/workbuddy-admin-api.test.mjs test/workbuddy-sync-events-api.test.mjs test/workbuddy-sync-log.test.mjs
```

After these selections, use small patches to add WorkBuddy imports, admin route handling, open route handling and the admin section into the current main versions. Do not restore deleted CloudBase/Netlify runtime files or overwrite current admin code.

- [ ] **Step 3: Verify all conflict markers are gone**

```powershell
git diff --name-only --diff-filter=U
rg -n "^(<<<<<<<|=======|>>>>>>>)" api public lib test docs PRD.MD PROJECT_ARCHITECTURE.md
```

Expected: both commands produce no conflict paths or conflict markers.

- [ ] **Step 4: Run the existing WorkBuddy tests before contract changes**

```powershell
node --test test/workbuddy-config.test.mjs test/workbuddy-sync-log.test.mjs test/workbuddy-admin-api.test.mjs test/workbuddy-sync-events-api.test.mjs test/workbuddy-open-api.test.mjs test/workbuddy-oauth-api.test.mjs
```

Expected: existing WorkBuddy tests pass after integration; if a test fails because a current-main function signature changed, adapt only the WorkBuddy call site to the current signature.

- [ ] **Step 5: Commit the main integration**

```powershell
git add -- api public lib test docs PRD.MD PROJECT_ARCHITECTURE.md package.json package-lock.json .github .env.example eslint.config.js scripts server.mjs
git commit -m "merge: integrate WorkBuddy admin with current main"
```

### Task 2: Extend the Sync Log Domain for Production Fields

**Files:**
- Modify: `test/workbuddy-sync-log.test.mjs`
- Modify: `lib/workbuddy-sync-log.mjs`

- [ ] **Step 1: Write a failing domain test for optional production fields**

Add a test that calls `appendSyncEvent` with:

```js
const appended = appendSyncEvent(state, {
  externalEventId: "event-production-1",
  source: "workbuddy",
  action: "create",
  result: "failure",
  taskId: "task-1",
  wecomTodoId: "todo-1",
  durationMs: 320,
  operatorUserId: "zhangsan",
  attempt: 2,
  message: "token=secret\nfailed",
  occurredAt: now,
}, { now, idFactory: () => "sync-production-1" });

assert.equal(appended.event.durationMs, 320);
assert.equal(appended.event.operatorUserId, "zhangsan");
assert.equal(appended.event.attempt, 2);
assert.doesNotMatch(appended.event.message, /secret|\n/);
```

- [ ] **Step 2: Run the domain test and verify it fails**

```powershell
node --test test/workbuddy-sync-log.test.mjs
```

Expected: FAIL because the new action/result or optional fields are not accepted/persisted.

- [ ] **Step 3: Implement the minimal domain extension**

Extend allowed values without removing existing values:

```js
const resultValues = new Set([
  "success", "failed", "skipped", "retrying",
  "failure", "retry", "conflict", "rejected",
]);

const actionValues = new Set([
  "polled", "poll_failed", "writeback_completed", "writeback_terminal",
  "writeback_rejected", "oauth_mapped", "oauth_rejected", "config_changed",
  "mapping_changed", "created", "updated", "recreated", "skipped", "failed",
  "retry_scheduled", "create", "update", "finish", "delete", "writeback",
]);
```

Add to the stored event:

```js
durationMs: Math.max(0, Number(input.durationMs) || 0),
operatorUserId: text(input.operatorUserId).slice(0, 128),
```

Include `operatorUserId` in keyword search. Preserve old events that lack both fields.

- [ ] **Step 4: Run the domain test and verify it passes**

```powershell
node --test test/workbuddy-sync-log.test.mjs
```

Expected: PASS, including existing retention, cursor and idempotency tests.

- [ ] **Step 5: Commit the domain change**

```powershell
git add -- lib/workbuddy-sync-log.mjs test/workbuddy-sync-log.test.mjs
git commit -m "feat: extend WorkBuddy production sync logs"
```

### Task 3: Accept the Formal and Backward-Compatible Event Contracts

**Files:**
- Modify: `test/workbuddy-sync-events-api.test.mjs`
- Modify: `api/[...path].mjs`

- [ ] **Step 1: Write failing API tests for the formal schema**

Add one successful request using:

```js
const payload = {
  event_id: "event-formal-1",
  task_id: validTaskId,
  action: "create",
  result: "success",
  todo_id: "todo-formal-1",
  duration_ms: 250,
  operator_userid: "zhongnanhai",
  result_message: "created",
  retry_count: 0,
  occurred_at: Date.now(),
};
```

Assert `statusCode === 200`, `accepted === true`, `duplicate === false`, and the admin log contains the optional fields. Keep the existing old-schema test to prove compatibility.

- [ ] **Step 2: Write failing rejection and retry-semantics tests**

Add requests asserting:

```js
assert.equal((await openApi("/open/sync-events", {
  method: "POST",
  body: [payload],
})).statusCode, 400);

assert.equal((await openApi("/open/sync-events", {
  method: "POST",
  body: { ...payload, event_id: "bad-duration", duration_ms: -1 },
})).statusCode, 400);

assert.equal((await openApi("/open/sync-events", {
  method: "POST",
  body: { ...payload, event_id: "bad-retry", retry_count: 101 },
})).statusCode, 400);
```

Also assert an invalid Bearer token returns 401 and creates no detail log.

- [ ] **Step 3: Run the API test and verify it fails**

```powershell
node --test test/workbuddy-sync-events-api.test.mjs
```

Expected: FAIL because formal aliases, new enum values, optional fields and `accepted` are not implemented.

- [ ] **Step 4: Implement exact request normalization**

In `normalizedWorkbuddyEvent`, reject arrays before accessing fields and resolve aliases explicitly:

```js
if (!body || Array.isArray(body) || typeof body !== "object") {
  throw new Error("sync event body must be one object");
}
const todoId = body.todo_id ?? body.wecom_todo_id ?? "";
const resultMessage = body.result_message ?? body.message ?? "";
const retryCount = body.retry_count ?? body.attempt ?? 0;
const durationMs = body.duration_ms ?? 0;
```

Validate `durationMs` as a nonnegative safe integer and `retryCount` as an integer from 0 through 100. Expand the API action/result sets to match Task 2, keep `event_id`, `task_id` and `occurred_at` required, and return:

```js
return json(res, {
  accepted: true,
  duplicate: appended.duplicate,
  log_id: appended.event.id,
});
```

- [ ] **Step 5: Run API and domain tests**

```powershell
node --test test/workbuddy-sync-events-api.test.mjs test/workbuddy-sync-log.test.mjs
```

Expected: PASS for formal schema, old schema, duplicate event, invalid array, invalid values, stale timestamp, security and no task mutation.

- [ ] **Step 6: Commit the API change**

```powershell
git add -- 'api/[...path].mjs' test/workbuddy-sync-events-api.test.mjs
git commit -m "feat: accept WorkBuddy production result events"
```

### Task 4: Preserve the WorkBuddy Admin Center in the Current UI

**Files:**
- Modify: `public/index.html`
- Modify: `test/workbench-ui.test.mjs`
- Modify: `test/workbuddy-admin-api.test.mjs`

- [ ] **Step 1: Add failing UI assertions against the current admin shell**

Assert the current global-admin navigation contains exactly one `data-admin-section="workbuddy"` trigger, the WorkBuddy panel contains overview/config/mapping/log regions, and leader navigation does not expose the trigger. Assert password inputs remain blank after data loading and no Token is written to local storage.

- [ ] **Step 2: Run UI and admin API tests and verify failure**

```powershell
node --test test/workbench-ui.test.mjs test/workbuddy-admin-api.test.mjs
```

Expected: FAIL until the WorkBuddy section is connected to the current main admin navigation and rendering lifecycle.

- [ ] **Step 3: Integrate the existing WorkBuddy components into the new admin layout**

Reuse the current main admin navigation functions and data attributes. Add one global-admin-only navigation item and one panel that calls:

```js
api("/admin/workbuddy")
api("/admin/workbuddy/mappings")
api("/admin/workbuddy/logs?limit=50")
```

Keep Token inputs as empty password fields. Render only `configured`, `source` and `mask`; require the existing confirmation dialog before replace/clear actions. Do not restore the previous admin sidebar or duplicate current detail drawers.

- [ ] **Step 4: Run UI and admin API tests**

```powershell
node --test test/workbench-ui.test.mjs test/workbuddy-admin-api.test.mjs
```

Expected: PASS with current admin navigation behavior and WorkBuddy visibility/configuration behavior both intact.

- [ ] **Step 5: Commit the UI integration**

```powershell
git add -- public/index.html test/workbench-ui.test.mjs test/workbuddy-admin-api.test.mjs
git commit -m "feat: integrate WorkBuddy into current admin center"
```

### Task 5: Update the Integration Contract and Loop Boundaries

**Files:**
- Modify: `docs/workbuddy-integration-api.md`
- Modify: `docs/workbuddy-production-checklist.md`
- Modify: `docs/LOOP_ENGINEERING.md`
- Modify: `PROJECT_ARCHITECTURE.md`

- [ ] **Step 1: Document the exact production event contract**

Add the formal single-object request and compatibility aliases from the design. State that arrays return 400, duplicate events return 200, 4xx are not retried, and 5xx use the 5/30/120-second retry schedule with the same `event_id`.

- [ ] **Step 2: Document the project-local loop**

Add a WorkBuddy loop section containing:

```text
Discovery: WorkBuddy polls updated_at every 5 minutes.
Handoff: Each task is keyed by task_id; each result event by event_id.
Validation: HTTP status plus WorkBuddy --once smoke test; website does not self-approve delivery.
Persistence: WorkBuddy stores watermark/retry queue; website stores deduplicated logs and overview.
Scheduling: 5-minute polling; result retries at 5/30/120 seconds, maximum three attempts.
Human checkpoint: Token rotation, userid conflict, production deployment and 422 completion rejection.
```

- [ ] **Step 3: Update architecture and production checklist**

Document `lib/workbuddy-config.mjs`, `lib/workbuddy-sync-log.mjs`, `POST /api/open/sync-events`, the global-admin panel and the rule that port 3902 remains closed.

- [ ] **Step 4: Check documentation consistency**

```powershell
rg -n "3902|HMAC|sync-events|5 秒|30 秒|120 秒|单条|数组" PRD.MD PROJECT_ARCHITECTURE.md docs/workbuddy-integration-api.md docs/workbuddy-production-checklist.md docs/LOOP_ENGINEERING.md docs/superpowers/specs/2026-09-07-workbuddy-sync-events-production-contract-design.md
git diff --check
```

Expected: documents consistently describe inbound result reporting, no HMAC, no 3902 listener, one event per request and bounded retries; `git diff --check` is clean.

- [ ] **Step 5: Commit documentation**

```powershell
git add -- PROJECT_ARCHITECTURE.md docs/workbuddy-integration-api.md docs/workbuddy-production-checklist.md docs/LOOP_ENGINEERING.md
git commit -m "docs: publish WorkBuddy production integration contract"
```

### Task 6: Verify, Publish, Configure, and Smoke Test Production

**Files:**
- Verify: all modified source, test and documentation files
- Update if required: `SESSION_HANDOFF.md`

- [ ] **Step 1: Run targeted tests**

```powershell
node --test test/workbuddy-config.test.mjs test/workbuddy-sync-log.test.mjs test/workbuddy-admin-api.test.mjs test/workbuddy-sync-events-api.test.mjs test/workbuddy-open-api.test.mjs test/workbuddy-oauth-api.test.mjs test/workbench-ui.test.mjs
```

Expected: all targeted tests pass with zero failures.

- [ ] **Step 2: Run independent full verification**

Use a fresh temporary directory so stale Windows test-state files cannot affect the result:

```powershell
$taskTemp = Join-Path ([System.IO.Path]::GetTempPath()) ("workbuddy-prod-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $taskTemp | Out-Null
$env:TEMP = $taskTemp
$env:TMP = $taskTemp
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: full tests, lint and production build all pass. Report exact pass/fail counts from fresh output.

- [ ] **Step 3: Scan for leaked production credentials**

```powershell
rg -n "Authorization: Bearer [A-Za-z0-9+/=_-]{24,}" api lib public test docs .env.example
```

Expected: no production Token or hard-coded Bearer credential is found. Test-only short fixtures may remain only when they do not match the production value.

- [ ] **Step 4: Push the updated feature branch and refresh PR #9**

```powershell
git push origin codex/workbuddy-sync-admin-design
gh pr view 9 --json state,mergeStateStatus,url
```

Expected: PR #9 is open and mergeable, with the current branch commit visible remotely.

- [ ] **Step 5: Merge only after GitHub checks pass**

```powershell
gh pr checks 9 --watch
gh pr merge 9 --merge
```

Expected: checks pass and PR #9 becomes merged. This is the explicit human-approved external publication checkpoint from the confirmed design.

- [ ] **Step 6: Configure the website side without printing the Token**

On the production host, set `WORKBUDDY_OPEN_API_TOKEN` to the same secret already stored in WorkBuddy and set:

```text
WORKBUDDY_DEPARTMENT_ID=data-product
```

Restart the Node service through its existing service manager. Do not place the Token in a command transcript, repository, URL or log.

- [ ] **Step 7: Verify the production API status without exposing task content**

```powershell
$headers = @{ Authorization = "Bearer $env:WORKBUDDY_PROD_TOKEN" }
$response = Invoke-WebRequest -UseBasicParsing -Uri "http://192.168.18.231:8000/api/open/tasks?updated_since=0" -Headers $headers -TimeoutSec 10
$body = $response.Content | ConvertFrom-Json
[pscustomobject]@{ Status = $response.StatusCode; TaskCount = @($body.tasks).Count }
```

Expected: status 200 and a nonnegative task count; do not print titles, descriptions or the Token.

- [ ] **Step 8: Run the WorkBuddy one-shot smoke and verify website logs**

From `C:\Users\apple\WorkBuddy\企微CLI打通\todo-sync`:

```powershell
node src/index.js --once
```

Expected: WorkBuddy completes one polling cycle, creates/updates eligible企微待办, and posts result events. A global administrator sees the latest result time and event rows in “企微任务同步”.

- [ ] **Step 9: Record the final handoff**

Update `SESSION_HANDOFF.md` with the merged commit, production HTTP result, WorkBuddy smoke result, remaining userid mapping conflicts and the rollback instruction to disable integration from the admin panel. Do not include any Token value.

```powershell
git add -- SESSION_HANDOFF.md
git commit -m "docs: record WorkBuddy production handoff"
git push origin main
```

Expected: handoff contains only current state and no credential.
