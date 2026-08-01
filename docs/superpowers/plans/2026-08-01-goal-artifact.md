# Department Goal Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one replaceable, authenticated, previewable artifact to each department goal, with local file storage and LibreOffice-based Office previews.

**Architecture:** Keep file bytes outside the existing JSON state. Add focused modules for goal metadata and authorization, local storage, multipart parsing, Office preview conversion, and transactional artifact operations; the existing API route composes those modules, while the existing goal table adds a compact artifact column and authenticated preview panel.

**Tech Stack:** Node.js ESM, `node:test`, Busboy multipart parsing, local filesystem storage, LibreOffice headless conversion, existing HTML/CSS/JavaScript frontend.

---

## File structure

**Create**

- `lib/goal-artifact-core.mjs` — stable goal IDs, server-owned metadata merge, public metadata, file validation, and Owner/department-leader authorization.
- `lib/artifact-store.mjs` — path-safe atomic local file storage.
- `lib/multipart-file.mjs` — one-file multipart parser with a 20 MB hard limit.
- `lib/artifact-preview.mjs` — LibreOffice process execution and PDF preview creation.
- `lib/goal-artifact-service.mjs` — upload, replacement, download, preview, deletion, cleanup, and rollback orchestration.
- `test/goal-artifact-core.test.mjs` — goal metadata, validation, migration, and authorization tests.
- `test/artifact-store.test.mjs` — local storage boundary and lifecycle tests.
- `test/multipart-file.test.mjs` — multipart parsing and upload-limit tests.
- `test/artifact-preview.test.mjs` — preview conversion command, output, timeout, and cleanup tests.
- `test/goal-artifact-service.test.mjs` — transactional service tests with injected fakes.
- `test/goal-artifact-ui.test.mjs` — static UI contract checks for the existing monolithic page.
- `data/artifacts/README.md` — explains the runtime-only storage directory.

**Modify**

- `package.json` and `package-lock.json` — add `busboy`.
- `api/[...path].mjs` — preserve artifact metadata on goal edits and expose artifact endpoints.
- `public/index.html` — artifact column, modal, authenticated blob loading, upload/replace/delete, preview, and completion hint.
- `.gitignore` — ignore runtime artifact bytes while retaining `data/artifacts/README.md`.
- `PRD.MD` — retain the already approved “部门目标产物” section; do not stage unrelated pre-existing PRD changes.
- `docs/superpowers/specs/2026-08-01-goal-artifact-design.md` — clarify that “管理员” in the goal workspace means the configured current-department leader.

## Task 1: Goal identity, metadata ownership, validation, and authorization

**Files:**

- Create: `lib/goal-artifact-core.mjs`
- Create: `test/goal-artifact-core.test.mjs`
- Modify: `api/[...path].mjs:278-305,703-714`

- [ ] **Step 1: Write failing core tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureGoalIds,
  mergeGoalRows,
  publicGoalRows,
  validateArtifactFile,
  canManageGoalArtifact,
} from "../lib/goal-artifact-core.mjs";

test("adds stable ids and preserves server-owned artifact metadata", () => {
  const existing = [{ id: "goal-1", name: "收入", artifact: { storageKey: "private.pdf", originalName: "结果.pdf" } }];
  const incoming = [{ id: "goal-1", name: "年度收入", artifact: null }, { name: "客户数" }];
  const merged = mergeGoalRows(existing, incoming, () => "goal-2");
  assert.equal(merged[0].artifact.storageKey, "private.pdf");
  assert.equal(merged[1].id, "goal-2");
  assert.equal(ensureGoalIds(merged, () => "unused").changed, false);
});

test("public rows hide storage keys", () => {
  const [row] = publicGoalRows([{ id: "goal-1", artifact: { storageKey: "private.pdf", previewStorageKey: "preview.pdf", originalName: "结果.pdf", size: 8 } }]);
  assert.deepEqual(row.artifact, { originalName: "结果.pdf", mimeType: "", size: 8, previewMimeType: "", updatedAt: 0, updatedBy: null });
});

test("allows the Owner and current department leader to manage artifacts", () => {
  const settings = { departments: [{ id: "data", leaderUsername: "leader" }] };
  assert.equal(canManageGoalArtifact({ actor: { username: "alice", displayName: "张三", departmentId: "data" }, departmentId: "data", goal: { owner: "张三" }, settings }), true);
  assert.equal(canManageGoalArtifact({ actor: { username: "leader", displayName: "负责人", departmentId: "data" }, departmentId: "data", goal: { owner: "别人" }, settings }), true);
  assert.equal(canManageGoalArtifact({ actor: { username: "bob", displayName: "李四", departmentId: "data" }, departmentId: "data", goal: { owner: "张三" }, settings }), false);
});

test("validates extension, MIME, signature, and 20 MB limit", () => {
  assert.doesNotThrow(() => validateArtifactFile({ filename: "结果.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") }));
  assert.throws(() => validateArtifactFile({ filename: "恶意.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }), /不支持/);
  assert.throws(() => validateArtifactFile({ filename: "伪造.pdf", mimeType: "application/pdf", buffer: Buffer.from("not pdf") }), /内容/);
  assert.throws(() => validateArtifactFile({ filename: "过大.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) }), /20 MB/);
});
```

- [ ] **Step 2: Run the core test and verify the missing-module failure**

Run: `npm.cmd test -- test/goal-artifact-core.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/goal-artifact-core.mjs`.

- [ ] **Step 3: Implement the core contract**

```js
import { randomUUID } from "node:crypto";
import path from "node:path";

export const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
export const OFFICE_EXTENSIONS = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"]);
export const DIRECT_PREVIEW_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".html", ".htm"]);

export function ensureGoalIds(rows = [], makeId = () => `goal-${randomUUID()}`) {
  let changed = false;
  const next = rows.map((row) => {
    if (row.id) return row;
    changed = true;
    return { ...row, id: makeId() };
  });
  return { rows: next, changed };
}

export function mergeGoalRows(existingRows = [], incomingRows = [], makeId) {
  const existingById = new Map(existingRows.filter((row) => row.id).map((row) => [row.id, row]));
  return ensureGoalIds(incomingRows, makeId).rows.map((row) => {
    const { artifact: ignoredArtifact, canManageArtifact: ignoredPermission, ...editableGoal } = row;
    return { ...editableGoal, artifact: existingById.get(row.id)?.artifact || null };
  });
}

export function publicGoalRows(rows = []) {
  return rows.map((row) => ({ ...row, artifact: row.artifact ? {
    originalName: row.artifact.originalName || "",
    mimeType: row.artifact.mimeType || "",
    size: Number(row.artifact.size || 0),
    previewMimeType: row.artifact.previewMimeType || "",
    updatedAt: Number(row.artifact.updatedAt || 0),
    updatedBy: row.artifact.updatedBy || null,
  } : null }));
}

export function canManageGoalArtifact({ actor, departmentId, goal, settings }) {
  if (!actor || actor.departmentId !== departmentId) return false;
  const owner = String(goal.owner || "").trim().toLowerCase();
  const aliases = [actor.username, actor.displayName].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  const department = settings.departments.find((item) => item.id === actor.departmentId);
  return aliases.includes(owner) || department?.leaderUsername === actor.username;
}
```

Implement `validateArtifactFile` with the following explicit decision table and signature predicates. Return `{ extension, previewKind }`; throw errors with `statusCode` 400 or 413.

```js
const TYPE_RULES = new Map([
  [".pdf", { mimes: ["application/pdf"], signature: (b) => b.subarray(0, 4).toString() === "%PDF", previewKind: "direct" }],
  [".docx", { mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], signature: isZip, previewKind: "office" }],
  [".xlsx", { mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], signature: isZip, previewKind: "office" }],
  [".pptx", { mimes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], signature: isZip, previewKind: "office" }],
  [".doc", { mimes: ["application/msword"], signature: isOle, previewKind: "office" }],
  [".xls", { mimes: ["application/vnd.ms-excel"], signature: isOle, previewKind: "office" }],
  [".ppt", { mimes: ["application/vnd.ms-powerpoint"], signature: isOle, previewKind: "office" }],
  [".png", { mimes: ["image/png"], signature: isPng, previewKind: "direct" }],
  [".jpg", { mimes: ["image/jpeg"], signature: isJpeg, previewKind: "direct" }],
  [".jpeg", { mimes: ["image/jpeg"], signature: isJpeg, previewKind: "direct" }],
  [".webp", { mimes: ["image/webp"], signature: isWebp, previewKind: "direct" }],
  [".gif", { mimes: ["image/gif"], signature: isGif, previewKind: "direct" }],
  [".html", { mimes: ["text/html"], signature: isHtml, previewKind: "html" }],
  [".htm", { mimes: ["text/html"], signature: isHtml, previewKind: "html" }],
]);
const isZip = (b) => b[0] === 0x50 && b[1] === 0x4b;
const isOle = (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
```

Add the equally explicit PNG, JPEG, GIF, WebP, and trimmed `<!doctype html`/`<html` predicates next to these two predicates, then apply the matching rule in one validation function.

- [ ] **Step 4: Preserve internal metadata in `/api/goals`**

Import the core helpers. On GET, call `ensureGoalIds`; persist once if IDs were added; return `publicGoalRows`. On POST, call `mergeGoalRows` so client JSON cannot clear or replace internal artifact keys, and reject IDs that belong to another department record.

```js
const current = state.goalsByDepartment[departmentId] || { departmentId, year: "2026", rows: [] };
const { rows, changed } = ensureGoalIds(current.rows, () => randomId("goal"));
if (changed) {
  current.rows = rows;
  state.goalsByDepartment[departmentId] = current;
  await saveState(state);
}
if (req.method === "GET") return json(res, { ...current, rows: publicGoalRows(current.rows) });
```

- [ ] **Step 5: Run the focused and existing tests**

Run: `npm.cmd test -- test/goal-artifact-core.test.mjs test/migration-tools.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the core change**

```powershell
git add -- lib/goal-artifact-core.mjs test/goal-artifact-core.test.mjs 'api/[...path].mjs'
git commit -m "feat: secure goal artifact metadata"
```

## Task 2: Multipart parsing and local artifact storage

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/multipart-file.mjs`
- Create: `lib/artifact-store.mjs`
- Create: `test/multipart-file.test.mjs`
- Create: `test/artifact-store.test.mjs`
- Modify: `.gitignore`
- Create: `data/artifacts/README.md`

- [ ] **Step 1: Add the multipart dependency**

Run: `npm.cmd install busboy@1.6.0`

Expected: `package.json` and `package-lock.json` contain Busboy 1.6.0; no other dependency upgrades occur.

- [ ] **Step 2: Write failing multipart and storage tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { parseSingleFile } from "../lib/multipart-file.mjs";

test("parses exactly one multipart file", async () => {
  const boundary = "artifact-boundary";
  const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="结果.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7\r\n--${boundary}--\r\n`);
  const req = Readable.from(body);
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  const file = await parseSingleFile(req);
  assert.equal(file.filename, "结果.pdf");
  assert.equal(file.mimeType, "application/pdf");
  assert.match(file.buffer.toString(), /^%PDF/);
});
```

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArtifactStore } from "../lib/artifact-store.mjs";

test("writes atomically and rejects keys outside its root", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createArtifactStore({ rootDir: root });
  await store.put("abc.pdf", Buffer.from("value"));
  assert.equal((await store.read("abc.pdf")).toString(), "value");
  await assert.rejects(() => store.put("../escape.pdf", Buffer.from("bad")), /存储键/);
  await store.remove("abc.pdf");
  assert.equal(await store.exists("abc.pdf"), false);
});
```

- [ ] **Step 3: Run both tests and verify missing-module failures**

Run: `npm.cmd test -- test/multipart-file.test.mjs test/artifact-store.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the two new modules.

- [ ] **Step 4: Implement `parseSingleFile` with Busboy**

Use Busboy limits `{ files: 1, fields: 0, fileSize: MAX_ARTIFACT_BYTES }`, collect only the `file` part, reject missing/multiple/truncated files, and attach status 400 or 413 to returned errors.

```js
export async function parseSingleFile(req) {
  return new Promise((resolve, reject) => {
    const parser = busboy({ headers: req.headers, defParamCharset: "utf8", limits: { files: 1, fields: 0, fileSize: MAX_ARTIFACT_BYTES } });
    let result;
    let limited = false;
    parser.on("file", (name, stream, info) => {
      if (name !== "file" || result) return stream.resume();
      const chunks = [];
      stream.on("limit", () => { limited = true; });
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => { result = { filename: info.filename, mimeType: info.mimeType, buffer: Buffer.concat(chunks) }; });
    });
    parser.on("finish", () => limited ? reject(httpError(413, "产物不能超过 20 MB")) : result ? resolve(result) : reject(httpError(400, "请选择产物文件")));
    parser.on("error", reject);
    req.pipe(parser);
  });
}
```

- [ ] **Step 5: Implement atomic path-safe local storage**

Resolve the default root from `ARTIFACT_STORAGE_DIR` or `data/artifacts`, accept only keys matching `/^[a-zA-Z0-9._-]+$/`, write to a random temporary sibling, and rename to the final path. Expose `put`, `read`, `remove`, and `exists`.

- [ ] **Step 6: Ignore runtime bytes**

Add exactly these rules while preserving existing `.gitignore` content:

```gitignore
data/artifacts/*
!data/artifacts/README.md
```

Document that files are runtime data, are not backed up by Git, and can be redirected with `ARTIFACT_STORAGE_DIR`.

- [ ] **Step 7: Run tests and commit**

Run: `npm.cmd test -- test/multipart-file.test.mjs test/artifact-store.test.mjs`

Expected: PASS.

```powershell
git add -- package.json package-lock.json lib/multipart-file.mjs lib/artifact-store.mjs test/multipart-file.test.mjs test/artifact-store.test.mjs .gitignore data/artifacts/README.md
git commit -m "feat: add local artifact storage"
```

## Task 3: LibreOffice preview conversion

**Files:**

- Create: `lib/artifact-preview.mjs`
- Create: `test/artifact-preview.test.mjs`

- [ ] **Step 1: Write failing preview tests**

Inject a process runner so tests do not require LibreOffice. Verify the command arguments, PDF bytes, cleanup, nonzero exit, missing executable, and 30-second timeout mapping.

```js
test("converts an Office buffer to PDF with LibreOffice", async () => {
  const calls = [];
  const run = async (bin, args) => {
    calls.push({ bin, args });
    const outDir = args[args.indexOf("--outdir") + 1];
    await writeFile(path.join(outDir, "source.pdf"), Buffer.from("%PDF-preview"));
  };
  const pdf = await convertOfficeToPdf({ buffer: Buffer.from("office"), extension: ".pptx", executable: "soffice-test", run });
  assert.match(pdf.toString(), /^%PDF/);
  assert.equal(calls[0].bin, "soffice-test");
  assert.deepEqual(calls[0].args.slice(0, 3), ["--headless", "--convert-to", "pdf"]);
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npm.cmd test -- test/artifact-preview.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement conversion and cleanup**

Create a unique temporary directory, write `source<extension>`, run:

```text
soffice --headless --convert-to pdf --outdir <temp-dir> <source-file>
```

Use `LIBREOFFICE_BIN` when set, otherwise `soffice.exe` on Windows and `soffice` elsewhere. Enforce a 30-second timeout, require a nonempty `%PDF` output, map `ENOENT` to `未找到 LibreOffice，请安装后重试`, and remove the exact temporary directory in `finally`.

- [ ] **Step 4: Run the preview test and commit**

Run: `npm.cmd test -- test/artifact-preview.test.mjs`

Expected: PASS.

```powershell
git add -- lib/artifact-preview.mjs test/artifact-preview.test.mjs
git commit -m "feat: generate Office artifact previews"
```

## Task 4: Transactional goal artifact service

**Files:**

- Create: `lib/goal-artifact-service.mjs`
- Create: `test/goal-artifact-service.test.mjs`

- [ ] **Step 1: Write failing service tests**

Build an in-memory fake store and cover first upload, direct preview, Office conversion, successful replacement cleanup, conversion failure preserving the old artifact, save failure cleanup, read authorization, delete failure restoration, and cleanup when a permitted user deletes a goal that owns an artifact.

```js
test("does not replace the old artifact when conversion fails", async () => {
  const oldArtifact = { storageKey: "old.docx", previewStorageKey: "old.pdf", originalName: "旧版.docx" };
  const state = fixtureState(oldArtifact);
  const service = createGoalArtifactService({
    store: memoryStore({ "old.docx": Buffer.from("old"), "old.pdf": Buffer.from("%PDF-old") }),
    convertOffice: async () => { throw new Error("转换失败"); },
    makeKey: () => "new-key",
    now: () => 123,
  });
  await assert.rejects(() => service.upload({ state, departmentId: "data", goalId: "goal-1", actor: owner, settings, file: officeFile, save: async () => {} }), /转换失败/);
  assert.equal(state.goalsByDepartment.data.rows[0].artifact, oldArtifact);
});
```

- [ ] **Step 2: Run the service test and verify the missing-module failure**

Run: `npm.cmd test -- test/goal-artifact-service.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the service**

Expose `upload`, `readOriginal`, `readPreview`, and `remove`. Each method resolves the goal inside `state.goalsByDepartment[departmentId]`, returns 404 for missing/cross-department goals, and calls `canManageGoalArtifact({ actor, departmentId, goal, settings })` for mutations.

Upload order must be:

1. Validate the file.
2. Generate any Office PDF before changing storage or state.
3. Save original and distinct preview with random keys.
4. Set new metadata and await the injected `save()` callback.
5. On save failure, restore the old metadata and remove the new keys.
6. After save success, best-effort delete old keys and log cleanup failures.

Deletion must read backups, remove both files, clear metadata, and await `save()`. If deletion or save fails, restore bytes under the same keys and restore old metadata before rethrowing.

- [ ] **Step 4: Run the service tests and commit**

Run: `npm.cmd test -- test/goal-artifact-service.test.mjs`

Expected: PASS.

```powershell
git add -- lib/goal-artifact-service.mjs test/goal-artifact-service.test.mjs
git commit -m "feat: manage goal artifact lifecycle"
```

## Task 5: Authenticated artifact API endpoints

**Files:**

- Modify: `api/[...path].mjs:1-9,703-714,1091-1113`
- Modify: `test/goal-artifact-service.test.mjs`

- [ ] **Step 1: Add API-facing failure cases to the service test**

Assert errors retain `statusCode` values for 400, 403, 404, and 413 so the API can map them without matching localized strings.

- [ ] **Step 2: Instantiate the dependencies once**

```js
const artifactStore = createArtifactStore();
const goalArtifactService = createGoalArtifactService({
  store: artifactStore,
  convertOffice: convertOfficeToPdf,
});
```

- [ ] **Step 3: Route goal artifact actions**

Change `handleGoals` to accept `parts`. Preserve existing collection GET/POST when `parts.length === 1`; for `parts[2] === "artifact"` support:

```js
if (req.method === "POST" && !action) {
  const file = await parseSingleFile(req);
  const artifact = await goalArtifactService.upload({ state, departmentId, goalId, actor, settings: getSettings(state), file, save: () => saveState(state) });
  return json(res, { artifact }, 201);
}
if (req.method === "GET" && action === "download") return sendArtifact(res, await goalArtifactService.readOriginal({ state, departmentId, goalId, actor }));
if (req.method === "GET" && action === "preview") return sendArtifact(res, await goalArtifactService.readPreview({ state, departmentId, goalId, actor }), { inline: true });
if (req.method === "DELETE" && !action) {
  await goalArtifactService.remove({ state, departmentId, goalId, actor, settings: getSettings(state), save: () => saveState(state) });
  return json(res, { ok: true });
}
```

When collection POST removes a goal that has an artifact, first require `canManageGoalArtifact` for every removed artifact-owning goal. Save the new goal rows, then best-effort remove those now-unreferenced files through the service. A non-Owner/non-leader attempt to delete such a goal returns 403 and preserves both the goal and artifact.

`sendArtifact` must set a validated `Content-Type`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and UTF-8 `Content-Disposition`. HTML preview responses additionally receive `Content-Security-Policy: sandbox allow-scripts`.

- [ ] **Step 4: Map typed errors once**

In the outer catch, if `Number.isInteger(error.statusCode)`, return `{ error: error.message }` with that status before the existing business-error mapping. Do not expose file paths or process stderr to the browser.

- [ ] **Step 5: Run focused API-adjacent tests and commit**

Run: `npm.cmd test -- test/goal-artifact-core.test.mjs test/multipart-file.test.mjs test/artifact-preview.test.mjs test/goal-artifact-service.test.mjs`

Expected: PASS.

```powershell
git add -- 'api/[...path].mjs' test/goal-artifact-service.test.mjs
git commit -m "feat: expose goal artifact endpoints"
```

## Task 6: Goal table and preview panel

**Files:**

- Modify: `public/index.html:32-46,224-244,684-700,1359-1370,1582-1637,1811-1829,3500-3600`
- Create: `test/goal-artifact-ui.test.mjs`

- [ ] **Step 1: Write the failing UI contract test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("goal table exposes artifact actions and panel", () => {
  assert.match(html, /<th>产物<\/th>/);
  assert.match(html, /id="goalArtifactModal"/);
  assert.match(html, /data-goal-artifact=/);
  assert.match(html, /async function uploadGoalArtifact/);
  assert.match(html, /async function loadGoalArtifactBlob/);
  assert.match(html, /目标已完成，建议补充产物/);
});
```

- [ ] **Step 2: Run the UI test and verify failure**

Run: `npm.cmd test -- test/goal-artifact-ui.test.mjs`

Expected: FAIL because the artifact markup and functions do not exist.

- [ ] **Step 3: Add the artifact column and panel**

Insert “产物” between “状态” and “操作”, update empty-row `colspan`, and render either “上传产物” or an icon, escaped file name, and formatted update time. Add a side panel with preview container, metadata, file input, download, replace, delete, close, busy, and error states.

The server returns `canManageArtifact` per row by mapping `publicGoalRows(current.rows)` and calling `canManageGoalArtifact({ actor, departmentId, goal, settings: getSettings(state) })`; do not duplicate Owner permission logic in the browser.

- [ ] **Step 4: Add authenticated blob helpers**

```js
async function loadGoalArtifactBlob(goalId, action) {
  const response = await authedFetch(`/api/goals/${encodeURIComponent(goalId)}/artifact/${action}`);
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return response.blob();
}

function replaceArtifactObjectUrl(nextUrl = "") {
  if (goalArtifactObjectUrl) URL.revokeObjectURL(goalArtifactObjectUrl);
  goalArtifactObjectUrl = nextUrl;
}
```

Fetch preview/download bytes through `authedFetch` because direct iframe and anchor URLs cannot attach the existing `x-user-token`. Preview images, PDFs, Office-generated PDFs, and HTML through a temporary object URL. Use `<iframe sandbox="allow-scripts">` for HTML and no `allow-same-origin`.

- [ ] **Step 5: Add upload, replacement, deletion, and completion hint**

Send `FormData` through `authedFetch` without manually setting `Content-Type`. On success, assign returned public metadata to the matching `goalsRows` item and rerender. Confirm deletion, clear metadata only after success, close/reload the panel predictably, and revoke every replaced/closed object URL.

When a goal status changes to `已完成` and `row.artifact` is absent, show `目标已完成，建议补充产物` through the existing sync/status area, then continue `scheduleGoalsSave()` without blocking.

- [ ] **Step 6: Run UI and core tests**

Run: `npm.cmd test -- test/goal-artifact-ui.test.mjs test/goal-artifact-core.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit the frontend**

```powershell
git add -- public/index.html test/goal-artifact-ui.test.mjs
git commit -m "feat: attach artifacts to department goals"
```

## Task 7: Product baseline, documentation, and complete verification

**Files:**

- Modify: `PRD.MD`
- Modify: `docs/superpowers/specs/2026-08-01-goal-artifact-design.md`

- [ ] **Step 1: Clarify the administrator term in the spec**

Replace generic “管理员” in the goal workspace permission statements with “当前部门负责人（后台配置的 `leaderUsername`）”. The global backend administrator remains outside the regular goal page and is not granted an implicit department context.

- [ ] **Step 2: Verify the approved PRD section without absorbing unrelated changes**

Run: `git diff -- PRD.MD`

Expected: the approved “部门目标产物” section is present. Preserve every pre-existing user hunk. Stage only this feature section with interactive staging or an index-only patch; verify with `git diff --cached -- PRD.MD` before committing.

- [ ] **Step 3: Run the complete independent verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run lint
git diff --check
git status --short
```

Expected: all tests pass; build and lint exit 0; no whitespace errors in feature files; no file under `data/artifacts/` except `README.md` is tracked.

- [ ] **Step 4: Perform LibreOffice smoke verification**

Run:

```powershell
$artifactLibreOffice = if ($env:LIBREOFFICE_BIN) { $env:LIBREOFFICE_BIN } else { "soffice.exe" }
& $artifactLibreOffice --version
```

Expected: LibreOffice version text. Then start the app with `npm.cmd start`, upload one `.pptx`, verify PDF preview and original download, replace it with an invalid file, and confirm the old artifact remains available. Stop the local process after the check.

- [ ] **Step 5: Commit documentation and the isolated PRD hunk**

```powershell
git add -- docs/superpowers/specs/2026-08-01-goal-artifact-design.md
git commit -m "docs: finalize goal artifact requirements"
```

Include the staged PRD feature hunk in this commit only after `git diff --cached -- PRD.MD` proves no unrelated PRD content is staged.

## Task 8: Push and merge the GitHub delivery

**Files:** none

- [ ] **Step 1: Verify branch and remote state**

Run:

```powershell
git status --short
git branch --show-current
git remote -v
gh auth status
```

Expected: feature code and planned docs are committed; only the user’s pre-existing unrelated files remain untracked or modified; current branch is `codex/department-workbench`; GitHub CLI authentication succeeds.

- [ ] **Step 2: Push the feature branch**

Run: `git push -u origin codex/department-workbench`

Expected: push succeeds and the remote tracking branch is configured.

- [ ] **Step 3: Create or refresh the pull request**

Run `gh pr view --json url,state` first. If no open pull request exists, run:

```powershell
gh pr create --fill --title "feat: attach artifacts to department goals" --body "Adds one replaceable goal artifact, authenticated previews and downloads, LibreOffice Office previews, local storage isolation, permission checks, and rollback coverage."
```

Expected: an open pull request URL.

- [ ] **Step 4: Merge after checking the PR**

Run:

```powershell
gh pr checks
gh pr merge --merge --delete-branch
```

Expected: required checks pass and GitHub reports the pull request merged. Do not deploy.
