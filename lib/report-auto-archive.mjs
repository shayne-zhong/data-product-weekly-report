const REPORT_TYPES = ["weekly", "monthly", "quarterly"];
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const REPORT_ARCHIVE_TASK_ID = "report-auto-archive";
const STALE_RUNNING_MS = 15 * 60 * 1000;

export function defaultReportArchiveSchedule() {
  return {
    timezone: "Asia/Shanghai",
    weeklyTime: "20:00",
    monthlyTime: "20:00",
    quarterlyTime: "20:00",
  };
}

export function normalizeReportArchiveSchedule(value = {}) {
  const fallback = defaultReportArchiveSchedule();
  return {
    timezone: fallback.timezone,
    ...Object.fromEntries(REPORT_TYPES.map((type) => {
      const key = `${type}Time`;
      return [key, TIME_PATTERN.test(String(value?.[key] || "")) ? String(value[key]) : fallback[key]];
    })),
  };
}

function archiveExecution(state) {
  if (!state.reportArchiveExecution || typeof state.reportArchiveExecution !== "object") state.reportArchiveExecution = {};
  return state.reportArchiveExecution;
}

export function startReportArchiveExecution(state, { now = Date.now(), trigger = "scheduled" } = {}) {
  state.reportArchiveExecution = { status: "running", startedAt: now, finishedAt: 0, trigger, archivedCount: 0, error: "" };
  return state.reportArchiveExecution;
}

export function completeReportArchiveExecution(state, { now = Date.now(), result = {} } = {}) {
  const execution = archiveExecution(state);
  Object.assign(execution, { status: "success", finishedAt: now, archivedCount: Number(result.archivedCount || 0), error: "" });
  return execution;
}

export function failReportArchiveExecution(state, { now = Date.now(), error } = {}) {
  const execution = archiveExecution(state);
  Object.assign(execution, { status: "failed", finishedAt: now, error: String(error?.message || error || "执行失败").slice(0, 200) });
  return execution;
}

export function reportArchiveTaskSummary(state, { now = Date.now() } = {}) {
  const schedule = normalizeReportArchiveSchedule(state.settings?.reportArchive);
  const execution = state.reportArchiveExecution || {};
  const stale = execution.status === "running" && now - Number(execution.startedAt || 0) > STALE_RUNNING_MS;
  return {
    id: REPORT_ARCHIVE_TASK_ID,
    kind: REPORT_ARCHIVE_TASK_ID,
    name: "报告自动归档",
    schedule: `周日 ${schedule.weeklyTime} · 月末 ${schedule.monthlyTime} · 季末 ${schedule.quarterlyTime}（北京时间）`,
    status: stale ? "failed" : execution.status || "never",
    startedAt: Number(execution.startedAt || 0),
    finishedAt: Number(execution.finishedAt || 0),
    trigger: execution.trigger || "",
    archivedCount: Number(execution.archivedCount || 0),
    error: stale ? "上次执行未正常完成" : execution.error || "",
  };
}

function reportType(report = {}) {
  const direct = report.summaryType || report.data?.summaryType;
  return REPORT_TYPES.includes(direct) ? direct : "weekly";
}

function scheduledTimestamp(report, schedule) {
  const match = String(report.data?.endDate || report.endDate || "").replaceAll("/", "-").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return Number.NaN;
  const type = reportType(report);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const isValidDate = calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day;
  const isMonthEnd = day === new Date(Date.UTC(year, month, 0)).getUTCDate();
  const eligible = isValidDate && (
    (type === "weekly" && calendarDate.getUTCDay() === 0)
    || (type === "monthly" && isMonthEnd)
    || (type === "quarterly" && isMonthEnd && month % 3 === 0)
  );
  if (!eligible) return Number.NaN;
  const [hour, minute] = schedule[`${type}Time`].split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour - 8, minute);
}

export function archiveDueReports(state, { triggeredAt = Date.now(), trigger = "scheduled" } = {}) {
  const schedule = normalizeReportArchiveSchedule(state.settings?.reportArchive);
  const archivedReportIds = [];
  reportsDueForArchive(state, { triggeredAt }).forEach((report) => {
    const scheduledAt = scheduledTimestamp(report, schedule);
    report.status = "final";
    report.archivedAt = triggeredAt;
    report.archivedBy = { type: "scheduled-task", trigger };
    report.archiveRunKey = `${report.departmentId || "unknown"}:${report.id}:${scheduledAt}`;
    report.updatedAt = triggeredAt;
    delete report.editLock;
    archivedReportIds.push(report.id);
  });
  return { archivedCount: archivedReportIds.length, archivedReportIds, triggeredAt, trigger };
}

export function reportsDueForArchive(state, { triggeredAt = Date.now(), departmentIds = null } = {}) {
  const schedule = normalizeReportArchiveSchedule(state.settings?.reportArchive);
  const allowedDepartmentIds = departmentIds === null ? null : new Set(departmentIds);
  return Object.values(state.reports || {}).filter((report) => {
    if (!report || report.status === "final") return false;
    if (allowedDepartmentIds && !allowedDepartmentIds.has(report.departmentId)) return false;
    const scheduledAt = scheduledTimestamp(report, schedule);
    return Number.isFinite(scheduledAt) && triggeredAt >= scheduledAt;
  });
}
