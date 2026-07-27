import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import apiHandler from "./api/[...path].mjs";
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

const isDirectRun = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const port = Number(process.env.PORT || 3000);
  createProductionServer().listen(port, "0.0.0.0", () => {
    console.log(`Department workbench listening on port ${port}`);
  });
}
