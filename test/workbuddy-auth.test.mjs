import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDirectoryMappings,
  bindWecomUserId,
  consumeOAuthState,
  issueOAuthState,
  resolveWorkbuddyIdentity,
  workbuddyTokenValid,
} from "../lib/workbuddy-auth.mjs";

test("WorkBuddy bearer token validation requires an exact configured value", () => {
  assert.equal(workbuddyTokenValid("Bearer open-secret", "open-secret"), true);
  assert.equal(workbuddyTokenValid("Bearer wrong", "open-secret"), false);
  assert.equal(workbuddyTokenValid("open-secret", "open-secret"), false);
  assert.equal(workbuddyTokenValid("Bearer open-secret", ""), false);
});

test("binding uses an exact account and enforces one-to-one userid mapping", () => {
  const accounts = [
    { username: "zhangsan", departmentId: "data-product", wecomUserId: "wx-zhangsan" },
    { username: "lisi", departmentId: "data-product" },
  ];

  assert.equal(bindWecomUserId(accounts, "LISI", "wx-lisi").wecomUserId, "wx-lisi");
  assert.throws(() => bindWecomUserId(accounts, "missing", "wx-missing"), /not found/);
  assert.throws(() => bindWecomUserId(accounts, "lisi", "wx-zhangsan"), /already bound/);
  assert.throws(() => bindWecomUserId(accounts, "zhangsan", "wx-replacement"), /already bound/);
  assert.throws(() => bindWecomUserId(accounts, "lisi", ""), /required/);
});

test("directory mapping is department scoped, conflict safe, and batch idempotent", () => {
  const state = {
    settings: {
      accounts: [
        { username: "zhangsan", departmentId: "data-product" },
        { username: "lisi", departmentId: "data-product", wecomUserId: "wx-used" },
        { username: "wangwu", departmentId: "other" },
      ],
    },
  };
  const mappings = [
    { username: "zhangsan", wecom_userid: "wx-zhangsan" },
    { username: "lisi", wecom_userid: "wx-zhangsan" },
    { username: "wangwu", wecom_userid: "wx-wangwu" },
    { username: "missing", wecom_userid: "wx-missing" },
  ];

  const first = applyDirectoryMappings(state, mappings, { departmentId: "data-product", batchId: "batch-1" });
  assert.deepEqual(first, { batchId: "batch-1", bound: 1, skipped: 2, conflicts: 1 });
  assert.equal(state.settings.accounts[0].wecomUserId, "wx-zhangsan");
  assert.equal(state.settings.accounts[2].wecomUserId, undefined);

  const second = applyDirectoryMappings(state, [], { departmentId: "data-product", batchId: "batch-1" });
  assert.deepEqual(second, first);
});

test("signed OAuth state expires, rejects unsafe returns, and can be consumed only once", () => {
  const secret = "01234567890123456789012345678901";
  const state = {};
  const token = issueOAuthState({ returnTo: "/tasks" }, { secret, now: 1_000 });

  assert.equal(consumeOAuthState(state, token, { secret, now: 2_000 }).returnTo, "/tasks");
  assert.throws(() => consumeOAuthState(state, token, { secret, now: 2_000 }), /already used/);

  const expired = issueOAuthState({ returnTo: "/" }, { secret, now: 1_000 });
  assert.throws(() => consumeOAuthState({}, expired, { secret, now: 400_001 }), /Expired/);

  assert.throws(
    () => issueOAuthState({ returnTo: "//evil.example" }, { secret, now: 1_000 }),
    /return path/,
  );
});

test("identity resolver sends code server-to-server and validates its response", async () => {
  const calls = [];
  const identity = await resolveWorkbuddyIdentity("oauth-code", {
    url: "https://workbuddy.internal/resolve",
    token: "resolver-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        wecom_userid: "wx-zhangsan",
        username: "zhangsan",
        corp_id: "corp-1",
        department_id: "data-product",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(identity.wecom_userid, "wx-zhangsan");
  assert.equal(calls[0].url, "https://workbuddy.internal/resolve");
  assert.equal(calls[0].options.headers.authorization, "Bearer resolver-secret");
  assert.deepEqual(JSON.parse(calls[0].options.body), { code: "oauth-code" });

  await assert.rejects(() => resolveWorkbuddyIdentity("bad", {
    url: "https://workbuddy.internal/resolve",
    token: "resolver-secret",
    fetchImpl: async () => new Response("bad", { status: 502 }),
  }), /resolver failed/);
});
