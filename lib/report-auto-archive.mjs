const REPORT_TYPES = ["weekly", "monthly", "quarterly"];
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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
  Object.values(state.reports || {}).forEach((report) => {
    if (!report || report.status === "final") return;
    const scheduledAt = scheduledTimestamp(report, schedule);
    if (!Number.isFinite(scheduledAt) || triggeredAt < scheduledAt) return;
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
