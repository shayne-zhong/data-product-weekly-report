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

async function api(path, { method = "GET", body, token = "" } = {}) {
  const req = {
    method,
    headers: { "x-report-key": syncKey, ...(token ? { "x-user-token": token } : {}) },
    query: { path: path.split("/").filter(Boolean) },
    body,
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

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
