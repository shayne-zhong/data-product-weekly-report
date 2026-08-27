# Task Access Control Implementation Plan

> **For agentic workers:** Execute inline task-by-task with test-first verification.

**Goal:** Enforce three task access scopes and let department management maintain roles and module ownership.

**Architecture:** Account records carry a role and managed-module list; the existing department leader assignment remains the single source for the department-leader role. The API derives an access context on every request and uses one policy helper for all task resources. The browser only renders choices permitted by that context; it is not the security boundary.

**Tech Stack:** Node.js ESM, node:test, vanilla HTML/JavaScript.

---

### Task 1: Document and normalize authorization data

**Files:**
- Modify: `PRD.MD`
- Modify: `api/[...path].mjs`
- Test: `test/task-permissions-api.test.mjs`

- [ ] Add failing settings tests for a module leader with multiple modules and for a single department leader.
- [ ] Normalize `role` to `member` or `module_leader`, normalize `managedModules` against the account department, and derive `department_leader` from `department.leaderUsername`.
- [ ] Return role and managed modules in the authenticated user/settings responses without exposing cross-department configuration.
- [ ] Run `npm.cmd test -- test/task-permissions-api.test.mjs` and confirm green.

### Task 2: Enforce policy on every task route

**Files:**
- Modify: `api/[...path].mjs`
- Modify: `lib/task-core.mjs`
- Test: `test/task-permissions-api.test.mjs`

- [ ] Add failing tests for member filtering, module filtering, department-wide filtering, blocked direct mutation and blocked artifact access.
- [ ] Add `ownerUsername` to new and rolled-over tasks. Resolve legacy owners only when the name has one account match.
- [ ] Add shared policy helpers for read, create and mutation. Apply them to week tasks, period tasks, individual task routes and artifact routes; return 404 for inaccessible tasks.
- [ ] Validate module and assignee on task create/update. Preserve unmatched legacy task data rather than guessing an owner.
- [ ] Run the focused API test and then the existing task artifact and report API tests.

### Task 3: Maintain roles in the management interface

**Files:**
- Modify: `public/index.html`
- Test: `test/workbench-ui.test.mjs`

- [ ] Add failing UI assertions for role selection, module multi-select and scope-aware task choices.
- [ ] Add role and responsible-module controls to global-admin and department-leader account management. Hide department-leader assignment from department leaders.
- [ ] Use the signed-in access context to remove the redundant member filter and restrict task module/assignee options.
- [ ] Run `npm.cmd test -- test/workbench-ui.test.mjs`.

### Task 4: Verify regression boundaries

**Files:**
- Test: `test/task-permissions-api.test.mjs`
- Test: `test/leader-admin.test.mjs`
- Test: `test/task-artifact-api.test.mjs`

- [ ] Verify role changes take effect on the next request and a leader cannot change their own role or department leader assignment.
- [ ] Verify legacy unmatched tasks remain hidden from members and visible only through approved scopes.
- [ ] Run focused tests, `npm.cmd run build`, inspect the final diff, then report remaining migration risk.
