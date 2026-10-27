export const DASHBOARD_CSV_FIELDS = ["schemaVersion", "batchId", "departmentId", "sourceId", "sourceName", "asOf", "metric", "periodStart", "periodEnd", "value", "unit", "dimensionType", "dimension", "coverage", "numerator", "denominator", "annualTarget", "validForHours"];

function csvRows(text) {
  const rows = []; let row = [], field = "", quoted = false, closed = false;
  const finish = () => { row.push(field); field = ""; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field || closed) throw Error("CSV 引号位置无效。");
      quoted = true;
    } else if (c === ",") finish();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      finish(); if (row.some(v => v.trim())) rows.push(row); row = [];
      if (rows.length > 501) throw Error("单批最多导入 500 条数据。");
    } else if (closed && c !== " " && c !== "\t") throw Error("CSV 关闭引号后存在非法字符。");
    else if (!closed) field += c;
  }
  if (quoted) throw Error("CSV 引号未闭合。");
  finish(); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

export function parseDashboardFile(content, format) {
  const text = String(content).replace(/^\uFEFF/, "");
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw Error("文件不能超过 1 MB。");
  if (format === "json") {
    let value; try { value = JSON.parse(text); } catch { throw Error("JSON 格式无效，请检查文件。"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("文件必须是 v1 数据对象。");
    return value;
  }
  if (format !== "csv") throw Error("请选择 UTF-8 JSON 或 CSV 文件；Excel 请另存为 CSV UTF-8。");
  const rows = csvRows(text), header = rows.shift()?.map(v => v.trim());
  if (!rows.length) throw Error("这是空模板，尚没有数据行；请填写真实数据后再导入。");
  if (!header || header.length !== DASHBOARD_CSV_FIELDS.length || new Set(header).size !== header.length || DASHBOARD_CSV_FIELDS.some(k => !header.includes(k))) throw Error("CSV 表头与标准模板不一致，请使用提供的模板。");
  let metadata; const records = [];
  for (const [index, row] of rows.entries()) {
    if (row.length !== header.length) throw Error(`CSV 第 ${index + 2} 行列数与表头不一致。`);
    const data = Object.fromEntries(header.map((key, i) => [key, row[i].trim()]));
    const next = { schemaVersion: Number(data.schemaVersion), batchId: data.batchId, departmentId: data.departmentId, sourceId: data.sourceId, sourceName: data.sourceName, asOf: data.asOf };
    if (metadata && Object.keys(next).some(key => next[key] !== metadata[key])) throw Error(`CSV 第 ${index + 2} 行元信息不同；一个文件只能包含同一部门、来源与批次。`);
    metadata = next;
    const record = { metric: data.metric, periodStart: data.periodStart, periodEnd: data.periodEnd, value: data.value === "" ? null : Number(data.value), unit: data.unit, dimensionType: data.dimensionType || "total", dimension: data.dimension || "", coverage: data.coverage };
    for (const key of ["numerator", "denominator", "annualTarget", "validForHours"]) if (data[key] !== "") record[key] = Number(data[key]);
    for (const key of ["value", "numerator", "denominator", "annualTarget", "validForHours"]) if (record[key] !== null && record[key] !== undefined && !Number.isFinite(record[key])) throw Error(`CSV 第 ${index + 2} 行 ${key} 不是有效数字。`);
    records.push(record);
  }
  return { ...metadata, records };
}
