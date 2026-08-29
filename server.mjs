import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import apiHandler, { runReportAutoArchiveFromServer, runWeeklyRolloverFromServer } from "./api/[...path].mjs";
import { validateProductionConfig } from "./lib/runtime-config.mjs";

const defaultPublicRoot = fileURLToPath(new URL("./public", import.meta.url));
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
};

function sendJson(res, body, statusCode = 200) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function adaptApiResponse(res) {
  res.status = (statusCode) => {
    res.statusCode = statusCode;
    return res;
  };
  res.json = (body) => {
    if (!res.hasHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
    return res;
  };
  return res;
}

function safePublicPath(publicRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const filePath = resolve(publicRoot, decoded.replace(/^[/\\]+/, ""));
  const root = resolve(publicRoot);
  return filePath === root || filePath.startsWith(`${root}${sep}`) ? filePath : null;
}

async function serveStatic(req, res, url, publicRoot) {
  if (!['GET', 'HEAD'].includes(req.method || "GET")) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }

  const routeToIndex = url.pathname === "/"
    || url.pathname === "/admin"
    || url.pathname.startsWith("/admin/")
    || !extname(url.pathname);
  const requestedPath = routeToIndex ? "/index.html" : url.pathname;
  const filePath = safePublicPath(publicRoot, requestedPath);
  if (!filePath) {
    res.writeHead(404);
    return res.end("Not found");
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const extension = extname(filePath).toLowerCase();
    const cacheControl = extension === ".html" ? "no-store" : "public, max-age=3600";
    res.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") return res.end();
    res.end(await readFile(filePath));
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

export function apiQueryFromUrl(url) {
  const query = { path: url.pathname.slice(5).split("/").filter(Boolean) };
  for (const [key, value] of url.searchParams) query[key] = value;
  return query;
}

export function createProductionServer({
  publicRoot = defaultPublicRoot,
  deploymentVersion = process.env.DEPLOYMENT_VERSION || "local",
} = {}) {
  validateProductionConfig();
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (url.pathname === "/healthz") return sendJson(res, { status: "ok", version: deploymentVersion });
      if (url.pathname === "/wecom/callback") {
        req.query = { path: ["wecom", "callback"] };
        for (const [key, value] of url.searchParams) req.query[key] = value;
        return await apiHandler(req, adaptApiResponse(res));
      }
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        req.query = apiQueryFromUrl(url);
        return await apiHandler(req, adaptApiResponse(res));
      }
      return await serveStatic(req, res, url, publicRoot);
    } catch (error) {
      console.error("Request failed", error?.message || error);
      if (!res.headersSent) return sendJson(res, { error: "Unexpected server error" }, 500);
      res.end();
    }
  });
}

const chinaOffsetMs = 8 * 60 * 60 * 1000;
const weekMs = 7 * 24 * 60 * 60 * 1000;

export function millisecondsUntilNextWeeklyRollover(now = Date.now()) {
  const chinaNow = new Date(now + chinaOffsetMs);
  const daysSinceMonday = (chinaNow.getUTCDay() + 6) % 7;
  const mondayStart = Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate())
    - chinaOffsetMs
    - daysSinceMonday * 24 * 60 * 60 * 1000;
  let nextRun = mondayStart + 5 * 60 * 1000;
  if (nextRun <= now) nextRun += weekMs;
  return nextRun - now;
}

export function startWeeklyRolloverScheduler({
  run = runWeeklyRolloverFromServer,
  now = Date.now,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  logger = console,
} = {}) {
  let stopped = false;
  let timer = null;
  const invoke = async (triggeredAt, trigger) => {
    try {
      const result = await run({ triggeredAt, trigger });
      logger.info?.("Weekly rollover scheduler:", JSON.stringify({ trigger, ...result }));
      return result;
    } catch (error) {
      logger.error?.("Weekly rollover scheduler failed:", error?.message || error);
      return null;
    }
  };
  const scheduleNext = () => {
    if (stopped) return;
    const current = now();
    const scheduledAt = current + millisecondsUntilNextWeeklyRollover(current);
    timer = setTimeoutImpl(async () => {
      await invoke(scheduledAt, "server-scheduled");
      scheduleNext();
    }, Math.max(0, scheduledAt - now()));
    timer?.unref?.();
  };
  const startup = invoke(now(), "server-startup");
  scheduleNext();
  return {
    startup,
    stop() {
      stopped = true;
      if (timer) clearTimeoutImpl(timer);
    },
  };
}

export function startReportAutoArchiveScheduler({
  run = runReportAutoArchiveFromServer,
  now = Date.now,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  logger = console,
} = {}) {
  const invoke = async (trigger) => {
    try {
      const result = await run({ triggeredAt: now(), trigger });
      logger.info?.("Report auto archive scheduler:", JSON.stringify(result));
      return result;
    } catch (error) {
      logger.error?.("Report auto archive scheduler failed:", error?.message || error);
      return null;
    }
  };
  const startup = invoke("server-startup");
  const timer = setIntervalImpl(() => invoke("server-scheduled"), 5 * 60 * 1000);
  timer?.unref?.();
  return { startup, stop: () => clearIntervalImpl(timer) };
}

const isDirectRun = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const port = Number(process.env.PORT || 3000);
  const server = createProductionServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Department workbench listening on port ${port}`);
    const scheduler = startWeeklyRolloverScheduler();
    const reportArchiveScheduler = startReportAutoArchiveScheduler();
    server.once("close", () => { scheduler.stop(); reportArchiveScheduler.stop(); });
  });
}
