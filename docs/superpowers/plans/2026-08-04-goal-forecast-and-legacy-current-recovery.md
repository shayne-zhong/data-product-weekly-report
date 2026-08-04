# Goal Forecast and Legacy Current Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable forecast achievement to goals, keep actual achievement task-derived, calculate completion from forecasts, narrow the linked-todo column, and safely recover trustworthy legacy manual values.

**Architecture:** Persist `expectedCurrent` on goal rows while continuing to derive response-only `current` from completed task contributions. Put recovery classification in a pure module, and expose a project-local migration script that always snapshots and previews before an explicit `--apply`. Use commit `6966e7ac1b182fac851ffc3186cd21a7962328b4` at `2026-08-04T16:05:28+08:00` as the conservative code-version cutoff; the live deployment record must confirm that boundary before applying.

**Tech Stack:** Node.js ESM, native browser HTML/CSS/JavaScript, existing state store, Node test runner, PowerShell.

---

## File map

- Modify `PRD.MD`: confirmed field, completion, width, and recovery rules.
- Modify `api/[...path].mjs`: preserve `expectedCurrent`, keep `current` derived.
- Modify `public/index.html`: new forecast column, actual label, forecast-based completion, linked-todo width/alignment.
- Create `lib/goal-current-recovery.mjs`: pure recovery classification and migration preview.
- Create `scripts/migrate-goal-expected-current.mjs`: snapshot, report, explicit apply, and read-back verification.
- Create `test/goal-current-recovery.test.mjs`; modify API and UI contract tests.

### Task 1: Synchronize the confirmed PRD

**Files:**
- Modify: `PRD.MD`

- [ ] **Step 1: Update the target-field rules before code**

Add these exact requirements:

```markdown
- “预计达成”由用户手工填写并持久化；新目标默认为空。
- “实际达成”由已完成关联待办贡献数汇总，目标页只读。
- 完成度与平均完成度按“预计达成 ÷ 目标值”计算；预计值为空或无效时为 0%。
- 可确认未被新版本覆盖的旧 `current` 迁入 `expectedCurrent`；无法确认时留空。
- “关联待办”默认宽度 120，允许 100 至 180，表头和内容左对齐。
```

- [ ] **Step 2: Validate and commit**

Run: `git diff --check -- PRD.MD`

Expected: no output. Re-read the changed section with UTF-8 encoding.

```powershell
git add -- PRD.MD
git commit -m "docs: define forecast goal achievement"
```

### Task 2: Preserve forecast values through the goals API

**Files:**
- Modify: `api/[...path].mjs`
- Modify: `test/persistence-api.test.mjs`

- [ ] **Step 1: Write a failing persistence test**

```js
test("goals persist forecast values while actual values remain task derived", async () => {
  const saved = await api("/goals", {
    method: "POST",
    body: { year: "2026", rows: [{ name: "交付数", target: "10项", expectedCurrent: "8项", current: 999 }] },
  });
  const goalId = saved.body.rows[0].id;
  assert.equal(saved.body.rows[0].expectedCurrent, "8项");
  assert.equal(saved.body.rows[0].current, 0);

  const reloaded = await api("/goals");
  assert.equal(reloaded.body.rows.find((row) => row.id === goalId).expectedCurrent, "8项");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- --test-name-pattern="persist forecast values" test/persistence-api.test.mjs`

Expected: FAIL because the forecast contract is not yet protected by a regression test.

- [ ] **Step 3: Make forecast preservation explicit**

Normalize incoming goal rows without accepting client `current` as authoritative:

```js
const rows = mergeGoalRows(current.rows, body.rows, () => randomId("goal"))
  .map((row) => ({
    ...row,
    expectedCurrent: String(row.expectedCurrent || ""),
    current: totals[row.id] || 0,
  }));
```

GET continues to overwrite only response `current`; it must not change stored `expectedCurrent`.

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- test/persistence-api.test.mjs`

Expected: PASS.

```powershell
git add -- api/[...path].mjs test/persistence-api.test.mjs
git commit -m "feat: persist goal forecast achievement"
```

### Task 3: Forecast UI and compact linked-todo column

**Files:**
- Modify: `public/index.html`
- Modify: `test/workbench-ui.test.mjs`

- [ ] **Step 1: Write failing UI contracts**

Update the expected stable columns and add semantic assertions:

```js
assert.deepEqual(runtime.goalTableColumns.map(({ key }) => key), [
  "seq", "name", "definition", "owner", "lastYearActual", "target",
  "expectedCurrent", "current", "progress", "status", "actions",
]);
assert.equal(runtime.goalTableColumns.find(({ key }) => key === "expectedCurrent").label, "预计达成");
assert.equal(runtime.goalTableColumns.find(({ key }) => key === "current").label, "实际达成");
assert.deepEqual(
  (({ defaultWidth, minWidth, maxWidth }) => [defaultWidth, minWidth, maxWidth])(runtime.goalTableColumns.find(({ key }) => key === "actions")),
  [120, 100, 180],
);
assert.match(html, /data-goal-key="expectedCurrent"/);
assert.doesNotMatch(html, /data-goal-key="current"/);
assert.match(html, /firstNumber\(row\.expectedCurrent\)/);
```

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- --test-name-pattern="goal column widths|goal table renders" test/workbench-ui.test.mjs`

Expected: FAIL on the missing forecast column, old label, and old action width.

- [ ] **Step 3: Add forecast column and change labels**

Use these column definitions:

```js
{ key: "expectedCurrent", label: "预计达成", defaultWidth: 140, minWidth: 90, maxWidth: 320 },
{ key: "current", label: "实际达成", defaultWidth: 140, minWidth: 90, maxWidth: 320 },
{ key: "actions", label: "关联待办", defaultWidth: 120, minWidth: 100, maxWidth: 180 },
```

Render forecast as the editable cell:

```html
<td contenteditable="true" data-goal-row="${rowIndex}" data-goal-key="expectedCurrent">${escapeHtml(row.expectedCurrent || "")}</td>
<td>${escapeHtml(String(row.current || 0))}</td>
```

New rows set `expectedCurrent` to an empty string.

- [ ] **Step 4: Calculate completion only from forecast**

Replace the current-value branch in `goalCompletion`:

```js
function goalCompletion(row) {
  const forecast = firstNumber(row.expectedCurrent);
  const target = firstNumber(row.target);
  if (forecast === null || target === null || target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((forecast / target) * 100)));
}
```

The existing stats and fallback status helpers continue calling `goalCompletion`, so they inherit the new source.

- [ ] **Step 5: Keep linked-todo headings and cells left aligned**

Add a semantic class to the action heading/cells and keep explicit left alignment:

```css
.goals-table th[data-goal-column="actions"],.goal-linked-todo-cell{text-align:left}
.goal-linked-todo-cell .row-actions{justify-content:flex-start}
```

- [ ] **Step 6: Verify and commit**

Run: `npm.cmd test -- test/workbench-ui.test.mjs test/task-artifact-ui.test.mjs`

Expected: PASS.

```powershell
git add -- public/index.html test/workbench-ui.test.mjs
git commit -m "feat: add forecast achievement to goals"
```

### Task 4: Pure legacy-value recovery classification

**Files:**
- Create: `lib/goal-current-recovery.mjs`
- Create: `test/goal-current-recovery.test.mjs`

- [ ] **Step 1: Write failing recovery tests**

```js
import { previewGoalCurrentRecovery } from "../lib/goal-current-recovery.mjs";

test("recovers only pre-cutoff legacy current values", () => {
  const preview = previewGoalCurrentRecovery({
    state: { goalsByDepartment: {
      data: { updatedAt: Date.parse("2026-08-04T15:00:00+08:00"), rows: [{ id: "g1", current: "8项" }] },
      finance: { updatedAt: Date.parse("2026-08-04T17:00:00+08:00"), rows: [{ id: "g2", current: "3项" }] },
    } },
    cutoffMs: Date.parse("2026-08-04T16:05:28+08:00"),
  });
  assert.equal(preview.state.goalsByDepartment.data.rows[0].expectedCurrent, "8项");
  assert.equal(preview.state.goalsByDepartment.finance.rows[0].expectedCurrent, "");
  assert.deepEqual(preview.counts, { recovered: 1, blank: 1, preserved: 0 });
});

test("never overwrites an existing forecast", () => {
  const preview = previewGoalCurrentRecovery({
    state: { goalsByDepartment: { data: { updatedAt: 0, rows: [{ id: "g1", current: "8", expectedCurrent: "9" }] } } },
    cutoffMs: 1,
  });
  assert.equal(preview.state.goalsByDepartment.data.rows[0].expectedCurrent, "9");
  assert.equal(preview.counts.preserved, 1);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- test/goal-current-recovery.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement immutable classification**

```js
export function previewGoalCurrentRecovery({ state, cutoffMs }) {
  if (!Number.isFinite(cutoffMs)) throw new Error("A valid recovery cutoff is required");
  const next = structuredClone(state);
  const rows = [];
  const counts = { recovered: 0, blank: 0, preserved: 0 };
  for (const [departmentId, record] of Object.entries(next.goalsByDepartment || {})) {
    for (const goal of record.rows || []) {
      let outcome = "preserved";
      if (!("expectedCurrent" in goal)) {
        const recoverable = Number(record.updatedAt || 0) < cutoffMs;
        goal.expectedCurrent = recoverable ? String(goal.current || "") : "";
        outcome = recoverable ? "recovered" : "blank";
      }
      counts[outcome] += 1;
      rows.push({ departmentId, goalId: goal.id || "", oldCurrent: goal.current ?? "", expectedCurrent: goal.expectedCurrent, outcome });
    }
  }
  return { state: next, rows, counts };
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- test/goal-current-recovery.test.mjs`

Expected: PASS.

```powershell
git add -- lib/goal-current-recovery.mjs test/goal-current-recovery.test.mjs
git commit -m "feat: classify legacy goal current recovery"
```

### Task 5: Snapshot-first migration command

**Files:**
- Create: `scripts/migrate-goal-expected-current.mjs`
- Modify: `package.json`
- Create: `test/goal-current-migration-script.test.mjs`

- [ ] **Step 1: Write failing script-contract tests**

```js
test("migration defaults to preview and requires explicit apply", async () => {
  const source = await readFile(new URL("../scripts/migrate-goal-expected-current.mjs", import.meta.url), "utf8");
  assert.match(source, /process\.argv\.includes\("--apply"\)/);
  assert.match(source, /MIGRATION_BACKUP_DIR/);
  assert.match(source, /stateStore\.load\(\)/);
  assert.match(source, /if \(apply\) await stateStore\.save\(preview\.state\)/);
  assert.match(source, /fingerprintState/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- test/goal-current-migration-script.test.mjs`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement snapshot, preview, apply, and read-back**

The script must:

```js
const apply = process.argv.includes("--apply");
const cutoffText = process.env.LEGACY_CURRENT_CUTOFF;
if (!cutoffText) throw new Error("LEGACY_CURRENT_CUTOFF is required");
const cutoffMs = Date.parse(cutoffText);
if (!Number.isFinite(cutoffMs)) throw new Error("LEGACY_CURRENT_CUTOFF must be an ISO timestamp");
const stateStore = createStateStore();
const original = await stateStore.load();
if (!original) throw new Error("No durable state found; migration stopped");
const preview = previewGoalCurrentRecovery({ state: original, cutoffMs });
// Write original state, fingerprint metadata, and preview report under MIGRATION_BACKUP_DIR.
if (apply) await stateStore.save(preview.state);
// When applied, load again and require fingerprintState(readBack) to equal fingerprintState(preview.state).
```

Write `state-v1.before.json`, `goal-current-recovery-preview.json`, and `metadata.json` into a timestamped directory. Metadata includes cutoff, apply flag, original fingerprint, proposed fingerprint, counts, and execution time.

Add package commands:

```json
"goals:forecast:preview": "node scripts/migrate-goal-expected-current.mjs",
"goals:forecast:apply": "node scripts/migrate-goal-expected-current.mjs --apply"
```

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- test/goal-current-migration-script.test.mjs test/goal-current-recovery.test.mjs`

Expected: PASS.

```powershell
git add -- scripts/migrate-goal-expected-current.mjs package.json test/goal-current-migration-script.test.mjs
git commit -m "feat: add forecast recovery migration command"
```

### Task 6: Integrated verification and recovery checkpoint

**Files:**
- Verify only before any external write.

- [ ] **Step 1: Run full local verification**

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run lint
```

Expected: all tests pass; build and lint exit 0.

- [ ] **Step 2: Confirm deployment boundary from live records**

Verify that `2026-08-04T16:05:28+08:00` is not later than the actual deployment time of commit `6966e7ac1b182fac851ffc3186cd21a7962328b4`. If this cannot be confirmed, do not classify any missing forecast as recoverable; stop and request a human decision.

- [ ] **Step 3: Generate preview only**

Run with the production storage environment loaded:

```powershell
$env:LEGACY_CURRENT_CUTOFF='2026-08-04T16:05:28+08:00'
npm.cmd run goals:forecast:preview
```

Expected: a new timestamped backup directory containing the untouched state snapshot and a report with `recovered`, `blank`, and `preserved` counts. No durable state write occurs.

- [ ] **Step 4: Stop for explicit user approval**

Report the backup path, cutoff evidence, counts, and every proposed recovered value. Do not run the apply command until the user explicitly approves this exact preview.

- [ ] **Step 5: Apply only after approval and verify**

```powershell
$env:LEGACY_CURRENT_CUTOFF='2026-08-04T16:05:28+08:00'
npm.cmd run goals:forecast:apply
```

Expected: script saves once, reloads durable state, verifies fingerprints, and reports the same counts as the approved preview.
