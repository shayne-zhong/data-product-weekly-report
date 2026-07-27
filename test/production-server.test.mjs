import test from "node:test";
import assert from "node:assert/strict";

import { createProductionServer } from "../server.mjs";
import * as productionServer from "../server.mjs";

process.env.ADMIN_USERNAME = "admin-test";
process.env.ADMIN_PASSWORD = "admin-password-test";
process.env.ADMIN_SESSION_SECRET = "production-server-admin-session-secret-32-bytes";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("production server forwards API query parameters", () => {
  assert.equal(typeof productionServer.apiQueryFromUrl, "function");
  const query = productionServer.apiQueryFromUrl(
    new URL("http://localhost/api/tasks?startDate=2026-07-01&endDate=2026-07-31"),
  );
  assert.deepEqual(query, {
    path: ["tasks"],
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  });
});

test("production server serves health, UI, and protected API", async () => {
  const server = createProductionServer({ deploymentVersion: "test-version" });
  await listen(server);
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const healthResponse = await fetch(`${origin}/healthz`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { status: "ok", version: "test-version" });

    const home = await fetch(origin);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<title>部门工作台<\/title>/);

    assert.equal((await fetch(`${origin}/admin`)).status, 200);
    assert.equal((await fetch(`${origin}/favicon.svg`)).status, 200);

    const protectedResponse = await fetch(`${origin}/api/weeks`);
    assert.equal(protectedResponse.status, 401);
  } finally {
    await close(server);
  }
});

test("production server does not expose files outside public", async () => {
  const server = createProductionServer({ deploymentVersion: "test-version" });
  await listen(server);
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    assert.equal((await fetch(`${origin}/..%2Fpackage.json`)).status, 404);
  } finally {
    await close(server);
  }
});
