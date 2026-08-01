import test from "node:test";
import assert from "node:assert/strict";

import { createGoalArtifactService } from "../lib/goal-artifact-service.mjs";

const owner = { id: "user-1", username: "alice", displayName: "张三", departmentId: "data" };
const outsider = { id: "user-2", username: "bob", displayName: "李四", departmentId: "data" };
const settings = { departments: [{ id: "data", leaderUsername: "leader" }] };
const pdfFile = { filename: "结果.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-result") };
const officeFile = {
  filename: "汇报.pptx",
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  buffer: Buffer.from("PK\u0003\u0004office"),
};

function fixtureState(artifact = null) {
  return {
    goalsByDepartment: {
      data: { departmentId: "data", rows: [{ id: "goal-1", name: "收入", owner: "张三", artifact }] },
    },
  };
}

function memoryStore(initial = {}, failures = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async put(key, value) {
      if (failures.put?.(key)) throw new Error("put failed");
      files.set(key, Buffer.from(value));
    },
    async read(key) {
      if (failures.read?.(key)) throw new Error("read failed");
      if (!files.has(key)) Object.assign(new Error("missing"), { code: "ENOENT" });
      if (!files.has(key)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return Buffer.from(files.get(key));
    },
    async remove(key) {
      if (failures.remove?.(key)) throw new Error("remove failed");
      files.delete(key);
    },
  };
}

function keySequence(...keys) {
  return () => keys.shift();
}

test("uploads a direct-preview artifact and exposes only public metadata", async () => {
  const state = fixtureState();
  const store = memoryStore();
  let saves = 0;
  const service = createGoalArtifactService({ store, makeKey: keySequence("new"), now: () => 123 });

  const artifact = await service.upload({ state, departmentId: "data", goalId: "goal-1", actor: owner, settings, file: pdfFile, save: async () => { saves += 1; } });

  assert.equal(saves, 1);
  assert.equal(store.files.get("new.pdf").toString(), "%PDF-result");
  assert.equal(state.goalsByDepartment.data.rows[0].artifact.storageKey, "new.pdf");
  assert.equal(artifact.storageKey, undefined);
  assert.equal(artifact.originalName, "结果.pdf");
});

test("creates a PDF preview for Office files and removes old files after save", async () => {
  const old = { storageKey: "old.pptx", previewStorageKey: "old.pdf", originalName: "旧版.pptx", mimeType: officeFile.mimeType };
  const state = fixtureState(old);
  const store = memoryStore({ "old.pptx": Buffer.from("old"), "old.pdf": Buffer.from("%PDF-old") });
  const service = createGoalArtifactService({
    store,
    convertOffice: async () => Buffer.from("%PDF-new"),
    makeKey: keySequence("source", "preview"),
    now: () => 456,
  });

  await service.upload({ state, departmentId: "data", goalId: "goal-1", actor: owner, settings, file: officeFile, save: async () => {} });

  assert.equal(store.files.get("source.pptx").toString(), "PK\u0003\u0004office");
  assert.equal(store.files.get("preview.pdf").toString(), "%PDF-new");
  assert.equal(store.files.has("old.pptx"), false);
  assert.equal(store.files.has("old.pdf"), false);
});

test("conversion and state-save failures preserve the old artifact", async () => {
  const old = { storageKey: "old.pptx", previewStorageKey: "old.pdf", originalName: "旧版.pptx", mimeType: officeFile.mimeType };
  const conversionState = fixtureState(old);
  const conversionStore = memoryStore({ "old.pptx": Buffer.from("old"), "old.pdf": Buffer.from("%PDF-old") });
  const conversionService = createGoalArtifactService({
    store: conversionStore,
    convertOffice: async () => { throw new Error("转换失败"); },
    makeKey: keySequence("source", "preview"),
  });
  await assert.rejects(() => conversionService.upload({ state: conversionState, departmentId: "data", goalId: "goal-1", actor: owner, settings, file: officeFile, save: async () => {} }), /转换失败/);
  assert.equal(conversionState.goalsByDepartment.data.rows[0].artifact, old);
  assert.deepEqual([...conversionStore.files.keys()].sort(), ["old.pdf", "old.pptx"]);

  const saveState = fixtureState(old);
  const saveStore = memoryStore({ "old.pptx": Buffer.from("old"), "old.pdf": Buffer.from("%PDF-old") });
  const saveService = createGoalArtifactService({ store: saveStore, makeKey: keySequence("new") });
  await assert.rejects(() => saveService.upload({ state: saveState, departmentId: "data", goalId: "goal-1", actor: owner, settings, file: pdfFile, save: async () => { throw new Error("save failed"); } }), /save failed/);
  assert.equal(saveState.goalsByDepartment.data.rows[0].artifact, old);
  assert.equal(saveStore.files.has("new.pdf"), false);
});

test("enforces mutation permissions and department-scoped reads", async () => {
  const artifact = { storageKey: "file.pdf", previewStorageKey: "file.pdf", originalName: "结果.pdf", mimeType: "application/pdf", previewMimeType: "application/pdf" };
  const state = fixtureState(artifact);
  const service = createGoalArtifactService({ store: memoryStore({ "file.pdf": Buffer.from("%PDF") }) });

  await assert.rejects(() => service.upload({ state, departmentId: "data", goalId: "goal-1", actor: outsider, settings, file: pdfFile, save: async () => {} }), (error) => error.statusCode === 403);
  await assert.rejects(() => service.readOriginal({ state, departmentId: "data", goalId: "goal-1", actor: { ...owner, departmentId: "other" } }), (error) => error.statusCode === 404);
  const original = await service.readOriginal({ state, departmentId: "data", goalId: "goal-1", actor: outsider });
  assert.equal(original.buffer.toString(), "%PDF");
  assert.equal(original.filename, "结果.pdf");
});

test("restores deleted bytes and metadata when deletion cannot complete", async () => {
  const artifact = { storageKey: "file.pptx", previewStorageKey: "file.pdf", originalName: "汇报.pptx", mimeType: officeFile.mimeType, previewMimeType: "application/pdf" };
  const state = fixtureState(artifact);
  let failed = false;
  const store = memoryStore({ "file.pptx": Buffer.from("office"), "file.pdf": Buffer.from("%PDF") }, {
    remove: (key) => {
      if (key === "file.pdf" && !failed) {
        failed = true;
        return true;
      }
      return false;
    },
  });
  const service = createGoalArtifactService({ store });

  await assert.rejects(() => service.remove({ state, departmentId: "data", goalId: "goal-1", actor: owner, settings, save: async () => {} }), /删除产物失败/);
  assert.equal(state.goalsByDepartment.data.rows[0].artifact, artifact);
  assert.equal(store.files.get("file.pptx").toString(), "office");
  assert.equal(store.files.get("file.pdf").toString(), "%PDF");
});
