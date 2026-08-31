import test from "node:test";
import assert from "node:assert/strict";

import { adminScope, validateAdminSettingsTransition } from "../lib/admin-access.mjs";

const departments = [
  { id: "data", modules: ["数据分析"] },
  { id: "finance", modules: ["经营报表"] },
];

test("global admin without a requested department can access all departments", () => {
  assert.deepEqual(adminScope({ role: "admin" }, departments), {
    departmentIds: ["data", "finance"],
    selectedDepartmentId: "",
  });
});

test("global admin can select one existing department", () => {
  assert.deepEqual(adminScope({ role: "admin" }, departments, "finance"), {
    departmentIds: ["finance"],
    selectedDepartmentId: "finance",
  });
});

test("global admin cannot select an unknown department", () => {
  assert.throws(
    () => adminScope({ role: "admin" }, departments, "unknown"),
    (error) => error.statusCode === 400 && error.message === "部门范围不存在"
  );
});

test("leader is restricted to their own department despite the requested department", () => {
  assert.deepEqual(adminScope({ role: "leader", departmentId: "data" }, departments, "finance"), {
    departmentIds: ["data"],
    selectedDepartmentId: "data",
  });
});

test("leader with a stale department cannot access an admin scope", () => {
  assert.throws(
    () => adminScope({ role: "leader", departmentId: "deleted" }, departments),
    (error) => error.statusCode === 403 && error.message === "无权访问后台管理范围"
  );
});

test("unrecognized actor cannot access an admin scope", () => {
  assert.throws(
    () => adminScope({ role: "member", departmentId: "data" }, departments),
    (error) => error.statusCode === 403 && error.message === "无权访问后台管理范围"
  );
});

function settings({ leaderUsername = "leader", accounts } = {}) {
  return {
    departments: [
      { id: "data", modules: ["数据分析"], leaderUsername },
      { id: "finance", modules: ["经营报表"], leaderUsername: "" },
    ],
    accounts: accounts || [
      { username: "leader", departmentId: "data", enabled: true, role: "member", managedModules: [] },
    ],
  };
}

test("assigned department leader cannot be disabled", () => {
  const current = settings();
  const next = settings({
    accounts: current.accounts.map((account) => ({ ...account, enabled: false })),
  });
  assert.throws(
    () => validateAdminSettingsTransition(current, next),
    (error) => error.statusCode === 400 && error.message === "请先更换部门负责人，再停用该成员账号"
  );
});

test("former leader can be disabled while assigning a replacement", () => {
  const current = settings();
  const next = settings({
    leaderUsername: "replacement",
    accounts: [
      { ...current.accounts[0], enabled: false },
      { username: "replacement", departmentId: "data", enabled: true, role: "member", managedModules: [] },
    ],
  });
  assert.doesNotThrow(() => validateAdminSettingsTransition(current, next));
});

test("module leader must manage at least one module", () => {
  const current = settings();
  const next = settings({
    accounts: [
      { username: "module", departmentId: "data", enabled: true, role: "module_leader", managedModules: [] },
    ],
  });
  assert.throws(
    () => validateAdminSettingsTransition(current, next),
    (error) => error.statusCode === 400 && error.message === "模块负责人至少负责一个工作模块，且工作模块必须属于本部门"
  );
});

test("module leader cannot manage a module outside their department", () => {
  const current = settings();
  const next = settings({
    accounts: [
      { username: "module", departmentId: "data", enabled: true, role: "module_leader", managedModules: ["经营报表"] },
    ],
  });
  assert.throws(
    () => validateAdminSettingsTransition(current, next),
    (error) => error.statusCode === 400 && error.message === "模块负责人至少负责一个工作模块，且工作模块必须属于本部门"
  );
});

test("module leader can manage modules from their own department", () => {
  const current = settings();
  const next = settings({
    accounts: [
      { username: "module", departmentId: "data", enabled: true, role: "module_leader", managedModules: ["数据分析"] },
    ],
  });
  assert.doesNotThrow(() => validateAdminSettingsTransition(current, next));
});
