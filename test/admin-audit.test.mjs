import test from "node:test";
import assert from "node:assert/strict";

import { appendAdminAudit, listAdminAudit } from "../lib/admin-audit.mjs";
import { hydrateState } from "../api/[...path].mjs";

function record(overrides = {}) {
  return {
    actorUsername: "alice",
    actorRole: "leader",
    departmentId: "sales",
    action: "settings.update",
    targetType: "settings",
    targetId: "global",
    result: "success",
    summary: "updated",
    ...overrides,
  };
}

test("appendAdminAudit redacts sensitive summary values and truncates to 500 characters", () => {
  const state = { adminAudit: [] };
  const item = appendAdminAudit(state, record({
    summary: `password:open API_KEY=abc token:xyz Secret=q authorization:Bearer credential; note=${"x".repeat(600)}`,
  }), { now: new Date("2026-08-31T00:00:00.000Z") });

  assert.match(item.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(item.createdAt, "2026-08-31T00:00:00.000Z");
  assert.equal(item.summary.length, 500);
  assert.match(item.summary, /password=\[REDACTED\]/i);
  assert.match(item.summary, /API_KEY=\[REDACTED\]/i);
  assert.doesNotMatch(item.summary, /open|abc|xyz|Bearer/);
});

test("appendAdminAudit redacts an entire bearer authorization credential", () => {
  const state = { adminAudit: [] };
  const item = appendAdminAudit(state, record({
    summary: "request failed Authorization: Bearer real-access-token-123, retrying",
  }), { now: new Date("2026-08-31T00:00:00.000Z") });

  assert.doesNotMatch(item.summary, /real-access-token-123/);
  assert.match(item.summary, /Authorization=\[REDACTED\]/);
});

test("listAdminAudit limits leaders to their department and lets admins see all", () => {
  const state = { adminAudit: [
    record({ id: "new-sales", createdAt: "2026-08-31T02:00:00.000Z" }),
    record({ id: "hr", departmentId: "hr", createdAt: "2026-08-31T01:00:00.000Z" }),
    record({ id: "old-sales", createdAt: "2026-08-31T00:00:00.000Z" }),
  ] };

  const options = { now: new Date("2026-08-31T03:00:00.000Z") };
  assert.deepEqual(listAdminAudit(state, { role: "leader", departmentId: "sales" }, options).map((item) => item.id), ["new-sales", "old-sales"]);
  assert.deepEqual(listAdminAudit(state, { role: "admin" }, options).map((item) => item.id), ["new-sales", "hr", "old-sales"]);
});

test("listAdminAudit hides records older than 180 days for admins and leaders", () => {
  const now = new Date("2026-08-31T00:00:00.000Z");
  const cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const state = { adminAudit: [
    record({ id: "cutoff", createdAt: cutoff.toISOString() }),
    record({ id: "expired", createdAt: new Date(cutoff.getTime() - 1).toISOString() }),
  ] };

  assert.deepEqual(listAdminAudit(state, { role: "admin" }, { now }).map((item) => item.id), ["cutoff"]);
  assert.deepEqual(listAdminAudit(state, { role: "leader", departmentId: "sales" }, { now }).map((item) => item.id), ["cutoff"]);
});

test("appendAdminAudit retains 180 days, caps at 5000, and orders newest first", () => {
  const now = new Date("2026-08-31T00:00:00.000Z");
  const cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const state = { adminAudit: [
    record({ id: "cutoff", createdAt: cutoff }),
    record({ id: "expired", createdAt: new Date(Date.parse(cutoff) - 1).toISOString() }),
    ...Array.from({ length: 4_998 }, (_, index) => record({
      id: `existing-${index}`,
      createdAt: new Date(now.getTime() - index - 1).toISOString(),
    })),
  ] };

  appendAdminAudit(state, record({ summary: "new" }), { now });

  assert.equal(state.adminAudit.length, 5_000);
  assert.equal(state.adminAudit[0].summary, "new");
  assert.ok(state.adminAudit.every((item, index, items) => index === 0 || item.createdAt <= items[index - 1].createdAt));
  assert.ok(state.adminAudit.some((item) => item.id === "cutoff"));
  assert.ok(!state.adminAudit.some((item) => item.id === "expired"));
});

test("hydrateState supplies an empty audit list for legacy and malformed state", () => {
  assert.deepEqual(hydrateState({}).adminAudit, []);
  assert.deepEqual(hydrateState({ adminAudit: null }).adminAudit, []);
});
