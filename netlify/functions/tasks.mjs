import { getStore } from "@netlify/blobs";
import {
  buildEmptyTask,
  buildWeekId,
  rolloverTasks,
  summarizeTasksForReport,
} from "../../lib/task-core.mjs";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const store = getStore({ name: "weekly-report", consistency: "strong" });
const weeksPrefix = "weeks/";
const tasksPrefix = "tasks/";
const sessionsPrefix = "sessions/";
const usersPrefix = "users/";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function requireAuth(req) {
  const expectedKey = Netlify.env.get("REPORT_SYNC_KEY");
  if (!expectedKey) return json({ error: "Sync key is not configured" }, 503);
  if (req.headers.get("x-report-key") !== expectedKey) return json({ error: "Unauthorized" }, 401);
  return null;
}

async function readBody(req) {
  const text = await req.text();
  if (text.length > 800_000) throw new Response(JSON.stringify({ error: "Payload too large" }), { status: 413, headers: jsonHeaders });
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: jsonHeaders });
  }
}

async function currentUser(req) {
  const token = req.headers.get("x-user-token");
  if (!token) return null;
  const session = await store.get(`${sessionsPrefix}${token}`, { type: "json" });
  if (!session) return null;
  const user = await store.get(`${usersPrefix}${session.username}`, { type: "json" });
  if (!user) return null;
  return { id: user.id, username: user.username, displayName: user.displayName };
}

async function listJson(prefix) {
  const { blobs } = await store.list({ prefix });
  const rows = await Promise.all(blobs.map((blob) => store.get(blob.key, { type: "json" }).catch(() => null)));
  return rows.filter(Boolean);
}

async function getWeek(weekId) {
  return store.get(`${weeksPrefix}${weekId}`, { type: "json" });
}

async function setWeek(week) {
  await store.setJSON(`${weeksPrefix}${week.id}`, week);
}

async function getTask(taskId) {
  return store.get(`${tasksPrefix}${taskId}`, { type: "json" });
}

async function setTask(task) {
  await store.setJSON(`${tasksPrefix}${task.id}`, task);
}

async function listTasksForWeek(weekId) {
  const tasks = await listJson(tasksPrefix);
  return tasks.filter((task) => task.weekId === weekId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
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

function weekFromBody(body, now) {
  const startDate = body.startDate || "";
  const endDate = body.endDate || "";
  if (!startDate || !endDate) return null;
  return {
    id: buildWeekId(startDate, endDate),
    startDate,
    endDate,
    createdAt: now,
    updatedAt: now,
  };
}

function reportDataFromSummary({ week, summary }) {
  const modules = ["AI+X项目", "AI应用项目", "数据治理与经营分析", "财经共享"];
  const displayDate = (value) => String(value || "").replaceAll("-", "/");
  return {
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

export default async (req, context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: jsonHeaders });

  const authError = await requireAuth(req);
  if (authError) return authError;

  const now = Date.now();
  const actor = await currentUser(req);
  const weekId = context.params?.weekId;
  const taskId = context.params?.taskId;

  try {
    if (req.method === "GET" && !weekId && !taskId) {
      const weeks = (await listJson(weeksPrefix)).map(summarizeWeek).sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
      return json({ weeks });
    }

    if (req.method === "POST" && !weekId && !taskId) {
      const body = await readBody(req);
      const week = weekFromBody(body, now);
      if (!week) return json({ error: "startDate and endDate are required" }, 400);
      const existing = await getWeek(week.id);
      if (existing) return json({ week: summarizeWeek(existing) });
      week.createdBy = actor;
      week.updatedBy = actor;
      await setWeek(week);
      return json({ week: summarizeWeek(week) }, 201);
    }

    if (req.method === "GET" && weekId && !taskId) {
      const week = await getWeek(weekId);
      if (!week) return json({ error: "Week not found" }, 404);
      return json({ week: summarizeWeek(week), tasks: await listTasksForWeek(weekId) });
    }

    if (req.method === "POST" && weekId && context.params?.action === "rollover") {
      const body = await readBody(req);
      const sourceWeekId = body.sourceWeekId;
      if (!sourceWeekId) return json({ error: "sourceWeekId is required" }, 400);
      const sourceTasks = await listTasksForWeek(sourceWeekId);
      const existingTargetTasks = await listTasksForWeek(weekId);
      const rolled = rolloverTasks(sourceTasks, { targetWeekId: weekId, sourceWeekId, existingTargetTasks, now });
      rolled.forEach((task) => {
        task.createdBy = actor;
        task.updatedBy = actor;
      });
      await Promise.all(rolled.map(setTask));
      return json({ tasks: rolled }, 201);
    }

    if (req.method === "POST" && weekId && context.params?.action === "generate-report") {
      const week = await getWeek(weekId);
      if (!week) return json({ error: "Week not found" }, 404);
      const tasks = await listTasksForWeek(weekId);
      const summary = summarizeTasksForReport(tasks);
      return json({ data: reportDataFromSummary({ week, summary }), summary });
    }

    if (req.method === "POST" && weekId && !taskId) {
      const body = await readBody(req);
      const week = await getWeek(weekId);
      if (!week) return json({ error: "Week not found" }, 404);
      const task = buildEmptyTask({ ...body.task, weekId, now });
      task.createdBy = actor;
      task.updatedBy = actor;
      await setTask(task);
      await setWeek({ ...week, updatedAt: now });
      return json({ task }, 201);
    }

    if (req.method === "POST" && taskId) {
      const body = await readBody(req);
      const existing = await getTask(taskId);
      if (!existing) return json({ error: "Task not found" }, 404);
      const task = { ...existing, ...body.task, id: existing.id, weekId: existing.weekId, updatedAt: now, updatedBy: actor };
      await setTask(task);
      return json({ task });
    }

    if (req.method === "DELETE" && taskId) {
      await store.delete(`${tasksPrefix}${taskId}`);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return json({ error: "Unexpected server error" }, 500);
  }
};

export const config = {
  path: [
    "/api/weeks",
    "/api/week/:weekId/tasks",
    "/api/week/:weekId/:action",
    "/api/task/:taskId",
  ],
  method: ["GET", "POST", "DELETE", "OPTIONS"],
};
