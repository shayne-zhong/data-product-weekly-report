import test from "node:test";
import assert from "node:assert/strict";

import { assembleLegacyNetlifyState } from "../lib/legacy-netlify-state.mjs";

test("assembles legacy Netlify records and invalidates old sessions", () => {
  const user = { username: "alice" };
  const week = { id: "2026-07-20_2026-07-26" };
  const task = { id: "task-1" };
  const report = { id: "report-1" };
  const goals = { year: "2026", rows: [{ seq: "1" }] };
  const result = assembleLegacyNetlifyState([
    ["users/alice", user],
    [`weeks/${week.id}`, week],
    [`tasks/${task.id}`, task],
    [`reports/${report.id}`, report],
    ["department-goals/current", goals],
    ["sessions/old-session", { username: "alice" }],
  ]);

  assert.deepEqual(result.state.users, { alice: user });
  assert.deepEqual(result.state.weeks, { [week.id]: week });
  assert.deepEqual(result.state.tasks, { [task.id]: task });
  assert.deepEqual(result.state.reports, { [report.id]: report });
  assert.equal(result.state.goals, goals);
  assert.deepEqual(result.state.sessions, {});
  assert.equal(result.ignoredSessions, 1);
});
