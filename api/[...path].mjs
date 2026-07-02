import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyTaskStatus, buildEmptyTask, buildWeekId, rolloverTasks, summarizeTasksForReport } from "../lib/task-core.mjs";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const dataPath = "data-product-weekly-report/state-v1.json";
const tmpPath = join(tmpdir(), "data-product-weekly-report-state-v1.json");
const defaultSyncKey = "DP-WEEKLY-2026-7K4M";
const sessionTtlMs = 30 * 60 * 1000;
const departmentAccounts = [
  ["钟南海", "zhongnanhai"], ["宋泉辰", "songquanchen"], ["高竹林", "gaozhulin"], ["林徵", "linzheng"],
  ["黄嘉颖", "huangjiaying"], ["梁思嘉", "liangsijia"], ["杨俊华", "yangjunhua"], ["吴健浩", "wujianhao"],
  ["张瀚中", "zhanghanzhong"], ["黎带兴", "lidaixing"], ["周勉", "zhoumian"], ["邹晓燕", "zouxiaoyan"], ["李文雅", "liwenya"],
].map(([name, username]) => ({ name, username }));
let memoryState = null;
let blobApi = null;
let netlifyStore = null;

function json(res, body, status = 200) {
  Object.entries(jsonHeaders).forEach(([key, value]) => res.setHeader(key, value));
  return res.status(status).json(body);
}

function methodNotAllowed(res) {
  return json(res, { error: "Method not allowed" }, 405);
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function safeId(value) {
  return String(value || "")
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

function displayDate(value) {
  return String(value || "").replaceAll("-", "/");
}

function normalizeDateText(value) {
  return String(value || "").replaceAll("/", "-");
}

function validReportSummaryType(value) {
  return ["weekly", "monthly", "quarterly"].includes(value) ? value : "";
}

function resolveReportSummaryType(reportOrData = {}) {
  const data = reportOrData.data || reportOrData;
  const direct = validReportSummaryType(reportOrData.summaryType) || validReportSummaryType(data.summaryType);
  const titles = [
    reportOrData.title,
    data.title,
    ...(Array.isArray(data.modules) ? data.modules.map((module) => module?.title) : []),
  ].join(" ");
  let inferred = "";
  if (/quarter|季度|本季|下季/i.test(titles)) inferred = "quarterly";
  else if (/month|月度|本月|下月/i.test(titles)) inferred = "monthly";
  const start = normalizeDateText(data.startDate || reportOrData.startDate);
  const end = normalizeDateText(data.endDate || reportOrData.endDate);
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  if (!inferred && startYear && startMonth && startDay === 1 && endYear && endMonth && endDay) {
    const quarterEnd = new Date(startYear, startMonth + 2, 0);
    if (endYear === quarterEnd.getFullYear() && endMonth === quarterEnd.getMonth() + 1 && endDay === quarterEnd.getDate()) inferred = "quarterly";
    const monthEnd = new Date(startYear, startMonth, 0);
    if (!inferred && endYear === monthEnd.getFullYear() && endMonth === monthEnd.getMonth() + 1 && endDay === monthEnd.getDate()) inferred = "monthly";
  }
  if (direct && !(direct === "weekly" && inferred && inferred !== "weekly")) return direct;
  return inferred || "weekly";
}

function normalizeReportPayload(data = {}, fallbackType = "weekly") {
  const summaryType = validReportSummaryType(data.summaryType) || validReportSummaryType(fallbackType) || resolveReportSummaryType(data);
  return { ...data, summaryType };
}

function emptyState() {
  return { users: {}, sessions: {}, weeks: {}, tasks: {}, reports: {}, goals: null };
}

async function getBlobApi() {
  if (blobApi !== null) return blobApi;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    blobApi = false;
    return blobApi;
  }
  try {
    blobApi = await import("@vercel/blob");
  } catch {
    blobApi = false;
  }
  return blobApi;
}

async function getNetlifyStore() {
  if (netlifyStore !== null) return netlifyStore;
  if (!process.env.NETLIFY) {
    netlifyStore = false;
    return netlifyStore;
  }
  try {
    const { getStore } = await import("@netlify/blobs");
    netlifyStore = getStore({ name: "weekly-report", consistency: "strong" });
  } catch {
    netlifyStore = false;
  }
  return netlifyStore;
}

async function loadState() {
  const store = await getNetlifyStore();
  if (store) {
    try {
      const state = await store.get("state-v1.json", { type: "json" });
      if (state) {
        memoryState = { ...emptyState(), ...state };
        return memoryState;
      }
    } catch (error) {
      if (process.env.NETLIFY) throw new Error(`Cloud state load failed: ${error.message || error}`);
    }
  } else if (process.env.NETLIFY) {
    throw new Error("Cloud state storage is not configured");
  }
  const api = await getBlobApi();
  if (api) {
    try {
      const blob = await api.get(dataPath, { access: "private", useCache: false });
      if (blob?.stream) {
        const text = await new Response(blob.stream).text();
        memoryState = { ...emptyState(), ...JSON.parse(text) };
        return memoryState;
      }
    } catch {}
  }
  if (memoryState) return memoryState;
  try {
    memoryState = { ...emptyState(), ...JSON.parse(await readFile(tmpPath, "utf8")) };
  } catch {
    memoryState = emptyState();
  }
  return memoryState;
}

async function saveState(state) {
  memoryState = state;
  const body = JSON.stringify(state);
  const store = await getNetlifyStore();
  if (store) {
    try {
      await store.setJSON("state-v1.json", state);
      return;
    } catch (error) {
      if (process.env.NETLIFY) throw new Error(`Cloud state save failed: ${error.message || error}`);
    }
  } else if (process.env.NETLIFY) {
    throw new Error("Cloud state storage is not configured");
  }
  const api = await getBlobApi();
  if (api) {
    try {
      await api.put(dataPath, body, {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json; charset=utf-8",
      });
      return;
    } catch (error) {
      if (process.env.VERCEL) throw new Error(`Cloud state save failed: ${error.message || error}`);
    }
  } else if (process.env.VERCEL) {
    throw new Error("Cloud state storage is not configured");
  }
  await writeFile(tmpPath, body, "utf8");
}

function requireKey(req, res) {
  const expectedKey = process.env.REPORT_SYNC_KEY || defaultSyncKey;
  if (req.headers["x-report-key"] !== expectedKey) {
    json(res, { error: "Unauthorized" }, 401);
    return false;
  }
  return true;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return req.body ? JSON.parse(req.body) : {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function hashPassword(password, salt) {
  const input = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicUser(user) {
  return user ? { id: user.id, username: user.username, displayName: user.displayName, createdAt: user.createdAt } : null;
}

function isReportManager(user) {
  const username = String(user?.username || "").toLowerCase();
  const displayName = String(user?.displayName || "").trim();
  return username === "zhongnanhai" || displayName === "钟南海" || displayName.toLowerCase() === "znh";
}

function lockExpired(lock, now) {
  return !lock?.expiresAt || lock.expiresAt < now;
}

function lockForActor(report, actor, now) {
  if (!report?.editLock || lockExpired(report.editLock, now)) return null;
  if (actor?.id && report.editLock.user?.id === actor.id) return null;
  return report.editLock;
}

function currentSession(req, state, now = Date.now()) {
  const token = req.headers["x-user-token"];
  const session = token ? state.sessions[token] : null;
  if (!session) return null;
  if (!session.expiresAt || session.expiresAt <= now) return null;
  return session;
}

function currentUser(req, state, now = Date.now()) {
  const session = currentSession(req, state, now);
  return session ? publicUser(state.users[session.username]) : null;
}

function summarizeWeek(week) {
  return {
    id: week.id,
    startDate: week.startDate,
    endDate: week.endDate,
    createdAt: week.createdAt,
    updatedAt: week.updatedAt,
  };
}

function listTasksForWeek(state, weekId) {
  return Object.values(state.tasks).filter((task) => task.weekId === weekId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function summarizeReport(report) {
  const summaryType = resolveReportSummaryType(report);
  return {
    id: report.id,
    summaryType,
    title: report.data?.title || report.title || "数据产品部周重点工作汇报",
    startDate: report.data?.startDate || report.startDate || "",
    endDate: report.data?.endDate || report.endDate || "",
    status: report.status || "draft",
    createdAt: report.createdAt || 0,
    updatedAt: report.updatedAt || 0,
  };
}

function makeReportId(data) {
  const base = safeId(`${data.startDate || "start"}-${data.endDate || "end"}`);
  return `${base || "weekly-report"}-${Date.now().toString(36)}`;
}

function reportDataFromSummary({ week, summary }) {
  const modules = ["AI+X项目", "AI应用项目", "数据治理与经营分析", "财经共享"];
  return {
    summaryType: "weekly",
    title: "数据产品部周重点工作汇报",
    startDate: displayDate(week.startDate),
    endDate: displayDate(week.endDate),
    modules: modules.map((moduleName) => ({
      title: moduleName,
      status: moduleName === "数据治理与经营分析" ? "🔵" : moduleName === "财经共享" ? "🟢" : "🟡",
      sections: [
        { title: "本周进展", groups: [], items: summary.progress[moduleName] || [""] },
        { title: "当前风险", groups: [], items: summary.risks[moduleName] || [""] },
        { title: "下周重点", groups: [], items: summary.next[moduleName] || [""] },
      ],
    })),
  };
}

function findReportByPeriod(state, data) {
  const summaryType = resolveReportSummaryType(data);
  return Object.values(state.reports).find((report) =>
    resolveReportSummaryType(report) === summaryType &&
    displayDate(report.data?.startDate || report.startDate) === displayDate(data.startDate) &&
    displayDate(report.data?.endDate || report.endDate) === displayDate(data.endDate)
  );
}

function normalizeReportStatus(status, fallback = "draft") {
  return ["draft", "editing", "final"].includes(status) ? status : fallback;
}

async function handleAuth(req, res, state, action, now) {
  if (req.method === "GET" && action === "me") {
    const session = currentSession(req, state, now);
    return json(res, { user: session ? publicUser(state.users[session.username]) : null, expiresAt: session?.expiresAt || 0 });
  }
  if (req.method !== "POST") return methodNotAllowed(res);
  const body = await readBody(req);
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (action === "register") {
    const displayName = String(body.displayName || username).trim();
    if (!/^[a-z0-9_\-.]{3,32}$/.test(username)) return json(res, { error: "用户名需为3-32位英文、数字或._-" }, 400);
    if (password.length < 6) return json(res, { error: "密码至少6位" }, 400);
    if (state.users[username]) return json(res, { error: "用户名已存在" }, 409);
    const salt = randomId("salt");
    const user = { id: randomId("user"), username, displayName, salt, passwordHash: await hashPassword(password, salt), createdAt: now, updatedAt: now };
    state.users[username] = user;
    const token = randomId("session");
    const expiresAt = now + sessionTtlMs;
    state.sessions[token] = { username, createdAt: now, expiresAt };
    await saveState(state);
    return json(res, { user: publicUser(user), token, expiresAt }, 201);
  }
  if (action === "login") {
    const user = state.users[username];
    if (!user || await hashPassword(password, user.salt) !== user.passwordHash) return json(res, { error: "用户名或密码错误" }, 401);
    const token = randomId("session");
    const expiresAt = now + sessionTtlMs;
    state.sessions[token] = { username, createdAt: now, expiresAt };
    await saveState(state);
    return json(res, { user: publicUser(user), token, expiresAt });
  }
  return methodNotAllowed(res);
}

async function handleWeeks(req, res, state, parts, now, actor) {
  if (req.method === "GET" && parts.length === 1) {
    const weeks = Object.values(state.weeks).map(summarizeWeek).sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
    return json(res, { weeks });
  }
  if (req.method === "POST" && parts.length === 1) {
    const body = await readBody(req);
    if (!body.startDate || !body.endDate) return json(res, { error: "startDate and endDate are required" }, 400);
    const id = buildWeekId(body.startDate, body.endDate);
    if (!state.weeks[id]) state.weeks[id] = { id, startDate: body.startDate, endDate: body.endDate, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor };
    await saveState(state);
    return json(res, { week: summarizeWeek(state.weeks[id]) }, 201);
  }
  return methodNotAllowed(res);
}

async function handleWeek(req, res, state, parts, now, actor) {
  const weekId = decodeURIComponent(parts[1] || "");
  const action = parts[2];
  const week = state.weeks[weekId];
  if (!week) return json(res, { error: "Week not found" }, 404);
  if (req.method === "GET" && action === "tasks") return json(res, { week: summarizeWeek(week), tasks: listTasksForWeek(state, weekId) });
  if (req.method === "POST" && action === "tasks") {
    const body = await readBody(req);
    const draft = buildEmptyTask({ ...body.task, weekId, now });
    const task = body.task?.status ? applyTaskStatus(draft, body.task.status, { blocker: body.task.blocker, now }) : draft;
    task.createdBy = actor;
    task.updatedBy = actor;
    state.tasks[task.id] = task;
    week.updatedAt = now;
    await saveState(state);
    return json(res, { task }, 201);
  }
  if (req.method === "POST" && action === "rollover") {
    const body = await readBody(req);
    const sourceTasks = listTasksForWeek(state, body.sourceWeekId);
    const rolled = rolloverTasks(sourceTasks, { targetWeekId: weekId, sourceWeekId: body.sourceWeekId, existingTargetTasks: listTasksForWeek(state, weekId), now });
    rolled.forEach((task) => { task.createdBy = actor; task.updatedBy = actor; state.tasks[task.id] = task; });
    await saveState(state);
    return json(res, { tasks: rolled }, 201);
  }
  if (req.method === "POST" && action === "generate-report") {
    const summary = summarizeTasksForReport(listTasksForWeek(state, weekId));
    return json(res, { data: reportDataFromSummary({ week, summary }), summary });
  }
  return methodNotAllowed(res);
}

async function handleTask(req, res, state, parts, now, actor) {
  const taskId = decodeURIComponent(parts[1] || "");
  if (req.method === "DELETE") {
    delete state.tasks[taskId];
    await saveState(state);
    return json(res, { ok: true });
  }
  if (req.method === "POST") {
    const existing = state.tasks[taskId];
    if (!existing) return json(res, { error: "Task not found" }, 404);
    const body = await readBody(req);
    const merged = { ...existing, ...body.task, id: existing.id, weekId: existing.weekId, updatedAt: now, updatedBy: actor };
    const task = body.task?.status && body.task.status !== existing.status
      ? applyTaskStatus(merged, body.task.status, { blocker: body.task.blocker, now })
      : merged;
    task.updatedBy = actor;
    state.tasks[task.id] = task;
    await saveState(state);
    return json(res, { task });
  }
  return methodNotAllowed(res);
}

async function handleReports(req, res, state, parts, now, actor) {
  if (req.method === "GET" && parts[0] === "reports") {
    const reports = Object.values(state.reports).map(summarizeReport).sort((a, b) => b.updatedAt - a.updatedAt);
    return json(res, { reports });
  }
  if (req.method === "POST" && parts[0] === "reports") {
    const body = await readBody(req);
    const data = normalizeReportPayload(body.data);
    if (!data || !Array.isArray(data.modules)) return json(res, { error: "Invalid report data" }, 400);
    const duplicate = findReportByPeriod(state, data);
    if (duplicate) return json(res, { error: "Report already exists for this period", report: summarizeReport(duplicate) }, 409);
    const report = { id: makeReportId(data), summaryType: data.summaryType, status: normalizeReportStatus(body.status, "draft"), createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, data };
    state.reports[report.id] = report;
    await saveState(state);
    return json(res, { report: summarizeReport(report) }, 201);
  }
  const id = decodeURIComponent(parts[1] || "");
  const action = parts[2];
  const report = state.reports[id];
  if (!report) return json(res, { error: "Not found" }, 404);
  if (req.method === "GET") return json(res, { report, lock: lockForActor(report, actor, now), canManage: isReportManager(actor) });
  if (req.method === "POST" && action === "lock") {
    if (report.status === "final") return json(res, { error: "周报已归档，无法编辑" }, 423);
    report.editLock = { user: actor, lockedAt: now, expiresAt: now + 5 * 60 * 1000 };
    report.updatedAt = now;
    await saveState(state);
    return json(res, { lock: report.editLock, report: summarizeReport(report), canManage: true });
  }
  if (req.method === "POST" && action === "unlock") {
    if (report.editLock && actor?.id && (report.editLock.user?.id === actor.id || isReportManager(actor))) {
      delete report.editLock;
      report.updatedAt = now;
      await saveState(state);
    }
    return json(res, { ok: true });
  }
  if (req.method === "DELETE") {
    if (!isReportManager(actor)) return json(res, { error: "仅钟南海可删除周报" }, 403);
    delete state.reports[id];
    await saveState(state);
    return json(res, { ok: true });
  }
  if (req.method === "POST" || req.method === "PATCH") {
    if (report.status === "final") return json(res, { error: "周报已归档，无法编辑" }, 423);
    const body = await readBody(req);
    if (req.method === "POST" && (!body.data || !Array.isArray(body.data.modules))) return json(res, { error: "Invalid report data" }, 400);
    const data = body.data ? normalizeReportPayload(body.data, resolveReportSummaryType(report)) : normalizeReportPayload(report.data, resolveReportSummaryType(report));
    state.reports[id] = { ...report, summaryType: data.summaryType, status: normalizeReportStatus(body.status, report.status || "draft"), updatedAt: now, updatedBy: actor, data, editLock: { user: actor, lockedAt: report.editLock?.lockedAt || now, expiresAt: now + 5 * 60 * 1000 } };
    await saveState(state);
    return json(res, { report: summarizeReport(state.reports[id]) });
  }
  return methodNotAllowed(res);
}

async function handleGoals(req, res, state, now, actor) {
  if (req.method === "GET") return json(res, state.goals || { year: "2026", rows: [], updatedAt: 0, updatedBy: null });
  if (req.method === "POST") {
    const body = await readBody(req);
    if (!Array.isArray(body.rows)) return json(res, { error: "Invalid goals rows" }, 400);
    state.goals = { year: String(body.year || "2026"), rows: body.rows, updatedAt: now, updatedBy: actor };
    await saveState(state);
    return json(res, state.goals);
  }
  return methodNotAllowed(res);
}

async function handleAccounts(req, res, state) {
  if (req.method !== "GET") return methodNotAllowed(res);
  const users = Object.values(state.users || {}).map(publicUser);
  const accounts = departmentAccounts.map((account) => ({
    ...account,
    user: users.find((user) => user.username === account.username || user.displayName === account.name) || null,
  }));
  return json(res, { accounts });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!requireKey(req, res)) return;
  const state = await loadState();
  const now = Date.now();
  const routePath = Array.isArray(req.query.path) ? req.query.path.join("/") : String(req.query.path || "");
  const parts = routePath.split("/").filter(Boolean);
  const actor = currentUser(req, state, now);
  try {
    if (parts[0] === "auth") return handleAuth(req, res, state, parts[1], now);
    if (parts[0] === "weeks") return handleWeeks(req, res, state, parts, now, actor);
    if (parts[0] === "week") return handleWeek(req, res, state, parts, now, actor);
    if (parts[0] === "task") return handleTask(req, res, state, parts, now, actor);
    if (parts[0] === "reports" || parts[0] === "report") return handleReports(req, res, state, parts, now, actor);
    if (parts[0] === "goals") return handleGoals(req, res, state, now, actor);
    if (parts[0] === "accounts") return handleAccounts(req, res, state);
    return json(res, { error: "Not found" }, 404);
  } catch (error) {
    if (["无效任务状态", "进入阻塞状态必须填写阻塞原因"].includes(error.message)) {
      return json(res, { error: error.message }, 400);
    }
    console.error(error);
    return json(res, { error: "Unexpected server error" }, 500);
  }
}
