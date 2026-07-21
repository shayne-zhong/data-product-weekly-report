import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import handler from "../api/[...path].mjs";

const syncKey = "DP-WEEKLY-2026-7K4M";

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

let defaultToken = "";

async function api(path, { method = "GET", body, token, headers = {} } = {}) {
  const resolvedToken = token === undefined ? defaultToken : token;
  const req = {
    method,
    headers: { "x-report-key": syncKey, ...(resolvedToken ? { "x-user-token": resolvedToken } : {}), ...headers },
    query: { path: path.split("/").filter(Boolean) },
    body,
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

test.before(async () => {
  const username = `report${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const current = await api("/settings");
  const settings = current.body.settings;
  const saved = await api("/settings", {
    method: "POST",
    headers: { "x-admin-user": "Admin", "x-admin-password": "888888" },
    body: {
      departments: settings.departments,
      accounts: [...settings.accounts, { name: "报告测试", username, departmentId: settings.departments[0].id }],
      sessionDurationMinutes: settings.sessionDurationMinutes,
      ai: settings.ai,
    },
  });
  assert.equal(saved.statusCode, 200);
  const registered = await api("/auth/register", {
    method: "POST",
    body: { username, password: "12345678", displayName: "报告测试" },
  });
  assert.equal(registered.statusCode, 201);
  defaultToken = registered.body.token;
});

test("AI settings expose readiness without exposing API keys", async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalMoonshotKey = process.env.MOONSHOT_API_KEY;
  process.env.DEEPSEEK_API_KEY = "unit-test-placeholder";
  process.env.MOONSHOT_API_KEY = "unit-test-moonshot-placeholder";
  try {
    const settings = await api("/settings");
    assert.equal(settings.statusCode, 200);
    assert.equal(settings.body.settings.ai.configured, true);
    assert.equal(JSON.stringify(settings.body).includes("unit-test-placeholder"), false);
    assert.equal(JSON.stringify(settings.body).includes("unit-test-moonshot-placeholder"), false);
  } finally {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    if (originalMoonshotKey === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = originalMoonshotKey;
  }
});

test("AI report summary requires login and returns a reviewable candidate", async () => {
  const anonymous = await api("/ai/report-summary", {
    method: "POST",
    token: "",
    body: { sourceText: "这是一段足够长的周报原始内容，用于验证未登录状态。" },
  });
  assert.equal(anonymous.statusCode, 401);

  const saved = await api("/settings", {
    method: "POST",
    headers: { "x-admin-user": "Admin", "x-admin-password": "888888" },
    body: { ai: { enabled: true, provider: "deepseek", model: "deepseek-v4-flash" } },
  });
  assert.equal(saved.statusCode, 200);

  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalMoonshotKey = process.env.MOONSHOT_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = "unit-test-placeholder";
  process.env.MOONSHOT_API_KEY = "unit-test-moonshot-placeholder";
  let upstreamRequest = null;
  globalThis.fetch = async (url, options) => {
    upstreamRequest = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{ message: { content: "```text\n数据产品部周重点工作汇报\n1、完成重点任务。\n```" } }],
          usage: { total_tokens: 128 },
        };
      },
    };
  };
  try {
    const generated = await api("/ai/report-summary", {
      method: "POST",
      token: defaultToken,
      body: {
        sourceText: "数据产品部周重点工作汇报\n汇报周期：2026/07/13—2026/07/19\n本周完成重点任务。",
        summaryType: "weekly",
        style: "executive",
      },
    });
    assert.equal(generated.statusCode, 200);
    assert.equal(generated.body.result.text.includes("```"), false);
    assert.equal(generated.body.result.usage.total_tokens, 128);
    assert.equal(upstreamRequest.url, "https://api.deepseek.com/chat/completions");
    assert.equal(upstreamRequest.options.headers.Authorization, "Bearer unit-test-placeholder");

    const kimiSettings = await api("/settings", {
      method: "POST",
      headers: { "x-admin-user": "Admin", "x-admin-password": "888888" },
      body: { ai: { enabled: true, provider: "kimi", model: "kimi-k2.6" } },
    });
    assert.equal(kimiSettings.statusCode, 200);
    const kimiGenerated = await api("/ai/report-summary", {
      method: "POST",
      token: defaultToken,
      body: {
        sourceText: "数据产品部周重点工作汇报\n汇报周期：2026/07/13—2026/07/19\n本周完成重点任务。",
        summaryType: "weekly",
        style: "concise",
      },
    });
    assert.equal(kimiGenerated.statusCode, 200);
    assert.equal(upstreamRequest.url, "https://api.moonshot.cn/v1/chat/completions");
    assert.equal(upstreamRequest.options.headers.Authorization, "Bearer unit-test-moonshot-placeholder");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    if (originalMoonshotKey === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = originalMoonshotKey;
  }
});

function reportData(summaryType, startDate, endDate) {
  return {
    summaryType,
    title: `${summaryType} test report`,
    startDate,
    endDate,
    modules: [{ title: "测试模块", status: "", sections: [{ title: "内容", items: ["测试内容"] }] }],
  };
}

test("reports allow same period across summary types but reject duplicate type periods", async () => {
  const startDate = `2091/01/${randomUUID()}`;
  const endDate = startDate;

  const weekly = await api("/reports", {
    method: "POST",
    body: { data: reportData("weekly", startDate, endDate), status: "draft" },
  });
  assert.equal(weekly.statusCode, 201);
  assert.equal(weekly.body.report.summaryType, "weekly");

  const monthly = await api("/reports", {
    method: "POST",
    body: { data: reportData("monthly", startDate, endDate), status: "draft" },
  });
  assert.equal(monthly.statusCode, 201);
  assert.equal(monthly.body.report.summaryType, "monthly");

  const duplicateWeekly = await api("/reports", {
    method: "POST",
    body: { data: reportData("weekly", startDate, endDate), status: "draft" },
  });
  assert.equal(duplicateWeekly.statusCode, 409);
});

test("final reports reject later edits", async () => {
  const startDate = `2092/02/${randomUUID()}`;
  const created = await api("/reports", {
    method: "POST",
    body: { data: reportData("quarterly", startDate, startDate), status: "draft" },
  });
  assert.equal(created.statusCode, 201);

  const archived = await api(`/report/${encodeURIComponent(created.body.report.id)}`, {
    method: "POST",
    body: { data: reportData("quarterly", startDate, startDate), status: "final" },
  });
  assert.equal(archived.statusCode, 200);
  assert.equal(archived.body.report.status, "final");

  const edited = await api(`/report/${encodeURIComponent(created.body.report.id)}`, {
    method: "POST",
    body: { data: reportData("quarterly", startDate, startDate), status: "editing" },
  });
  assert.equal(edited.statusCode, 423);
  assert.match(edited.body.error, /已归档/);
});

test("reports infer quarterly type when legacy data was saved as weekly", async () => {
  const suffix = randomUUID();
  const year = 2200 + Math.floor(Math.random() * 300);
  const created = await api("/reports", {
    method: "POST",
    body: {
      data: {
        ...reportData("weekly", `${year}/01/01`, `${year}/03/31`),
        title: `legacy quarterly ${suffix}`,
      },
      status: "draft",
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.report.summaryType, "quarterly");

  const list = await api("/reports");
  const found = list.body.reports.find((report) => report.id === created.body.report.id);
  assert.ok(found);
  assert.equal(found.summaryType, "quarterly");
});

test("goals persist the annual record year", async () => {
  const saved = await api("/goals", {
    method: "POST",
    body: { year: "2026", rows: [{ seq: "1", name: "年度目标测试", target: "100%" }] },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.year, "2026");

  const loaded = await api("/goals");
  assert.equal(loaded.statusCode, 200);
  assert.equal(loaded.body.year, "2026");
  assert.equal(loaded.body.rows[0].name, "年度目标测试");
});
