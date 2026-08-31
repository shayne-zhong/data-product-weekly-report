function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export function adminScope(actor, departments, requestedDepartmentId = "") {
  if (actor?.role === "admin") {
    if (!requestedDepartmentId) {
      return {
        departmentIds: departments.map((department) => department.id),
        selectedDepartmentId: "",
      };
    }
    if (!departments.some((department) => department.id === requestedDepartmentId)) {
      reject(400, "部门范围不存在");
    }
    return {
      departmentIds: [requestedDepartmentId],
      selectedDepartmentId: requestedDepartmentId,
    };
  }
  if (actor?.role === "leader" && actor.departmentId) {
    return {
      departmentIds: [actor.departmentId],
      selectedDepartmentId: actor.departmentId,
    };
  }
  reject(403, "无权访问后台管理范围");
}

export function validateAdminSettingsTransition(current, next) {
  const disabledLeader = next.accounts.find((account) =>
    account.enabled === false && next.departments.some((department) => department.leaderUsername === account.username)
  );
  if (disabledLeader) {
    reject(400, "请先更换部门负责人，再停用该成员账号");
  }

  const invalidModuleLeader = next.accounts.find((account) => {
    if (account.role !== "module_leader") return false;
    const department = next.departments.find((item) => item.id === account.departmentId);
    return !account.managedModules.length
      || account.managedModules.some((moduleName) => !department?.modules.includes(moduleName));
  });
  if (invalidModuleLeader) {
    reject(400, "模块负责人至少负责一个工作模块，且工作模块必须属于本部门");
  }
}
