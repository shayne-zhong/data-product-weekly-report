# WorkBuddy Assignee Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return a human-readable assignee name, website username, and mapped WeCom userid for every incremental task while safely resolving legacy owner-only tasks.

**Architecture:** Centralize exact assignee resolution in `lib/open-task-sync.mjs`. The resolver first uses the saved website username, then falls back to a unique same-department display-name match; the projection emits three flat assignee fields and the fingerprint tracks all externally visible values.

**Tech Stack:** Node.js ESM, native Node test runner, existing JSON state and WorkBuddy API.

---

### Task 1: Record the product contract

**Files:**
- Modify: `PRD.MD`

- [ ] **Step 1: Document the three assignee fields**

Specify `assignee_name`, `assignee_username`, and `assignee_userid`, including nullable behavior and the rule that a website username must never be substituted for a WeCom userid.

- [ ] **Step 2: Commit**

```bash
git add PRD.MD
git commit -m "docs: define WorkBuddy assignee fields"
```

### Task 2: Prove the missing assignee identity

**Files:**
- Modify: `test/open-task-sync.test.mjs`
- Modify: `test/workbuddy-open-api.test.mjs`

- [ ] **Step 1: Add failing domain tests**

Create one mapped task with `ownerUsername`, one legacy task with only a uniquely matching `owner`, and one ambiguous-name task. Assert the first two project all three assignee fields while the ambiguous task exposes only its saved name and keeps both identifiers `null`.

- [ ] **Step 2: Strengthen the API contract test**

Assert the exact task keys include `assignee_name` and `assignee_username`, and verify mapped and unmapped values.

- [ ] **Step 3: Verify red**

Run: `node --test test/open-task-sync.test.mjs test/workbuddy-open-api.test.mjs`
Expected: FAIL because the new fields do not exist and legacy owner-only tasks do not resolve an account.

### Task 3: Implement safe assignee resolution

**Files:**
- Modify: `lib/open-task-sync.mjs`
- Modify: `api/[...path].mjs`
- Test: `test/open-task-sync.test.mjs`
- Test: `test/workbuddy-open-api.test.mjs`

- [ ] **Step 1: Add a pure resolver**

Export `resolveOpenTaskAssignee(task, accounts, departmentId)`. Match `ownerUsername` exactly within the department; otherwise accept `owner` only when exactly one account in that department has the same display name.

- [ ] **Step 2: Extend fingerprint and projection**

Have `projectOpenTask` return the existing fields plus `assignee_name` and `assignee_username`. Include all three assignee values in the visible fingerprint so mapping or identity changes advance `updated_at`.

- [ ] **Step 3: Use the resolver in reconciliation and API projection**

Pass department accounts through the shared resolver. Remove the API-local direct-only lookup so legacy and current tasks follow one rule.

- [ ] **Step 4: Verify green**

Run: `node --test test/open-task-sync.test.mjs test/workbuddy-open-api.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/open-task-sync.mjs "api/[...path].mjs" test/open-task-sync.test.mjs test/workbuddy-open-api.test.mjs
git commit -m "fix: return complete WorkBuddy assignee identity"
```

### Task 4: Update the public contract and verify

**Files:**
- Modify: `docs/workbuddy-integration-api.md`
- Modify: `PROJECT_ARCHITECTURE.md`

- [ ] **Step 1: Document field meanings and compatibility**

Add both new fields to the response example and field table. State that `assignee_userid` remains the only value WorkBuddy may use as a WeCom follower ID.

- [ ] **Step 2: Document the shared resolver boundary**

Update the architecture note to describe exact username resolution and unique same-department legacy-name fallback.

- [ ] **Step 3: Run independent verification**

Run:

```bash
node --test test/open-task-sync.test.mjs test/workbuddy-open-api.test.mjs
npm test
npm run lint
npm run build
git diff --check
```

Expected: targeted and full tests pass, lint and build exit 0, and `git diff --check` has no output.

- [ ] **Step 4: Commit**

```bash
git add docs/workbuddy-integration-api.md PROJECT_ARCHITECTURE.md
git commit -m "docs: publish WorkBuddy assignee contract"
```
