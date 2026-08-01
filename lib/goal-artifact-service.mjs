import { randomUUID } from "node:crypto";
import path from "node:path";

import { canManageGoalArtifact, publicGoalRows, validateArtifactFile } from "./goal-artifact-core.mjs";

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function storedKeys(artifact) {
  return [...new Set([artifact?.storageKey, artifact?.previewStorageKey].filter(Boolean))];
}

function publicActor(actor) {
  return {
    id: actor.id || "",
    username: actor.username || "",
    displayName: actor.displayName || actor.username || "",
  };
}

function safeFilename(filename) {
  return path.basename(String(filename || "")).replace(/[\u0000-\u001f\u007f]/g, "").trim() || "artifact";
}

function resolveGoal(state, departmentId, goalId, actor) {
  if (!actor || actor.departmentId !== departmentId) throw httpError(404, "目标不存在");
  const record = state.goalsByDepartment?.[departmentId];
  const goal = record?.rows?.find((row) => row.id === goalId);
  if (!goal) throw httpError(404, "目标不存在");
  return goal;
}

export function createGoalArtifactService({
  store,
  convertOffice,
  makeKey = randomUUID,
  now = Date.now,
  logger = console,
} = {}) {
  if (!store) throw new Error("artifact store is required");

  async function cleanupStored(artifact, { bestEffort = false } = {}) {
    try {
      await Promise.all(storedKeys(artifact).map((key) => store.remove(key)));
    } catch (error) {
      if (!bestEffort) throw error;
      logger.error?.("goal artifact cleanup failed", { message: error?.message || String(error) });
    }
  }

  async function upload({ state, departmentId, goalId, actor, settings, file, save }) {
    const goal = resolveGoal(state, departmentId, goalId, actor);
    if (!canManageGoalArtifact({ actor, departmentId, goal, settings })) throw httpError(403, "无权修改该目标产物");

    const { extension, previewKind } = validateArtifactFile(file);
    const originalName = safeFilename(file.filename);
    const originalKey = `${makeKey()}${extension}`;
    const previewKey = previewKind === "office" ? `${makeKey()}.pdf` : originalKey;
    const previewBuffer = previewKind === "office"
      ? await convertOffice({ buffer: file.buffer, extension })
      : file.buffer;
    const oldArtifact = goal.artifact || null;
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
      goal.artifact = newArtifact;
      await save();
    } catch (error) {
      goal.artifact = oldArtifact;
      await Promise.allSettled(writtenKeys.map((key) => store.remove(key)));
      throw error;
    }

    if (oldArtifact) await cleanupStored(oldArtifact, { bestEffort: true });
    return publicGoalRows([{ artifact: newArtifact }])[0].artifact;
  }

  async function readArtifact({ state, departmentId, goalId, actor, preview }) {
    const goal = resolveGoal(state, departmentId, goalId, actor);
    if (!goal.artifact) throw httpError(404, "该目标尚未上传产物");
    const key = preview ? goal.artifact.previewStorageKey : goal.artifact.storageKey;
    if (!key) throw httpError(404, "产物文件不存在");
    try {
      const buffer = await store.read(key);
      const officePreview = preview && goal.artifact.previewMimeType === "application/pdf" && goal.artifact.mimeType !== "application/pdf";
      const filename = officePreview
        ? `${path.basename(goal.artifact.originalName, path.extname(goal.artifact.originalName))}.pdf`
        : goal.artifact.originalName;
      return {
        buffer,
        filename,
        mimeType: preview ? goal.artifact.previewMimeType : goal.artifact.mimeType,
      };
    } catch (error) {
      if (error?.code === "ENOENT") throw httpError(404, "产物文件不存在");
      throw error;
    }
  }

  async function remove({ state, departmentId, goalId, actor, settings, save }) {
    const goal = resolveGoal(state, departmentId, goalId, actor);
    if (!canManageGoalArtifact({ actor, departmentId, goal, settings })) throw httpError(403, "无权删除该目标产物");
    const oldArtifact = goal.artifact;
    if (!oldArtifact) throw httpError(404, "该目标尚未上传产物");

    const backups = new Map();
    try {
      for (const key of storedKeys(oldArtifact)) backups.set(key, await store.read(key));
      for (const key of backups.keys()) await store.remove(key);
      goal.artifact = null;
      await save();
    } catch (error) {
      goal.artifact = oldArtifact;
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
