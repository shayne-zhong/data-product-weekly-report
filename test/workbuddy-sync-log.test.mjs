import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSyncEvent,
  pruneSyncEvents,
  querySyncEvents,
  summarizeSyncEvents,
} from "../lib/workbuddy-sync-log.mjs";

test("duplicate external event IDs return the original row", () => {
  const state = {};
  const first = appendSyncEvent(state, {
    externalEventId: "evt-1",
    source: "workbuddy",
    action: "created",
    result: "success",
    taskId: "task-1",
    occurredAt: 1_000,
  }, { now: 2_000, idFactory: () => "sync-1" });
  const duplicate = appendSyncEvent(state, {
    externalEventId: "evt-1",
    source: "workbuddy",
    action: "created",
    result: "success",
    taskId: "task-1",
    occurredAt: 1_000,
  }, { now: 3_000, idFactory: () => "sync-2" });

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.event.id, "sync-1");
  assert.equal(state.workbuddy.syncEvents.length, 1);
});

test("messages remove credentials, headers, newlines, and excess length", () => {
  const state = {};
  const { event } = appendSyncEvent(state, {
    source: "website",
    action: "poll_failed",
    result: "failed",
    occurredAt: 1_000,
    message: `Authorization: Bearer secret-token-value\ncode=oauth-code ${"x".repeat(800)}`,
  }, { now: 2_000, idFactory: () => "sync-1" });

  assert.doesNotMatch(event.message, /secret-token-value|oauth-code|Authorization|\n/);
  assert.ok(event.message.length <= 500);
});

test("retention removes rows older than 30 days and caps the newest 5000", () => {
  const now = 40 * 86_400_000;
  const events = Array.from({ length: 5_010 }, (_, index) => ({
    id: `sync-${String(index).padStart(5, "0")}`,
    externalEventId: `external-${index}`,
    occurredAt: now - index,
  }));
  events.push({
    id: "sync-old",
    externalEventId: "external-old",
    occurredAt: now - 31 * 86_400_000,
  });
  const state = { workbuddy: { syncEvents: events, syncEventIds: {} } };
  for (const event of events) {
    state.workbuddy.syncEventIds[event.externalEventId] = event.id;
  }

  pruneSyncEvents(state, { now });

  assert.equal(state.workbuddy.syncEvents.length, 5_000);
  assert.equal(state.workbuddy.syncEventIds["external-5009"], undefined);
  assert.equal(state.workbuddy.syncEventIds["external-old"], undefined);
});

test("queries use stable cursor ordering and filters", () => {
  const state = { workbuddy: { syncEvents: [
    {
      id: "b", occurredAt: 2_000, result: "failed", action: "updated",
      source: "workbuddy", username: "zhangsan", taskTitle: "经营分析",
    },
    {
      id: "a", occurredAt: 2_000, result: "success", action: "created",
      source: "workbuddy", username: "lisi", taskTitle: "数据治理",
    },
    {
      id: "c", occurredAt: 1_000, result: "failed", action: "created",
      source: "workbuddy", username: "zhangsan", taskTitle: "月报",
    },
  ] } };

  const first = querySyncEvents(state, {
    result: "failed", keyword: "ZHANGSAN", limit: 1, now: 3_000,
  });
  assert.deepEqual(first.events.map((row) => row.id), ["b"]);
  const second = querySyncEvents(state, {
    result: "failed",
    keyword: "ZHANGSAN",
    limit: 1,
    before: first.nextBefore,
    now: 3_000,
  });
  assert.deepEqual(second.events.map((row) => row.id), ["c"]);
  assert.equal(second.nextBefore, "");
  assert.deepEqual(summarizeSyncEvents(state, { now: 3_000 }), {
    success: 1,
    failed: 2,
    skipped: 0,
    retrying: 0,
  });
});

test("queries can limit rows by an absolute start timestamp", () => {
  const state = { workbuddy: { syncEvents: [
    { id: "new", occurredAt: 2_000, result: "success", action: "created" },
    { id: "old", occurredAt: 1_000, result: "success", action: "created" },
  ] } };

  const result = querySyncEvents(state, { since: 1_500, now: 3_000 });

  assert.deepEqual(result.events.map((event) => event.id), ["new"]);
});

test("invalid event source, action, result, or timestamp is rejected", () => {
  const valid = {
    source: "website",
    action: "polled",
    result: "success",
    occurredAt: 1_000,
  };
  assert.throws(() => appendSyncEvent({}, { ...valid, source: "browser" }), /source/);
  assert.throws(() => appendSyncEvent({}, { ...valid, action: "deleted" }), /action/);
  assert.throws(() => appendSyncEvent({}, { ...valid, result: "unknown" }), /result/);
  assert.throws(() => appendSyncEvent({}, { ...valid, occurredAt: NaN }), /occurredAt/);
});
