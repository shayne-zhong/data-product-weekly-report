import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("goal table removes goal artifacts and exposes linked todos", () => {
  assert.doesNotMatch(html, /\{ key: "artifact", label: "产物"/);
  assert.doesNotMatch(html, /id="goalArtifactModal"/);
  assert.match(html, /关联待办/);
  assert.match(html, /data-open-linked-task=/);
});

test("artifact interactions use authenticated blob requests and revoke object URLs", () => {
  assert.match(html, /async function loadTaskArtifactBlob/);
  assert.match(html, /authedFetch\(`\/api\/task\/\$\{encodeURIComponent\(taskId\)\}\/artifact\/\$\{action\}`\)/);
  assert.match(html, /URL\.revokeObjectURL/);
  assert.match(html, /setAttribute\("sandbox", "allow-scripts"\)/);
});

test("artifact upload replacement and deletion are wired in task detail", () => {
  assert.match(html, /async function uploadTaskArtifact/);
  assert.match(html, /async function deleteTaskArtifact/);
  assert.match(html, /id="taskArtifactFile"/);
  assert.match(html, /产物不能超过 20 MB/);
});
