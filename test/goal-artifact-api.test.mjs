import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "goal-artifact-api-"));
process.env.ARTIFACT_STORAGE_DIR = artifactRoot;
process.env.ADMIN_USERNAME = "Admin";
process.env.ADMIN_PASSWORD = "888888";
process.env.ADMIN_SESSION_SECRET = "goal-artifact-api-admin-secret-32-bytes";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

const { default: handler } = await import(`../api/[...path].mjs?goal-artifact-api=${Date.now()}`);

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end(body) { this.body = body; return this; },
  };
}

let token = "";

async function jsonApi(route, { method = "GET", body, authToken = token, headers = {} } = {}) {
  const req = {
    method,
    headers: { ...(authToken ? { "x-user-token": authToken } : {}), ...headers },
    query: { path: route.split("/").filter(Boolean) },
    body,
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

async function multipartApi(route, { filename, mimeType, content, authToken = token }) {
  const boundary = `artifact-${randomUUID()}`;
  const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const req = Readable.from(Buffer.concat([prefix, content, suffix]));
  req.method = "POST";
  req.headers = {
    ...(authToken ? { "x-user-token": authToken } : {}),
    "content-type": `multipart/form-data; boundary=${boundary}`,
  };
  req.query = { path: route.split("/").filter(Boolean) };
  const res = mockRes();
  await handler(req, res);
  return res;
}

test.before(async () => {
  const settings = await jsonApi("/settings", { authToken: "" });
  const username = `artifact${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const adminLogin = await jsonApi("/admin/login", { method: "POST", authToken: "", body: { username: "Admin", password: "888888" } });
  const saved = await jsonApi("/admin/settings", {
    method: "POST",
    authToken: "",
    headers: { authorization: `Bearer ${adminLogin.body.token}` },
    body: {
      departments: settings.body.settings.departments,
      accounts: [...settings.body.settings.accounts, { name: "张三", username, departmentId: settings.body.settings.departments[0].id }],
      sessionDurationMinutes: settings.body.settings.sessionDurationMinutes,
      ai: settings.body.settings.ai,
    },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal((await jsonApi("/auth/register", { method: "POST", authToken: "", body: { username, password: "12345678", displayName: "张三" } })).statusCode, 201);
  const login = await jsonApi("/auth/login", { method: "POST", authToken: "", body: { username, password: "12345678" } });
  token = login.body.token;
});

test.after(async () => {
  await rm(artifactRoot, { recursive: true, force: true });
});

test("uploads previews downloads and deletes one goal artifact", async () => {
  const savedGoals = await jsonApi("/goals", {
    method: "POST",
    body: { year: "2026", rows: [{ name: "收入", owner: "张三", status: "正常" }] },
  });
  const goalId = savedGoals.body.rows[0].id;

  const uploaded = await multipartApi(`/goals/${goalId}/artifact`, {
    filename: "结果.pdf",
    mimeType: "application/pdf",
    content: Buffer.from("%PDF-api-result"),
  });
  assert.equal(uploaded.statusCode, 201);
  assert.equal(uploaded.body.artifact.originalName, "结果.pdf");
  assert.equal(uploaded.body.artifact.storageKey, undefined);

  const goals = await jsonApi("/goals");
  assert.equal(goals.body.rows[0].artifact.originalName, "结果.pdf");
  assert.equal(goals.body.rows[0].canManageArtifact, true);

  const preview = await jsonApi(`/goals/${goalId}/artifact/preview`);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.headers["Content-Type"], "application/pdf");
  assert.equal(preview.body.toString(), "%PDF-api-result");

  const download = await jsonApi(`/goals/${goalId}/artifact/download`);
  assert.match(download.headers["Content-Disposition"], /^attachment/);
  assert.equal(download.body.toString(), "%PDF-api-result");

  const clientEdit = await jsonApi("/goals", {
    method: "POST",
    body: { year: "2026", rows: [{ ...goals.body.rows[0], name: "年度收入", artifact: null }] },
  });
  assert.equal(clientEdit.body.rows[0].artifact.originalName, "结果.pdf");

  const removed = await jsonApi(`/goals/${goalId}/artifact`, { method: "DELETE" });
  assert.equal(removed.statusCode, 200);
  assert.equal((await jsonApi("/goals")).body.rows[0].artifact, null);
});

test("artifact endpoints reject anonymous and invalid uploads", async () => {
  const goals = await jsonApi("/goals");
  const goalId = goals.body.rows[0].id;
  const anonymous = await multipartApi(`/goals/${goalId}/artifact`, {
    authToken: "",
    filename: "结果.pdf",
    mimeType: "application/pdf",
    content: Buffer.from("%PDF-result"),
  });
  assert.equal(anonymous.statusCode, 401);

  const invalid = await multipartApi(`/goals/${goalId}/artifact`, {
    filename: "脚本.exe",
    mimeType: "application/octet-stream",
    content: Buffer.from("MZ"),
  });
  assert.equal(invalid.statusCode, 400);
});
