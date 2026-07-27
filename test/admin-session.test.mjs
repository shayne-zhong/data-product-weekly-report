import test from "node:test";
import assert from "node:assert/strict";

import { issueAdminToken, verifyAdminToken } from "../lib/admin-session.mjs";

const env = { ADMIN_SESSION_SECRET: "admin-session-secret-longer-than-32-bytes" };

test("admin tokens are signed and expire", async () => {
  const issued = await issueAdminToken({ username: "Admin", now: 1_000, ttlMs: 60_000, env });
  const valid = await verifyAdminToken(issued.token, { now: 2_000, env });

  assert.equal(valid.username, "admin");
  assert.equal(issued.expiresAt, 61_000);
  assert.equal(await verifyAdminToken(`${issued.token}x`, { now: 2_000, env }), null);
  assert.equal(await verifyAdminToken(issued.token, { now: 61_001, env }), null);
});

test("admin sessions reject missing or weak signing secrets", async () => {
  await assert.rejects(
    () => issueAdminToken({ username: "admin", env: { ADMIN_SESSION_SECRET: "short" } }),
    /ADMIN_SESSION_SECRET/,
  );
  assert.equal(await verifyAdminToken("invalid", { env: {} }), null);
});
