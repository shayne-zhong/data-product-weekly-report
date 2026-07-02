import { getStore } from "@netlify/blobs";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const store = getStore({ name: "weekly-report", consistency: "strong" });
const prefix = "reports/";
const sessionsPrefix = "sessions/";
const usersPrefix = "users/";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function safeId(value) {
  return String(value || "")
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

function makeId(report) {
  const base = safeId(`${report.summaryType || "weekly"}-${report.startDate || "start"}-${report.endDate || "end"}`);
  return `${base || "weekly-report"}-${Date.now().toString(36)}`;
}

function summarize(report) {
  return {
    id: report.id,
    summaryType: report.data?.summaryType || report.summaryType || "weekly",
    title: report.data?.title || report.title || "数据产品部周重点工作汇报",
    startDate: report.data?.startDate || report.startDate || "",
    endDate: report.data?.endDate || report.endDate || "",
    status: report.status || "draft",
    createdAt: report.createdAt || 0,
    updatedAt: report.updatedAt || 0,
  };
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

async function getReport(id) {
  return store.get(`${prefix}${id}`, { type: "json" });
}

async function setReport(report) {
  await store.setJSON(`${prefix}${report.id}`, report);
}

async function listReports() {
  const { blobs } = await store.list({ prefix });
  const reports = await Promise.all(
    blobs.map(async (blob) => store.get(blob.key, { type: "json" }).catch(() => null)),
  );
  return reports.filter(Boolean).map(summarize).sort((a, b) => b.updatedAt - a.updatedAt);
}

function displayDate(value) {
  return String(value || "").replaceAll("-", "/");
}

async function findReportByPeriod(data) {
  const { blobs } = await store.list({ prefix });
  const summaryType = data.summaryType || "weekly";
  for (const blob of blobs) {
    const report = await store.get(blob.key, { type: "json" }).catch(() => null);
    if (!report) continue;
    const reportType = report.data?.summaryType || report.summaryType || "weekly";
    const startDate = report.data?.startDate || report.startDate || "";
    const endDate = report.data?.endDate || report.endDate || "";
    if (reportType === summaryType && displayDate(startDate) === displayDate(data.startDate) && displayDate(endDate) === displayDate(data.endDate)) {
      return report;
    }
  }
  return null;
}

export default async (req, context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: jsonHeaders });

  const authError = await requireAuth(req);
  if (authError) return authError;

  const id = context.params?.id;
  const now = Date.now();
  const actor = await currentUser(req);

  try {
    if (!id && req.method === "GET") {
      return json({ reports: await listReports() });
    }

    if (!id && req.method === "POST") {
      const body = await readBody(req);
      const data = body.data;
      if (!data || !Array.isArray(data.modules)) return json({ error: "Invalid report data" }, 400);
      const duplicate = await findReportByPeriod(data);
      if (duplicate) return json({ error: "Report already exists for this period", report: summarize(duplicate) }, 409);

      const report = {
        id: makeId(data),
        summaryType: data.summaryType || "weekly",
        status: body.status || "draft",
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
        updatedBy: actor,
        data,
      };
      await setReport(report);
      return json({ report: summarize(report) }, 201);
    }

    if (id && req.method === "GET") {
      const report = await getReport(id);
      if (!report) return json({ error: "Not found" }, 404);
      return json({ report });
    }

    if (id && req.method === "POST") {
      const body = await readBody(req);
      const existing = await getReport(id);
      if (!existing) return json({ error: "Not found" }, 404);
      if (existing.status === "final") return json({ error: "Report is archived and cannot be edited" }, 423);
      if (!body.data || !Array.isArray(body.data.modules)) return json({ error: "Invalid report data" }, 400);

      const report = {
        ...existing,
        summaryType: body.data?.summaryType || existing.summaryType || "weekly",
        status: body.status || existing.status || "draft",
        updatedAt: now,
        updatedBy: actor,
        data: body.data,
      };
      await setReport(report);
      return json({ report: summarize(report) });
    }

    if (id && req.method === "PATCH") {
      const body = await readBody(req);
      const existing = await getReport(id);
      if (!existing) return json({ error: "Not found" }, 404);
      if (existing.status === "final") return json({ error: "Report is archived and cannot be edited" }, 423);

      const report = {
        ...existing,
        status: body.status || existing.status || "draft",
        updatedAt: now,
        updatedBy: actor,
      };
      await setReport(report);
      return json({ report: summarize(report) });
    }

    if (id && req.method === "DELETE") {
      await store.delete(`${prefix}${id}`);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: "Unexpected server error" }, 500);
  }
};

export const config = {
  path: ["/api/reports", "/api/report/:id"],
  method: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
};
