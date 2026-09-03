# Admin Hover Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the admin primary navigation into the global top bar and expose each group's secondary pages through an accessible hover/focus dropdown.

**Architecture:** Keep the existing admin group/section state and permission filtering. Move only the navigation markup and presentation: each top-level button owns a dropdown of its existing secondary buttons, while the admin content becomes a single full-width editor. Desktop uses hover/focus; touch uses click; selection and server-side authorization remain unchanged.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in test runner

---

### Task 1: Record the approved product behavior

**Files:**
- Modify: `PRD.MD:123-132`

- [x] **Step 1:** Replace the left-sidebar requirement with top-bar dropdown behavior, including hover/focus, touch click, close behavior, active state, and unchanged role visibility.

### Task 2: Add a failing navigation regression test

**Files:**
- Modify: `test/workbench-ui.test.mjs:782-868`

- [x] **Step 1:** Assert the admin navigation is inside the global top bar, each group contains its secondary menu, the content has no left navigation column, and hover/focus/touch accessibility hooks exist.
- [x] **Step 2:** Run `node --test test/workbench-ui.test.mjs` and confirm failure because the navigation still lives in the admin content with a sticky left sidebar.

### Task 3: Implement the top-bar dropdown navigation

**Files:**
- Modify: `public/index.html:19-54, 175-195, 371-407, 3951-3978, 5186-5214`

- [x] **Step 1:** Move the three primary groups and six secondary buttons into the top bar, nesting each secondary menu beneath its group button.
- [x] **Step 2:** Replace the sidebar grid CSS with a full-width editor and compact dropdown styles supporting `:hover`, `:focus-within`, active state, and narrow/touch layouts.
- [x] **Step 3:** Preserve role filtering, remembered sections, dirty markers, scheduled-task loading, and current-page state while adding expanded-state semantics and outside/Escape closing.
- [x] **Step 4:** Run `node --test test/workbench-ui.test.mjs` and expect all tests to pass.
- [x] **Step 5:** Run the project's production build command and confirm it succeeds.

### Self-review

- [x] Every approved desktop, keyboard, and touch interaction is covered.
- [x] Department-leader visibility and backend permission behavior are unchanged.
- [x] No placeholder text or unrelated refactor is included.
