import assert from "node:assert/strict";
import test from "node:test";

import {
  nextOpenTaskTimestamp,
  projectOpenTask,
  reconcileOpenTasks,
} from "../lib/open-task-sync.mjs";

function fixtureState() {
  return {
    tasks: {
      task_a: {
        id: "task_a",
        departmentId: "data-product",
        title: "准备月报",
        description: "补齐说明",
        ownerUsername: "zhangsan",
        status: "进行中",
        dueDate: "2026-09-01",
        dailyLogs: [],
      },
      task_other: {
        id: "task_other",
        departmentId: "other",
        title: "其他部门任务",
        description: "",
        ownerUsername: "lisi",
        status: "待开始",
        dueDate: "",
      },
    },
    settings: {
      accounts: [
        { username: "zhangsan", departmentId: "data-product", wecomUserId: "wx-zhangsan" },
        { username: "lisi", departmentId: "other", wecomUserId: "wx-lisi" },
      ],
    },
  };
}

test("open task timestamps increase by whole seconds even within one wall-clock second", () => {
  const state = { openTaskClock: 100 };

  assert.equal(nextOpenTaskTimestamp(state, 100_000), 101);
  assert.equal(nextOpenTaskTimestamp(state, 100_000), 102);
  assert.equal(nextOpenTaskTimestamp(state, 99_000), 103);
});

test("reconciliation baselines only the configured department and ignores internal fields", () => {
  const state = fixtureState();

  assert.equal(reconcileOpenTasks(state, { departmentId: "data-product", now: 100_000 }), true);
  const first = state.tasks.task_a.openUpdatedAt;
  assert.equal(first, 100);
  assert.equal(state.tasks.task_other.openUpdatedAt, undefined);

  state.tasks.task_a.dailyLogs.push({ progress: "内部日志" });
  assert.equal(reconcileOpenTasks(state, { departmentId: "data-product", now: 100_000 }), false);
  assert.equal(state.tasks.task_a.openUpdatedAt, first);

  state.tasks.task_a.title = "准备月报 V2";
  assert.equal(reconcileOpenTasks(state, { departmentId: "data-product", now: 100_000 }), true);
  assert.equal(state.tasks.task_a.openUpdatedAt, 101);
});

test("mapping changes restamp assigned tasks and projection follows the API contract", () => {
  const state = fixtureState();
  reconcileOpenTasks(state, { departmentId: "data-product", now: 100_000 });
  const account = state.settings.accounts[0];
  const first = projectOpenTask(state.tasks.task_a, account);

  assert.deepEqual(first, {
    task_id: "task_a",
    title: "准备月报",
    description: "补齐说明",
    assignee_userid: "wx-zhangsan",
    status: "进行中",
    due_date: "2026-09-01",
    updated_at: 100,
  });

  account.wecomUserId = "";
  assert.equal(reconcileOpenTasks(state, { departmentId: "data-product", now: 100_000 }), true);
  assert.equal(state.tasks.task_a.openUpdatedAt, 101);
  assert.equal(projectOpenTask(state.tasks.task_a, account).assignee_userid, null);
});

test("tasks remain scoped by their own department when an owner account is missing", () => {
  const state = fixtureState();
  state.tasks.task_a.ownerUsername = "removed-account";

  assert.equal(reconcileOpenTasks(state, { departmentId: "data-product", now: 100_000 }), true);
  assert.equal(state.tasks.task_a.openUpdatedAt, 100);
});
