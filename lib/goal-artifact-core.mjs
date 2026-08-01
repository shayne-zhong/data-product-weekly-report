import { randomUUID } from "node:crypto";
import path from "node:path";

export const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
export const OFFICE_EXTENSIONS = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"]);

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function hasPrefix(buffer, bytes) {
  return buffer.length >= bytes.length && bytes.every((value, index) => buffer[index] === value);
}

const signatures = {
  pdf: (buffer) => buffer.subarray(0, 4).toString("ascii") === "%PDF",
  zip: (buffer) => hasPrefix(buffer, [0x50, 0x4b]) && [0x03, 0x05, 0x07].includes(buffer[2]) && [0x04, 0x06, 0x08].includes(buffer[3]),
  ole: (buffer) => hasPrefix(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  png: (buffer) => hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: (buffer) => hasPrefix(buffer, [0xff, 0xd8, 0xff]),
  gif: (buffer) => ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")),
  webp: (buffer) => buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP",
  html: (buffer) => {
    const text = buffer.subarray(0, 1024).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
    return text.startsWith("<!doctype html") || text.startsWith("<html");
  },
};

const typeRules = new Map([
  [".pdf", { mimes: ["application/pdf"], signature: signatures.pdf, previewKind: "direct" }],
  [".docx", { mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], signature: signatures.zip, previewKind: "office" }],
  [".xlsx", { mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], signature: signatures.zip, previewKind: "office" }],
  [".pptx", { mimes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], signature: signatures.zip, previewKind: "office" }],
  [".doc", { mimes: ["application/msword"], signature: signatures.ole, previewKind: "office" }],
  [".xls", { mimes: ["application/vnd.ms-excel"], signature: signatures.ole, previewKind: "office" }],
  [".ppt", { mimes: ["application/vnd.ms-powerpoint"], signature: signatures.ole, previewKind: "office" }],
  [".png", { mimes: ["image/png"], signature: signatures.png, previewKind: "direct" }],
  [".jpg", { mimes: ["image/jpeg"], signature: signatures.jpeg, previewKind: "direct" }],
  [".jpeg", { mimes: ["image/jpeg"], signature: signatures.jpeg, previewKind: "direct" }],
  [".webp", { mimes: ["image/webp"], signature: signatures.webp, previewKind: "direct" }],
  [".gif", { mimes: ["image/gif"], signature: signatures.gif, previewKind: "direct" }],
  [".html", { mimes: ["text/html"], signature: signatures.html, previewKind: "html" }],
  [".htm", { mimes: ["text/html"], signature: signatures.html, previewKind: "html" }],
]);

export function ensureGoalIds(rows = [], makeId = () => `goal-${randomUUID()}`) {
  let changed = false;
  const normalizedRows = rows.map((row) => {
    if (String(row?.id || "").trim()) return row;
    changed = true;
    return { ...row, id: makeId() };
  });
  return { rows: normalizedRows, changed };
}

export function mergeGoalRows(existingRows = [], incomingRows = [], makeId) {
  const existingById = new Map(existingRows.filter((row) => row?.id).map((row) => [row.id, row]));
  return ensureGoalIds(incomingRows, makeId).rows.map((row) => {
    const editableGoal = { ...row };
    delete editableGoal.artifact;
    delete editableGoal.canManageArtifact;
    return { ...editableGoal, artifact: existingById.get(row.id)?.artifact || null };
  });
}

export function publicGoalRows(rows = []) {
  return rows.map((row) => ({
    ...row,
    artifact: row.artifact
      ? {
          originalName: row.artifact.originalName || "",
          mimeType: row.artifact.mimeType || "",
          size: Number(row.artifact.size || 0),
          previewMimeType: row.artifact.previewMimeType || "",
          updatedAt: Number(row.artifact.updatedAt || 0),
          updatedBy: row.artifact.updatedBy || null,
        }
      : null,
  }));
}

export function canManageGoalArtifact({ actor, departmentId, goal, settings = {} }) {
  if (!actor || actor.departmentId !== departmentId) return false;
  const owner = String(goal?.owner || "").trim().toLowerCase();
  const aliases = [actor.username, actor.displayName]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  const department = (settings.departments || []).find((item) => item.id === departmentId);
  return aliases.includes(owner) || department?.leaderUsername === actor.username;
}

export function validateArtifactFile({ filename, mimeType, buffer }) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  if (!bytes.length) throw httpError(400, "产物文件不能为空");
  if (bytes.length > MAX_ARTIFACT_BYTES) throw httpError(413, "产物不能超过 20 MB");

  const extension = path.extname(String(filename || "")).toLowerCase();
  const rule = typeRules.get(extension);
  if (!rule) throw httpError(400, "不支持该产物格式");

  const normalizedMime = String(mimeType || "").split(";", 1)[0].trim().toLowerCase();
  if (!rule.mimes.includes(normalizedMime)) throw httpError(400, "产物文件类型与扩展名不匹配");
  if (!rule.signature(bytes)) throw httpError(400, "产物文件内容与格式不匹配");
  return { extension, previewKind: rule.previewKind };
}
