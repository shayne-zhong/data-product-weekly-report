import { applyTaskStatus, buildEmptyTask, buildWeekId, rolloverTasks, summarizeTasksForReport } from "../lib/task-core.mjs";
import { adminCredentialsValid as credentialsMatch } from "../lib/runtime-config.mjs";
import { issueAdminToken, verifyAdminToken } from "../lib/admin-session.mjs";
import { decryptSecret, encryptSecret } from "../lib/encrypted-secret.mjs";
import { createStateStore } from "../lib/state-store.mjs";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const defaultModules = ["AI+X项目", "AI应用项目", "数据治理与经营分析", "财经共享"];
const defaultDepartment = { id: "data-product", name: "数据产品部", enabled: true };
const defaultSessionDurationMinutes = 30;
const minSessionDurationMinutes = 5;
const maxSessionDurationMinutes = 43_200;
const aiProviders = {
  deepseek: {
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-v4-flash",
    apiKeyNames: ["DEEPSEEK_API_KEY", "AI_API_KEY"],
  },
  kimi: {
    label: "Kimi",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    defaultModel: "kimi-k2.6",
    apiKeyNames: ["MOONSHOT_API_KEY", "KIMI_API_KEY", "AI_API_KEY"],
  },
};
const defaultDepartmentAccounts = [
  ["钟南海", "zhongnanhai"], ["宋泉辰", "songquanchen"], ["高竹林", "gaozhulin"], ["林徵", "linzheng"],
  ["黄嘉颖", "huangjiaying"], ["梁思嘉", "liangsijia"], ["杨俊华", "yangjunhua"], ["吴健浩", "wujianhao"],
  ["张瀚中", "zhanghanzhong"], ["黎带兴", "lidaixing"], ["周勉", "zhoumian"], ["邹晓燕", "zouxiaoyan"], ["李文雅", "liwenya"],
].map(([name, username]) => ({ name, username }));
let memoryState = null;
const stateStore = createStateStore();

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

function normalizeModules(list) {
  const modules = (Array.isArray(list) ? list : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return [...new Set(modules)].slice(0, 20);
}

function normalizeAccounts(list, fallbackDepartmentId = defaultDepartment.id) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((account) => ({
      name: String(account?.name || "").trim(),
      username: String(account?.username || "").trim().toLowerCase(),
      departmentId: safeId(account?.departmentId || fallbackDepartmentId).toLowerCase(),
    }))
    .filter((account) => account.name && account.username)
    .filter((account) => {
      if (seen.has(account.username)) return false;
      seen.add(account.username);
      return true;
    })
    .slice(0, 80);
}

function normalizeDepartments(value, fallbackModules = defaultModules) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((department) => ({
      id: safeId(department?.id || department?.name).toLowerCase(),
      name: String(department?.name || "").trim(),
      enabled: department?.enabled !== false,
      modules: normalizeModules(department?.modules).length
        ? normalizeModules(department.modules)
        : [...fallbackModules],
    }))
    .filter((department) => department.id && department.name)
    .filter((department) => {
      if (seen.has(department.id)) return false;
      seen.add(department.id);
      return true;
    })
    .slice(0, 50);
}

function validSessionDurationMinutes(value) {
  const minutes = Number(value);
  return Number.isInteger(minutes)
    && minutes >= minSessionDurationMinutes
    && minutes <= maxSessionDurationMinutes;
}

function normalizeSessionDurationMinutes(value, fallback = defaultSessionDurationMinutes) {
  return validSessionDurationMinutes(value) ? Number(value) : fallback;
}

function normalizeAiSettings(value = {}) {
  const provider = Object.hasOwn(aiProviders, value.provider) ? value.provider : "deepseek";
  const model = String(value.model || aiProviders[provider].defaultModel).trim().slice(0, 100);
  const encryptedApiKey = value.encryptedApiKey && typeof value.encryptedApiKey === "object"
    ? value.encryptedApiKey
    : null;
  const apiKeyLast4 = String(value.apiKeyLast4 || "").slice(-4);
  return {
    enabled: value.enabled === true,
    provider,
    model: model || aiProviders[provider].defaultModel,
    ...(encryptedApiKey ? { encryptedApiKey } : {}),
    ...(encryptedApiKey && apiKeyLast4 ? { apiKeyLast4 } : {}),
  };
}

function aiApiKey(provider) {
  const definition = aiProviders[provider];
  if (!definition) return "";
  return definition.apiKeyNames.map((name) => process.env[name]).find(Boolean) || "";
}

async function resolvedAiApiKey(value = {}) {
  if (value.encryptedApiKey) return decryptSecret(value.encryptedApiKey);
  return aiApiKey(value.provider);
}

function publicAiSettings(value = {}, { admin = false } = {}) {
  const ai = normalizeAiSettings(value);
  const result = {
    enabled: ai.enabled,
    provider: ai.provider,
    model: ai.model,
    providerLabel: aiProviders[ai.provider].label,
    configured: Boolean(ai.encryptedApiKey || aiApiKey(ai.provider)),
  };
  if (admin && ai.encryptedApiKey && ai.apiKeyLast4) result.apiKeyMask = `•••• ${ai.apiKeyLast4}`;
  return result;
}

function defaultSettings() {
  const departments = [{ ...defaultDepartment, modules: [...defaultModules] }];
  return {
    modules: [...defaultModules],
    departments,
    accounts: defaultDepartmentAccounts.map((account) => ({ ...account, departmentId: defaultDepartment.id })),
    sessionDurationMinutes: defaultSessionDurationMinutes,
    ai: normalizeAiSettings(),
  };
}

function getSettings(state = {}) {
  const fallback = defaultSettings();
  const modules = normalizeModules(state.settings?.modules);
  const legacyModules = modules.length ? modules : fallback.modules;
  const departments = normalizeDepartments(state.settings?.departments, legacyModules);
  const resolvedDepartments = departments.length ? departments : fallback.departments;
  const accounts = normalizeAccounts(state.settings?.accounts, resolvedDepartments[0].id)
    .filter((account) => resolvedDepartments.some((department) => department.id === account.departmentId));
  return {
    modules: resolvedDepartments[0].modules,
    departments: resolvedDepartments,
    accounts: accounts.length ? accounts : fallback.accounts,
    sessionDurationMinutes: normalizeSessionDurationMinutes(state.settings?.sessionDurationMinutes),
    ai: normalizeAiSettings(state.settings?.ai || fallback.ai),
  };
}

function publicSettings(state = {}, { admin = false, departmentId = "" } = {}) {
  const settings = getSettings(state);
  const ai = publicAiSettings(settings.ai, { admin });
  if (admin) {
    return {
      ...settings,
      accounts: settings.accounts.map((account) => ({
        ...account,
        registered: Boolean(state.users?.[account.username]),
      })),
      ai,
    };
  }
  if (departmentId) {
    const department = settings.departments.find((item) => item.id === departmentId);
    if (department) {
      return {
        ...settings,
        modules: department.modules,
        departments: [department],
        accounts: settings.accounts.filter((account) => account.departmentId === departmentId),
        ai,
      };
    }
  }
  return { ...settings, accounts: [], ai };
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

function departmentRecordKey(departmentId, recordId) {
  return `${departmentId}:${recordId}`;
}

function emptyState() {
  return { users: {}, sessions: {}, weeks: {}, tasks: {}, reports: {}, goals: null, goalsByDepartment: {}, settings: defaultSettings(), aiUsage: {} };
}

function hydrateState(state = {}) {
  const merged = { ...emptyState(), ...state };
  merged.settings = getSettings(merged);
  const fallbackDepartmentId = merged.settings.departments[0].id;
  Object.values(merged.users).forEach((user) => {
    const account = merged.settings.accounts.find((item) => item.username === user.username);
    user.departmentId ||= account?.departmentId || fallbackDepartmentId;
  });
  Object.values(merged.sessions).forEach((session) => {
    session.departmentId ||= merged.users[session.username]?.departmentId || fallbackDepartmentId;
  });
  const migratedWeeks = {};
  Object.values(merged.weeks).forEach((week) => {
    week.departmentId ||= fallbackDepartmentId;
    migratedWeeks[departmentRecordKey(week.departmentId, week.id)] = week;
  });
  merged.weeks = migratedWeeks;
  Object.values(merged.tasks).forEach((task) => { task.departmentId ||= fallbackDepartmentId; });
  Object.values(merged.reports).forEach((report) => { report.departmentId ||= fallbackDepartmentId; });
  merged.goalsByDepartment = { ...(merged.goalsByDepartment || {}) };
  if (merged.goals && !merged.goalsByDepartment[fallbackDepartmentId]) {
    merged.goalsByDepartment[fallbackDepartmentId] = { ...merged.goals, departmentId: fallbackDepartmentId };
  }
  return merged;
}

async function loadState() {
  const state = await stateStore.load();
  memoryState = state ? hydrateState(state) : emptyState();
  return memoryState;
}

async function saveState(state) {
  memoryState = state;
  await stateStore.save(state);
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

function publicUser(user, state = null) {
  if (!user) return null;
  const department = state
    ? getSettings(state).departments.find((item) => item.id === user.departmentId)
    : null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    departmentId: user.departmentId || "",
    department: department ? { id: department.id, name: department.name } : null,
    createdAt: user.createdAt,
  };
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
  const user = state.users[session.username];
  const departmentId = session.departmentId || user?.departmentId;
  const settings = getSettings(state);
  const account = settings.accounts.find((item) => item.username === session.username);
  const department = settings.departments.find((item) => item.id === departmentId);
  if (!user || !account || account.departmentId !== departmentId || !department?.enabled) return null;
  session.departmentId = departmentId;
  return session;
}

function currentUser(req, state, now = Date.now()) {
  const session = currentSession(req, state, now);
  return session ? publicUser(state.users[session.username], state) : null;
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

function settingsForDepartment(state, departmentId) {
  const settings = getSettings(state);
  const department = settings.departments.find((item) => item.id === departmentId) || settings.departments[0];
  return { ...settings, department, modules: department.modules };
}

function listTasksForWeek(state, weekId, departmentId) {
  return Object.values(state.tasks)
    .filter((task) => task.weekId === weekId && task.departmentId === departmentId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function reportTitleForDepartment(departmentName, summaryType = "weekly") {
  if (summaryType === "monthly") return `${departmentName}月度工作总结`;
  if (summaryType === "quarterly") return `${departmentName}季度工作总结`;
  return `${departmentName}周重点工作汇报`;
}

function summarizeReport(report, departmentName = "数据产品部") {
  const summaryType = resolveReportSummaryType(report);
  return {
    id: report.id,
    summaryType,
    title: report.data?.title || report.title || reportTitleForDepartment(departmentName, summaryType),
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

function reportDataFromSummary({ week, summary, settings }) {
  const modules = normalizeModules(settings?.modules).length ? normalizeModules(settings.modules) : defaultModules;
  return {
    summaryType: "weekly",
    title: `${settings?.department?.name || "数据产品部"}周重点工作汇报`,
    startDate: displayDate(week.startDate),
    endDate: displayDate(week.endDate),
    modules: modules.map((moduleName) => ({
      title: moduleName,
      status: moduleName === "数据治理与经营分析" || moduleName === "财经共享" ? "🟢" : "🟡",
      sections: [
        { title: "本周进展", groups: [], items: summary.progress[moduleName] || [""] },
        { title: "当前风险", groups: [], items: summary.risks[moduleName] || [""] },
        { title: "下周重点", groups: [], items: summary.next[moduleName] || [""] },
      ],
    })),
  };
}

function findReportByPeriod(state, data, departmentId) {
  const summaryType = resolveReportSummaryType(data);
  return Object.values(state.reports).find((report) =>
    report.departmentId === departmentId &&
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
    return json(res, { user: session ? publicUser(state.users[session.username], state) : null, expiresAt: session?.expiresAt || 0 });
  }
  if (req.method !== "POST") return methodNotAllowed(res);
  const body = await readBody(req);
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const settings = getSettings(state);
  const account = settings.accounts.find((item) => item.username === username);
  const department = account
    ? settings.departments.find((item) => item.id === account.departmentId)
    : null;
  if (action === "register") {
    if (!account || !department) return json(res, { error: "该用户名未在后台成员账号中配置" }, 403);
    if (!department.enabled) return json(res, { error: "所属部门已停用" }, 403);
    const displayName = account.name || String(body.displayName || username).trim();
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) return json(res, { error: "用户名需为3-32位英文、数字或._-" }, 400);
    if (password.length < 6) return json(res, { error: "密码至少6位" }, 400);
    if (state.users[username]) return json(res, { error: "用户名已存在" }, 409);
    const salt = randomId("salt");
    const user = { id: randomId("user"), username, displayName, departmentId: department.id, salt, passwordHash: await hashPassword(password, salt), createdAt: now, updatedAt: now };
    state.users[username] = user;
    await saveState(state);
    return json(res, { ok: true, user: publicUser(user, state) }, 201);
  }
  if (action === "login") {
    const user = state.users[username];
    if (!user || await hashPassword(password, user.salt) !== user.passwordHash) return json(res, { error: "用户名或密码错误" }, 401);
    if (!account || !department) return json(res, { error: "账号未分配有效部门" }, 403);
    if (!department.enabled) return json(res, { error: "所属部门已停用" }, 403);
    user.departmentId = department.id;
    user.displayName = account.name || user.displayName;
    user.updatedAt = now;
    const token = randomId("session");
    const expiresAt = now + settings.sessionDurationMinutes * 60_000;
    state.sessions[token] = { username, departmentId: department.id, createdAt: now, expiresAt };
    await saveState(state);
    return json(res, { user: publicUser(user, state), token, expiresAt });
  }
  return methodNotAllowed(res);
}

async function handleWeeks(req, res, state, parts, now, actor) {
  const departmentId = actor.departmentId;
  if (req.method === "GET" && parts.length === 1) {
    const weeks = Object.values(state.weeks)
      .filter((week) => week.departmentId === departmentId)
      .map(summarizeWeek)
      .sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
    return json(res, { weeks });
  }
  if (req.method === "POST" && parts.length === 1) {
    const body = await readBody(req);
    if (!body.startDate || !body.endDate) return json(res, { error: "startDate and endDate are required" }, 400);
    const id = buildWeekId(body.startDate, body.endDate);
    const storageKey = departmentRecordKey(departmentId, id);
    if (!state.weeks[storageKey]) state.weeks[storageKey] = { id, departmentId, startDate: body.startDate, endDate: body.endDate, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor };
    await saveState(state);
    return json(res, { week: summarizeWeek(state.weeks[storageKey]) }, 201);
  }
  return methodNotAllowed(res);
}

function validIsoDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function listTasksForPeriod(state, departmentId, startDate, endDate) {
  const weekIds = new Set(
    Object.values(state.weeks || {})
      .filter((week) =>
        week.departmentId === departmentId
        && week.startDate <= endDate
        && week.endDate >= startDate
      )
      .map((week) => week.id),
  );
  return Object.values(state.tasks || {})
    .filter((task) => task.departmentId === departmentId && weekIds.has(task.weekId))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function handleTasksByPeriod(req, res, state, actor) {
  if (req.method !== "GET") return methodNotAllowed(res);
  const startDate = String(req.query.startDate || "");
  const endDate = String(req.query.endDate || "");
  if (!validIsoDate(startDate) || !validIsoDate(endDate) || endDate < startDate) {
    return json(res, { error: "请输入有效的开始日期和结束日期" }, 400);
  }
  return json(res, {
    tasks: listTasksForPeriod(state, actor.departmentId, startDate, endDate),
  });
}

async function handleWeek(req, res, state, parts, now, actor) {
  const departmentId = actor.departmentId;
  const weekId = decodeURIComponent(parts[1] || "");
  const action = parts[2];
  const week = state.weeks[departmentRecordKey(departmentId, weekId)];
  if (!week) return json(res, { error: "Week not found" }, 404);
  if (req.method === "GET" && action === "tasks") return json(res, { week: summarizeWeek(week), tasks: listTasksForWeek(state, weekId, departmentId) });
  if (req.method === "POST" && action === "tasks") {
    const body = await readBody(req);
    const draft = buildEmptyTask({ ...body.task, weekId, now });
    const task = body.task?.status ? applyTaskStatus(draft, body.task.status, { blocker: body.task.blocker, now }) : draft;
    task.departmentId = departmentId;
    task.createdBy = actor;
    task.updatedBy = actor;
    state.tasks[task.id] = task;
    week.updatedAt = now;
    await saveState(state);
    return json(res, { task }, 201);
  }
  if (req.method === "POST" && action === "rollover") {
    const body = await readBody(req);
    const sourceTasks = listTasksForWeek(state, body.sourceWeekId, departmentId);
    const rolled = rolloverTasks(sourceTasks, { targetWeekId: weekId, sourceWeekId: body.sourceWeekId, existingTargetTasks: listTasksForWeek(state, weekId, departmentId), now });
    rolled.forEach((task) => { task.departmentId = departmentId; task.createdBy = actor; task.updatedBy = actor; state.tasks[task.id] = task; });
    await saveState(state);
    return json(res, { tasks: rolled }, 201);
  }
  if (req.method === "POST" && action === "generate-report") {
    const settings = settingsForDepartment(state, departmentId);
    const summary = summarizeTasksForReport(listTasksForWeek(state, weekId, departmentId), { modules: settings.modules });
    return json(res, { data: reportDataFromSummary({ week, summary, settings }), summary });
  }
  return methodNotAllowed(res);
}

async function handleTask(req, res, state, parts, now, actor) {
  const taskId = decodeURIComponent(parts[1] || "");
  const existing = state.tasks[taskId];
  if (!existing || existing.departmentId !== actor.departmentId) return json(res, { error: "Task not found" }, 404);
  if (req.method === "DELETE") {
    delete state.tasks[taskId];
    await saveState(state);
    return json(res, { ok: true });
  }
  if (req.method === "POST") {
    const body = await readBody(req);
    const merged = { ...existing, ...body.task, id: existing.id, weekId: existing.weekId, departmentId: existing.departmentId, updatedAt: now, updatedBy: actor };
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
  const departmentId = actor.departmentId;
  const departmentName = settingsForDepartment(state, departmentId).department.name;
  if (req.method === "GET" && parts[0] === "reports") {
    const reports = Object.values(state.reports)
      .filter((report) => report.departmentId === departmentId)
      .map((report) => summarizeReport(report, departmentName))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return json(res, { reports });
  }
  if (req.method === "POST" && parts[0] === "reports") {
    const body = await readBody(req);
    const data = normalizeReportPayload(body.data);
    if (!data || !Array.isArray(data.modules)) return json(res, { error: "Invalid report data" }, 400);
    data.title ||= reportTitleForDepartment(departmentName, data.summaryType);
    const duplicate = findReportByPeriod(state, data, departmentId);
    if (duplicate) return json(res, { error: "Report already exists for this period", report: summarizeReport(duplicate, departmentName) }, 409);
    const report = { id: makeReportId(data), departmentId, summaryType: data.summaryType, status: normalizeReportStatus(body.status, "draft"), createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, data };
    state.reports[report.id] = report;
    await saveState(state);
    return json(res, { report: summarizeReport(report, departmentName) }, 201);
  }
  const id = decodeURIComponent(parts[1] || "");
  const action = parts[2];
  const report = state.reports[id];
  if (!report || report.departmentId !== departmentId) return json(res, { error: "Not found" }, 404);
  if (req.method === "GET") return json(res, { report, lock: lockForActor(report, actor, now), canManage: isReportManager(actor) });
  if (req.method === "POST" && action === "lock") {
    if (report.status === "final") return json(res, { error: "总结已归档，无法编辑" }, 423);
    report.editLock = { user: actor, lockedAt: now, expiresAt: now + 5 * 60 * 1000 };
    report.updatedAt = now;
    await saveState(state);
    return json(res, { lock: report.editLock, report: summarizeReport(report, departmentName), canManage: true });
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
    if (!isReportManager(actor)) return json(res, { error: "仅钟南海可删除总结" }, 403);
    delete state.reports[id];
    await saveState(state);
    return json(res, { ok: true });
  }
  if (req.method === "POST" || req.method === "PATCH") {
    if (report.status === "final") return json(res, { error: "总结已归档，无法编辑" }, 423);
    const body = await readBody(req);
    if (req.method === "POST" && (!body.data || !Array.isArray(body.data.modules))) return json(res, { error: "Invalid report data" }, 400);
    const data = body.data ? normalizeReportPayload(body.data, resolveReportSummaryType(report)) : normalizeReportPayload(report.data, resolveReportSummaryType(report));
    data.title ||= reportTitleForDepartment(departmentName, data.summaryType);
    state.reports[id] = { ...report, summaryType: data.summaryType, status: normalizeReportStatus(body.status, report.status || "draft"), updatedAt: now, updatedBy: actor, data, editLock: { user: actor, lockedAt: report.editLock?.lockedAt || now, expiresAt: now + 5 * 60 * 1000 } };
    await saveState(state);
    return json(res, { report: summarizeReport(state.reports[id], departmentName) });
  }
  return methodNotAllowed(res);
}

async function handleGoals(req, res, state, now, actor) {
  const departmentId = actor.departmentId;
  if (req.method === "GET") return json(res, state.goalsByDepartment[departmentId] || { year: "2026", rows: [], updatedAt: 0, updatedBy: null });
  if (req.method === "POST") {
    const body = await readBody(req);
    if (!Array.isArray(body.rows)) return json(res, { error: "Invalid goals rows" }, 400);
    state.goalsByDepartment[departmentId] = { departmentId, year: String(body.year || "2026"), rows: body.rows, updatedAt: now, updatedBy: actor };
    await saveState(state);
    return json(res, state.goalsByDepartment[departmentId]);
  }
  return methodNotAllowed(res);
}

async function handleAccounts(req, res, state, actor) {
  if (req.method !== "GET") return methodNotAllowed(res);
  const users = Object.values(state.users || {})
    .filter((user) => user.departmentId === actor.departmentId)
    .map((user) => publicUser(user, state));
  const accounts = getSettings(state).accounts
    .filter((account) => account.departmentId === actor.departmentId)
    .map((account) => ({
    ...account,
    user: users.find((user) => user.username === account.username || user.displayName === account.name) || null,
    }));
  return json(res, { accounts });
}

function aiSummaryInstruction(style, summaryType, departmentName) {
  const styleRules = {
    concise: "高度精炼，删除重复表述，每个模块优先保留3-6条最有价值的事实。",
    executive: "面向CIO和管理层，突出业务结果、量化指标、关键风险、依赖事项和下阶段决策点。",
    complete: "在保留全部有效事实的前提下润色表达、合并重复项并强化层次。",
  };
  const typeLabel = { weekly: "周总结", monthly: "月总结", quarterly: "季度总结" }[summaryType] || "工作总结";
  return `你是${departmentName}负责人助理，负责把${typeLabel}整理成可直接发送给管理层的中文纯文本。\n\n要求：\n1. 严格基于原文，不得补充、猜测或虚构任何数字、结论、人员和进度。\n2. ${styleRules[style] || styleRules.executive}\n3. 保留原文标题、周期、模块名称，以及进展、风险、计划等必要层级。\n4. 优先呈现量化成果、完成度、业务影响、阻塞原因和需要管理层关注的事项。\n5. 合并同义或重复事项，修正病句和标点；信息不完整时保持原意，不自行推断。\n6. 输出纯文本，不要Markdown代码块，不要写“以下是总结”等前言，不要解释你的处理过程。\n7. 列表统一使用“1、2、3、”格式；没有内容的风险可写“无”。`;
}

function cleanAiText(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

async function requestAiSummary({ sourceText, style, summaryType, departmentName, ai }) {
  const provider = aiProviders[ai.provider];
  const apiKey = await resolvedAiApiKey(ai);
  if (!apiKey) throw new Error(`${provider.label} API Key 未配置`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: ai.model,
        messages: [
          { role: "system", content: aiSummaryInstruction(style, summaryType, departmentName) },
          { role: "user", content: `请总结并提炼以下原始内容：\n\n${sourceText}` },
        ],
        temperature: 0.2,
        max_tokens: 4000,
        stream: false,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const upstreamMessage = String(payload?.error?.message || payload?.message || `HTTP ${response.status}`).slice(0, 240);
      throw new Error(`${provider.label} 调用失败：${upstreamMessage}`);
    }
    const text = cleanAiText(payload?.choices?.[0]?.message?.content);
    if (!text) throw new Error(`${provider.label} 未返回有效内容`);
    return {
      text,
      provider: ai.provider,
      providerLabel: provider.label,
      model: ai.model,
      usage: payload.usage || null,
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("AI生成超时，请稍后重试");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function consumeAiQuota(state, actor, now = Date.now()) {
  const configuredLimit = Number(process.env.AI_DAILY_LIMIT || 30);
  const limit = Math.max(1, Math.min(200, Number.isFinite(configuredLimit) ? Math.floor(configuredLimit) : 30));
  const userKey = String(actor?.id || actor?.username || "");
  const day = new Date(now).toISOString().slice(0, 10);
  const current = state.aiUsage?.[userKey];
  const count = current?.day === day ? Number(current.count || 0) : 0;
  if (count >= limit) return { allowed: false, limit, remaining: 0 };
  if (!state.aiUsage || typeof state.aiUsage !== "object") state.aiUsage = {};
  state.aiUsage[userKey] = { day, count: count + 1, updatedAt: now };
  return { allowed: true, limit, remaining: limit - count - 1 };
}

async function handleAi(req, res, state, parts, actor) {
  if (req.method === "GET" && parts[1] === "status") {
    return json(res, { ai: publicAiSettings(getSettings(state).ai) });
  }
  if (req.method !== "POST" || parts[1] !== "report-summary") return methodNotAllowed(res);
  if (!actor) return json(res, { error: "请先登录后使用AI提炼" }, 401);
  const departmentSettings = settingsForDepartment(state, actor.departmentId);
  const ai = normalizeAiSettings(departmentSettings.ai);
  if (!ai.enabled) return json(res, { error: "后台尚未启用AI提炼" }, 503);
  if (!ai.encryptedApiKey && !aiApiKey(ai.provider)) return json(res, { error: `${aiProviders[ai.provider].label} API Key 未配置` }, 503);
  const body = await readBody(req);
  const sourceText = String(body.sourceText || "").trim();
  if (sourceText.length < 20) return json(res, { error: "周报内容过少，暂时无法提炼" }, 400);
  if (sourceText.length > 50_000) return json(res, { error: "周报内容超过50000字，请精简后重试" }, 413);
  const style = ["concise", "executive", "complete"].includes(body.style) ? body.style : "executive";
  const summaryType = validReportSummaryType(body.summaryType) || "weekly";
  const quota = consumeAiQuota(state, actor);
  if (!quota.allowed) return json(res, { error: `今日AI提炼次数已达上限（${quota.limit}次）` }, 429);
  await saveState(state);
  try {
    const result = await requestAiSummary({ sourceText, style, summaryType, departmentName: departmentSettings.department.name, ai });
    return json(res, { result, quota });
  } catch (error) {
    return json(res, { error: error.message || "AI生成失败" }, 502);
  }
}

async function handleSettings(req, res, state, now, { adminAuthorized = false } = {}) {
  if (req.method === "GET") {
    const session = currentSession(req, state, now);
    return json(res, {
      settings: publicSettings(state, {
        admin: adminAuthorized,
        departmentId: session?.departmentId || "",
      }),
    });
  }
  if (req.method !== "POST" && req.method !== "PATCH") return methodNotAllowed(res);
  if (!adminAuthorized) return json(res, { error: "后台登录已过期，请重新登录" }, 401);
  const body = await readBody(req);
  const current = getSettings(state);
  if (Object.hasOwn(body, "sessionDurationMinutes") && !validSessionDurationMinutes(body.sessionDurationMinutes)) {
    return json(res, { error: "登录保持时间必须是 5 到 43200 分钟之间的整数" }, 400);
  }
  const departments = Object.hasOwn(body, "departments")
    ? normalizeDepartments(body.departments, current.modules)
    : current.departments;
  const removedDepartment = current.departments.find((department) =>
    !departments.some((candidate) => candidate.id === department.id)
  );
  if (removedDepartment) {
    return json(res, { error: `部门“${removedDepartment.name}”不能删除，请改为停用` }, 400);
  }
  if (!departments.length || !departments.some((department) => department.enabled)) {
    return json(res, { error: "至少保留一个启用的部门" }, 400);
  }
  const accounts = Object.hasOwn(body, "accounts")
    ? normalizeAccounts(body.accounts, departments[0].id)
    : current.accounts;
  if (accounts.some((account) => !departments.some((department) => department.id === account.departmentId))) {
    return json(res, { error: "成员账号必须关联有效部门" }, 400);
  }
  const next = {
    modules: departments[0].modules,
    departments,
    accounts,
    sessionDurationMinutes: Object.hasOwn(body, "sessionDurationMinutes")
      ? Number(body.sessionDurationMinutes)
      : current.sessionDurationMinutes,
    ai: body.ai ? normalizeAiSettings({ ...current.ai, ...body.ai }) : current.ai,
  };
  if (body.ai?.apiKey) {
    const apiKey = String(body.ai.apiKey).trim();
    next.ai.encryptedApiKey = await encryptSecret(apiKey);
    next.ai.apiKeyLast4 = apiKey.slice(-4);
  }
  if (body.ai?.clearApiKey === true) {
    delete next.ai.encryptedApiKey;
    delete next.ai.apiKeyLast4;
    next.ai.enabled = false;
  }
  if (!next.modules.length) return json(res, { error: "至少保留一个项目类型" }, 400);
  if (!next.accounts.length) return json(res, { error: "至少保留一个账号" }, 400);
  state.settings = { ...next, updatedAt: now };
  await saveState(state);
  return json(res, { settings: publicSettings(state, { admin: true }) });
}

async function testAiConnection({ provider: providerName, model, apiKey }) {
  const provider = aiProviders[providerName];
  if (!provider || !apiKey) throw new Error("请填写有效的 AI API 密钥");
  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: String(model || provider.defaultModel),
      messages: [{ role: "user", content: "请回复 OK" }],
      temperature: 0,
      max_tokens: 4,
      stream: false,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(payload?.error?.message || payload?.message || `HTTP ${response.status}`).slice(0, 240);
    throw new Error(`${provider.label} 连接失败：${message}`);
  }
  return { ok: true, message: "连接成功" };
}

function bearerToken(req) {
  const header = String(req.headers.authorization || req.headers.Authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function resetUserPassword(req, res, state, username, now) {
  if (req.method !== "POST") return methodNotAllowed(res);
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const { password } = await readBody(req);
  const nextPassword = String(password || "");
  if (nextPassword.length < 6) return json(res, { error: "密码至少6位" }, 400);

  const user = state.users[normalizedUsername];
  if (!user) return json(res, { error: "账号尚未注册" }, 404);

  user.salt = randomId("salt");
  user.passwordHash = await hashPassword(nextPassword, user.salt);
  user.updatedAt = now;
  for (const [token, session] of Object.entries(state.sessions || {})) {
    if (session.username === normalizedUsername) delete state.sessions[token];
  }
  await saveState(state);
  return json(res, { ok: true, username: normalizedUsername });
}

async function handleAdmin(req, res, state, parts, now) {
  const action = parts[1] || "";
  if (action === "login") {
    if (req.method !== "POST") return methodNotAllowed(res);
    const { username, password } = await readBody(req);
    if (!credentialsMatch(username, password)) return json(res, { error: "后台账号或密码错误" }, 401);
    const session = await issueAdminToken({ username, now });
    return json(res, session);
  }

  const admin = await verifyAdminToken(bearerToken(req), { now });
  if (!admin) return json(res, { error: "后台登录已过期，请重新登录" }, 401);
  if (action === "settings") return handleSettings(req, res, state, now, { adminAuthorized: true });
  if (action === "users" && parts[3] === "reset-password") {
    return resetUserPassword(req, res, state, decodeURIComponent(parts[2] || ""), now);
  }
  if (action === "ai" && parts[2] === "test" && req.method === "POST") {
    const body = await readBody(req);
    const ai = normalizeAiSettings({ ...getSettings(state).ai, ...body });
    try {
      const apiKey = String(body.apiKey || "").trim() || await resolvedAiApiKey(ai);
      return json(res, await testAiConnection({ provider: ai.provider, model: ai.model, apiKey }));
    } catch (error) {
      return json(res, { error: error.message || "AI 连接测试失败" }, 502);
    }
  }
  return json(res, { error: "Not found" }, 404);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  const state = await loadState();
  const now = Date.now();
  const routePath = Array.isArray(req.query.path) ? req.query.path.join("/") : String(req.query.path || "");
  const parts = routePath.split("/").filter(Boolean);
  const actor = currentUser(req, state, now);
  try {
    if (parts[0] === "auth") return handleAuth(req, res, state, parts[1], now);
    if (parts[0] === "admin") return handleAdmin(req, res, state, parts, now);
    if (parts[0] === "settings") return handleSettings(req, res, state, now);
    if (!actor) return json(res, { error: "请先登录" }, 401);
    if (parts[0] === "weeks") return handleWeeks(req, res, state, parts, now, actor);
    if (parts[0] === "week") return handleWeek(req, res, state, parts, now, actor);
    if (parts[0] === "tasks") return handleTasksByPeriod(req, res, state, actor);
    if (parts[0] === "task") return handleTask(req, res, state, parts, now, actor);
    if (parts[0] === "reports" || parts[0] === "report") return handleReports(req, res, state, parts, now, actor);
    if (parts[0] === "goals") return handleGoals(req, res, state, now, actor);
    if (parts[0] === "accounts") return handleAccounts(req, res, state, actor);
    if (parts[0] === "ai") return handleAi(req, res, state, parts, actor);
    return json(res, { error: "Not found" }, 404);
  } catch (error) {
    if (["无效任务状态", "进入阻塞状态必须填写阻塞原因", "完成任务前必须关联年度指标并填写贡献数"].includes(error.message)) {
      return json(res, { error: error.message }, 400);
    }
    console.error(error);
    return json(res, { error: "Unexpected server error" }, 500);
  }
}
