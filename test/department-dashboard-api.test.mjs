import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { defaultLocalStatePath } from "../lib/state-store.mjs";

process.env.ADMIN_USERNAME = "dashboard-admin";
process.env.ADMIN_PASSWORD = "dashboard-test-only-password";
process.env.ADMIN_SESSION_SECRET = "dashboard-test-only-session-secret-32bytes";

let handler;
let adminHeaders;
let leaderHeaders;
const departmentId = "data-product";
const query = "/admin/dashboard?departmentId=data-product&year=2026&period=m01";

async function request(path, { method = "GET", body, headers = {} } = {}) {
  const url = new URL(path, "http://dashboard.test");
  const req = { method, body, headers, query: { path: url.pathname.split("/").filter(Boolean) } };
  for (const [key, value] of url.searchParams) req.query[key] = value;
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    },
  };
  await handler(req, res);
  return res;
}

function document(batchId, value = 12, dept = departmentId) {
  return {
    schemaVersion: 1,
    batchId,
    departmentId: dept,
    sourceId: "bi-validation",
    sourceName: "隔离验证来源",
    asOf: new Date().toISOString(),
    records: [
      {
        metric: "report_visits",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        value,
        unit: "count",
        dimensionType: "total",
        dimension: "",
        coverage: "complete",
      },
    ],
  };
}

test.before(async () => {
  await rm(defaultLocalStatePath(), { force: true });
  ({ default: handler } = await import(`../api/[...path].mjs?dashboard-api=${Date.now()}`));
  const login = await request("/admin/login", {
    method: "POST",
    body: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(login.statusCode, 200);
  adminHeaders = { authorization: `Bearer ${login.body.token}` };
  const current = await request("/admin/settings", { headers: adminHeaders });
  const settings = current.body.settings;
  const updated = await request("/admin/settings", {
    method: "PATCH",
    headers: adminHeaders,
    body: {
      departments: [
        ...settings.departments.map((d) => (d.id === departmentId ? { ...d, leaderUsername: "zhongnanhai" } : d)),
        { id: "dashboard-other", name: "隔离验证部门", enabled: true, modules: ["验证模块"], leaderUsername: "" },
      ],
      accounts: settings.accounts,
    },
  });
  assert.equal(updated.statusCode, 200);
  const registered = await request("/auth/register", {
    method: "POST",
    body: { username: "zhongnanhai", password: "dashboard-leader-test-password", displayName: "钟南海" },
  });
  assert.equal(registered.statusCode, 201);
  const leader = await request("/admin/login", {
    method: "POST",
    body: { username: "zhongnanhai", password: "dashboard-leader-test-password" },
  });
  assert.equal(leader.statusCode, 200);
  leaderHeaders = { authorization: `Bearer ${leader.body.token}` };
});

test.after(async () => {
  await rm(defaultLocalStatePath(), { force: true });
});

test("dashboard only accepts authenticated admin roles and scopes the leader", async () => {
  assert.equal((await request(query)).statusCode, 401);
  const own = await request(query, { headers: leaderHeaders });
  assert.equal(own.statusCode, 200);
  assert.equal(own.body.context.departmentId, departmentId);
  assert.equal(own.body.context.departments.length, 1);
  const other = await request("/admin/dashboard?departmentId=dashboard-other", { headers: leaderHeaders });
  assert.equal(other.statusCode, 403);
  const global = await request("/admin/dashboard?departmentId=dashboard-other", { headers: adminHeaders });
  assert.equal(global.statusCode, 200);
  assert.equal(global.body.context.departmentId, "dashboard-other");
});

test("preview is read-only; confirmed import persists and is idempotent", async () => {
  const before = await request(query, { headers: adminHeaders });
  const doc = document("api-import-1");
  const preview = await request("/admin/dashboard/imports/preview", {
    method: "POST",
    headers: adminHeaders,
    body: { departmentId, document: doc },
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(typeof preview.body.previewHash, "string");
  const notWritten = await request(query, { headers: adminHeaders });
  assert.equal(notWritten.body.revision, before.body.revision);
  assert.equal(notWritten.body.metrics.find((m) => m.id === "report_visits").value, null);
  const body = {
    departmentId,
    document: doc,
    previewHash: preview.body.previewHash,
    expectedRevision: preview.body.revision,
  };
  const commit = await request("/admin/dashboard/imports", { method: "POST", headers: adminHeaders, body });
  assert.equal(commit.statusCode, 200);
  const reread = await request(query, { headers: adminHeaders });
  assert.equal(reread.body.metrics.find((m) => m.id === "report_visits").value, 12);
  assert.equal(reread.body.revision, before.body.revision + 1);
  const repeat = await request("/admin/dashboard/imports", { method: "POST", headers: adminHeaders, body });
  assert.equal(repeat.statusCode, 200);
  assert.equal(repeat.body.duplicate, true);
  assert.equal((await request(query, { headers: adminHeaders })).body.revision, reread.body.revision);
});

test("invalid records, cross-department imports and changed previews cannot write", async () => {
  const before = await request(query, { headers: adminHeaders });
  const bad = document("api-invalid", -1);
  assert.equal(
    (
      await request("/admin/dashboard/imports/preview", {
        method: "POST",
        headers: adminHeaders,
        body: { departmentId, document: bad },
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await request("/admin/dashboard/imports/preview", {
        method: "POST",
        headers: leaderHeaders,
        body: { departmentId: "dashboard-other", document: document("api-cross", 3, "dashboard-other") },
      })
    ).statusCode,
    403,
  );
  const doc = document("api-changed", 15);
  const preview = await request("/admin/dashboard/imports/preview", {
    method: "POST",
    headers: adminHeaders,
    body: { departmentId, document: doc },
  });
  assert.equal(preview.statusCode, 200);
  const changed = { ...doc, records: [{ ...doc.records[0], value: 16 }] };
  const refused = await request("/admin/dashboard/imports", {
    method: "POST",
    headers: adminHeaders,
    body: {
      departmentId,
      document: changed,
      previewHash: preview.body.previewHash,
      expectedRevision: preview.body.revision,
    },
  });
  assert.equal(refused.statusCode, 409);
  assert.equal((await request(query, { headers: adminHeaders })).body.revision, before.body.revision);
});

test("existing overview contract and dashboard metric statuses remain distinct", async () => {
  const old = await request("/admin/overview", { headers: adminHeaders });
  assert.equal(old.statusCode, 200);
  assert.equal(typeof old.body.metrics.activeMembers, "number");
  const dashboard = await request(query, { headers: adminHeaders });
  assert.equal(dashboard.statusCode, 200);
  assert.equal(dashboard.body.metrics.find((m) => m.id === "business_users").value, null);
  assert.equal(dashboard.body.metrics.find((m) => m.id === "token_total").value, null);
  assert.equal(typeof dashboard.body.operations.activeAccounts, "number");
});

test("import byte limit includes whitespace and rejects before changing state", async () => {
  const before = await request(query, { headers: adminHeaders });
  const padded = JSON.stringify({ departmentId, document: document("api-too-large") }) + " ".repeat(1024 * 1024);
  const response = await request("/admin/dashboard/imports/preview", {
    method: "POST",
    headers: adminHeaders,
    body: padded,
  });
  assert.equal(response.statusCode, 413);
  assert.equal(response.body.code, "DASHBOARD_BODY_TOO_LARGE");
  assert.equal((await request(query, { headers: adminHeaders })).body.revision, before.body.revision);
});
