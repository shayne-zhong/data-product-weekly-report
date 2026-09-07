# WorkBuddy Sync Admin Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global-admin-only WorkBuddy operations center with encrypted production configuration, visual userid mapping, dual-source synchronization logs, and 30-day retention.

**Architecture:** Keep configuration resolution and log retention/query behavior in two independent pure modules. The existing catch-all API orchestrates encryption, authorization, persistence, automatic website events, and WorkBuddy result ingestion; the existing single-page admin UI consumes only masked projections.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing encrypted-secret and JSON state store, native HTML/CSS/JavaScript admin UI.

---

### Task 1: WorkBuddy configuration domain

**Files:**
- Create: `lib/workbuddy-config.mjs`
- Create: `test/workbuddy-config.test.mjs`
- Modify: `lib/workbuddy-auth.mjs`
- Modify: `test/workbuddy-auth.test.mjs`

- [x] **Step 1: Write failing configuration tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveWorkbuddyConfig,
  publicWorkbuddyConfig,
  validateWorkbuddyConfigPatch,
} from "../lib/workbuddy-config.mjs";

test("admin overrides environment while explicit disable wins", async () => {
  const decrypt = async (value) => value.plaintext;
  const env = {
    WORKBUDDY_OPEN_API_TOKEN: "environment-open-token-1234",
    WORKBUDDY_DEPARTMENT_ID: "data-product",
    WORKBUDDY_OAUTH_RESOLVER_URL: "http://environment/resolve",
    WORKBUDDY_OAUTH_RESOLVER_TOKEN: "environment-oauth-token-1234",
    WECOM_OAUTH_CORP_ID: "corp-env",
  };
  const state = { workbuddy: {
    enabled: false,
    openApiToken: { encrypted: { plaintext: "admin-open-token-123456" }, last4: "3456" },
  } };
  const config = await effectiveWorkbuddyConfig(state, { env, decrypt });
  assert.equal(config.enabled, false);
  assert.equal(config.openApiToken, "admin-open-token-123456");
  assert.equal(config.departmentId, "data-product");
});

test("public projection exposes masks and sources but no secret", async () => {
  const config = await publicWorkbuddyConfig({ workbuddy: {
    openApiToken: { encrypted: { ciphertext: "secret" }, last4: "1234" },
  } }, {
    env: { WORKBUDDY_OAUTH_RESOLVER_TOKEN: "environment-oauth-token-5678" },
  });
  assert.deepEqual(config.openApiToken, { configured: true, source: "admin", mask: "•••• 1234" });
  assert.deepEqual(config.oauthResolverToken, { configured: true, source: "environment", mask: "•••• 5678" });
  assert.doesNotMatch(JSON.stringify(config), /ciphertext|environment-oauth-token/);
});

test("patch validation rejects short identical tokens and invalid URLs", () => {
  assert.throws(() => validateWorkbuddyConfigPatch({ open_api_token: "short" }), /24/);
  assert.throws(() => validateWorkbuddyConfigPatch({
    open_api_token: "same-token-value-123456789",
    oauth_resolver_token: "same-token-value-123456789",
  }), /different/);
  assert.throws(() => validateWorkbuddyConfigPatch({ oauth_resolver_url: "file:///tmp/a" }), /http/);
});
```

- [x] **Step 2: Run configuration tests and confirm RED**

Run: `node --test test/workbuddy-config.test.mjs`

Expected: FAIL because `lib/workbuddy-config.mjs` does not exist.

- [x] **Step 3: Implement configuration resolution and safe projection**

```js
const text = (value) => String(value || "").trim();
const envValue = (env, name) => text(env?.[name]);

function tokenProjection(stored, environmentValue) {
  if (stored?.encrypted) return { configured: true, source: "admin", mask: `•••• ${stored.last4}` };
  const fallback = text(environmentValue);
  return { configured: Boolean(fallback), source: fallback ? "environment" : "none", mask: fallback ? `•••• ${fallback.slice(-4)}` : "" };
}

export async function effectiveWorkbuddyConfig(state, { env = process.env, decrypt } = {}) {
  const stored = state.workbuddy || {};
  const enabled = Object.hasOwn(stored, "enabled") ? stored.enabled === true : true;
  return {
    enabled,
    departmentId: text(stored.departmentId) || envValue(env, "WORKBUDDY_DEPARTMENT_ID"),
    openApiToken: stored.openApiToken?.encrypted
      ? await decrypt(stored.openApiToken.encrypted)
      : envValue(env, "WORKBUDDY_OPEN_API_TOKEN"),
    oauthResolverUrl: text(stored.oauthResolverUrl) || envValue(env, "WORKBUDDY_OAUTH_RESOLVER_URL"),
    oauthResolverToken: stored.oauthResolverToken?.encrypted
      ? await decrypt(stored.oauthResolverToken.encrypted)
      : envValue(env, "WORKBUDDY_OAUTH_RESOLVER_TOKEN"),
    corpId: text(stored.corpId) || envValue(env, "WECOM_OAUTH_CORP_ID"),
  };
}

export async function publicWorkbuddyConfig(state, { env = process.env } = {}) {
  const stored = state.workbuddy || {};
  return {
    enabled: Object.hasOwn(stored, "enabled") ? stored.enabled === true : true,
    departmentId: text(stored.departmentId) || envValue(env, "WORKBUDDY_DEPARTMENT_ID"),
    oauthResolverUrl: text(stored.oauthResolverUrl) || envValue(env, "WORKBUDDY_OAUTH_RESOLVER_URL"),
    corpId: text(stored.corpId) || envValue(env, "WECOM_OAUTH_CORP_ID"),
    openApiToken: tokenProjection(stored.openApiToken, env.WORKBUDDY_OPEN_API_TOKEN),
    oauthResolverToken: tokenProjection(stored.oauthResolverToken, env.WORKBUDDY_OAUTH_RESOLVER_TOKEN),
  };
}

export function validateWorkbuddyConfigPatch(body = {}) {
  for (const key of ["open_api_token", "oauth_resolver_token"]) {
    if (Object.hasOwn(body, key) && text(body[key]).length < 24) throw new Error(`${key} must contain at least 24 characters`);
  }
  if (body.open_api_token && body.oauth_resolver_token && text(body.open_api_token) === text(body.oauth_resolver_token)) {
    throw new Error("WorkBuddy tokens must be different");
  }
  if (Object.hasOwn(body, "oauth_resolver_url") && body.oauth_resolver_url) {
    const url = new URL(body.oauth_resolver_url);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("OAuth resolver URL must use http or https");
  }
  return body;
}
```

Update `workbuddy-auth.mjs` so constant-time token validation accepts the already resolved expected token rather than reading `process.env` itself:

```js
export function workbuddyTokenValid(header, expectedToken) {
  const authorization = text(header);
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const expected = text(expectedToken);
  return Boolean(expected && provided) && safeEqual(provided, expected);
}
```

Update `test/workbuddy-auth.test.mjs` to pass `"open-secret"` as the second argument and assert that an empty expected token is rejected.

- [x] **Step 4: Run configuration and existing auth tests and confirm GREEN**

Run: `node --test test/workbuddy-config.test.mjs test/workbuddy-auth.test.mjs`

Expected: all tests pass.

- [x] **Step 5: Commit the configuration domain**

```bash
git add -- lib/workbuddy-config.mjs lib/workbuddy-auth.mjs test/workbuddy-config.test.mjs test/workbuddy-auth.test.mjs
git commit -m "feat: add WorkBuddy configuration domain"
```

### Task 2: Synchronization log domain

**Files:**
- Create: `lib/workbuddy-sync-log.mjs`
- Create: `test/workbuddy-sync-log.test.mjs`

- [x] **Step 1: Write failing tests for sanitization, idempotency, retention, statistics, and cursor pagination**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  appendSyncEvent,
  pruneSyncEvents,
  querySyncEvents,
  summarizeSyncEvents,
} from "../lib/workbuddy-sync-log.mjs";

test("duplicate external event IDs return the original row", () => {
  const state = {};
  const first = appendSyncEvent(state, {
    externalEventId: "evt-1", source: "workbuddy", action: "created", result: "success",
    taskId: "task-1", occurredAt: 1_000,
  }, { now: 2_000, idFactory: () => "sync-1" });
  const duplicate = appendSyncEvent(state, {
    externalEventId: "evt-1", source: "workbuddy", action: "created", result: "success",
    taskId: "task-1", occurredAt: 1_000,
  }, { now: 3_000, idFactory: () => "sync-2" });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.event.id, "sync-1");
  assert.equal(state.workbuddy.syncEvents.length, 1);
});

test("messages remove secrets, headers, newlines, and excess length", () => {
  const state = {};
  const { event } = appendSyncEvent(state, {
    source: "website", action: "poll_failed", result: "failed", occurredAt: 1_000,
    message: `Authorization: Bearer secret-token-value\n${"x".repeat(800)}`,
  }, { now: 2_000, idFactory: () => "sync-1" });
  assert.doesNotMatch(event.message, /secret-token-value|Authorization|\n/);
  assert.ok(event.message.length <= 500);
});

test("retention removes rows older than 30 days and caps the newest 5000", () => {
  const now = 40 * 86_400_000;
  const state = { workbuddy: { syncEvents: Array.from({ length: 5_010 }, (_, index) => ({
    id: `sync-${String(index).padStart(5, "0")}`,
    externalEventId: `external-${index}`,
    occurredAt: now - index,
  })), syncEventIds: {} } };
  for (const event of state.workbuddy.syncEvents) state.workbuddy.syncEventIds[event.externalEventId] = event.id;
  pruneSyncEvents(state, { now });
  assert.equal(state.workbuddy.syncEvents.length, 5_000);
  assert.equal(state.workbuddy.syncEventIds["external-5009"], undefined);
});

test("queries use stable cursor ordering and filters", () => {
  const state = { workbuddy: { syncEvents: [
    { id: "b", occurredAt: 2_000, result: "failed", action: "updated", username: "zhangsan" },
    { id: "a", occurredAt: 2_000, result: "success", action: "created", username: "lisi" },
    { id: "c", occurredAt: 1_000, result: "failed", action: "created", username: "zhangsan" },
  ] } };
  const first = querySyncEvents(state, { result: "failed", limit: 1 });
  assert.deepEqual(first.events.map((row) => row.id), ["b"]);
  const second = querySyncEvents(state, { result: "failed", limit: 1, before: first.nextBefore });
  assert.deepEqual(second.events.map((row) => row.id), ["c"]);
  assert.equal(summarizeSyncEvents(state, { now: 3_000 }).failed, 2);
});
```

- [x] **Step 2: Run log tests and confirm RED**

Run: `node --test test/workbuddy-sync-log.test.mjs`

Expected: FAIL because `lib/workbuddy-sync-log.mjs` does not exist.

- [x] **Step 3: Implement the log domain**

```js
const retentionMs = 30 * 24 * 60 * 60 * 1000;
const maxEvents = 5_000;
const resultValues = new Set(["success", "failed", "skipped", "retrying"]);
const actionValues = new Set([
  "polled", "poll_failed", "writeback_completed", "writeback_terminal", "writeback_rejected",
  "oauth_mapped", "oauth_rejected", "config_changed", "mapping_changed",
  "created", "updated", "recreated", "skipped", "failed", "retry_scheduled",
]);

function bucket(state) {
  state.workbuddy ||= {};
  state.workbuddy.syncEvents ||= [];
  state.workbuddy.syncEventIds ||= {};
  return state.workbuddy;
}

function cleanMessage(value) {
  return String(value || "")
    .replace(/authorization\s*:\s*bearer\s+\S+/gi, "[credential removed]")
    .replace(/(token|code|secret)\s*[=:]\s*\S+/gi, "$1=[credential removed]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500);
}

export function pruneSyncEvents(state, { now = Date.now() } = {}) {
  const target = bucket(state);
  target.syncEvents = target.syncEvents
    .filter((event) => Number(event.occurredAt) >= now - retentionMs)
    .sort((left, right) => right.occurredAt - left.occurredAt || right.id.localeCompare(left.id))
    .slice(0, maxEvents);
  const kept = new Set(target.syncEvents.map((event) => event.id));
  target.syncEventIds = Object.fromEntries(Object.entries(target.syncEventIds).filter(([, id]) => kept.has(id)));
  return target.syncEvents;
}

export function appendSyncEvent(state, input, { now = Date.now(), idFactory = () => `sync_${crypto.randomUUID()}` } = {}) {
  const target = bucket(state);
  const externalEventId = String(input.externalEventId || "").trim();
  const existingId = externalEventId ? target.syncEventIds[externalEventId] : "";
  if (existingId) return { duplicate: true, event: target.syncEvents.find((event) => event.id === existingId) };
  if (!actionValues.has(input.action)) throw new Error("Invalid sync event action");
  if (!resultValues.has(input.result)) throw new Error("Invalid sync event result");
  const event = {
    id: idFactory(), externalEventId, source: input.source, action: input.action, result: input.result,
    taskId: String(input.taskId || ""), taskTitle: String(input.taskTitle || "").slice(0, 200),
    username: String(input.username || ""), displayName: String(input.displayName || "").slice(0, 100),
    wecomTodoId: String(input.wecomTodoId || "").slice(0, 128),
    attempt: Math.max(0, Math.min(100, Number(input.attempt) || 0)),
    message: cleanMessage(input.message), occurredAt: Number(input.occurredAt), recordedAt: now,
  };
  target.syncEvents.push(event);
  if (externalEventId) target.syncEventIds[externalEventId] = event.id;
  pruneSyncEvents(state, { now });
  return { duplicate: false, event };
}
```

Implement `querySyncEvents` with a base64url JSON cursor `{ occurredAt, id }`. Sort by `occurredAt DESC, id DESC`; apply exact `source`, `result`, and `action` filters plus a case-insensitive `keyword` match across task ID/title, username/display name, WeCom todo ID, and message; include only rows strictly after the cursor in that order; clamp `limit` to 1–100; and return `{ events, nextBefore }`. Implement `summarizeSyncEvents` by counting each result over rows whose `occurredAt >= now - 24 hours`, returning zero-filled `success`, `failed`, `skipped`, and `retrying` fields.

- [x] **Step 4: Run log tests and confirm GREEN**

Run: `node --test test/workbuddy-sync-log.test.mjs`

Expected: all tests pass.

- [x] **Step 5: Commit the log domain**

```bash
git add -- lib/workbuddy-sync-log.mjs test/workbuddy-sync-log.test.mjs
git commit -m "feat: add WorkBuddy synchronization log domain"
```

### Task 3: Global administrator configuration and mapping API

**Files:**
- Modify: `api/[...path].mjs`
- Create: `test/workbuddy-admin-api.test.mjs`
- Modify: `test/workbuddy-open-api.test.mjs`
- Modify: `test/workbuddy-oauth-api.test.mjs`

- [x] **Step 1: Write failing admin API tests**

```js
test("only a global administrator can read WorkBuddy operations data", async () => {
  assert.equal((await api("/admin/workbuddy")).statusCode, 401);
  assert.equal((await api("/admin/workbuddy", { headers: leaderHeaders })).statusCode, 403);
  const response = await api("/admin/workbuddy", { headers: adminHeaders });
  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(JSON.stringify(response.body), /admin-open-secret|encrypted|ciphertext/);
});

test("saved tokens take effect immediately and are returned only as masks", async () => {
  const saved = await api("/admin/workbuddy/config", {
    method: "PATCH", headers: adminHeaders,
    body: {
      enabled: true,
      department_id: "data-product",
      open_api_token: "new-open-token-value-123456789",
      oauth_resolver_token: "new-oauth-token-value-12345678",
      oauth_resolver_url: "http://workbuddy.internal/resolve",
      corp_id: "corp-data-product",
    },
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.config.openApiToken, { configured: true, source: "admin", mask: "•••• 6789" });
  assert.equal((await openApi("/open/tasks?updated_since=0", "old-token")).statusCode, 401);
  assert.equal((await openApi("/open/tasks?updated_since=0", "new-open-token-value-123456789")).statusCode, 200);
});

test("mapping edit is unique, audited, and restamps assigned tasks", async () => {
  const before = await openApi("/open/tasks?updated_since=0", activeOpenToken);
  const checkpoint = Math.max(...before.body.tasks.map((task) => task.updated_at));
  const changed = await api("/admin/workbuddy/mappings/zhongnanhai", {
    method: "PATCH", headers: adminHeaders, body: { wecom_userid: "wx-zhongnanhai" },
  });
  assert.equal(changed.statusCode, 200);
  const after = await openApi(`/open/tasks?updated_since=${checkpoint}`, activeOpenToken);
  assert.ok(after.body.tasks.some((task) => task.assignee_userid === "wx-zhongnanhai"));
  const conflict = await api("/admin/workbuddy/mappings/songquanchen", {
    method: "PATCH", headers: adminHeaders, body: { wecom_userid: "wx-zhongnanhai" },
  });
  assert.equal(conflict.statusCode, 409);
});
```

- [x] **Step 2: Run admin API tests and confirm RED**

Run: `node --test test/workbuddy-admin-api.test.mjs`

Expected: FAIL because `/api/admin/workbuddy` routes do not exist.

- [x] **Step 3: Implement global-admin-only routes**

Add these routes inside the existing `handleAdmin` global-admin branch:

```js
if (action === "workbuddy") {
  if (parts.length === 2 && req.method === "GET") return handleWorkbuddyAdminOverview(req, res, state, now);
  if (parts[2] === "config" && req.method === "PATCH") return handleWorkbuddyAdminConfig(req, res, state, now, decoded);
  if (parts[2] === "mappings" && parts[3] && req.method === "PATCH") {
    return handleWorkbuddyMappingUpdate(req, res, state, decodeURIComponent(parts[3]), now, decoded);
  }
  if (parts[2] === "mappings" && req.method === "GET") return handleWorkbuddyMappings(req, res, state);
  if (parts[2] === "logs" && req.method === "GET") return handleWorkbuddyLogs(req, res, state, now);
  return methodNotAllowed(res);
}
```

`handleWorkbuddyAdminConfig` must validate the complete prospective configuration, encrypt new tokens through `encryptSecret`, retain existing token objects when fields are omitted, delete only the requested admin override when `clear_*` is true, append one `config_changed` event containing changed field names, and save once.

`GET /api/admin/workbuddy` returns `{ config, status, summary, mappings }`; `status` contains the latest poll/writeback/result timestamps, watermark, and poll count; `summary` contains 24-hour result counters and the unmapped enabled-account count. `GET /mappings` returns the same mapping rows. `GET /logs` forwards validated filters to `querySyncEvents` and returns `{ events, nextBefore }`.

`handleWorkbuddyMappingUpdate` must work on a cloned account array first. To replace a user's existing mapping, clear that cloned account's own old `wecomUserId`, then call `bindWecomUserId` so uniqueness is still enforced against every other account. Set mapping audit fields, restamp tasks assigned to that username with the existing monotonic task timestamp helper, append `mapping_changed`, then assign and save once. An empty `wecom_userid` unbinds the account. A conflict returns 409 without mutating `state`.

Before the existing leader delegation in `handleAdmin`, return 403 when `decoded.role === "leader" && action === "workbuddy"`; do not let this admin-only route fall through as a 404.

In `test/workbuddy-admin-api.test.mjs`, define the request/response harness and issue real admin and leader tokens in `beforeEach`, mirroring the existing WorkBuddy API test harness. Keep `adminHeaders`, `leaderHeaders`, `api`, and `openApi` local to that file; seed one mapped task and two enabled data-product accounts so every example above is directly runnable.

- [x] **Step 4: Replace environment-only open/OAuth config reads**

At the start of each open API or OAuth request, resolve configuration once:

```js
const config = await effectiveWorkbuddyConfig(state, {
  env: process.env,
  decrypt: decryptSecret,
});
if (!config.enabled) return json(res, { error: "WorkBuddy integration is disabled" }, 503);
if (!workbuddyTokenValid(req.headers?.authorization, config.openApiToken)) {
  return json(res, { error: "Unauthorized" }, 401);
}
```

Pass the same resolved `config` through the handler. Do not decrypt more than once per request.
Invalid or missing bearer tokens return 401 without appending a synchronization event, so unauthenticated traffic cannot fill the retained log.

- [x] **Step 5: Run admin and existing WorkBuddy tests and confirm GREEN**

Run: `node --test test/workbuddy-admin-api.test.mjs test/workbuddy-open-api.test.mjs test/workbuddy-oauth-api.test.mjs test/workbuddy-auth.test.mjs test/workbuddy-config.test.mjs`

Expected: all tests pass.

- [x] **Step 6: Commit the admin API**

```bash
git add -- api/[...path].mjs test/workbuddy-admin-api.test.mjs test/workbuddy-open-api.test.mjs test/workbuddy-oauth-api.test.mjs
git commit -m "feat: add WorkBuddy admin configuration APIs"
```

### Task 4: WorkBuddy result ingestion and website automatic events

**Files:**
- Modify: `api/[...path].mjs`
- Create: `test/workbuddy-sync-events-api.test.mjs`
- Modify: `test/workbuddy-open-api.test.mjs`
- Modify: `test/workbuddy-oauth-api.test.mjs`

- [x] **Step 1: Write failing event ingestion tests**

```js
test("WorkBuddy reports one real WeCom result idempotently without changing the task", async () => {
  const before = await readTask(taskId);
  const payload = {
    event_id: "event-created-1", task_id: taskId, action: "created", result: "success",
    wecom_todo_id: "todo-1", attempt: 1, message: "", occurred_at: Date.now(),
  };
  const first = await openApi("/open/sync-events", { method: "POST", body: payload });
  const repeat = await openApi("/open/sync-events", { method: "POST", body: payload });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.duplicate, false);
  assert.equal(repeat.body.duplicate, true);
  assert.equal(repeat.body.log_id, first.body.log_id);
  assert.deepEqual(await readTask(taskId), before);
});

test("event ingestion rejects invalid actions and timestamps outside 24 hours", async () => {
  const invalidAction = await openApi("/open/sync-events", {
    method: "POST",
    body: { event_id: "bad-1", task_id: taskId, action: "deleted", result: "success", occurred_at: Date.now() },
  });
  assert.equal(invalidAction.statusCode, 400);
  const stale = await openApi("/open/sync-events", {
    method: "POST",
    body: { event_id: "bad-2", task_id: taskId, action: "created", result: "success", occurred_at: Date.now() - 25 * 60 * 60 * 1000 },
  });
  assert.equal(stale.statusCode, 400);
});
```

- [x] **Step 2: Add failing automatic website event tests**

```js
test("empty polling updates status without writing detail while nonempty polling writes one event", async () => {
  const first = await openApi("/open/tasks?updated_since=0");
  const checkpoint = Math.max(...first.body.tasks.map((task) => task.updated_at));
  await openApi(`/open/tasks?updated_since=${checkpoint}`);
  const logs = await adminApi("/admin/workbuddy/logs?action=polled");
  assert.equal(logs.body.events.length, 1);
  const overview = await adminApi("/admin/workbuddy");
  assert.ok(overview.body.status.lastPollAt > 0);
  assert.equal(overview.body.status.lastPollCount, 0);
});

test("writeback 200, 409, and 422 create distinct safe events", async () => {
  await completeValidTask();
  await completeValidTask();
  await completeInvalidTask();
  const logs = await adminApi("/admin/workbuddy/logs");
  assert.deepEqual(new Set(logs.body.events.map((row) => row.action)), new Set([
    "writeback_completed", "writeback_terminal", "writeback_rejected",
  ]));
  assert.doesNotMatch(JSON.stringify(logs.body), /Authorization|Bearer|oauth-code/);
});
```

- [x] **Step 3: Run event tests and confirm RED**

Run: `node --test test/workbuddy-sync-events-api.test.mjs test/workbuddy-open-api.test.mjs`

Expected: FAIL because `/api/open/sync-events` and automatic log writes are absent.

- [x] **Step 4: Implement strict WorkBuddy event validation and ingestion**

```js
const workbuddyActions = new Set(["created", "updated", "recreated", "skipped", "failed", "retry_scheduled"]);
const workbuddyResults = new Set(["success", "failed", "skipped", "retrying"]);

function normalizedWorkbuddyEvent(body, state, now) {
  const occurredAt = Number(body.occurred_at);
  if (!String(body.event_id || "").trim() || !String(body.task_id || "").trim()) throw new Error("event_id and task_id are required");
  if (!workbuddyActions.has(body.action) || !workbuddyResults.has(body.result)) throw new Error("Invalid sync event action or result");
  if (!Number.isSafeInteger(occurredAt) || Math.abs(now - occurredAt) > 24 * 60 * 60 * 1000) throw new Error("occurred_at is outside the accepted window");
  const task = state.tasks[body.task_id];
  return {
    externalEventId: String(body.event_id).slice(0, 100), source: "workbuddy",
    action: body.action, result: body.result, taskId: String(body.task_id),
    taskTitle: task?.title || "", username: task?.ownerUsername || "", displayName: task?.owner || "",
    wecomTodoId: String(body.wecom_todo_id || ""), attempt: Number(body.attempt) || 0,
    message: body.message, occurredAt,
  };
}
```

Route `POST /api/open/sync-events` before the task-specific PUT route, append the event, update `lastResultReportedAt`, save once for new events, and return the stable log ID for duplicates.

- [x] **Step 5: Add automatic events without changing business outcomes**

On GET task polling, always update `lastPollAt`, `lastSuccessfulPollAt`, `lastPollCount`, and `lastWatermark`; append `polled` only when tasks are returned. Append the three writeback result events before returning 200/409/422. Append OAuth mapping or rejection events without ever including code/state/token values.

- [x] **Step 6: Run event, open API, OAuth, and admin tests and confirm GREEN**

Run: `node --test test/workbuddy-sync-events-api.test.mjs test/workbuddy-open-api.test.mjs test/workbuddy-oauth-api.test.mjs test/workbuddy-admin-api.test.mjs test/workbuddy-sync-log.test.mjs`

Expected: all tests pass.

- [x] **Step 7: Commit event ingestion and automatic logging**

```bash
git add -- api/[...path].mjs test/workbuddy-sync-events-api.test.mjs test/workbuddy-open-api.test.mjs test/workbuddy-oauth-api.test.mjs
git commit -m "feat: add WorkBuddy synchronization events"
```

### Task 5: Global administrator UI

**Files:**
- Modify: `public/index.html`
- Modify: `test/workbench-ui.test.mjs`

- [x] **Step 1: Write failing static UI contract tests**

```js
test("global admin exposes a WorkBuddy operations panel with no leader access", () => {
  assert.match(html, /data-admin-section="workbuddy"/);
  assert.match(html, /data-admin-panel="workbuddy"/);
  assert.match(html, /adminRole !== "admin"/);
  assert.match(html, /\/api\/admin\/workbuddy\/config/);
  assert.match(html, /\/api\/admin\/workbuddy\/mappings/);
  assert.match(html, /\/api\/admin\/workbuddy\/logs/);
});

test("WorkBuddy token fields never hydrate from returned masks", () => {
  assert.match(html, /workbuddyOpenToken\.value = ""/);
  assert.match(html, /workbuddyOauthToken\.value = ""/);
  assert.doesNotMatch(html, /localStorage\.setItem\([^\n]*workbuddy/i);
});
```

- [x] **Step 2: Run the UI test and confirm RED**

Run: `node --test --test-name-pattern="WorkBuddy" test/workbench-ui.test.mjs`

Expected: FAIL because the admin panel does not exist.

- [x] **Step 3: Add the admin navigation and four panel regions**

Add one `data-admin-section="workbuddy"` button visible only to `admin`, and one panel containing:

```html
<section class="panel admin-section" data-admin-panel="workbuddy" hidden>
  <div class="admin-section-head">
    <div><h3>企微任务同步</h3><p>查看同步状态、生产配置、员工映射和企微执行结果。</p></div>
    <button class="ghost-btn" id="reloadWorkbuddyBtn">刷新</button>
  </div>
  <div id="workbuddyOverview" class="metric-grid"></div>
  <div id="workbuddyConfig"></div>
  <div id="workbuddyMappings"></div>
  <div id="workbuddyLogs"></div>
</section>
```

Use existing cards, tables, inputs, badges, and responsive settings layout. Do not introduce a new visual system.

- [x] **Step 4: Implement state loading and masked configuration editing**

```js
let workbuddyAdmin = null;
let workbuddyLogs = [];
let workbuddyLogCursor = "";

async function loadWorkbuddyAdmin() {
  if (adminRole !== "admin") return;
  workbuddyAdmin = await apiJson("/api/admin/workbuddy", { headers: adminRequestHeaders() });
  $("workbuddyOpenToken").value = "";
  $("workbuddyOauthToken").value = "";
  renderWorkbuddyAdmin();
}

async function saveWorkbuddyConfig() {
  const body = {
    enabled: $("workbuddyEnabled").checked,
    department_id: $("workbuddyDepartment").value,
    oauth_resolver_url: $("workbuddyResolverUrl").value.trim(),
    corp_id: $("workbuddyCorpId").value.trim(),
  };
  if ($("workbuddyOpenToken").value) body.open_api_token = $("workbuddyOpenToken").value;
  if ($("workbuddyOauthToken").value) body.oauth_resolver_token = $("workbuddyOauthToken").value;
  workbuddyAdmin = await apiJson("/api/admin/workbuddy/config", {
    method: "PATCH", headers: { "Content-Type": "application/json", ...adminRequestHeaders() }, body: JSON.stringify(body),
  });
  $("workbuddyOpenToken").value = "";
  $("workbuddyOauthToken").value = "";
  renderWorkbuddyAdmin();
}
```

Render source/mask next to each empty password input. Require a confirmation dialog whenever a token field or clear checkbox is present.

- [x] **Step 5: Implement mapping editing and log filters with cursor loading**

Mapping saves call `PATCH /api/admin/workbuddy/mappings/:username`, display 409 conflicts inline, then reload overview and mappings. Log filters build URLSearchParams for time, result, action and keyword; “加载更多” sends `before`, appends results, and replaces the cursor.

The log table must use existing `escapeHtml` for every string, format timestamps locally, show result badges, truncate summaries to two lines, and expose the full sanitized message through an accessible title/detail element.

- [x] **Step 6: Run UI and relevant admin tests and confirm GREEN**

Run: `node --test test/workbench-ui.test.mjs test/workbuddy-admin-api.test.mjs`

Expected: all tests pass.

- [x] **Step 7: Commit the administrator UI**

```bash
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "feat: add WorkBuddy synchronization admin UI"
```

### Task 6: Architecture, contract documentation, and full verification

**Files:**
- Modify: `PROJECT_ARCHITECTURE.md`
- Modify: `docs/workbuddy-integration-api.md`
- Modify: `docs/superpowers/plans/2026-08-29-workbuddy-sync-admin.md`

- [x] **Step 1: Document the final module and route boundaries**

Add `lib/workbuddy-config.mjs`, `lib/workbuddy-sync-log.mjs`, `/api/admin/workbuddy/*`, and `POST /api/open/sync-events` to the architecture map. Document that persistent encrypted config overrides environment variables and that the website never controls WorkBuddy polling or retry policy.

Add the exact `POST /api/open/sync-events` request, allowed enums, idempotency response, and error codes to the WorkBuddy integration guide.

- [x] **Step 2: Run contract-focused tests**

Run:

```powershell
node --test test/workbuddy-config.test.mjs test/workbuddy-sync-log.test.mjs test/workbuddy-admin-api.test.mjs test/workbuddy-sync-events-api.test.mjs test/workbuddy-open-api.test.mjs test/workbuddy-oauth-api.test.mjs test/workbuddy-auth.test.mjs test/workbench-ui.test.mjs
```

Expected: zero failures.

- [x] **Step 3: Run complete repository verification**

Run: `npm test`

Expected: zero failures.

Run: `npm run lint`

Expected: zero errors.

Run: `npm run build`

Expected: exit code 0 and a production build path.

- [x] **Step 4: Verify scope, secrets, and whitespace**

Run:

```powershell
git diff --check
rg -n "Authorization: Bearer [A-Za-z0-9_-]{24,}|WORKBUDDY_[A-Z_]*TOKEN\s*=\s*['\"][^$'{][^'\"]{23,}['\"]" lib api public
git status --short
```

Expected: no real credential values, no whitespace errors, and only planned source/test/document files changed.

- [x] **Step 5: Commit final documentation**

```bash
git add -- PROJECT_ARCHITECTURE.md docs/workbuddy-integration-api.md docs/superpowers/plans/2026-08-29-workbuddy-sync-admin.md
git commit -m "docs: document WorkBuddy synchronization operations"
```
