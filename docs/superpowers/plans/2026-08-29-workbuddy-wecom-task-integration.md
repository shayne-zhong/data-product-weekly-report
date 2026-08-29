# WorkBuddy WeCom Task Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the four approved WorkBuddy contracts for Data Product Department task polling, completion writeback, WeCom userid mapping, and OAuth callback login.

**Architecture:** Keep task projection and monotonic timestamp logic in a small pure module, and keep WorkBuddy token/OAuth handling in a separate authentication module. The existing catch-all API remains the single business entry point; Node, Vercel, and Netlify adapters only translate the exact `/wecom/callback` path into that handler. Existing task completion and session rules remain authoritative.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing JSON state store, Vercel/Netlify/Node adapters.

---

### Task 1: Incremental task projection and monotonic seconds

**Files:**
- Create: `lib/open-task-sync.mjs`
- Create: `test/open-task-sync.test.mjs`

- [ ] **Step 1: Write failing tests for timestamp allocation, visible-field reconciliation, mapping changes, and projection**

```js
test("allocates strictly increasing second timestamps", () => {
  const state = { openTaskClock: 100 };
  assert.equal(nextOpenTaskTimestamp(state, 100_000), 101);
  assert.equal(nextOpenTaskTimestamp(state, 100_000), 102);
});

test("reconciles only externally visible task changes", () => {
  const state = {
    tasks: { t1: { id: "t1", title: "A", description: "", ownerUsername: "zhangsan", status: "进行中", dueDate: "" } },
    settings: { accounts: [{ username: "zhangsan", departmentId: "data-product" }] },
  };
  reconcileOpenTasks(state, { departmentId: "data-product", now: 100_000 });
  const first = state.tasks.t1.openUpdatedAt;
  state.tasks.t1.dailyLogs = [{ progress: "internal" }];
  reconcileOpenTasks(state, { departmentId: "data-product", now: 100_000 });
  assert.equal(state.tasks.t1.openUpdatedAt, first);
  state.settings.accounts[0].wecomUserId = "zhangsan";
  reconcileOpenTasks(state, { departmentId: "data-product", now: 100_000 });
  assert.ok(state.tasks.t1.openUpdatedAt > first);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/open-task-sync.test.mjs`

Expected: FAIL because `lib/open-task-sync.mjs` does not exist.

- [ ] **Step 3: Implement the pure synchronization helpers**

```js
export function nextOpenTaskTimestamp(state, now = Date.now()) {
  const next = Math.max(Math.floor(now / 1000), Number(state.openTaskClock || 0) + 1);
  state.openTaskClock = next;
  return next;
}

export function reconcileOpenTasks(state, { departmentId, now = Date.now() } = {}) {
  const accounts = new Map((state.settings?.accounts || []).map((row) => [row.username, row]));
  let changed = false;
  for (const task of Object.values(state.tasks || {})) {
    const account = accounts.get(task.ownerUsername);
    if (account?.departmentId !== departmentId) continue;
    const fingerprint = JSON.stringify([
      task.title || "", task.description || "", task.ownerUsername || "",
      task.status || "", task.dueDate || "", account.wecomUserId || null,
    ]);
    if (task.openFingerprint === fingerprint && Number.isSafeInteger(task.openUpdatedAt)) continue;
    task.openFingerprint = fingerprint;
    task.openUpdatedAt = nextOpenTaskTimestamp(state, now);
    changed = true;
  }
  return changed;
}

export function projectOpenTask(task, account) {
  return {
    task_id: task.id,
    title: String(task.title || ""),
    description: String(task.description || ""),
    assignee_userid: account?.wecomUserId || null,
    status: task.status,
    due_date: task.dueDate || null,
    updated_at: task.openUpdatedAt,
  };
}
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `node --test test/open-task-sync.test.mjs`

Expected: all tests pass.

### Task 2: WorkBuddy authentication, mapping, and OAuth state helpers

**Files:**
- Create: `lib/workbuddy-auth.mjs`
- Create: `test/workbuddy-auth.test.mjs`
- Modify: `lib/runtime-config.mjs`
- Modify: `test/runtime-config.test.mjs`

- [ ] **Step 1: Write failing tests for bearer validation, exact one-to-one mapping, signed one-time state, and resolver errors**

```js
test("validates the configured WorkBuddy bearer token", () => {
  assert.equal(workbuddyTokenValid("Bearer secret", { WORKBUDDY_OPEN_API_TOKEN: "secret" }), true);
  assert.equal(workbuddyTokenValid("Bearer wrong", { WORKBUDDY_OPEN_API_TOKEN: "secret" }), false);
});

test("rejects a userid already mapped to another account", () => {
  const accounts = [{ username: "a", wecomUserId: "wx-a" }, { username: "b" }];
  assert.throws(() => bindWecomUserId(accounts, "b", "wx-a"), /already bound/);
});

test("consumes a signed OAuth state only once", () => {
  const state = { oauthStates: {} };
  const token = issueOAuthState({ returnTo: "/" }, { secret: "01234567890123456789012345678901", now: 1_000 });
  assert.equal(consumeOAuthState(state, token, { secret: "01234567890123456789012345678901", now: 2_000 }).returnTo, "/");
  assert.throws(() => consumeOAuthState(state, token, { secret: "01234567890123456789012345678901", now: 2_000 }), /used/);
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test test/workbuddy-auth.test.mjs test/runtime-config.test.mjs`

Expected: FAIL because the new module and production configuration rules are missing.

- [ ] **Step 3: Implement minimal authentication and mapping helpers**

```js
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const text = (value) => String(value || "").trim();
const sign = (value, secret) => createHmac("sha256", secret).update(value).digest("base64url");

export function workbuddyTokenValid(header, env = process.env) {
  const actual = text(header).startsWith("Bearer ") ? text(header).slice(7).trim() : "";
  const expected = text(env.WORKBUDDY_OPEN_API_TOKEN);
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return Boolean(expected) && left.length === right.length && timingSafeEqual(left, right);
}

export function bindWecomUserId(accounts, username, wecomUserId) {
  const normalizedUsername = text(username).toLowerCase();
  const normalizedUserId = text(wecomUserId);
  const account = accounts.find((row) => text(row.username).toLowerCase() === normalizedUsername);
  if (!account) throw new Error("Website account not found");
  const conflict = accounts.find((row) => row !== account && text(row.wecomUserId) === normalizedUserId);
  if (conflict) throw new Error("WeCom userid already bound");
  account.wecomUserId = normalizedUserId;
  return account;
}

export function applyDirectoryMappings(state, mappings, { departmentId, batchId }) {
  state.workbuddyDirectoryBatches ||= {};
  if (state.workbuddyDirectoryBatches[batchId]) return state.workbuddyDirectoryBatches[batchId];
  const summary = { batchId, bound: 0, skipped: 0, conflicts: 0 };
  for (const row of mappings) {
    const account = (state.settings?.accounts || []).find((item) =>
      item.departmentId === departmentId && text(item.username).toLowerCase() === text(row.username).toLowerCase());
    if (!account) { summary.skipped += 1; continue; }
    try {
      if (account.wecomUserId === text(row.wecom_userid)) summary.skipped += 1;
      else { bindWecomUserId(state.settings.accounts, account.username, row.wecom_userid); summary.bound += 1; }
    } catch { summary.conflicts += 1; }
  }
  state.workbuddyDirectoryBatches[batchId] = summary;
  return summary;
}

export function issueOAuthState(payload, { secret, now = Date.now() }) {
  const nonce = randomUUID();
  const encoded = Buffer.from(JSON.stringify({ nonce, returnTo: payload.returnTo || "/", expiresAt: now + 300_000 })).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function consumeOAuthState(state, token, { secret, now = Date.now() }) {
  const [encoded, signature] = text(token).split(".");
  const expected = sign(encoded, secret);
  if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid OAuth state");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!payload.expiresAt || payload.expiresAt < now) throw new Error("Expired OAuth state");
  state.oauthStates ||= {};
  if (state.oauthStates[payload.nonce]?.usedAt) throw new Error("OAuth state already used");
  state.oauthStates[payload.nonce] = { expiresAt: payload.expiresAt, usedAt: now };
  if (!String(payload.returnTo || "/").startsWith("/")) throw new Error("Invalid OAuth return path");
  return payload;
}

export async function resolveWorkbuddyIdentity(code, { url, token, fetchImpl = fetch }) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) throw new Error("WorkBuddy identity resolver failed");
  const identity = await response.json();
  if (!text(identity.wecom_userid) || !text(identity.username)) throw new Error("Incomplete WorkBuddy identity");
  return identity;
}
```

Add production validation for `WORKBUDDY_OPEN_API_TOKEN`, `WORKBUDDY_DEPARTMENT_ID`, `WORKBUDDY_OAUTH_RESOLVER_URL`, `WORKBUDDY_OAUTH_RESOLVER_TOKEN`, `WECOM_OAUTH_CORP_ID`, `WECOM_OAUTH_AGENT_ID`, and `WECOM_OAUTH_REDIRECT_URI` only when WorkBuddy integration is enabled.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run: `node --test test/workbuddy-auth.test.mjs test/runtime-config.test.mjs`

Expected: all tests pass.

### Task 3: Incremental GET API

**Files:**
- Modify: `api/[...path].mjs`
- Create: `test/workbuddy-open-api.test.mjs`

- [ ] **Step 1: Write failing API tests for authentication, input validation, department filtering, ordering, and mapping refresh**

```js
test("GET open tasks returns only timestamps greater than updated_since", async () => {
  const first = await api("/open/tasks?updated_since=0", { bearer: "open-secret" });
  assert.equal(first.statusCode, 200);
  const checkpoint = Math.max(...first.body.tasks.map((task) => task.updated_at));
  const next = await api(`/open/tasks?updated_since=${checkpoint}`, { bearer: "open-secret" });
  assert.deepEqual(next.body.tasks, []);
});

test("GET open tasks rejects missing token and invalid updated_since", async () => {
  assert.equal((await api("/open/tasks?updated_since=0")).statusCode, 401);
  assert.equal((await api("/open/tasks?updated_since=-1", { bearer: "open-secret" })).statusCode, 400);
});
```

- [ ] **Step 2: Run the API test and confirm RED**

Run: `node --test test/workbuddy-open-api.test.mjs`

Expected: FAIL with 401/404 because the open route does not exist.

- [ ] **Step 3: Add the open route before employee-session authentication**

```js
if (parts[0] === "open" && parts[1] === "tasks") {
  if (!workbuddyTokenValid(req.headers.authorization, process.env)) return json(res, { error: "Unauthorized" }, 401);
  if (req.method === "GET" && parts.length === 2) return handleOpenTaskQuery(req, res, state, now);
}
```

`handleOpenTaskQuery` validates a nonnegative safe integer, reconciles/persists visible task changes, filters `openUpdatedAt > updated_since`, sorts ascending, and responds as `{ tasks }`.

- [ ] **Step 4: Run the API test and confirm GREEN**

Run: `node --test test/workbuddy-open-api.test.mjs`

Expected: all GET cases pass.

### Task 4: Completion status writeback API

**Files:**
- Modify: `api/[...path].mjs`
- Modify: `test/workbuddy-open-api.test.mjs`

- [ ] **Step 1: Add failing tests for completion, terminal 409, domain 422, unsupported status, and cross-department 404**

```js
test("PUT completion writes once and returns terminal conflict on repeat", async () => {
  const first = await api(`/open/tasks/${taskId}/status`, {
    method: "PUT", bearer: "open-secret", body: { status: "completed" },
  });
  assert.equal(first.statusCode, 200);
  const repeat = await api(`/open/tasks/${taskId}/status`, {
    method: "PUT", bearer: "open-secret", body: { status: "completed" },
  });
  assert.equal(repeat.statusCode, 409);
  assert.equal(repeat.body.code, "TASK_ALREADY_TERMINAL");
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/workbuddy-open-api.test.mjs`

Expected: FAIL because the PUT route returns 404/405.

- [ ] **Step 3: Implement the minimal writeback handler**

```js
if (!["completed", "已完成"].includes(String(body.status || ""))) return json(res, { error: "Unsupported status" }, 400);
if (task.status === "已完成") return json(res, { code: "TASK_ALREADY_TERMINAL", error: "Task is already terminal" }, 409);
try {
  state.tasks[task.id] = applyTaskStatus(task, "已完成", { now });
} catch (error) {
  if (error.message === "完成任务前必须关联年度指标并填写贡献数") {
    return json(res, { code: "TASK_COMPLETION_REQUIREMENTS_NOT_MET", error: error.message }, 422);
  }
  throw error;
}
```

After success, reconcile the task, persist once, and return `{ task_id, status, updated_at }`. Repeated terminal requests return before any mutation.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `node --test test/workbuddy-open-api.test.mjs`

Expected: all GET and PUT cases pass.

### Task 5: OAuth callback and account auto-fill

**Files:**
- Modify: `api/[...path].mjs`
- Create: `test/workbuddy-oauth-api.test.mjs`

- [ ] **Step 1: Write failing tests for existing mapping, exact auto-fill, conflicts, inactive users, resolver failure, and state replay**

```js
test("OAuth callback auto-fills one exact registered account and creates a session", async () => {
  const signedState = issueOAuthState(
    { returnTo: "/" },
    { secret: process.env.WORKBUDDY_OAUTH_RESOLVER_TOKEN, now: Date.now() },
  );
  const response = await api("/wecom/callback", { query: { code: "code-1", state: signedState } });
  assert.equal(response.statusCode, 302);
  assert.match(response.headers["set-cookie"], /session/i);
  const tasks = await api("/open/tasks?updated_since=0", { bearer: "open-secret" });
  assert.equal(tasks.body.tasks.find((task) => task.task_id === taskId).assignee_userid, "wx-zhangsan");
});

test("OAuth callback rejects a replayed state", async () => {
  const signedState = issueOAuthState(
    { returnTo: "/" },
    { secret: process.env.WORKBUDDY_OAUTH_RESOLVER_TOKEN, now: Date.now() },
  );
  await api("/wecom/callback", { query: { code: "code-1", state: signedState } });
  assert.equal((await api("/wecom/callback", { query: { code: "code-2", state: signedState } })).statusCode, 400);
});
```

- [ ] **Step 2: Run the OAuth API test and confirm RED**

Run: `node --test test/workbuddy-oauth-api.test.mjs`

Expected: FAIL because `/wecom/callback` is not handled.

- [ ] **Step 3: Implement callback handling before ordinary session checks**

```js
if (parts[0] === "wecom" && parts[1] === "callback") {
  return handleWecomCallback(req, res, state, now);
}
```

The handler consumes the one-time state, resolves `code` through WorkBuddy, validates enterprise/department identity, binds only one exact active registered account, persists the mapping and affected task timestamps, creates the existing session shape, and redirects only to an allowlisted local path. Resolver credentials and authorization codes are never logged.

- [ ] **Step 4: Run the OAuth API test and confirm GREEN**

Run: `node --test test/workbuddy-oauth-api.test.mjs`

Expected: all callback cases pass.

### Task 6: Exact callback routing in every runtime

**Files:**
- Modify: `server.mjs`
- Modify: `vercel.json`
- Modify: `netlify.toml`
- Modify: relevant Netlify adapter only if the existing redirect cannot preserve query parameters
- Modify: `test/production-server.test.mjs`
- Modify: `test/production-build.test.mjs`

- [ ] **Step 1: Write failing routing tests**

```js
test("production server forwards exact WeCom callback path to the API handler", async () => {
  const response = await request("/wecom/callback?code=x&state=y");
  assert.notEqual(response.status, 200, "must not serve index.html");
  assert.match(response.headers.get("content-type"), /json|text/);
});
```

Assert that Vercel and Netlify configuration preserve `/wecom/callback` and its query string while directing it to the unified backend.

- [ ] **Step 2: Run routing/build tests and confirm RED**

Run: `node --test test/production-server.test.mjs test/production-build.test.mjs`

Expected: callback route currently falls through to the SPA/static index.

- [ ] **Step 3: Add the exact runtime rewrites**

```js
if (url.pathname === "/wecom/callback") {
  req.query = { path: ["wecom", "callback"], ...Object.fromEntries(url.searchParams) };
  return await apiHandler(req, adaptApiResponse(res));
}
```

Add equivalent Vercel/Netlify rewrites without adding any other public endpoint.

- [ ] **Step 4: Run routing/build tests and confirm GREEN**

Run: `node --test test/production-server.test.mjs test/production-build.test.mjs`

Expected: all routing cases pass.

### Task 7: Architecture update and full verification

**Files:**
- Modify: `PROJECT_ARCHITECTURE.md`
- Modify: this plan file checkboxes as tasks finish

- [ ] **Step 1: Document the implemented boundaries**

Add concise architecture entries for `lib/open-task-sync.mjs`, `lib/workbuddy-auth.mjs`, the two `/api/open/tasks` routes, exact `/wecom/callback`, Data Product Department scoping, and persistent `openTaskClock`/`openUpdatedAt`.

- [ ] **Step 2: Run contract-focused tests**

Run: `node --test test/open-task-sync.test.mjs test/workbuddy-auth.test.mjs test/workbuddy-open-api.test.mjs test/workbuddy-oauth-api.test.mjs test/runtime-config.test.mjs test/production-server.test.mjs test/production-build.test.mjs`

Expected: zero failures.

- [ ] **Step 3: Run repository verification**

Run: `npm test`

Expected: zero failures.

Run: `npm run lint`

Expected: zero errors.

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 4: Verify scope and working tree**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only the explicitly listed implementation, test, architecture, and plan files are modified; unrelated `.claude/` remains untracked and unstaged.

- [ ] **Step 5: Commit the verified implementation**

```bash
git add -- PROJECT_ARCHITECTURE.md api/[...path].mjs lib/open-task-sync.mjs lib/workbuddy-auth.mjs lib/runtime-config.mjs server.mjs vercel.json netlify.toml test/open-task-sync.test.mjs test/workbuddy-auth.test.mjs test/workbuddy-open-api.test.mjs test/workbuddy-oauth-api.test.mjs test/runtime-config.test.mjs test/production-server.test.mjs test/production-build.test.mjs docs/superpowers/plans/2026-08-29-workbuddy-wecom-task-integration.md
git commit -m "feat: add WorkBuddy WeCom task integration"
```
