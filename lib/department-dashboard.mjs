import { createHash } from "node:crypto";
import { completedGoalContributionById } from "./task-core.mjs";

const TOTAL = ["total"];
export const DASHBOARD_METRICS = Object.freeze(
  [
    ["report_visits", "报表访问量", "count", "sum", TOTAL],
    ["data_ai_calls", "数据与 AI 调用量", "count", "sum", TOTAL],
    ["report_count", "报表总量", "count", "snapshot", TOTAL],
    ["report_active_rate", "报表活跃率", "percent", "ratio", TOTAL],
    ["business_users", "业务用户数", "count", "snapshot", TOTAL],
    ["data_coverage", "数据覆盖率", "percent", "ratio", TOTAL],
    ["metric_count", "指标数量", "count", "snapshot", TOTAL],
    ["warehouse_table_count", "数仓表数量", "count", "snapshot", ["total", "warehouse_layer"]],
    ["service_api_count", "服务 API 数量", "count", "snapshot", TOTAL],
    ["quality_pass_rate", "数据质量通过率", "percent", "ratio", ["domain"]],
    ["token_total", "Token 总量", "tokens", "sum", ["total", "domain", "platform"]],
    ["token_input", "输入 Token", "tokens", "sum", TOTAL],
    ["token_output", "输出 Token", "tokens", "sum", TOTAL],
    ["ai_app_count", "AI 应用数量", "count", "snapshot", ["total", "domain", "platform"]],
    ["ai_active_app_count", "活跃 AI 应用数量", "count", "snapshot", TOTAL],
    ["ai_talent_count", "AI 人才数量", "people", "snapshot", ["total", "domain", "talent_level"]],
    ["hr_employees", "部门员工数", "people", "snapshot", TOTAL],
    ["employee_goal_rate", "个人 KPI 完成率", "percent", "ratio", ["person"]],
    ["employee_key_task_rate", "个人关键任务完成率", "percent", "ratio", ["person"]],
  ].map(([id, label, unit, kind, dimensions]) =>
    Object.freeze({ id, label, unit, kind, dimensions: Object.freeze([...dimensions]) }),
  ),
);
const CATALOG = new Map(DASHBOARD_METRICS.map((metric) => [metric.id, metric]));
const GOAL_ALIASES = {
  report_visits: ["报表访问次数", "报表访问量"],
  data_ai_calls: ["数据AI调用次数", "数据与AI调用量", "数据AI调用量"],
  report_count: ["BI报表数量", "报表总量", "报表数量"],
  report_active_rate: ["报表活跃率"],
  business_users: ["业务有效用户数", "业务用户数"],
  data_coverage: ["数据覆盖率"],
  metric_count: ["企业指标总数", "指标数量", "集团核心指标线上化"],
  warehouse_table_count: ["数仓有效表数", "数仓表数量"],
  service_api_count: ["数据服务接口", "服务API数量"],
  token_total: ["Token消耗", "Token总量"],
  token_input: ["输入Token"],
  token_output: ["输出Token"],
  ai_app_count: ["已上线AI应用", "AI应用数量", "AI智能体上线数量"],
  ai_active_app_count: ["活跃AI应用", "活跃AI应用数量"],
  ai_talent_count: ["已评估AI人才", "AI人才数量"],
};
const GOAL_UNITS = {
  report_visits: ["次"], data_ai_calls: ["次"], report_count: ["张", "个"],
  business_users: ["人"], metric_count: ["个", "项"], warehouse_table_count: ["张", "张表", "个"],
  service_api_count: ["个", "项"], ai_app_count: ["个"], ai_active_app_count: ["个"],
};
function goalName(value) {
  return String(value).normalize("NFKC").toLowerCase().replace(/\s+/g, "")
    .replace(/[（(]?(?:≥|>=|不少于|达到)?\d+(?:\.\d+)?(?:万|亿|w|k)?(?:个|次|张|项|人|%|条)?(?:以上|\+)?[）)]?$/, "");
}
function linkAnnualGoals(metrics, goals, context, fetchedAt) {
  for (const m of metrics) {
    const aliases = GOAL_ALIASES[m.id];
    if (!aliases) continue;
    const candidates = goals.filter(g => g.id && aliases.some(alias => goalName(alias) === goalName(g.title)));
    if (candidates.length !== 1) continue;
    const g = candidates[0];
    const units = [m.unit, ...(GOAL_UNITS[m.id] || []), ...(m.unit === "percent" ? ["%"] : []), ...(m.unit === "people" ? ["人"] : [])];
    if (g.unit && !units.some(u => u.toLowerCase() === g.unit.trim().toLowerCase())) continue;
    m.annualGoal = { ...g };
    if (m.target == null && g.annualTarget != null && String(g.annualTarget).trim()) {
      m.targetText = String(g.annualTarget);
      if (/^\d+(?:\.\d+)?$/.test(m.targetText) && Number.isFinite(Number(m.targetText))) m.target = Number(m.targetText);
    }
    if (m.status !== "missing" || !["ytd", "full"].includes(context.period) || !["count", "tokens", "people"].includes(m.unit)) continue;
    Object.assign(m, {
      value: g.current, status: "annual_goal", computedAt: fetchedAt,
      source: { mode: "annual_goal", sourceName: "年度指标 · 任务贡献" },
      reason: `${g.title}；${g.scopeNote}此值为年度指标当前累计，不代表所选期间的外部实测。`,
    });
  }
}
const QUALITY = new Set(["完整性", "准确性", "一致性", "及时性", "唯一性", "有效性"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const entries = (value) => Object.values(value || {}).filter((item) => item && typeof item === "object");
function fail(message, statusCode = 422, code = "DASHBOARD_INVALID_DOCUMENT") {
  throw Object.assign(new Error(message), { statusCode, code });
}
function plain(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
function fields(object, allowed, description) {
  if (!plain(object) || Object.keys(object).some((key) => !allowed.includes(key)))
    fail(`${description}包含不支持的字段或类型`);
}
function text(value, max, description, allowEmpty = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && !value.trim()) ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    fail(`${description}格式无效`);
  return value.trim();
}
function id(value, description) {
  if (typeof value !== "string" || !ID.test(value)) fail(`${description}格式无效`);
  return value;
}
function date(value, description) {
  if (typeof value !== "string" || !DATE.test(value)) fail(`${description}必须是有效日期`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    fail(`${description}必须是有效日期`);
  return value;
}
function beijingDate(now) {
  return new Date(Number(now) + 8 * 3600000).toISOString().slice(0, 10);
}
function timestamp(value, now) {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)
  )
    fail("asOf 必须是带时区的 ISO8601 时间");
  date(value.slice(0, 10), "asOf");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms > Number(now) + 300000) fail("asOf 无效或超过当前时间五分钟");
  return new Date(ms).toISOString();
}
function count(value, description) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${description}必须为非负安全整数`);
  return value;
}
function departments(state) {
  return (state.settings?.departments || []).filter((item) => item && item.enabled !== false);
}
function accounts(state, departmentId) {
  return (state.settings?.accounts || []).filter(
    (account) => account && account.departmentId === departmentId && account.enabled !== false,
  );
}
function authorize(state, actor, requested) {
  const role = actor?.role;
  if (!["admin", "leader", "global_admin", "department_leader"].includes(role))
    fail("当前账号无权访问部门大屏", 403, "DASHBOARD_FORBIDDEN");
  const all = departments(state);
  const isLeader = ["leader", "department_leader"].includes(role);
  const selected = requested || (isLeader ? actor.departmentId : all[0]?.id);
  if (isLeader && selected !== actor.departmentId) fail("不能访问其他部门的大屏", 403, "DASHBOARD_FORBIDDEN");
  const department = all.find((item) => item.id === selected);
  if (!department) fail("部门不存在或已停用", 404, "DASHBOARD_DEPARTMENT_NOT_FOUND");
  return { department, available: isLeader ? [department] : all };
}
export function resolveDashboardContext(state, actor, query = {}, now = Date.now()) {
  const { department, available } = authorize(state, actor, query.departmentId);
  const today = beijingDate(now);
  const yearValue = query.year ?? Number(today.slice(0, 4));
  if (!(typeof yearValue === "number" || (typeof yearValue === "string" && /^\d{4}$/.test(yearValue))))
    fail("大屏年份无效", 400, "DASHBOARD_INVALID_CONTEXT");
  const year = Number(yearValue);
  const period = query.period ?? "ytd";
  if (
    !Number.isInteger(year) ||
    year < 2020 ||
    year > 2100 ||
    typeof period !== "string" ||
    !/^(ytd|full|q[1-4]|m(?:0[1-9]|1[0-2]))$/.test(period)
  )
    fail("大屏年份或周期无效", 400, "DASHBOARD_INVALID_CONTEXT");
  let startDate = `${year}-01-01`,
    endDate = `${year}-12-31`;
  if (period === "ytd" && year === Number(today.slice(0, 4))) endDate = today;
  if (period.startsWith("m") || period.startsWith("q")) {
    const month = period.startsWith("m") ? Number(period.slice(1)) : (Number(period.slice(1)) - 1) * 3 + 1;
    startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    endDate = new Date(Date.UTC(year, month + (period.startsWith("q") ? 2 : 0), 0)).toISOString().slice(0, 10);
  }
  return {
    departmentId: department.id,
    departmentName: String(department.name || department.id),
    departments: available.map(({ id, name }) => ({ id, name: String(name || id) })),
    year,
    period,
    startDate,
    endDate,
  };
}
function recordKey(record) {
  return JSON.stringify([record.metric, record.periodStart, record.periodEnd, record.dimensionType, record.dimension]);
}
function sourceKey(record) {
  return JSON.stringify([record.sourceId, recordKey(record)]);
}
function dashboardDepartment(state, departmentId) {
  return state.dashboard?.departments?.[departmentId] || { revision: 0, observations: [], batches: [], batchIndex: {} };
}
function normalizeDocument(state, departmentId, input, now) {
  fields(input, ["schemaVersion", "batchId", "departmentId", "sourceId", "sourceName", "asOf", "records"], "导入文档");
  if (input.schemaVersion !== 1) fail("仅支持 schemaVersion 1");
  id(input.departmentId, "部门标识");
  if (input.departmentId !== departmentId) fail("文档部门与目标部门不一致");
  const batchId = id(input.batchId, "批次标识"),
    sourceId = id(input.sourceId, "来源标识");
  const sourceName = text(input.sourceName, 160, "来源名称");
  const asOf = timestamp(input.asOf, now),
    asOfDate = beijingDate(Date.parse(asOf));
  if (!Array.isArray(input.records) || !input.records.length || input.records.length > 500)
    fail("每批必须包含 1 至 500 条记录");
  const usernames = new Set(accounts(state, departmentId).map((account) => account.username));
  const keys = new Set();
  const records = input.records
    .map((raw) => {
      fields(
        raw,
        [
          "metric",
          "periodStart",
          "periodEnd",
          "value",
          "unit",
          "dimensionType",
          "dimension",
          "coverage",
          "numerator",
          "denominator",
          "annualTarget",
          "validForHours",
        ],
        "指标记录",
      );
      const definition = CATALOG.get(raw.metric);
      if (!definition || raw.unit !== definition.unit) fail("指标或单位不在约定目录中");
      const periodStart = date(raw.periodStart, "periodStart"),
        periodEnd = date(raw.periodEnd, "periodEnd");
      if (
        periodStart > periodEnd ||
        periodEnd > asOfDate ||
        periodStart.slice(0, 4) !== periodEnd.slice(0, 4) ||
        Number(periodStart.slice(0, 4)) < 2020 ||
        Number(periodStart.slice(0, 4)) > 2100
      )
        fail("记录周期不能倒置、跨年或超出 asOf 日期");
      const dimensionType = raw.dimensionType === undefined ? "total" : raw.dimensionType;
      if (!definition.dimensions.includes(dimensionType)) fail("指标不支持此维度类型");
      const dimension = text(
        raw.dimension === undefined ? "" : raw.dimension,
        160,
        "维度名称",
        dimensionType === "total",
      );
      if ((dimensionType === "total" && dimension !== "") || (dimensionType === "person" && !usernames.has(dimension)))
        fail("汇总维度必须为空，个人维度必须为本部门有效账号");
      if (raw.metric === "quality_pass_rate") {
        const parts = dimension.split("|");
        if (parts.length !== 2 || !parts[0].trim() || !QUALITY.has(parts[1]))
          fail("质量维度须为领域名称|完整性、准确性、一致性、及时性、唯一性或有效性");
      }
      if (!["complete", "partial"].includes(raw.coverage)) fail("coverage 必须为 complete 或 partial");
      const validForHours = raw.validForHours === undefined ? 24 : raw.validForHours;
      if (!Number.isInteger(validForHours) || validForHours < 1 || validForHours > 8760)
        fail("validForHours 必须为 1 至 8760 的整数");
      const record = {
        metric: definition.id,
        periodStart,
        periodEnd,
        value: raw.value,
        unit: definition.unit,
        dimensionType,
        dimension,
        coverage: raw.coverage,
        validForHours,
      };
      if (definition.kind === "ratio") {
        const numerator = count(raw.numerator, "分子"),
          denominator = count(raw.denominator, "分母");
        if (
          numerator > denominator ||
          (denominator === 0
            ? raw.value !== null
            : typeof raw.value !== "number" ||
              !Number.isFinite(raw.value) ||
              raw.value < 0 ||
              raw.value > 100 ||
              Math.abs(raw.value - (numerator / denominator) * 100) > 0.050000001)
        )
          fail("比例值与分子分母不一致，分母为零时 value 必须为 null");
        Object.assign(record, { numerator, denominator });
      } else {
        count(raw.value, "指标值");
        if (own(raw, "numerator") || own(raw, "denominator")) fail("非比例指标不接受分子分母");
      }
      if (own(raw, "annualTarget")) {
        if (
          typeof raw.annualTarget !== "number" ||
          !Number.isFinite(raw.annualTarget) ||
          raw.annualTarget < 0 ||
          (definition.unit === "percent" ? raw.annualTarget > 100 : !Number.isSafeInteger(raw.annualTarget))
        )
          fail("annualTarget 格式无效");
        record.annualTarget = raw.annualTarget;
      }
      const key = recordKey(record);
      if (keys.has(key)) fail("同一批次包含重复指标周期和维度");
      keys.add(key);
      return record;
    })
    .sort((a, b) => recordKey(a).localeCompare(recordKey(b), "en"));
  return { schemaVersion: 1, batchId, departmentId, sourceId, sourceName, asOf, records };
}
function summary(document) {
  return {
    departmentId: document.departmentId,
    sourceId: document.sourceId,
    sourceName: document.sourceName,
    recordCount: document.records.length,
    metricCount: new Set(document.records.map((record) => record.metric)).size,
    completeRecords: document.records.filter((record) => record.coverage === "complete").length,
    partialRecords: document.records.filter((record) => record.coverage === "partial").length,
  };
}
function priorBatch(current, document) {
  return (
    (own(current.batchIndex, document.batchId) ? current.batchIndex[document.batchId] : null) ||
    (current.batches || []).find((batch) => batch.batchId === document.batchId)
  );
}
function sameMeasurement(previous, record) {
  const measurementFields = [
    "metric",
    "periodStart",
    "periodEnd",
    "value",
    "unit",
    "dimensionType",
    "dimension",
    "coverage",
    "numerator",
    "denominator",
    "annualTarget",
    "validForHours",
  ];
  return measurementFields.every(
    (field) => own(previous, field) === own(record, field) && previous[field] === record[field],
  );
}
function validateImportPlan(current, document, hash) {
  const prior = priorBatch(current, document);
  if (prior) {
    if (prior.hash !== hash) fail("批次标识已被其他内容使用", 409, "DASHBOARD_BATCH_CONFLICT");
    return;
  }
  if (Object.keys(current.batchIndex || {}).length >= 10000)
    fail("本部门已达 10000 个导入批次的防重记录上限，请联系管理员归档", 422, "DASHBOARD_BATCH_LIMIT");
  const observations = new Map((current.observations || []).map((record) => [sourceKey(record), record]));
  for (const record of document.records) {
    const key = sourceKey({ ...record, sourceId: document.sourceId }),
      previous = observations.get(key);
    if (previous && Date.parse(previous.asOf) >= Date.parse(document.asOf)) {
      const same = Date.parse(previous.asOf) === Date.parse(document.asOf) && sameMeasurement(previous, record);
      if (!same) fail("同一来源的相同指标周期不能用较旧或相同时间的不同观测覆盖", 409, "DASHBOARD_SOURCE_ROLLBACK");
    }
    observations.set(key, record);
  }
  if (observations.size > 5000)
    fail("本部门观测已达 5000 条上限，请先由管理员规划归档", 409, "DASHBOARD_CAPACITY_LIMIT");
}
export function previewDashboardImport(state, actor, input, now = Date.now()) {
  fields(input, ["departmentId", "document"], "预览请求");
  const { department } = authorize(state, actor, input.departmentId);
  const document = normalizeDocument(state, department.id, input.document, now);
  const previewHash = createHash("sha256").update(JSON.stringify(document)).digest("hex");
  validateImportPlan(dashboardDepartment(state, department.id), document, previewHash);
  const warnings = ["仅在查询周期与记录周期完全一致时展示汇总值；不将存量相加或将分项推算成总量。"];
  if (document.records.some((record) => record.coverage === "partial"))
    warnings.push("批次包含部分覆盖记录，页面将保留部分覆盖标识。");
  if (document.records.some((record) => Number(now) > Date.parse(document.asOf) + record.validForHours * 3600000))
    warnings.push("批次包含已过期观测，将展示真实值及过期标识。");
  return {
    previewHash,
    revision: dashboardDepartment(state, department.id).revision || 0,
    summary: summary(document),
    warnings,
    document,
  };
}
export function commitDashboardImport(state, actor, input, now = Date.now()) {
  fields(input, ["departmentId", "document", "previewHash", "expectedRevision"], "确认请求");
  const preview = previewDashboardImport(
    state,
    actor,
    { departmentId: input.departmentId, document: input.document },
    now,
  );
  if (typeof input.previewHash !== "string" || input.previewHash !== preview.previewHash)
    fail("预览内容已变化，请重新预览", 409, "DASHBOARD_PREVIEW_MISMATCH");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
    fail("expectedRevision 必须为非负整数");
  const document = preview.document,
    current = dashboardDepartment(state, document.departmentId);
  const prior = priorBatch(current, document);
  if (prior) {
    if (prior.hash !== preview.previewHash) fail("批次标识已被其他内容使用", 409, "DASHBOARD_BATCH_CONFLICT");
    return { batchId: document.batchId, revision: prior.revision, duplicate: true, summary: summary(document) };
  }
  if (input.expectedRevision !== (current.revision || 0))
    fail("数据版本已更新，请重新预览", 409, "DASHBOARD_REVISION_CONFLICT");
  const observations = new Map((current.observations || []).map((record) => [sourceKey(record), record]));
  const receivedAt = new Date(Number(now)).toISOString();
  for (const record of document.records) {
    const observation = {
      ...record,
      sourceId: document.sourceId,
      sourceName: document.sourceName,
      asOf: document.asOf,
      receivedAt,
      batchId: document.batchId,
      mode: "import",
    };
    const key = sourceKey(observation),
      previous = observations.get(key);
    if (previous && Date.parse(previous.asOf) >= Date.parse(document.asOf)) {
      const same = Date.parse(previous.asOf) === Date.parse(document.asOf) && sameMeasurement(previous, record);
      if (!same) fail("同一来源的相同指标周期不能用较旧或相同时间的不同观测覆盖", 409, "DASHBOARD_SOURCE_ROLLBACK");
    }
    observations.set(key, observation);
  }
  if (observations.size > 5000)
    fail("本部门观测已达 5000 条上限，请先由管理员规划归档", 409, "DASHBOARD_CAPACITY_LIMIT");
  const revision = (current.revision || 0) + 1;
  const audit = {
    batchId: document.batchId,
    hash: preview.previewHash,
    revision,
    receivedAt,
    recordCount: document.records.length,
    sourceId: document.sourceId,
    sourceName: document.sourceName,
    asOf: document.asOf,
  };
  const next = {
    revision,
    observations: [...observations.values()],
    batches: [...(current.batches || []), audit].slice(-50),
    batchIndex: {
      ...(current.batchIndex || {}),
      [document.batchId]: { hash: audit.hash, revision, receivedAt, recordCount: audit.recordCount },
    },
  };
  // Publish only after every record and conflict check has passed.
  state.dashboard = {
    ...(state.dashboard || {}),
    departments: { ...(state.dashboard?.departments || {}), [document.departmentId]: next },
  };
  return { batchId: document.batchId, revision, duplicate: false, summary: preview.summary };
}
function observationStatus(observation, now) {
  if (observation.denominator === 0) return "not_applicable";
  if (Number(now) > Date.parse(observation.asOf) + observation.validForHours * 3600000) return "stale";
  return observation.coverage === "partial" ? "partial" : "available";
}
function observationView(observation, now) {
  return {
    value: observation.value,
    status: observationStatus(observation, now),
    source: { sourceId: observation.sourceId, sourceName: observation.sourceName, mode: "import" },
    asOf: observation.asOf,
    receivedAt: observation.receivedAt,
    coverage: observation.coverage,
    ...(own(observation, "annualTarget") ? { target: observation.annualTarget } : {}),
    ...(own(observation, "numerator")
      ? { numerator: observation.numerator, denominator: observation.denominator }
      : {}),
    ...(observation.denominator === 0 ? { reason: "分母为零，不适用" } : {}),
  };
}
function latestObservations(observations) {
  const selected = new Map();
  for (const observation of observations) {
    const key = recordKey(observation),
      previous = selected.get(key);
    if (
      !previous ||
      Date.parse(observation.asOf) > Date.parse(previous.asOf) ||
      (observation.asOf === previous.asOf && Date.parse(observation.receivedAt) > Date.parse(previous.receivedAt))
    )
      selected.set(key, observation);
  }
  return [...selected.values()];
}
function taskOwner(task, enabledAccounts) {
  if (task.ownerUsername)
    return enabledAccounts.some((account) => account.username === task.ownerUsername) ? task.ownerUsername : "";
  const matches = enabledAccounts.filter((account) => account.name === task.owner && task.owner);
  return matches.length === 1 ? matches[0].username : "";
}
function goalValue(value) {
  return typeof value === "string"
    ? value.slice(0, 2000)
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : null;
}
export function buildDepartmentDashboard(state, actor, query = {}, now = Date.now()) {
  const context = resolveDashboardContext(state, actor, query, now),
    stored = dashboardDepartment(state, context.departmentId);
  const allObservations = stored.observations || [];
  const observations = latestObservations(allObservations);
  const exact = observations.filter(
    (record) => record.periodStart === context.startDate && record.periodEnd === context.endDate,
  );
  const within = observations.filter(
    (record) => record.periodStart >= context.startDate && record.periodEnd <= context.endDate,
  );
  const metrics = DASHBOARD_METRICS.map((definition) => {
    const observation = exact.find((record) => record.metric === definition.id && record.dimensionType === "total");
    return {
      ...definition,
      ...(observation
        ? observationView(observation, now)
        : {
            value: null,
            status: definition.dimensions.includes("total") ? "missing" : "not_applicable",
            reason: definition.dimensions.includes("total")
              ? "当前周期无精确匹配的汇总观测"
              : "请查看领域或个人维度明细，不推算汇总比例",
          }),
    };
  });
  const trends = {},
    distributions = {};
  for (const definition of DASHBOARD_METRICS) {
    trends[definition.id] = within
      .filter((record) => record.metric === definition.id && record.dimensionType === "total")
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.periodEnd.localeCompare(b.periodEnd))
      .map((record) => ({
        periodStart: record.periodStart,
        periodEnd: record.periodEnd,
        ...observationView(record, now),
      }));
    distributions[definition.id] = exact
      .filter((record) => record.metric === definition.id && record.dimensionType !== "total")
      .map((record) => ({
        dimensionType: record.dimensionType,
        dimension: record.dimension,
        ...observationView(record, now),
      }));
  }
  const enabledAccounts = accounts(state, context.departmentId),
    today = beijingDate(now);
  const rawTasks = entries(state.tasks).filter((task) => task.departmentId === context.departmentId);
  const weekIds = new Set(
    entries(state.weeks)
      .filter(
        (week) =>
          week.departmentId === context.departmentId &&
          week.startDate <= context.endDate &&
          week.endDate >= context.startDate,
      )
      .map((week) => week.id),
  );
  const tasks = rawTasks.filter((task) => weekIds.has(task.weekId));
  const overdue = (task) => task.status !== "已完成" && DATE.test(task.dueDate || "") && task.dueDate < today;
  const finished = tasks.filter((task) => task.status === "已完成").length;
  const operations = {
    activeAccounts: enabledAccounts.length,
    tasks: tasks.length,
    completedTasks: finished,
    completionRate: tasks.length ? (finished / tasks.length) * 100 : null,
    overdueTasks: tasks.filter(overdue).length,
    blockedTasks: tasks.filter((task) => task.status === "阻塞").length,
    unassignedTasks: tasks.filter((task) => !taskOwner(task, enabledAccounts)).length,
    scopeNote:
      "按所属周与查询周期相交筛选，展示已保存任务的当前状态；结转跨周记录未去重，逾期按今日判断。账号数为网站有效账号，不代表 HR 员工数。",
  };
  const people = enabledAccounts.map((account) => {
    const owned = tasks.filter((task) => taskOwner(task, enabledAccounts) === account.username),
      completedTasks = owned.filter((task) => task.status === "已完成").length;
    const modules = [...new Set(owned.map((task) => task.module).filter(Boolean))];
    const personMetric = (metric) =>
      exact.find(
        (record) =>
          record.metric === metric && record.dimensionType === "person" && record.dimension === account.username,
      );
    const kpi = personMetric("employee_goal_rate"),
      keyTask = personMetric("employee_key_task_rate");
    return {
      username: String(account.username || ""),
      name: String(account.name || account.username || ""),
      role: String(account.role || "member"),
      team: modules.length === 1 ? String(modules[0]) : modules.length ? "跨模块" : "未分组",
      tasks: owned.length,
      completedTasks,
      completionRate: owned.length ? (completedTasks / owned.length) * 100 : null,
      overdueTasks: owned.filter(overdue).length,
      blockedTasks: owned.filter((task) => task.status === "阻塞").length,
      keyTaskRate: keyTask?.value ?? null,
      kpiRate: kpi?.value ?? null,
      keyTaskMetric: keyTask ? observationView(keyTask, now) : null,
      kpiMetric: kpi ? observationView(kpi, now) : null,
      tasksDetail: owned.map((task) => ({
        id: String(task.id || ""),
        title: String(task.title || ""),
        module: String(task.module || ""),
        status: String(task.status || ""),
        dueDate: String(task.dueDate || ""),
        blocker: String(task.blocker || ""),
      })),
    };
  });
  const goalRecord = state.goalsByDepartment?.[context.departmentId],
    contribution = completedGoalContributionById(rawTasks);
  const goals =
    Number(goalRecord?.year) === context.year
      ? (goalRecord.rows || []).map((row) => ({
          id: String(row.id || ""),
          title: String(row.title || row.name || row.indicator || ""),
          current: contribution[row.id] || 0,
          expectedCurrent: goalValue(row.expectedCurrent),
          annualTarget: goalValue(row.annualTarget ?? row.target),
          unit: String(row.unit || ""),
          source: "任务贡献（非外部实测）",
          scopeNote: "复用本部门全部已完成任务的目标贡献，不按查询周期或年份筛选任务；不等于外部实测值。",
        }))
      : [];
  linkAnnualGoals(metrics, goals, context, new Date(Number(now)).toISOString());
  const sources = [...new Set(allObservations.map((record) => record.sourceId))].map((sourceId) => {
    const records = allObservations.filter((record) => record.sourceId === sourceId),
      latest = records.reduce((a, b) => (Date.parse(b.asOf) > Date.parse(a.asOf) ? b : a));
    return {
      sourceId,
      sourceName: latest.sourceName,
      asOf: latest.asOf,
      receivedAt: latest.receivedAt,
      mode: "import",
      records: records.length,
      status: records.some((record) => observationStatus(record, now) === "stale")
        ? "stale"
        : records.some((record) => record.coverage === "partial")
          ? "partial"
          : "available",
    };
  });
  const imports = (stored.batches || []).map(
    ({ batchId, sourceId, sourceName, asOf, receivedAt, recordCount, revision }) => ({
      batchId,
      sourceId,
      sourceName,
      asOf,
      receivedAt,
      recordCount,
      revision,
    }),
  );
  return {
    schemaVersion: 1,
    context,
    metrics,
    trends,
    distributions,
    operations,
    people,
    goals,
    sources,
    revision: stored.revision || 0,
    imports,
    updatedAt: imports.at(-1)?.receivedAt || null,
    fetchedAt: new Date(Number(now)).toISOString(),
  };
}
