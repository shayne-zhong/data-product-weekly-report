import test from "node:test";
import assert from "node:assert/strict";

import { ensureGoalIds, mergeGoalRows, publicArtifact, validateArtifactFile } from "../lib/artifact-core.mjs";

test("adds stable goal ids and reports whether migration changed rows", () => {
  const first = ensureGoalIds([{ name: "收入" }], () => "goal-1");
  assert.equal(first.changed, true);
  assert.equal(first.rows[0].id, "goal-1");

  const second = ensureGoalIds(first.rows, () => "goal-2");
  assert.equal(second.changed, false);
  assert.equal(second.rows[0].id, "goal-1");
});

test("goal edits discard obsolete artifact metadata and client permissions", () => {
  const artifact = { storageKey: "private.pdf", previewStorageKey: "preview.pdf", originalName: "结果.pdf" };
  const incoming = [{ id: "goal-1", name: "年度收入", artifact: null, canManageArtifact: true }, { name: "客户数" }];
  const merged = mergeGoalRows([{ id: "goal-1", name: "收入", artifact }], incoming, () => "goal-2");
  assert.equal(merged[0].artifact, undefined);
  assert.equal(merged[0].canManageArtifact, undefined);
  assert.equal(merged[1].id, "goal-2");
});

test("public artifact metadata hides storage keys", () => {
  const artifact = publicArtifact({
    storageKey: "private.pdf",
    previewStorageKey: "preview.pdf",
    originalName: "结果.pdf",
    size: 8,
  });
  assert.deepEqual(artifact, {
    originalName: "结果.pdf",
    mimeType: "",
    size: 8,
    previewMimeType: "",
    updatedAt: 0,
    updatedBy: null,
  });
});

test("validates file extension MIME signature and size", () => {
  assert.deepEqual(
    validateArtifactFile({ filename: "结果.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") }),
    { extension: ".pdf", previewKind: "direct" },
  );
  assert.deepEqual(
    validateArtifactFile({
      filename: "汇报.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: Buffer.from("PK\u0003\u0004"),
    }),
    { extension: ".pptx", previewKind: "office" },
  );
  assert.throws(
    () =>
      validateArtifactFile({ filename: "恶意.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }),
    /不支持/,
  );
  assert.throws(
    () => validateArtifactFile({ filename: "伪造.pdf", mimeType: "application/pdf", buffer: Buffer.from("not pdf") }),
    /内容/,
  );
  assert.throws(
    () => validateArtifactFile({ filename: "类型.pdf", mimeType: "text/plain", buffer: Buffer.from("%PDF") }),
    /类型/,
  );
  assert.throws(
    () =>
      validateArtifactFile({
        filename: "过大.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
      }),
    /20 MB/,
  );
});

test("accepts supported image HTML and legacy Office signatures", () => {
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.equal(
    validateArtifactFile({ filename: "表格.xls", mimeType: "application/vnd.ms-excel", buffer: ole }).previewKind,
    "office",
  );
  assert.equal(
    validateArtifactFile({
      filename: "页面.html",
      mimeType: "text/html",
      buffer: Buffer.from("<!doctype html><html></html>"),
    }).previewKind,
    "html",
  );
  assert.equal(
    validateArtifactFile({
      filename: "图片.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    }).previewKind,
    "direct",
  );
});
