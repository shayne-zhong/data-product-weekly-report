import { createHash } from "node:crypto";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function objectCount(value) {
  return value && typeof value === "object" ? Object.keys(value).length : 0;
}

export function stateCounts(state = {}) {
  const departmentGoals = Object.values(state.goalsByDepartment || {});
  const goalRows = departmentGoals.length
    ? departmentGoals.reduce((sum, goal) => sum + (Array.isArray(goal?.rows) ? goal.rows.length : 0), 0)
    : Array.isArray(state.goals?.rows)
      ? state.goals.rows.length
      : 0;
  return {
    users: objectCount(state.users),
    sessions: objectCount(state.sessions),
    weeks: objectCount(state.weeks),
    tasks: objectCount(state.tasks),
    reports: objectCount(state.reports),
    goalRows,
    departments: Array.isArray(state.settings?.departments) ? state.settings.departments.length : 0,
  };
}

export function fingerprintState(state) {
  const canonical = JSON.stringify(stableValue(state));
  return {
    sha256: createHash("sha256").update(canonical).digest("hex"),
    bytes: Buffer.byteLength(canonical),
    counts: stateCounts(state),
  };
}

export function assertStateFingerprint(state, expected) {
  const actual = fingerprintState(state);
  if (
    actual.sha256 !== expected?.sha256 ||
    actual.bytes !== expected?.bytes ||
    JSON.stringify(actual.counts) !== JSON.stringify(expected?.counts)
  ) {
    throw new Error(`State fingerprint mismatch: expected ${expected?.sha256 || "missing"}, received ${actual.sha256}`);
  }
  return actual;
}
