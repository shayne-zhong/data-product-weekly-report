import { createHash, randomUUID } from "node:crypto";
import { buildPeriodSnapshot } from "./period-report-context.mjs";
import { renderReport, validateReport } from "./period-report-engine.mjs";

const ACTIVE = new Set(["queued", "generating", "validating"]);
const LEGACY_ACTIVE = new Set(["queued", "running", "validating"]);
const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const pick = (value, keys) =>
  Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, structuredClone(value[key])]));
const today = (now) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);

function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}

function bucket(state) {
  const data = (state.periodReports ||= {});
  data.jobs ||= {};
  return data;
}

function activePeriodJob(state, key) {
  return Object.values(state.periodReports?.jobs || {}).find((job) => job.key === key && ACTIVE.has(job.status));
}

export function periodFromInput(input, now = Date.now()) {
  const year = Number(input?.year);
  const part = Number(input?.part || 1);
  const kind = input?.kind;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !["month", "quarter", "half", "year"].includes(kind))
    fail("请选择有效年份和报告类型");
  const count = kind === "month" ? 12 : kind === "quarter" ? 4 : kind === "half" ? 2 : 1;
  if (!Number.isInteger(part) || part < 1 || part > count) fail("报告周期无效");
  const span = 12 / count;
  const month = (part - 1) * span;
  const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month + span, 0)).toISOString().slice(0, 10);
  if (start > today(now)) fail("报告起始日不能晚于今天");
  return {
    kind,
    year,
    part,
    start,
    end,
    asOf: end < today(now) ? end : today(now),
    label: `${year}年${kind === "month" ? `${part}月` : kind === "quarter" ? `第${part}季度` : kind === "half" ? (part === 1 ? "上半年" : "下半年") : "年度"}`,
  };
}

export function migratePeriodReportState(state, now = Date.now()) {
  const data = bucket(state);
  const hadWorkers = Object.hasOwn(data, "workers");
  for (const job of Object.values(data.jobs)) {
    if (job.status === "completed") job.status = "published";
    if (hadWorkers && LEGACY_ACTIVE.has(job.status)) {
      job.status = "failed";
      job.error = "旧版本机生成流程已停用，请重新生成";
      job.updatedAt = now;
    }
    for (const key of ["workerId", "lease", "heartbeatAt", "deadline"]) delete job[key];
  }
  delete data.workers;
  return data;
}

export function preparePeriodJob(state, input, actor = {}, now = Date.now()) {
  const department = state.settings?.departments?.find(
    (item) => item.id === input?.departmentId && item.enabled !== false,
  );
  if (!department || (actor.departmentId && actor.departmentId !== department.id)) fail("无权为该部门生成报告", 403);
  const period = periodFromInput(input, now);
  const key = `${department.id}:${period.kind}:${period.year}:${period.part}`;
  const duplicate = activePeriodJob(state, key);
  if (duplicate) return { duplicate: true, job: publicPeriodJob(duplicate, now) };
  return { duplicate: false, key, department, period, snapshot: buildPeriodSnapshot(state, department, period, now) };
}

export function persistPreparedPeriodJob(state, prepared, actor = {}, now = Date.now(), { model, skillVersion } = {}) {
  if (prepared?.duplicate || !prepared?.snapshot) fail("报告任务不可保存", 409);
  const job = {
    id: randomUUID(),
    key: prepared.key,
    departmentId: prepared.department.id,
    departmentName: prepared.department.name,
    period: structuredClone(prepared.period),
    snapshot: structuredClone(prepared.snapshot),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    createdBy: actor.username,
    model,
    skillVersion,
  };
  bucket(state).jobs[job.id] = job;
  return job;
}

export function createPeriodJob(state, input, actor, now, metadata = {}) {
  const prepared = preparePeriodJob(state, input, actor, now);
  if (prepared.duplicate) return { job: prepared.job, duplicate: true };
  const job = persistPreparedPeriodJob(state, prepared, actor, now, metadata);
  return { job: publicPeriodJob(job, now), duplicate: false };
}

export function beginPeriodJob(state, jobId, now = Date.now()) {
  const job = migratePeriodReportState(state, now).jobs[jobId];
  if (!job || job.status !== "queued") fail("报告任务不可执行", 409);
  job.status = "generating";
  job.startedAt = now;
  job.updatedAt = now;
  return structuredClone(job);
}

export function markPeriodJobValidating(state, jobId, now = Date.now()) {
  const job = migratePeriodReportState(state, now).jobs[jobId];
  if (!job || job.status !== "generating") fail("报告任务状态已变化", 409);
  job.status = "validating";
  job.updatedAt = now;
  return structuredClone(job);
}

export function failPeriodJob(state, jobId, error, now = Date.now()) {
  const job = migratePeriodReportState(state, now).jobs[jobId];
  if (!job || !ACTIVE.has(job.status)) return null;
  job.status = "failed";
  job.error = String(error instanceof Error ? error.message : error || "生成失败").slice(0, 300);
  job.updatedAt = now;
  return structuredClone(job);
}

function managedJob(state, jobId, actor) {
  const job = bucket(state).jobs[jobId];
  if (!job || (actor.departmentId && actor.departmentId !== job.departmentId)) fail("报告不存在或无权操作", 404);
  return job;
}

export function cancelPeriodJob(state, jobId, actor = {}, now = Date.now()) {
  const job = managedJob(state, jobId, actor);
  if (job.status === "cancelled") return publicPeriodJob(job);
  if (!ACTIVE.has(job.status)) fail("仅活动任务可以终止", 409);
  Object.assign(job, { status: "cancelled", error: "已由管理员终止", updatedAt: now, cancelledAt: now });
  return publicPeriodJob(job);
}

export function deletePeriodJob(state, jobId, actor = {}) {
  const job = managedJob(state, jobId, actor);
  if (ACTIVE.has(job.status)) fail("请先终止任务再删除", 409);
  if (!["published", "failed", "cancelled"].includes(job.status)) fail("当前状态不可删除", 409);
  const data = bucket(state);
  data.versionCounters ||= {};
  data.versionCounters[job.key] = Math.max(Number(data.versionCounters[job.key]) || 0, Number(job.version) || 0);
  delete data.jobs[jobId];
  return { deleted: true, id: jobId };
}

export function recoverInterruptedPeriodJobs(state, now = Date.now()) {
  const ids = [];
  for (const job of Object.values(migratePeriodReportState(state, now).jobs)) {
    if (!ACTIVE.has(job.status)) continue;
    job.status = "failed";
    job.error = "服务重启导致生成中断，请重试";
    job.updatedAt = now;
    ids.push(job.id);
  }
  return ids;
}

function numericAt(content, path) {
  if (
    !Array.isArray(path) ||
    path.length < 1 ||
    path.length > 12 ||
    path.some(
      (key) =>
        !["string", "number"].includes(typeof key) || ["__proto__", "constructor", "prototype"].includes(String(key)),
    )
  )
    return undefined;
  let value = content;
  for (const key of path) {
    if (value == null || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return undefined;
}

export function validatePeriodOutput(job, report) {
  let validation;
  try {
    validation = validateReport(report);
  } catch {
    return { errors: ["报告数据结构无效"], warnings: [] };
  }
  const { errors, warnings } = validation;
  if (errors.length) return validation;
  if (report.organization !== job.departmentName) errors.push("报告部门与任务不一致");
  for (const key of ["kind", "start", "end", "asOf"])
    if (report.period[key] !== job.period[key]) errors.push(`报告周期 ${key} 与任务不一致`);
  const sources = new Map(job.snapshot.sources.map((source) => [source.id, source]));
  for (const source of report.sources) if (!sources.has(source.id)) errors.push(`来源不属于本次资料快照：${source.id}`);
  for (const slide of report.slides)
    for (const metric of slide.metrics || []) {
      if (metric.value === null) continue;
      const evidence = metric.evidence;
      const value = numericAt(sources.get(evidence?.sourceId)?.content, evidence?.path);
      if (!metric.sourceIds.includes(evidence?.sourceId) || value !== metric.value)
        errors.push(`指标“${metric.label}”缺少与快照一致的数字证据；无法核对的指标必须为 null`);
      if (
        metric.progress &&
        numericAt(sources.get(metric.targetEvidence?.sourceId)?.content, metric.targetEvidence?.path) !==
          metric.progress.target
      )
        errors.push(`指标“${metric.label}”目标值无可核对证据`);
    }
  return { errors, warnings: [...warnings, ...(job.snapshot.warnings || [])] };
}

export function publishPeriodJob(state, jobId, report, metadata = {}, now = Date.now()) {
  const data = migratePeriodReportState(state, now);
  const job = data.jobs[jobId];
  if (!job || job.status !== "validating") fail("报告任务不可发布", 409);
  if (Buffer.byteLength(JSON.stringify(report || {})) > 512 * 1024) fail("报告数据超过 512 KB", 413);
  const validation = validatePeriodOutput(job, report);
  if (validation.errors.length) fail(validation.errors.slice(0, 8).join("；"), 422);
  const html = renderReport(report, { provenance: `正式版本 · ${job.skillVersion} · ${job.model}` });
  const previous = Object.values(data.jobs).filter((item) => item.key === job.key && item.status === "published");
  data.versionCounters ||= {};
  const version = Math.max(Number(data.versionCounters[job.key]) || 0, ...previous.map((item) => Number(item.version) || 0)) + 1;
  Object.assign(job, {
    report: structuredClone(report),
    html,
    validation,
    model: job.model,
    usage: structuredClone(metadata.usage || {}),
    contentHash: metadata.contentHash || digest(report),
    publishedAt: now,
    version,
    status: "published",
    updatedAt: now,
  });
  data.versionCounters[job.key] = version;
  return job;
}

export function publicPeriodJob(job) {
  const sourceCounts = structuredClone(job.snapshot?.stats || {});
  return {
    ...pick(job, [
      "id",
      "key",
      "departmentId",
      "departmentName",
      "period",
      "version",
      "createdAt",
      "updatedAt",
      "publishedAt",
      "skillVersion",
      "model",
    ]),
    status: job.status,
    message: job.error || "",
    snapshotCapturedAt: job.snapshot?.capturedAt,
    sourceCounts,
    sources: sourceCounts,
    warnings: job.validation?.warnings || job.snapshot?.warnings || [],
    href: `/?periodReport=${encodeURIComponent(job.key)}`,
    versionHref: `/?periodReport=${encodeURIComponent(job.id)}`,
  };
}

async function body(req) {
  if (req.body != null) {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > 600 * 1024) fail("请求过大", 413);
    try {
      return JSON.parse(raw);
    } catch {
      fail("请求 JSON 无效");
    }
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 600 * 1024) fail("请求过大", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    fail("请求 JSON 无效");
  }
}

export function createPeriodReportService({
  saveState,
  json,
  prepareGeneration = async () => ({}),
  enqueue = async () => {},
  abort = () => {},
}) {
  async function create(state, input, actor, now) {
    const prepared = preparePeriodJob(state, input, actor, now);
    if (prepared.duplicate) return { job: prepared.job, duplicate: true };
    const metadata = await prepareGeneration(state, actor, prepared, now);
    const duplicate = activePeriodJob(state, prepared.key);
    if (duplicate) return { job: publicPeriodJob(duplicate), duplicate: true };
    const job = persistPreparedPeriodJob(state, prepared, actor, now, metadata);
    await saveState(state);
    await enqueue(job.id);
    return { job: publicPeriodJob(job), duplicate: false };
  }

  async function admin(req, res, state, parts, now, actor = {}) {
    const data = bucket(state);
    const action = parts[2];
    const permitted = (department) =>
      department.enabled !== false && (!actor.departmentId || department.id === actor.departmentId);
    if (req.method === "GET" && !action)
      return json(res, {
        departments: (state.settings?.departments || []).filter(permitted).map(({ id, name }) => ({ id, name })),
        jobs: Object.values(data.jobs)
          .filter((job) => !actor.departmentId || job.departmentId === actor.departmentId)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(publicPeriodJob),
        generationSupported: !process.env.VERCEL,
      });
    if (req.method === "POST" && !action) {
      const result = await create(state, await body(req), actor, now);
      return json(res, result, result.duplicate ? 200 : 201);
    }
    if (req.method === "POST" && action === "retry") {
      const previous = data.jobs[(await body(req)).jobId];
      if (
        !previous ||
        !["failed", "published", "cancelled"].includes(previous.status) ||
        (actor.departmentId && previous.departmentId !== actor.departmentId)
      )
        fail("报告不存在或无权重试", 404);
      const result = await create(state, { departmentId: previous.departmentId, ...previous.period }, actor, now);
      return json(res, result, result.duplicate ? 200 : 201);
    }
    if (req.method === "POST" && action && parts[3] === "cancel" && parts.length === 4) {
      const job = cancelPeriodJob(state, action, actor, now);
      await saveState(state);
      abort(action);
      return json(res, { job });
    }
    if (req.method === "DELETE" && action && parts.length === 3) {
      const result = deletePeriodJob(state, action, actor);
      await saveState(state);
      return json(res, result);
    }
    return json(res, { error: "Not found" }, 404);
  }

  async function view(req, res, state, parts, _now, actor = {}) {
    if (req.method !== "GET") return json(res, { error: "Method not allowed" }, 405);
    const jobs = Object.values(bucket(state).jobs).filter(
      (job) => job.status === "published" && (!actor.departmentId || job.departmentId === actor.departmentId),
    );
    if (!parts[1])
      return json(res, {
        reports: jobs.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)).map(publicPeriodJob),
      });
    const id = decodeURIComponent(parts[1]);
    const exact = jobs.find((job) => job.id === id);
    const job =
      exact ||
      jobs
        .filter((item) => item.key === id)
        .sort(
          (a, b) => (Number(b.version) || 0) - (Number(a.version) || 0) || (b.publishedAt || 0) - (a.publishedAt || 0),
        )[0];
    if (!job) fail("报告不存在或无权访问", 404);
    return json(res, { job: publicPeriodJob(job), html: job.html, report: job.report, validation: job.validation });
  }
  return { admin, view };
}
