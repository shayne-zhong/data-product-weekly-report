import { getStore } from "@netlify/blobs";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const store = getStore({ name: "weekly-report", consistency: "strong" });
const usersPrefix = "users/";
const sessionsPrefix = "sessions/";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function requireKey(req) {
  const expectedKey = Netlify.env.get("REPORT_SYNC_KEY");
  if (!expectedKey) return json({ error: "Sync key is not configured" }, 503);
  if (req.headers.get("x-report-key") !== expectedKey) return json({ error: "Unauthorized" }, 401);
  return null;
}

async function readBody(req) {
  const text = await req.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: jsonHeaders });
  }
}

function userKey(username) {
  return `${usersPrefix}${String(username || "").trim().toLowerCase()}`;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function hashPassword(password, salt) {
  const input = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function userFromSession(req) {
  const token = req.headers.get("x-user-token");
  if (!token) return null;
  const session = await store.get(`${sessionsPrefix}${token}`, { type: "json" });
  if (!session) return null;
  return store.get(userKey(session.username), { type: "json" });
}

export default async (req, context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: jsonHeaders });
  const keyError = await requireKey(req);
  if (keyError) return keyError;

  const action = context.params?.action;
  const now = Date.now();

  try {
    if (req.method === "GET" && action === "me") {
      const user = await userFromSession(req);
      return json({ user: user ? publicUser(user) : null });
    }

    if (req.method === "POST" && action === "register") {
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const displayName = String(body.displayName || username).trim();
      if (!/^[a-z0-9_\-.]{3,32}$/.test(username)) return json({ error: "用户名需为3-32位英文、数字或._-" }, 400);
      if (password.length < 6) return json({ error: "密码至少6位" }, 400);
      const existing = await store.get(userKey(username), { type: "json" });
      if (existing) return json({ error: "用户名已存在" }, 409);
      const salt = randomId("salt");
      const user = {
        id: randomId("user"),
        username,
        displayName,
        salt,
        passwordHash: await hashPassword(password, salt),
        createdAt: now,
        updatedAt: now,
      };
      await store.setJSON(userKey(username), user);
      const token = randomId("session");
      await store.setJSON(`${sessionsPrefix}${token}`, { username, createdAt: now });
      return json({ user: publicUser(user), token }, 201);
    }

    if (req.method === "POST" && action === "login") {
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = await store.get(userKey(username), { type: "json" });
      if (!user) return json({ error: "用户名或密码错误" }, 401);
      const passwordHash = await hashPassword(password, user.salt);
      if (passwordHash !== user.passwordHash) return json({ error: "用户名或密码错误" }, 401);
      const token = randomId("session");
      await store.setJSON(`${sessionsPrefix}${token}`, { username, createdAt: now });
      return json({ user: publicUser(user), token });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return json({ error: "Unexpected server error" }, 500);
  }
};

export const config = {
  path: ["/api/auth/:action"],
  method: ["GET", "POST", "OPTIONS"],
};
