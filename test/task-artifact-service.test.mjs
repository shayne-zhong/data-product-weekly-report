import test from "node:test";
import assert from "node:assert/strict";

import { createTaskArtifactService } from "../lib/task-artifact-service.mjs";

const actor = { id: "user-1", username: "alice", displayName: "张三", departmentId: "data" };
const pdfFile = { filename: "结果.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-result") };

function memoryStore() {
  const files = new Map();
  return {
    files,
    async put(key, value) {
      files.set(key, Buffer.from(value));
    },
    async read(key) {
      if (!files.has(key)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return Buffer.from(files.get(key));
    },
    async remove(key) {
      files.delete(key);
    },
  };
}

test("task artifact upload stores metadata on the task and hides storage keys", async () => {
  const state = { tasks: { t1: { id: "t1", departmentId: "data", owner: "张三", artifact: null } } };
  const store = memoryStore();
  const service = createTaskArtifactService({ store, makeKey: () => "new", now: () => 123 });

  const artifact = await service.upload({
    state,
    departmentId: "data",
    taskId: "t1",
    actor,
    file: pdfFile,
    save: async () => {},
  });

  assert.equal(state.tasks.t1.artifact.storageKey, "new.pdf");
  assert.equal(store.files.get("new.pdf").toString(), "%PDF-result");
  assert.equal(artifact.storageKey, undefined);
  assert.equal(artifact.originalName, "结果.pdf");
});

test("task artifact reads are department scoped and deletion rolls back on save failure", async () => {
  const artifact = {
    storageKey: "file.pdf",
    previewStorageKey: "file.pdf",
    originalName: "结果.pdf",
    mimeType: "application/pdf",
    previewMimeType: "application/pdf",
  };
  const state = { tasks: { t1: { id: "t1", departmentId: "data", artifact } } };
  const store = memoryStore();
  await store.put("file.pdf", Buffer.from("%PDF"));
  const service = createTaskArtifactService({ store });

  await assert.rejects(
    () =>
      service.readOriginal({ state, departmentId: "data", taskId: "t1", actor: { ...actor, departmentId: "other" } }),
    (error) => error.statusCode === 404,
  );
  await assert.rejects(
    () =>
      service.remove({
        state,
        departmentId: "data",
        taskId: "t1",
        actor,
        save: async () => {
          throw new Error("save failed");
        },
      }),
    /删除产物失败/,
  );
  assert.equal(state.tasks.t1.artifact, artifact);
  assert.equal((await store.read("file.pdf")).toString(), "%PDF");
});
