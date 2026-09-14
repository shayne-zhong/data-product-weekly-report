import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { renderReport, validateReport } from "./period-report-engine.mjs";

export const REPORT_TIMEOUT = 25 * 60_000;
const ACTIVE = new Set(["queued", "running", "validating"]);
const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const date = (value) =>
  String(value || "")
    .replaceAll("/", "-")
    .slice(0, 10);
const today = (now) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}
function bucket(state) {
  return (state.periodReports ||= { jobs: {}, workers: {} });
}
const pick = (value, keys) =>
  Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, structuredClone(value[key])]));

export function periodFromInput(input, now = Date.now()) {
  const year = Number(input.year),
    part = Number(input.part || 1),
    kind = input.kind;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !["quarter", "half", "year"].includes(kind))
    fail("请选择有效年份和报告类型");
  const count = kind === "quarter" ? 4 : kind === "half" ? 2 : 1;
  if (!Number.isInteger(part) || part < 1 || part > count) fail("报告周期无效");
  const span = 12 / count,
    month = (part - 1) * span;
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
    label: `${year}年${kind === "quarter" ? `第${part}季度` : kind === "half" ? (part === 1 ? "上半年" : "下半年") : "年度"}`,
  };
}

export function reportSnapshot(state, department, period, now) {
  const cutoff = period.end < period.asOf ? period.end : period.asOf;
  const overlaps = (start, end) => start && end && start <= cutoff && end >= period.start;
  const weeks = Object.values(state.weeks || {}).filter(
    (w) => w.departmentId === department.id && overlaps(date(w.startDate), date(w.endDate)),
  );
  const weekIds = new Set(weeks.map((w) => w.id));
  const taskMap = state.tasks || {};
  const roots = new Map();
  for (const task of Object.values(taskMap).filter((t) => t.departmentId === department.id && weekIds.has(t.weekId))) {
    let root = task,
      visited = new Set([task.id]);
    while (
      root.sourceTaskId &&
      taskMap[root.sourceTaskId]?.departmentId === department.id &&
      !visited.has(root.sourceTaskId)
    ) {
      root = taskMap[root.sourceTaskId];
      visited.add(root.id);
    }
    const prior = roots.get(root.id);
    if (
      !prior ||
      String(task.weekId) > String(prior.weekId) ||
      (task.weekId === prior.weekId && Number(task.updatedAt || 0) > Number(prior.updatedAt || 0))
    )
      roots.set(root.id, task);
  }
  const tasks = [...roots.values()].map((t) =>
    pick(t, [
      "id",
      "weekId",
      "title",
      "description",
      "module",
      "owner",
      "status",
      "progress",
      "dailyProgress",
      "updates",
      "goalLinks",
      "sourceTaskId",
      "createdAt",
      "updatedAt",
      "completedAt",
      "dueDate",
      "blockedReason",
    ]),
  );
  const reports = Object.values(state.reports || {})
    .filter((r) => {
      const type = r.summaryType || r.data?.summaryType || "weekly";
      return (
        r.departmentId === department.id &&
        ["weekly", "monthly"].includes(type) &&
        overlaps(date(r.data?.startDate || r.startDate), date(r.data?.endDate || r.endDate))
      );
    })
    .map((r) => pick(r, ["id", "title", "summaryType", "status", "data", "createdAt", "updatedAt"]));
  const sources = [
    ...tasks.map((t, i) => ({
      id: `task-${i + 1}`,
      title: String(t.title || "未命名任务").slice(0, 180),
      type: "task",
      recordId: t.id,
      content: t,
    })),
    ...reports.map((r, i) => ({
      id: `report-${i + 1}`,
      title: String(r.data?.title || r.title || "工作总结").slice(0, 180),
      type: r.summaryType || r.data?.summaryType || "weekly",
      recordId: r.id,
      content: r,
    })),
  ];
  const stats = {
    taskCount: tasks.length,
    weeklyReportCount: sources.filter((s) => s.type === "weekly").length,
    monthlyReportCount: sources.filter((s) => s.type === "monthly").length,
  };
  sources.unshift({ id: "snapshot", title: "资料快照统计（不代表期间完成量）", type: "statistics", content: stats });
  const warnings = [
    "任务状态是资料提取时的状态，不能直接作为历史期间完成量；跨期周报仅使用本期内容。",
    "本报告由 AI 生成，来源和业务结论仍需负责人复核。",
  ];
  if (!stats.monthlyReportCount) warnings.push("本期没有月报资料。");
  if (!stats.weeklyReportCount) warnings.push("本期没有周报资料。");
  if (!tasks.length && !reports.length) fail("所选部门和周期没有任务、周报或月报，请先补充资料");
  const snapshot = {
    department: { id: department.id, name: department.name },
    period,
    capturedAt: now,
    stats,
    warnings,
    sources,
  };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 2 * 1024 * 1024)
    fail("资料超过 2 MB，请缩短周期或精简重复资料；系统未截断来源", 413);
  return { ...snapshot, hash: digest(snapshot) };
}

function expire(state, now) {
  for (const job of Object.values(bucket(state).jobs)) {
    if (["running", "validating"].includes(job.status) && now > job.deadline) {
      job.status = "failed";
      job.error = "执行超时，请重试。旧执行无法覆盖新版本。";
      job.updatedAt = now;
    }
  }
}

export function createPeriodJob(state, input, actor, now) {
  const department = state.settings.departments.find((d) => d.id === input.departmentId && d.enabled !== false);
  if (!department || (actor.departmentId && actor.departmentId !== department.id)) fail("无权为该部门生成报告", 403);
  const period = periodFromInput(input, now),
    data = bucket(state);
  expire(state, now);
  const key = `${department.id}:${period.kind}:${period.year}:${period.part}`;
  const previous = Object.values(data.jobs).filter((j) => j.key === key);
  const duplicate = previous.find((j) => ACTIVE.has(j.status));
  if (duplicate) return { job: publicPeriodJob(duplicate, now), duplicate: true };
  const snapshot = reportSnapshot(state, department, period, now);
  const job = {
    id: randomUUID(),
    key,
    departmentId: department.id,
    departmentName: department.name,
    period,
    version: Math.max(0, ...previous.map((j) => j.version)) + 1,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    createdBy: actor.username,
    snapshot,
  };
  data.jobs[job.id] = job;
  return { job: publicPeriodJob(job, now), duplicate: false };
}

export function publicPeriodJob(job, now) {
  let status = job.status,
    message = job.error || "";
  if (["running", "validating"].includes(status) && now > job.deadline) {
    status = "failed";
    message = "执行超时，请重试";
  } else if (["running", "validating"].includes(status) && now - job.heartbeatAt > 90_000)
    message = "本机连接中断，等待原执行恢复";
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
      "completedAt",
    ]),
    status,
    message,
    sources: job.snapshot.stats,
    warnings: job.validation?.warnings || job.snapshot.warnings,
    href: `/?periodReport=${encodeURIComponent(job.key)}`,
    versionHref: `/?periodReport=${encodeURIComponent(job.id)}`,
  };
}

function numericAt(content, path) {
  if (
    !Array.isArray(path) ||
    path.length < 1 ||
    path.length > 12 ||
    path.some(
      (k) => !["string", "number"].includes(typeof k) || ["__proto__", "constructor", "prototype"].includes(String(k)),
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
  const sources = new Map(job.snapshot.sources.map((s) => [s.id, s]));
  for (const source of report.sources) if (!sources.has(source.id)) errors.push(`来源不属于本次资料快照：${source.id}`);
  for (const slide of report.slides) {
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
  }
  return { errors, warnings: [...warnings, ...job.snapshot.warnings] };
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
function nodeOnly() {
  if (process.env.VERCEL) fail("报告生成请连接单实例 Node 工作台；当前部署不支持安全领取", 503);
}
function authorizeWorker(state, req) {
  const token = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  const hash = Buffer.from(digest(token));
  const worker = Object.values(bucket(state).workers).find(
    (w) => !w.revoked && timingSafeEqual(Buffer.from(w.tokenHash), hash),
  );
  if (!worker) fail("本机连接凭证无效或已停用", 401);
  return worker;
}

export function createPeriodReportService({ saveState, json }) {
  async function admin(req, res, state, parts, now, actor) {
    const data = bucket(state),
      action = parts[2];
    const permitted = (d) => d.enabled !== false && (!actor.departmentId || d.id === actor.departmentId);
    if (req.method === "GET" && !action)
      return json(res, {
        departments: state.settings.departments.filter(permitted).map((d) => ({ id: d.id, name: d.name })),
        jobs: Object.values(data.jobs)
          .filter((j) => !actor.departmentId || j.departmentId === actor.departmentId)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((j) => publicPeriodJob(j, now)),
        workers: Object.values(data.workers)
          .filter((w) => !actor.departmentId || w.departmentIds.includes(actor.departmentId))
          .map((w) => ({
            id: w.id,
            name: w.name,
            revoked: w.revoked,
            online: !w.revoked && now - (w.lastSeenAt || 0) < 90_000,
            lastSeenAt: w.lastSeenAt,
          })),
        generationSupported: !process.env.VERCEL,
      });
    if (req.method === "POST" && !action) {
      nodeOnly();
      const result = createPeriodJob(state, await body(req), actor, now);
      await saveState(state);
      return json(res, result, result.duplicate ? 200 : 201);
    }
    if (req.method === "POST" && action === "pair") {
      nodeOnly();
      const token = randomBytes(32).toString("hex"),
        id = randomUUID();
      data.workers[id] = {
        id,
        name: "本地报告设备",
        departmentIds: state.settings.departments.filter(permitted).map((d) => d.id),
        tokenHash: digest(token),
        createdAt: now,
        lastSeenAt: 0,
        createdBy: actor.username,
      };
      await saveState(state);
      return json(res, { workerId: id, token }, 201);
    }
    if (req.method === "POST" && action === "revoke") {
      const w = data.workers[(await body(req)).workerId];
      if (
        !w ||
        (actor.departmentId &&
          (w.createdBy !== actor.username || w.departmentIds.some((id) => id !== actor.departmentId)))
      )
        fail("无权停用该设备", 403);
      w.revoked = true;
      await saveState(state);
      return json(res, { ok: true });
    }
    if (req.method === "POST" && action === "cancel") {
      const job = data.jobs[(await body(req)).jobId];
      if (!job || (actor.departmentId && job.departmentId !== actor.departmentId)) fail("报告不存在", 404);
      if (!ACTIVE.has(job.status)) fail("只能取消未完成任务", 409);
      job.status = "cancelled";
      job.updatedAt = now;
      await saveState(state);
      return json(res, { ok: true });
    }
    return json(res, { error: "Not found" }, 404);
  }

  async function worker(req, res, state, parts, now) {
    nodeOnly();
    if (req.method !== "POST") return json(res, { error: "Method not allowed" }, 405);
    const w = authorizeWorker(state, req),
      data = bucket(state),
      input = await body(req);
    expire(state, now);
    w.lastSeenAt = now;
    const enabled = new Set(state.settings.departments.filter((d) => d.enabled !== false).map((d) => d.id));
    const allowed = (j) => w.departmentIds.includes(j.departmentId) && enabled.has(j.departmentId);
    if (parts[1] === "claim") {
      let job = Object.values(data.jobs).find(
        (j) => allowed(j) && j.workerId === w.id && ["running", "validating"].includes(j.status),
      );
      if (!job)
        job = Object.values(data.jobs)
          .filter((j) => allowed(j) && j.status === "queued")
          .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (job?.status === "queued")
        Object.assign(job, {
          status: "running",
          workerId: w.id,
          lease: randomUUID(),
          startedAt: now,
          heartbeatAt: now,
          deadline: now + REPORT_TIMEOUT,
          updatedAt: now,
        });
      await saveState(state);
      return json(res, {
        job: job
          ? {
              id: job.id,
              lease: job.lease,
              deadline: job.deadline,
              snapshot: job.snapshot,
              period: job.period,
              departmentName: job.departmentName,
            }
          : null,
      });
    }
    const job = data.jobs[input.jobId];
    if (!job || !allowed(job) || job.workerId !== w.id || input.lease !== job.lease) fail("任务归属已失效", 409);
    if (parts[1] === "complete" && job.status === "completed") {
      await saveState(state);
      return json(res, { ok: true, job: publicPeriodJob(job, now) });
    }
    if (!["running", "validating"].includes(job.status)) {
      await saveState(state);
      fail("任务已结束，拒绝旧执行结果", 409);
    }
    if (parts[1] === "heartbeat") {
      job.heartbeatAt = now;
      if (input.phase === "validating") job.status = "validating";
    } else if (parts[1] === "fail") {
      job.status = "failed";
      job.error = String(input.error || "本机生成失败").slice(0, 300);
    } else if (parts[1] === "complete") {
      if (Buffer.byteLength(JSON.stringify(input.report || {})) > 512 * 1024) fail("报告数据超过 512 KB", 413);
      const validation = validatePeriodOutput(job, input.report);
      if (validation.errors.length) fail(validation.errors.slice(0, 8).join("；"), 422);
      const html = renderReport(input.report);
      if (
        input.browserCheck?.htmlHash !== digest(html) ||
        input.browserCheck?.passed !== true ||
        input.browserCheck?.slides !== input.report.slides.length
      )
        fail("缺少与当前 HTML 一致的独立浏览器校验", 422);
      job.report = input.report;
      job.html = html;
      job.validation = { ...validation, browser: input.browserCheck, htmlHash: digest(html) };
      job.status = "completed";
      job.completedAt = now;
    } else return json(res, { error: "Not found" }, 404);
    job.updatedAt = now;
    await saveState(state);
    return json(res, { ok: true, job: publicPeriodJob(job, now) });
  }

  async function view(req, res, state, parts, now, actor) {
    if (req.method !== "GET") return json(res, { error: "Method not allowed" }, 405);
    const allowed = (j) => j.status === "completed" && (!actor.departmentId || j.departmentId === actor.departmentId);
    const jobs = Object.values(bucket(state).jobs)
      .filter(allowed)
      .sort((a, b) => b.version - a.version || b.createdAt - a.createdAt);
    if (!parts[1]) return json(res, { reports: jobs.map((j) => publicPeriodJob(j, now)) });
    const id = decodeURIComponent(parts[1]);
    const job = jobs.find((j) => j.id === id || j.key === id);
    if (!job) fail("报告不存在或无权访问", 404);
    return json(res, {
      job: publicPeriodJob(job, now),
      html: job.html,
      report: job.report,
      validation: job.validation,
    });
  }
  return { admin, worker, view };
}
