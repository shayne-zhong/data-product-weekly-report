import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("goal table exposes the artifact column and accessible panel", () => {
  assert.match(html, /<th>产物<\/th>/);
  assert.match(html, /id="goalArtifactModal"/);
  assert.match(html, /aria-label="目标产物"/);
  assert.match(html, /data-goal-artifact=/);
});

test("artifact interactions use authenticated blob requests and revoke object URLs", () => {
  assert.match(html, /async function loadGoalArtifactBlob/);
  assert.match(html, /authedFetch\(`\/api\/goals\/\$\{encodeURIComponent\(goalId\)\}\/artifact\/\$\{action\}`\)/);
  assert.match(html, /URL\.revokeObjectURL/);
  assert.match(html, /setAttribute\("sandbox", "allow-scripts"\)/);
});

test("artifact upload replacement deletion and completion hint are wired", () => {
  assert.match(html, /async function uploadGoalArtifact/);
  assert.match(html, /async function deleteGoalArtifact/);
  assert.match(html, /目标已完成，建议补充产物/);
  assert.match(html, /产物不能超过 20 MB/);
});
