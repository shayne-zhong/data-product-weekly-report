import { randomUUID } from "node:crypto";

const retentionMs = 30 * 24 * 60 * 60 * 1_000;
const maxEvents = 5_000;
const sourceValues = new Set(["website", "workbuddy"]);
const resultValues = new Set(["success", "failed", "skipped", "retrying"]);
const actionValues = new Set([
  "polled",
  "poll_failed",
  "writeback_completed",
  "writeback_terminal",
  "writeback_rejected",
  "oauth_mapped",
  "oauth_rejected",
  "config_changed",
  "mapping_changed",
  "created",
  "updated",
  "recreated",
  "skipped",
  "failed",
  "retry_scheduled",
]);

function text(value) {
  return String(value || "").trim();
}

function bucket(state) {
  state.workbuddy ||= {};
  state.workbuddy.syncEvents ||= [];
  state.workbuddy.syncEventIds ||= {};
  return state.workbuddy;
}

function cleanMessage(value) {
  return String(value || "")
    .replace(/authorization\s*:\s*bearer\s+\S+/gi, "[credential removed]")
    .replace(/(token|code|secret)\s*[=:]\s*\S+/gi, "$1=[credential removed]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500);
}

function compareEvents(left, right) {
  return Number(right.occurredAt) - Number(left.occurredAt)
    || String(right.id).localeCompare(String(left.id));
}

function encodeCursor(event) {
  return Buffer.from(JSON.stringify({
    occurredAt: event.occurredAt,
    id: event.id,
  })).toString("base64url");
}

function decodeCursor(value) {
  if (!text(value)) return null;
  try {
    const cursor = JSON.parse(Buffer.from(text(value), "base64url").toString("utf8"));
    if (!Number.isFinite(cursor?.occurredAt) || !text(cursor?.id)) throw new Error();
    return { occurredAt: Number(cursor.occurredAt), id: text(cursor.id) };
  } catch {
    throw new Error("Invalid sync event cursor");
  }
}

function isBeforeCursor(event, cursor) {
  if (!cursor) return true;
  return event.occurredAt < cursor.occurredAt
    || (event.occurredAt === cursor.occurredAt && event.id.localeCompare(cursor.id) < 0);
}

export function pruneSyncEvents(state, { now = Date.now() } = {}) {
  const target = bucket(state);
  target.syncEvents = target.syncEvents
    .filter((event) => Number(event.occurredAt) >= now - retentionMs)
    .sort(compareEvents)
    .slice(0, maxEvents);
  target.syncEventIds = Object.fromEntries(
    target.syncEvents
      .filter((event) => text(event.externalEventId))
      .map((event) => [event.externalEventId, event.id]),
  );
  return target.syncEvents;
}

export function appendSyncEvent(
  state,
  input,
  { now = Date.now(), idFactory = () => `sync_${randomUUID()}` } = {},
) {
  const target = bucket(state);
  const externalEventId = text(input?.externalEventId).slice(0, 128);
  const existingId = externalEventId ? target.syncEventIds[externalEventId] : "";
  if (existingId) {
    const existing = target.syncEvents.find((event) => event.id === existingId);
    if (existing) return { duplicate: true, event: existing };
    delete target.syncEventIds[externalEventId];
  }

  if (!sourceValues.has(input?.source)) throw new Error("Invalid sync event source");
  if (!actionValues.has(input?.action)) throw new Error("Invalid sync event action");
  if (!resultValues.has(input?.result)) throw new Error("Invalid sync event result");
  const occurredAt = Number(input?.occurredAt);
  if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) {
    throw new Error("Invalid sync event occurredAt");
  }

  const event = {
    id: idFactory(),
    externalEventId,
    source: input.source,
    action: input.action,
    result: input.result,
    taskId: text(input.taskId).slice(0, 128),
    taskTitle: text(input.taskTitle).slice(0, 200),
    username: text(input.username).slice(0, 100),
    displayName: text(input.displayName).slice(0, 100),
    wecomTodoId: text(input.wecomTodoId).slice(0, 128),
    attempt: Math.max(0, Math.min(100, Number(input.attempt) || 0)),
    message: cleanMessage(input.message),
    occurredAt,
    recordedAt: now,
  };
  target.syncEvents.push(event);
  if (externalEventId) target.syncEventIds[externalEventId] = event.id;
  pruneSyncEvents(state, { now });
  return { duplicate: false, event };
}

export function querySyncEvents(state, options = {}) {
  pruneSyncEvents(state, { now: options.now ?? Date.now() });
  const target = bucket(state);
  const cursor = decodeCursor(options.before);
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 50));
  const keyword = text(options.keyword).toLowerCase();
  const searchable = (event) => [
    event.taskId,
    event.taskTitle,
    event.username,
    event.displayName,
    event.wecomTodoId,
    event.message,
  ].join(" ").toLowerCase();

  const filtered = target.syncEvents.filter((event) => (
    isBeforeCursor(event, cursor)
    && (!options.source || event.source === options.source)
    && (!options.result || event.result === options.result)
    && (!options.action || event.action === options.action)
    && (!keyword || searchable(event).includes(keyword))
  ));
  const events = filtered.slice(0, limit);
  return {
    events,
    nextBefore: filtered.length > events.length && events.length
      ? encodeCursor(events.at(-1))
      : "",
  };
}

export function summarizeSyncEvents(state, { now = Date.now() } = {}) {
  pruneSyncEvents(state, { now });
  const summary = { success: 0, failed: 0, skipped: 0, retrying: 0 };
  const threshold = now - 24 * 60 * 60 * 1_000;
  for (const event of bucket(state).syncEvents) {
    if (event.occurredAt >= threshold && Object.hasOwn(summary, event.result)) {
      summary[event.result] += 1;
    }
  }
  return summary;
}
