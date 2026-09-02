import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "public");
const port = Number(process.env.PORT || 4177);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const now = Date.now();
const weeks = [
  { id: "2026-06-22_2026-06-28", startDate: "2026-06-22", endDate: "2026-06-28", createdAt: now, updatedAt: now },
];
const reports = {};
let settings = {
  modules: ["AI+X项目", "AI应用项目", "数据治理与经营分析", "财经共享"],
  accounts: [
    { name: "钟南海", username: "zhongnanhai" },
    { name: "宋泉辰", username: "songquanchen" },
  ],
  ai: { enabled: true, provider: "deepseek", providerLabel: "DeepSeek", model: "deepseek-v4-flash", configured: true },
};

function sendJson(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/api/settings") {
      if (req.method === "GET") return sendJson(res, { settings });
      const body = await readJson(req);
      settings = {
        modules: body.modules || settings.modules,
        accounts: body.accounts || settings.accounts,
        ai: body.ai || settings.ai,
      };
      return sendJson(res, { settings });
    }
    if (url.pathname === "/api/ai/report-summary" && req.method === "POST") {
      const body = await readJson(req);
      return sendJson(res, {
        result: {
          text: `AI提炼预览\n\n${body.sourceText || ""}`,
          provider: "deepseek",
          providerLabel: "DeepSeek",
          model: "deepseek-v4-flash",
          usage: { total_tokens: 120 },
        },
      });
    }
    if (url.pathname === "/api/accounts")
      return sendJson(res, { accounts: settings.accounts.map((account) => ({ ...account, user: null })) });
    if (url.pathname === "/api/weeks") return sendJson(res, { weeks });
    if (url.pathname === "/api/reports") {
      if (req.method === "GET")
        return sendJson(res, {
          reports: Object.values(reports).map((report) => ({
            id: report.id,
            summaryType: report.data.summaryType || "weekly",
            title: report.data.title,
            startDate: report.data.startDate,
            endDate: report.data.endDate,
            status: report.status,
            updatedAt: report.updatedAt,
          })),
        });
      const body = await readJson(req);
      const id = `mock_${Date.now()}`;
      reports[id] = { id, status: body.status || "draft", data: body.data, updatedAt: Date.now() };
      return sendJson(
        res,
        {
          report: {
            id,
            summaryType: body.data.summaryType || "weekly",
            title: body.data.title,
            startDate: body.data.startDate,
            endDate: body.data.endDate,
            status: reports[id].status,
            updatedAt: reports[id].updatedAt,
          },
        },
        201,
      );
    }
    if (url.pathname.startsWith("/api/report/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() || "");
      const report = reports[id];
      if (!report) return sendJson(res, { error: "Not found" }, 404);
      if (req.method === "GET") return sendJson(res, { report });
      const body = await readJson(req);
      report.status = body.status || report.status;
      report.data = body.data || report.data;
      report.updatedAt = Date.now();
      return sendJson(res, {
        report: {
          id,
          summaryType: report.data.summaryType || "weekly",
          title: report.data.title,
          startDate: report.data.startDate,
          endDate: report.data.endDate,
          status: report.status,
          updatedAt: report.updatedAt,
        },
      });
    }
    if (url.pathname === "/api/week/2026-06-22_2026-06-28/tasks") return sendJson(res, { week: weeks[0], tasks: [] });
    if (url.pathname === "/api/goals") return sendJson(res, { year: "2026", rows: [], updatedAt: 0, updatedBy: null });
    const path = normalize(
      url.pathname === "/" || url.pathname.startsWith("/admin") ? "/index.html" : url.pathname,
    ).replace(/^[/\\]+/, "");
    const file = join(root, path);
    if (!file.startsWith(root)) throw new Error("Forbidden");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`static server http://127.0.0.1:${port}`);
});
