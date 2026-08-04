import { randomUUID } from "node:crypto";
import path from "node:path";

import { publicArtifact, validateArtifactFile } from "./artifact-core.mjs";

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function storedKeys(artifact) {
  return [...new Set([artifact?.storageKey, artifact?.previewStorageKey].filter(Boolean))];
}

function publicActor(actor) {
  return { id: actor.id || "", username: actor.username || "", displayName: actor.displayName || actor.username || "" };
}

function safeFilename(filename) {
  const basename = path.basename(String(filename || ""));
  return [...basename].filter((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  }).join("").trim() || "artifact";
}

function resolveTask(state, departmentId, taskId, actor) {
  const task = state.tasks?.[taskId];
  if (!actor || actor.departmentId !== departmentId || !task || task.departmentId !== departmentId) {
    throw httpError(404, "待办不存在");
  }
  return task;
}

export function createTaskArtifactService({ store, convertOffice, makeKey = randomUUID, now = Date.now, logger = console } = {}) {
  if (!store) throw new Error("artifact store is required");

  async function cleanupStored(artifact, { bestEffort = false } = {}) {
    try {
      await Promise.all(storedKeys(artifact).map((key) => store.remove(key)));
    } catch (error) {
      if (!bestEffort) throw error;
      logger.error?.("task artifact cleanup failed", { message: error?.message || String(error) });
    }
  }

  async function upload({ state, departmentId, taskId, actor, file, save }) {
    const task = resolveTask(state, departmentId, taskId, actor);
    const { extension, previewKind } = validateArtifactFile(file);
    const originalName = safeFilename(file.filename);
    const originalKey = `${makeKey()}${extension}`;
    const previewKey = previewKind === "office" ? `${makeKey()}.pdf` : originalKey;
    const previewBuffer = previewKind === "office" ? await convertOffice({ buffer: file.buffer, extension }) : file.buffer;
    const oldArtifact = task.artifact || null;
    const newArtifact = {
      originalName,
      mimeType: String(file.mimeType || "").toLowerCase(),
      size: file.buffer.length,
      storageKey: originalKey,
      previewStorageKey: previewKey,
      previewMimeType: previewKind === "office" ? "application/pdf" : String(file.mimeType || "").toLowerCase(),
      updatedAt: now(),
      updatedBy: publicActor(actor),
    };
    const writtenKeys = [];
    try {
      await store.put(originalKey, file.buffer);
      writtenKeys.push(originalKey);
      if (previewKey !== originalKey) {
        await store.put(previewKey, previewBuffer);
        writtenKeys.push(previewKey);
      }
      task.artifact = newArtifact;
      await save();
    } catch (error) {
      task.artifact = oldArtifact;
      await Promise.allSettled(writtenKeys.map((key) => store.remove(key)));
      throw error;
    }
    if (oldArtifact) await cleanupStored(oldArtifact, { bestEffort: true });
    return publicArtifact(newArtifact);
  }

  async function readArtifact({ state, departmentId, taskId, actor, preview }) {
    const task = resolveTask(state, departmentId, taskId, actor);
    if (!task.artifact) throw httpError(404, "该待办尚未上传产物");
    const key = preview ? task.artifact.previewStorageKey : task.artifact.storageKey;
    if (!key) throw httpError(404, "产物文件不存在");
    try {
      const buffer = await store.read(key);
      const officePreview = preview && task.artifact.previewMimeType === "application/pdf" && task.artifact.mimeType !== "application/pdf";
      return {
        buffer,
        filename: officePreview ? `${path.basename(task.artifact.originalName, path.extname(task.artifact.originalName))}.pdf` : task.artifact.originalName,
        mimeType: preview ? task.artifact.previewMimeType : task.artifact.mimeType,
      };
    } catch (error) {
      if (error?.code === "ENOENT") throw httpError(404, "产物文件不存在");
      throw error;
    }
  }

  async function remove({ state, departmentId, taskId, actor, save }) {
    const task = resolveTask(state, departmentId, taskId, actor);
    const oldArtifact = task.artifact;
    if (!oldArtifact) throw httpError(404, "该待办尚未上传产物");
    const backups = new Map();
    try {
      for (const key of storedKeys(oldArtifact)) backups.set(key, await store.read(key));
      for (const key of backups.keys()) await store.remove(key);
      task.artifact = null;
      await save();
    } catch {
      task.artifact = oldArtifact;
      await Promise.allSettled([...backups].map(([key, value]) => store.put(key, value)));
      throw httpError(500, "删除产物失败，原产物已保留");
    }
  }

  return {
    upload,
    readOriginal: (context) => readArtifact({ ...context, preview: false }),
    readPreview: (context) => readArtifact({ ...context, preview: true }),
    remove,
    cleanup: (artifact) => cleanupStored(artifact, { bestEffort: true }),
  };
}
