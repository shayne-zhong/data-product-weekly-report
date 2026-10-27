import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

test("CSV import preserves quoted fields and creates the shared document", async () => {
  const { parseDashboardFile } = await import("../public/dashboard-import.js").catch(() =>
    assert.fail("CSV import feature is not implemented"),
  );
  const header =
    "schemaVersion,batchId,departmentId,sourceId,sourceName,asOf,metric,periodStart,periodEnd,value,unit,dimensionType,dimension,coverage,numerator,denominator,annualTarget,validForHours";
  const row =
    '1,batch-1,data-product,bi,"BI, 经营平台",2026-10-26T08:00:00+08:00,report_count,2026-01-01,2026-10-26,0,count,total,,complete,,,500,24';
  const parsed = parseDashboardFile("\uFEFF" + header + "\r\n" + row + "\r\n", "csv");
  assert.equal(parsed.sourceName, "BI, 经营平台");
  assert.equal(parsed.records[0].value, 0);
  assert.equal(parsed.records[0].annualTarget, 500);
  assert.equal(parsed.records[0].dimension, "");
  assert.equal(parseDashboardFile(JSON.stringify(parsed), "json").batchId, "batch-1");
});

test("CSV rejects conflicting metadata, broken quotes and fake empty zero", async () => {
  const { parseDashboardFile } = await import("../public/dashboard-import.js");
  const header =
    "schemaVersion,batchId,departmentId,sourceId,sourceName,asOf,metric,periodStart,periodEnd,value,unit,dimensionType,dimension,coverage,numerator,denominator,annualTarget,validForHours";
  const row =
    "1,b1,data-product,bi,BI,2026-10-26T08:00:00+08:00,report_count,2026-01-01,2026-10-26,1,count,total,,complete,,,,";
  assert.throws(() => parseDashboardFile(header + "\n" + row + "\n" + row.replace("b1", "b2"), "csv"), /元信息|批次/);
  assert.throws(() => parseDashboardFile(header + '\n"unclosed', "csv"), /引号/);
  const empty = parseDashboardFile(header + "\n" + row.replace(",1,count,", ",,count,"), "csv");
  assert.equal(empty.records[0].value, null);
  assert.throws(() => parseDashboardFile(header, "csv"), /没有数据|空模板/);
});

test("dashboard bridge rejects foreign windows and origins, routes only allowlisted requests", async () => {
  const source = await readFile(new URL("../public/dashboard-host.js", import.meta.url), "utf8").catch(() =>
    assert.fail("Dashboard bridge feature is not implemented"),
  );
  let listener;
  const delivered = [],
    calls = [];
  const frameWindow = { postMessage: (body, origin) => delivered.push({ body, origin }) };
  const window = {
    location: { origin: "http://workbench.test" },
    addEventListener: (type, fn) => {
      if (type === "message") listener = fn;
    },
    removeEventListener() {},
  };
  vm.runInNewContext(source, { window, URLSearchParams, Date, console });
  const host = window.DepartmentDashboardHost.create({
    frame: { contentWindow: frameWindow },
    isAuthorized: () => true,
    headers: () => ({ Authorization: "Bearer NEVER_SEND_TO_FRAME" }),
    request: async (path, options) => {
      calls.push({ path, options });
      return { context: { departmentId: "data-product" } };
    },
    sections: () => ["overview", "members"],
    openSection() {},
  });
  const message = {
    channel: "department-dashboard-v1",
    type: "request",
    id: "r1",
    action: "load",
    query: { departmentId: "data-product", year: 2026, period: "m01" },
  };
  await listener({ source: {}, origin: "http://workbench.test", data: message });
  await listener({ source: frameWindow, origin: "http://evil.test", data: message });
  assert.equal(calls.length, 0);
  await listener({ source: frameWindow, origin: "http://workbench.test", data: message });
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /^\/api\/admin\/dashboard\?/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer NEVER_SEND_TO_FRAME");
  assert.equal(JSON.stringify(delivered).includes("NEVER_SEND_TO_FRAME"), false);
  await listener({
    source: frameWindow,
    origin: "http://workbench.test",
    data: { ...message, id: "r2", action: "arbitrary", path: "/api/admin/settings" },
  });
  assert.equal(calls.length, 1);
  host.destroy();
});
