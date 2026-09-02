import assert from "node:assert/strict";
import test from "node:test";

import handler from "../api/[...path].mjs";
import { issueOAuthState } from "../lib/workbuddy-auth.mjs";

process.env.ADMIN_USERNAME = "Admin";
process.env.ADMIN_PASSWORD = "888888";
process.env.ADMIN_SESSION_SECRET = "workbuddy-oauth-admin-secret-32-bytes";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
process.env.WORKBUDDY_OPEN_API_TOKEN = "workbuddy-oauth-open-secret";
process.env.WORKBUDDY_DEPARTMENT_ID = "data-product";
process.env.WORKBUDDY_OAUTH_RESOLVER_URL = "https://workbuddy.internal/oauth/resolve";
process.env.WORKBUDDY_OAUTH_RESOLVER_TOKEN = "workbuddy-oauth-resolver-secret";
process.env.WECOM_OAUTH_CORP_ID = "corp-data-product";

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

async function api(path, { method = "GET", body, headers = {} } = {}) {
  const url = new URL(path, "http://workbench.internal");
  const query = { path: url.pathname.split("/").filter(Boolean) };
  for (const [key, value] of url.searchParams) query[key] = value;
  const req = { method, headers, query, body };
  const res = mockRes();
  await handler(req, res);
  return res;
}

function oauthState(returnTo = "/") {
  return issueOAuthState(
    { returnTo },
    { secret: process.env.WORKBUDDY_OAUTH_RESOLVER_TOKEN, now: Date.now() },
  );
}

function resolverResponse(overrides = {}) {
  return new Response(JSON.stringify({
    wecom_userid: "wx-zhongnanhai",
    username: "zhongnanhai",
    corp_id: "corp-data-product",
    department_id: "data-product",
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

let taskId = "";

test.before(async () => {
  const registered = await api("/auth/register", {
    method: "POST",
    body: { username: "zhongnanhai", password: "12345678", displayName: "钟南海" },
  });
  assert.equal(registered.statusCode, 201);
  const login = await api("/auth/login", {
    method: "POST",
    body: { username: "zhongnanhai", password: "12345678" },
  });
  assert.equal(login.statusCode, 200);
  const week = await api("/weeks", {
    method: "POST",
    headers: { "x-user-token": login.body.token },
    body: { startDate: "2096-01-08", endDate: "2096-01-14" },
  });
  const task = await api(`/week/${encodeURIComponent(week.body.week.id)}/tasks`, {
    method: "POST",
    headers: { "x-user-token": login.body.token },
    body: { task: { title: "OAuth 映射任务", status: "进行中" } },
  });
  taskId = task.body.task.id;
});

test("OAuth callback auto-fills an exact registered account and creates a reusable session cookie", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, process.env.WORKBUDDY_OAUTH_RESOLVER_URL);
    assert.equal(options.headers.authorization, `Bearer ${process.env.WORKBUDDY_OAUTH_RESOLVER_TOKEN}`);
    assert.deepEqual(JSON.parse(options.body), { code: "valid-code" });
    return resolverResponse();
  };
  const state = oauthState("/");
  try {
    const callback = await api(`/wecom/callback?code=valid-code&state=${encodeURIComponent(state)}`);
    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, "/");
    assert.match(callback.headers["set-cookie"], /^workbench_session=/);
    assert.match(callback.headers["set-cookie"], /HttpOnly/);

    const cookie = callback.headers["set-cookie"].split(";", 1)[0];
    const me = await api("/auth/me", { headers: { cookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.body.user.username, "zhongnanhai");

    const tasks = await api("/open/tasks?updated_since=0", {
      headers: { authorization: `Bearer ${process.env.WORKBUDDY_OPEN_API_TOKEN}` },
    });
    assert.equal(tasks.body.tasks.find((task) => task.task_id === taskId).assignee_userid, "wx-zhongnanhai");

    const replay = await api(`/wecom/callback?code=valid-code&state=${encodeURIComponent(state)}`);
    assert.equal(replay.statusCode, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth callback rejects mapping conflicts and unrecognized identities", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => resolverResponse({ wecom_userid: "wx-replacement" });
    const conflict = await api(`/wecom/callback?code=conflict&state=${encodeURIComponent(oauthState())}`);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, "WECOM_MAPPING_CONFLICT");

    globalThis.fetch = async () => resolverResponse({ username: "missing-user", wecom_userid: "wx-missing" });
    const missing = await api(`/wecom/callback?code=missing&state=${encodeURIComponent(oauthState())}`);
    assert.equal(missing.statusCode, 403);

    globalThis.fetch = async () => resolverResponse({ corp_id: "another-corp" });
    const wrongCorp = await api(`/wecom/callback?code=wrong-corp&state=${encodeURIComponent(oauthState())}`);
    assert.equal(wrongCorp.statusCode, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth resolver failure does not affect password login", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  try {
    const callback = await api(`/wecom/callback?code=unavailable&state=${encodeURIComponent(oauthState())}`);
    assert.equal(callback.statusCode, 502);

    const login = await api("/auth/login", {
      method: "POST",
      body: { username: "zhongnanhai", password: "12345678" },
    });
    assert.equal(login.statusCode, 200);
    assert.ok(login.body.token);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
