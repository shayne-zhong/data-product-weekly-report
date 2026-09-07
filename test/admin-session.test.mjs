import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

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

test("tokens carry a role claim that round-trips, defaulting to admin", async () => {
  const leaderToken = await issueAdminToken({ username: "leaduser", role: "leader", now: 1_000, ttlMs: 60_000, env });
  const decodedLeader = await verifyAdminToken(leaderToken.token, { now: 2_000, env });
  assert.equal(decodedLeader.role, "leader");

  const adminToken = await issueAdminToken({ username: "admin", now: 1_000, ttlMs: 60_000, env });
  const decodedAdmin = await verifyAdminToken(adminToken.token, { now: 2_000, env });
  assert.equal(decodedAdmin.role, "admin");
});

function signPayloadForTest(payload) {
  return createHmac("sha256", env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
}

test("a legacy token minted before the role claim existed still decodes as admin", async () => {
  const legacyPayload = Buffer.from(
    JSON.stringify({ username: "admin", issuedAt: 1_000, expiresAt: 61_000 }),
    "utf8",
  ).toString("base64url");
  const legacyToken = `${legacyPayload}.${signPayloadForTest(legacyPayload)}`;

  const decoded = await verifyAdminToken(legacyToken, { now: 2_000, env });
  assert.equal(decoded.role, "admin");
});
