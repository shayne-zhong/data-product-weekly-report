# Project Architecture Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立项目统一架构入口，并让 Codex 每个任务开始时先读该文档后定向探索。

**Architecture:** 根目录 `PROJECT_ARCHITECTURE.md` 保存经代码验证的稳定架构信息，`AGENTS.md` 保存任务启动和维护规则。前者回答“项目如何组成”，后者回答“代理如何工作”。

**Tech Stack:** Markdown、Node.js ESM、原生 HTML/CSS/JavaScript、PowerShell、Git

---

## File Structure

- Create: `PROJECT_ARCHITECTURE.md` — 项目入口、模块、数据流、部署、测试和命令的公共架构入口。
- Modify: `AGENTS.md:3-54` — 增加必读规则，允许基于架构文档进行有目的探索。
- Reference: `docs/superpowers/specs/2026-08-03-project-architecture-guide-design.md` — 已批准设计和验收边界。

### Task 1: Create the verified architecture guide

**Files:**
- Create: `PROJECT_ARCHITECTURE.md`
- Reference: `package.json`, `server.mjs`, `public/index.html`, `api/[...path].mjs`
- Reference: `lib/*.mjs`, `netlify/functions/api.mjs`, `scripts/build.mjs`, `test/*.test.mjs`

- [ ] **Step 1: Recheck architecture anchors**

Run:

```powershell
Select-String -LiteralPath 'server.mjs','api/[...path].mjs','netlify/functions/api.mjs','scripts/build.mjs' -Pattern '^import |^export |createProductionServer|routePath|const entries' -Encoding UTF8
rg -n --glob '*.mjs' '^(export|import )' lib
rg --files test | Sort-Object
```

Expected: `server.mjs` serves the SPA and `/api`; deployment adapters reuse `api/[...path].mjs`; shared modules live under `lib`; tests use Node's test runner.

- [ ] **Step 2: Create `PROJECT_ARCHITECTURE.md`**

Create the file with the following complete structure and verified facts:

```markdown
# 部门工作台项目架构

## 文档用途

本文件是项目架构的公共入口。每个开发任务开始时先阅读本文件，再根据任务定向读取最少的实现文件。产品需求、项目状态和单次交接分别以 `PRD.MD`、`PROJECT_STATUS.md`、`SESSION_HANDOFF.md` 为准。

## 项目概览

部门工作台是面向部门任务、目标、周报和个人工作管理的单页 Web 应用。前端使用原生 HTML、CSS 和 JavaScript，Node.js ESM 提供统一 API 与生产静态服务。

## 运行与构建入口

- `public/index.html`：单页应用入口，包含结构、样式、状态和交互。
- `server.mjs`：Node 生产入口，提供 `/healthz`、转发 `/api` 并托管静态资源。
- `api/[...path].mjs`：统一后端 API 处理器及 Vercel Functions 入口。
- `netlify/functions/api.mjs`：Netlify 到统一 API 的运行时适配层。
- `scripts/build.mjs`：校验内联脚本，生成 `build` 目录和构建清单。

常用命令：`npm.cmd start`、`npm.cmd test`、`npm.cmd run build`、`npm.cmd run lint`、`npm.cmd run format:check`。

## 核心目录与职责

- `public/`：浏览器端单页应用和静态资源。
- `api/`：鉴权、任务、目标、周报、设置和 AI 请求编排。
- `lib/`：可独立测试的领域逻辑、安全、持久化和附件能力。
- `test/`：API、领域模块、生产构建和 UI 行为测试。
- `netlify/functions/`：Netlify 运行时适配层。
- `scripts/`：构建、静态服务和状态迁移或恢复工具。
- `data/`：本地附件等运行数据；`build/`：生成产物，不作为源代码修改。

## 主要模块映射

- 任务：`lib/task-core.mjs`、`lib/workbench-utils.mjs` 及对应任务测试。
- 持久化：`lib/state-store.mjs`、`test/state-store.test.mjs`、`test/persistence-api.test.mjs`。
- 配置：`lib/runtime-config.mjs`、`test/runtime-config.test.mjs`。
- 鉴权安全：`lib/admin-session.mjs`、`lib/login-throttle.mjs`、`lib/password-hash.mjs`、`lib/encrypted-secret.mjs`。
- 目标附件：`lib/goal-artifact-core.mjs`、`lib/goal-artifact-service.mjs`、`lib/artifact-store.mjs`、`lib/artifact-preview.mjs`、`lib/multipart-file.mjs`。
- 迁移校验：`lib/legacy-netlify-state.mjs`、`lib/vercel-state-source.mjs`、`lib/state-fingerprint.mjs` 及相关脚本。

## 请求与数据流

1. 浏览器从 `public/index.html` 发起 `/api/*` 请求。
2. Node、Vercel、Netlify 三种入口最终调用 `api/[...path].mjs`。
3. API 完成鉴权和路由，并调用 `lib/` 领域服务。
4. `lib/state-store.mjs` 依次按环境选择 CloudBase、Netlify Blobs、Vercel Blob；非生产环境可使用临时目录 JSON。
5. API 返回 JSON，浏览器更新页面状态和视图。

顶层路由包括 `auth`、`admin`、`settings`、`weeks`、`week`、`tasks`、`task`、`reports`、`report`、`goals`、`accounts`、`ai`。

## 定向读取指南

- 待办任务：任务 UI → `lib/task-core.mjs`、`lib/workbench-utils.mjs` → 任务测试；涉及保存时补读任务 API。
- 部门目标：目标 UI → `lib/goal-artifact-*` 和附件模块 → 对应测试。
- 周报：周报 UI → 报告 API → `test/report-api.test.mjs`。
- 登录管理：鉴权 UI → 鉴权 API → 管理员和安全模块。
- 部署持久化：运行入口和平台适配 → `lib/state-store.mjs` → 生产测试。
- 构建：`scripts/build.mjs` → `package.json` → `test/production-build.test.mjs`。

## 验证策略

优先运行与改动直接对应的测试；跨入口或持久化改动再运行生产构建或相关 API 测试。Windows PowerShell 使用 `npm.cmd`。

## 更新规则

运行入口、目录职责、API 顶层路由、持久化优先级、部署适配或测试映射变化时必须同步更新本文件。局部文案、样式或不改变模块边界的逻辑修改无需更新。
```

- [ ] **Step 3: Validate paths and formatting**

Run:

```powershell
$paths=@('public/index.html','server.mjs','api/[...path].mjs','netlify/functions/api.mjs','scripts/build.mjs','lib/task-core.mjs','lib/workbench-utils.mjs','lib/state-store.mjs','test/task-core.test.mjs','test/production-build.test.mjs')
$missing=$paths | Where-Object { -not (Test-Path -LiteralPath $_) }
if($missing){ $missing; exit 1 }
npx.cmd prettier --check PROJECT_ARCHITECTURE.md
git diff --check -- PROJECT_ARCHITECTURE.md
```

Expected: all paths exist, Prettier passes, and diff check reports no errors.

- [ ] **Step 4: Commit the architecture guide**

```powershell
git add -- PROJECT_ARCHITECTURE.md
git commit -m "docs: add project architecture guide"
```

Expected: only `PROJECT_ARCHITECTURE.md` is included.

### Task 2: Require architecture context at task startup

**Files:**
- Modify: `AGENTS.md:3-54`
- Reference: `PROJECT_ARCHITECTURE.md`

- [ ] **Step 1: Add a context section after `## 核心目标`**

```markdown
## 项目上下文入口

每个新任务开始时，必须先读取根目录 `PROJECT_ARCHITECTURE.md`，再根据任务关键词定向读取最少的实现文件。若架构文档缺失、明显过期或未覆盖当前区域，可以进行受限探索并在架构边界变化时同步更新该文档。
```

- [ ] **Step 2: Replace items 1–4 under `### 阶段一：分析`**

```markdown
1. 先读取 `PROJECT_ARCHITECTURE.md`，不进行无目的的全项目扫描。
2. 用户明确指定文件、代码片段或路径时，以其为当前任务的优先范围。
3. 用户未指定文件时，根据任务关键词和架构文档选择最少的入口、模块或测试进行定向探索，无需先询问入口。
4. 只读取与任务直接相关的目录、配置或相邻文件；不读取依赖、生成物、备份或大型日志。
```

- [ ] **Step 3: Replace items 1–4 under `## 文件读取规则`**

```markdown
1. `PROJECT_ARCHITECTURE.md` 是每个任务的固定必读文件，不计入用户指定的文件白名单。
2. 用户给出明确文件时，优先读取这些文件；确需额外上下文时，只扩大到架构文档指向的直接相关文件。
3. 用户未指定文件时，允许根据架构文档进行有目的的定向探索，不再要求先询问入口。
4. 禁止无目的地读取锁文件、生成物、构建目录、依赖目录、备份和大型日志。
```

- [ ] **Step 4: Verify rule replacement**

Run:

```powershell
$old=Select-String -LiteralPath 'AGENTS.md' -Pattern '用户未指定文件时，不自行探索项目|不主动读取目录、依赖、日志、配置或相邻文件' -Encoding UTF8
if($old){ $old; exit 1 }
$new=Select-String -LiteralPath 'AGENTS.md' -Pattern '每个新任务开始时，必须先读取根目录 `PROJECT_ARCHITECTURE.md`|无需先询问入口' -Encoding UTF8
if($new.Count -lt 2){ $new; exit 1 }
npx.cmd prettier --check AGENTS.md
git diff --check -- AGENTS.md
```

Expected: old restrictions are absent, new rules are found, and formatting passes.

- [ ] **Step 5: Commit the startup rule**

```powershell
git add -- AGENTS.md
git diff --cached --name-only
git commit -m "docs: require architecture context at task start"
```

Expected: staged list contains only `AGENTS.md`; unrelated worktree changes remain unstaged.

### Task 3: Final cross-document verification

**Files:**
- Verify: `PROJECT_ARCHITECTURE.md`, `AGENTS.md`
- Verify: `docs/superpowers/specs/2026-08-03-project-architecture-guide-design.md`

- [ ] **Step 1: Verify design coverage**

```powershell
Select-String -LiteralPath 'PROJECT_ARCHITECTURE.md' -Pattern '^## 项目概览|^## 运行与构建入口|^## 核心目录与职责|^## 请求与数据流|^## 定向读取指南|^## 更新规则' -Encoding UTF8
Select-String -LiteralPath 'AGENTS.md' -Pattern 'PROJECT_ARCHITECTURE.md|定向探索|无需先询问入口' -Encoding UTF8
git status --short
```

Expected: all six architecture sections and all three rule concepts are present; unrelated existing changes remain untouched.

- [ ] **Step 2: Run documentation validation**

```powershell
npx.cmd prettier --check PROJECT_ARCHITECTURE.md AGENTS.md docs/superpowers/specs/2026-08-03-project-architecture-guide-design.md
git diff --check
```

Expected: formatting passes and diff check reports no whitespace errors.
