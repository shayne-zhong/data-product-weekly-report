import test from "node:test";
import assert from "node:assert/strict";

import { createProductionServer } from "../server.mjs";
import * as productionServer from "../server.mjs";

process.env.ADMIN_USERNAME = "admin-test";
process.env.ADMIN_PASSWORD = "admin-password-test";
process.env.ADMIN_SESSION_SECRET = "production-server-admin-session-secret-32-bytes";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");
process.env.WORKBUDDY_DEPARTMENT_ID = "data-product";
process.env.WORKBUDDY_OAUTH_RESOLVER_URL = "https://workbuddy.internal/oauth/resolve";
process.env.WORKBUDDY_OAUTH_RESOLVER_TOKEN = "production-server-workbuddy-oauth-secret";
process.env.WECOM_OAUTH_CORP_ID = "corp-data-product";

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

test("production server schedules Beijing Monday rollover and runs startup catch-up", async () => {
  const sunday = Date.parse("2026-08-16T23:55:00+08:00");
  assert.equal(productionServer.millisecondsUntilNextWeeklyRollover(sunday), 10 * 60 * 1000);
  const mondayAfter = Date.parse("2026-08-17T00:06:00+08:00");
  assert.equal(productionServer.millisecondsUntilNextWeeklyRollover(mondayAfter), 7 * 24 * 60 * 60 * 1000 - 60 * 1000);

  const calls = [];
  const timers = [];
  const scheduler = productionServer.startWeeklyRolloverScheduler({
    run: async (options) => { calls.push(options); return { rolledTaskCount: 0 }; },
    now: () => sunday,
    setTimeoutImpl(callback, delay) {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl() {},
    logger: { info() {}, error() {} },
  });
  await scheduler.startup;
  assert.deepEqual(calls, [{ triggeredAt: sunday, trigger: "server-startup" }]);
  assert.equal(timers[0].delay, 10 * 60 * 1000);
  await timers[0].callback();
  assert.equal(calls[1].trigger, "server-scheduled");
  assert.equal(calls[1].triggeredAt, Date.parse("2026-08-17T00:05:00+08:00"));
  scheduler.stop();
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

test("intranet server forwards the exact WeCom callback path to the backend", async () => {
  const server = createProductionServer({ deploymentVersion: "test-version" });
  await listen(server);
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${origin}/wecom/callback?code=missing-state`);
    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await response.json(), { error: "code and state are required" });
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
