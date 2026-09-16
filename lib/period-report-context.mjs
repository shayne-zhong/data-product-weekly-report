import { createHash } from "node:crypto";

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

function normalizeDate(value) {
  return String(value || "").replaceAll("/", "-").slice(0, 10);
}

function clone(value) {
  return structuredClone(value);
}

function fail(message, statusCode, details = {}) {
  throw Object.assign(new Error(message), { statusCode, ...details });
}

function monthRequirement(year, month) {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { type: "monthly", start: startDate, end: endDate, label: `${year}年${month}月月度总结` };
}

function quarterRequirement(year, part) {
  const firstMonth = (part - 1) * 3 + 1;
  return {
    type: "quarterly",
    part,
    start: `${year}-${String(firstMonth).padStart(2, "0")}-01`,
    end: new Date(Date.UTC(year, firstMonth + 2, 0)).toISOString().slice(0, 10),
    label: `${year}年第${part}季度总结`,
  };
}

export function requiredSummaryPeriods(period) {
  const year = Number(period?.year);
  const part = Number(period?.part);
  if (!Number.isInteger(year)) fail("报告周期年份无效", 400);
  if (period?.kind === "quarter") {
    if (part < 1 || part > 4) fail("季度无效", 400);
    return [0, 1, 2].map((offset) => monthRequirement(year, (part - 1) * 3 + offset + 1));
  }
  if (period?.kind === "half") {
    if (part < 1 || part > 2) fail("半年期无效", 400);
    return [0, 1].map((offset) => quarterRequirement(year, (part - 1) * 2 + offset + 1));
  }
  if (period?.kind === "year") return [1, 2, 3, 4].map((quarter) => quarterRequirement(year, quarter));
  fail("报告周期类型无效", 400);
}

function matchingGoalRecord(state, departmentId, year) {
  const record = state.goalsByDepartment?.[departmentId];
  if (!record || Number(record.year) !== Number(year) || !Array.isArray(record.rows) || !record.rows.length) return null;
  return record;
}

function matchingReport(state, departmentId, requirement) {
  return Object.values(state.reports || {}).find((report) => {
    const data = report?.data || {};
    const summaryType = report?.summaryType || data.summaryType || "weekly";
    return (
      report?.departmentId === departmentId &&
      report.status === "final" &&
      summaryType === requirement.type &&
      normalizeDate(data.startDate || report.startDate) === requirement.start &&
      normalizeDate(data.endDate || report.endDate) === requirement.end
    );
  });
}

function snapshotHash(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function buildPeriodSnapshot(state, department, period, now = Date.now()) {
  const requirements = requiredSummaryPeriods(period);
  const goalRecord = matchingGoalRecord(state, department?.id, period?.year);
  const matched = requirements.map((requirement) => ({ requirement, report: matchingReport(state, department?.id, requirement) }));
  const missing = [
    ...matched.filter(({ report }) => !report).map(({ requirement }) => requirement.label),
    ...(goalRecord ? [] : [`${period.year}年度目标`]),
  ];
  if (missing.length) fail(`生成资料不完整：${missing.join("、")}`, 409, { missing });

  const sources = [
    {
      id: `goals-${period.year}`,
      type: "goals",
      title: `${period.year}年度目标`,
      recordId: department.id,
      content: clone(goalRecord),
    },
    ...matched.map(({ requirement, report }) => ({
      id: `summary-${requirement.type}-${requirement.start}`,
      type: requirement.type,
      title: String(report.data?.title || report.title || requirement.label),
      recordId: report.id,
      period: requirement,
      content: clone(report),
    })),
  ];
  const stats = {
    goalCount: goalRecord.rows.length,
    monthlySummaryCount: sources.filter((source) => source.type === "monthly").length,
    quarterlySummaryCount: sources.filter((source) => source.type === "quarterly").length,
  };
  const snapshot = { department: { id: department.id, name: department.name }, period: clone(period), capturedAt: now, stats, sources };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SNAPSHOT_BYTES) fail("生成资料超过 2 MB，请先精简上级总结", 413);
  return { ...snapshot, hash: snapshotHash(snapshot) };
}
