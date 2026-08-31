import { reportsDueForArchive } from "./report-auto-archive.mjs";

const PERIOD_TYPES = new Set(["week", "month", "quarter"]);

function invalidPeriod() {
  const error = new Error("统计周期无效");
  error.statusCode = 400;
  return error;
}

function parseDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw invalidPeriod();
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw invalidPeriod();
  return date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function periodBounds(periodType, anchor) {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  if (periodType === "week") {
    const start = new Date(anchor);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return [isoDate(start), isoDate(end)];
  }
  if (periodType === "month") {
    return [isoDate(new Date(Date.UTC(year, month, 1))), isoDate(new Date(Date.UTC(year, month + 1, 0)))];
  }
  const quarterStart = Math.floor(month / 3) * 3;
  return [isoDate(new Date(Date.UTC(year, quarterStart, 1))), isoDate(new Date(Date.UTC(year, quarterStart + 3, 0)))];
}

export function buildAdminDashboard(state = {}, {
  departmentIds = [], periodType, anchorDate, now = Date.now(),
} = {}) {
  if (!PERIOD_TYPES.has(periodType)) throw invalidPeriod();
  const anchor = parseDate(anchorDate);
  const [startDate, endDate] = periodBounds(periodType, anchor);
  const requestedIds = new Set(Array.isArray(departmentIds) ? departmentIds : []);
  const departments = (state.settings?.departments || []).filter((department) => requestedIds.has(department.id));
  const allowedIds = departments.map((department) => department.id);
  const allowedSet = new Set(allowedIds);
  const accounts = (state.settings?.accounts || []).filter((account) => allowedSet.has(account.departmentId));
  const enabledDepartments = departments.filter((department) => department.enabled !== false);
  const enabledAccounts = accounts.filter((account) => account.enabled !== false);
  const missingLeaderDepartments = enabledDepartments.filter((department) => !department.leaderUsername);

  const weekIdsByDepartment = new Set(
    Object.values(state.weeks || {})
      .filter((week) => allowedSet.has(week?.departmentId) && week.startDate <= endDate && week.endDate >= startDate)
      .map((week) => `${week.departmentId}\u0000${week.id}`),
  );
  const tasks = Object.values(state.tasks || {}).filter((task) =>
    allowedSet.has(task?.departmentId) && weekIdsByDepartment.has(`${task.departmentId}\u0000${task.weekId}`));
  const completed = tasks.filter((task) => task.status === "已完成").length;
  const dueReports = reportsDueForArchive(state, { triggeredAt: now, departmentIds: allowedIds });

  const alerts = [
    ...missingLeaderDepartments.map((department) => ({ type: "leader-missing", departmentId: department.id })),
    ...enabledAccounts
      .filter((account) => account.role === "module_leader" && (!Array.isArray(account.managedModules) || account.managedModules.length === 0))
      .map((account) => ({ type: "module-scope-missing", departmentId: account.departmentId, username: account.username })),
    ...dueReports.map((report) => ({ type: "report-archive-due", departmentId: report.departmentId, reportId: report.id })),
  ];

  return {
    generatedAt: now,
    scope: { departmentIds: [...allowedIds], periodType, anchorDate },
    metrics: {
      organization: {
        enabledDepartments: enabledDepartments.length,
        enabledAccounts: enabledAccounts.length,
        disabledAccounts: accounts.length - enabledAccounts.length,
        missingLeaderCount: missingLeaderDepartments.length,
      },
      tasks: {
        total: tasks.length,
        completed,
        completionRate: tasks.length ? Math.round((completed / tasks.length) * 100) : null,
      },
      reports: { dueUnarchived: dueReports.length },
    },
    alerts,
  };
}
