import { randomUUID } from "node:crypto";

const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 5_000;
const SENSITIVE_VALUE = /(password|api[_-]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi;

function newestFirst(left, right) {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

export function appendAdminAudit(state, record, { now = new Date() } = {}) {
  const createdAt = new Date(now).toISOString();
  const item = {
    id: randomUUID(),
    actorUsername: record.actorUsername,
    actorRole: record.actorRole,
    departmentId: record.departmentId,
    action: record.action,
    targetType: record.targetType,
    targetId: record.targetId,
    result: record.result,
    summary: String(record.summary ?? "").replace(SENSITIVE_VALUE, "$1=[REDACTED]").slice(0, 500),
    createdAt,
  };
  const cutoff = Date.parse(createdAt) - RETENTION_MS;
  state.adminAudit = [...(Array.isArray(state.adminAudit) ? state.adminAudit : []), item]
    .filter((entry) => Date.parse(entry.createdAt) >= cutoff)
    .sort(newestFirst)
    .slice(0, MAX_RECORDS);
  return item;
}

export function listAdminAudit(state, actor) {
  const records = [...(Array.isArray(state.adminAudit) ? state.adminAudit : [])].sort(newestFirst);
  return actor.role === "admin" ? records : records.filter((record) => record.departmentId === actor.departmentId);
}
