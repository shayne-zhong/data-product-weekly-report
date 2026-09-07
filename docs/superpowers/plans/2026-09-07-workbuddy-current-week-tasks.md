# WorkBuddy Current-Week Task Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the WorkBuddy incremental task endpoint return only Data Product Department tasks assigned to the current Beijing-time Monday-to-Sunday week.

**Architecture:** Reuse `weeklyRolloverWindow(now).targetWeekId` as the single week-boundary source. Add the week ID to the existing department and `openUpdatedAt` filter without changing authentication, projections, ordering, or status writeback.

**Tech Stack:** Node.js ESM, native Node test runner, existing JSON state and API handler.

---

### Task 1: Record the product contract

**Files:**
- Modify: `PRD.MD`

- [ ] **Step 1: Update the incremental query requirement**

Change the requirement to state that “current tasks” means tasks whose `weekId` equals the current Beijing-time Monday-to-Sunday week ID. Record that all statuses remain eligible and that historical status writeback remains unchanged.

- [ ] **Step 2: Check the product diff**

Run: `git diff --check -- PRD.MD`
Expected: no output and exit code 0.

- [ ] **Step 3: Commit**

```bash
git add PRD.MD
git commit -m "docs: define current-week WorkBuddy task scope"
```

### Task 2: Prove the missing week filter

**Files:**
- Modify: `test/workbuddy-open-api.test.mjs`

- [ ] **Step 1: Use a deterministic current week in test setup**

Define a fixed Beijing-week timestamp and derive the current, previous, and next week IDs with `weeklyRolloverWindow`. Create Data Product Department tasks in all three weeks, while retaining the existing other-department fixture.

- [ ] **Step 2: Add the failing behavior assertion**

Assert that `GET /api/open/tasks?updated_since=0` contains the two current-week task IDs and excludes both previous- and next-week task IDs. Keep the exact response-field and ascending-watermark assertions.

- [ ] **Step 3: Run the targeted test to verify failure**

Run: `node --test test/workbuddy-open-api.test.mjs`
Expected: FAIL because the endpoint currently returns tasks from all weeks in the configured department.

### Task 3: Add the current-week filter

**Files:**
- Modify: `api/[...path].mjs`
- Test: `test/workbuddy-open-api.test.mjs`

- [ ] **Step 1: Import the existing week-window helper**

```js
import { applyWeeklyRollover, weeklyRolloverWindow } from "../lib/weekly-rollover.mjs";
```

- [ ] **Step 2: Filter the incremental query**

Inside the GET branch, derive `const currentWeekId = weeklyRolloverWindow(now).targetWeekId` and require:

```js
task.departmentId === departmentId &&
task.weekId === currentWeekId &&
Number(task.openUpdatedAt) > updatedSince
```

Do not change projection, sorting, authentication, or the PUT status route.

- [ ] **Step 3: Run targeted tests**

Run: `node --test test/workbuddy-open-api.test.mjs`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add -- "api/[...path].mjs" test/workbuddy-open-api.test.mjs
git commit -m "feat: limit WorkBuddy query to current week"
```

### Task 4: Publish and verify the contract

**Files:**
- Modify: `docs/workbuddy-integration-api.md`
- Modify: `PROJECT_ARCHITECTURE.md`

- [ ] **Step 1: Update integration documentation**

State that the endpoint uses the current Beijing-time Monday-to-Sunday `weekId`, returns all statuses, and excludes other weeks. Note that old-week WeCom todo cleanup remains WorkBuddy-owned.

- [ ] **Step 2: Update the architecture data-flow note**

Document that open-task projection reuses the weekly rollover window helper.

- [ ] **Step 3: Run independent verification**

Run:

```bash
node --test test/workbuddy-open-api.test.mjs
npm test
npm run lint
npm run build
git diff --check
```

Expected: targeted and full tests pass, lint and build exit 0, and `git diff --check` has no output.

- [ ] **Step 4: Commit**

```bash
git add docs/workbuddy-integration-api.md PROJECT_ARCHITECTURE.md
git commit -m "docs: document current-week WorkBuddy queries"
```
