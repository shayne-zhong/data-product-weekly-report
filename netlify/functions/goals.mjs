import { getStore } from "@netlify/blobs";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const store = getStore({ name: "weekly-report", consistency: "strong" });
const key = "department-goals/current";
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

async function currentUser(req) {
  const token = req.headers.get("x-user-token");
  if (!token) return null;
  const session = await store.get(`${sessionsPrefix}${token}`, { type: "json" });
  if (!session) return null;
  const user = await store.get(`${usersPrefix}${session.username}`, { type: "json" });
  if (!user) return null;
  return { id: user.id, username: user.username, displayName: user.displayName };
}

async function readBody(req) {
  const text = await req.text();
  if (text.length > 1_500_000) throw new Response(JSON.stringify({ error: "Payload too large" }), { status: 413, headers: jsonHeaders });
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: jsonHeaders });
  }
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: jsonHeaders });
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    if (req.method === "GET") {
      const saved = await store.get(key, { type: "json" });
      return json(saved || { rows: null, updatedAt: 0, updatedBy: null });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      if (!Array.isArray(body.rows)) return json({ error: "Invalid goals data" }, 400);
      const payload = {
        rows: body.rows,
        updatedAt: Date.now(),
        updatedBy: await currentUser(req),
      };
      await store.setJSON(key, payload);
      return json(payload);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return json({ error: "Unexpected server error" }, 500);
  }
};

export const config = {
  path: "/api/goals",
  method: ["GET", "POST", "OPTIONS"],
};
