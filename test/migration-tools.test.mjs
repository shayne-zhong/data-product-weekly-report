import test from "node:test";
import assert from "node:assert/strict";

import { assertStateFingerprint, fingerprintState } from "../lib/state-fingerprint.mjs";

const state = {
  users: { alice: { username: "alice" } },
  sessions: { session: { username: "alice" } },
  weeks: { week: { id: "week" } },
  tasks: { task: { id: "task" } },
  reports: { report: { id: "report" } },
  goalsByDepartment: { data: { rows: [{ seq: "1" }, { seq: "2" }] } },
  settings: { departments: [{ id: "data" }] },
};

test("state fingerprint is stable and summarizes all migrated entities", () => {
  const reordered = {
    settings: state.settings,
    reports: state.reports,
    tasks: state.tasks,
    weeks: state.weeks,
    sessions: state.sessions,
    users: state.users,
    goalsByDepartment: state.goalsByDepartment,
  };

  const first = fingerprintState(state);
  const second = fingerprintState(JSON.parse(JSON.stringify(reordered)));

  assert.equal(first.sha256, second.sha256);
  assert.equal(first.bytes, second.bytes);
  assert.deepEqual(first.counts, {
    users: 1,
    sessions: 1,
    weeks: 1,
    tasks: 1,
    reports: 1,
    goalRows: 2,
    departments: 1,
  });
});

test("fingerprint verification rejects corrupt metadata", () => {
  const metadata = fingerprintState(state);
  assert.throws(
    () => assertStateFingerprint(state, { ...metadata, sha256: "0".repeat(64) }),
    /fingerprint mismatch/i,
  );
});

test("fingerprint verification rejects a different read-back payload", () => {
  const metadata = fingerprintState(state);
  const changed = structuredClone(state);
  changed.tasks.task.title = "changed after import";

  assert.throws(() => assertStateFingerprint(changed, metadata), /fingerprint mismatch/i);
});
