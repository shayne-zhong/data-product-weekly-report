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
- `cloudfunctions/weekly-task-rollover/`：CloudBase Event Function，每周触发一次受保护的任务结转入口。
- `scripts/build.mjs`：校验内联脚本，生成 `build` 目录和构建清单。

常用命令：`npm.cmd start`、`npm.cmd test`、`npm.cmd run build`、`npm.cmd run lint`、`npm.cmd run format:check`。

## 核心目录与职责

- `public/`：浏览器端单页应用和静态资源。
- `api/`：鉴权、任务、目标、周报、设置和 AI 请求编排。
- `lib/`：可独立测试的领域逻辑、安全、持久化和附件能力。
- `test/`：API、领域模块、生产构建和 UI 行为测试。
- `netlify/functions/`：Netlify 运行时适配层。
- `cloudfunctions/`：CloudBase 定时事件函数；函数仅负责任务调度，不直接操作业务状态。
- `scripts/`：构建、静态服务和状态迁移或恢复工具。
- `data/`：本地附件等运行数据；`build/`：生成产物，不作为源代码修改。

## 主要模块映射

- 任务与指标贡献：`lib/task-core.mjs`、`lib/workbench-utils.mjs` 及对应任务测试；指标当前值由已完成待办的 `goalLinks` 贡献数汇总。
- 周任务结转：`lib/weekly-rollover.mjs` 负责北京时间周窗口、按部门持久化防重和任务复制；浏览器加载周数据不触发结转。
- 持久化：`lib/state-store.mjs`、`test/state-store.test.mjs`、`test/persistence-api.test.mjs`。
- 配置：`lib/runtime-config.mjs`、`test/runtime-config.test.mjs`。
- 鉴权安全：`lib/admin-session.mjs`、`lib/login-throttle.mjs`、`lib/password-hash.mjs`、`lib/encrypted-secret.mjs`。
- 待办产物：`lib/task-artifact-service.mjs`、`lib/artifact-core.mjs`、`lib/artifact-store.mjs`、`lib/artifact-preview.mjs`、`lib/multipart-file.mjs`。
- 迁移校验：`lib/legacy-netlify-state.mjs`、`lib/vercel-state-source.mjs`、`lib/state-fingerprint.mjs` 及相关脚本。

## 请求与数据流

1. 浏览器从 `public/index.html` 发起 `/api/*` 请求。
2. Node、Vercel、Netlify 三种入口最终调用 `api/[...path].mjs`。
3. API 完成鉴权和路由，并调用 `lib/` 领域服务。
4. `lib/state-store.mjs` 依次按环境选择 CloudBase、Netlify Blobs、Vercel Blob；非生产环境可使用临时目录 JSON。
5. API 返回 JSON，浏览器更新页面状态和视图。

周任务结转由 CloudBase 定时触发器调用 `cloudfunctions/weekly-task-rollover/`，函数携带共享密钥请求 `/api/internal/weekly-rollover`；API 在持久化状态中以“部门 + 源周 + 目标周”记录执行结果。

顶层路由包括 `auth`、`admin`、`settings`、`weeks`、`week`、`tasks`、`task`、`reports`、`report`、`goals`、`accounts`、`ai`、`internal`；`internal` 仅接受服务端共享密钥。

## 定向读取指南

- 待办任务：任务 UI → `lib/task-core.mjs`、`lib/workbench-utils.mjs` → 任务测试；涉及保存或产物时补读任务 API 与 `lib/task-artifact-service.mjs`。
- 周任务结转：`cloudfunctions/weekly-task-rollover/` → `/api/internal/weekly-rollover` → `lib/weekly-rollover.mjs` → 结转与持久化 API 测试。
- 部门目标：目标 UI → `lib/task-core.mjs` 的贡献汇总 → 目标与任务 API 测试。
- 周报：周报 UI → 报告 API → `test/report-api.test.mjs`。
- 登录管理：鉴权 UI → 鉴权 API → 管理员和安全模块。
- 部署持久化：运行入口和平台适配 → `lib/state-store.mjs` → 生产测试。
- 构建：`scripts/build.mjs` → `package.json` → `test/production-build.test.mjs`。

## 验证策略

优先运行与改动直接对应的测试；跨入口或持久化改动再运行生产构建或相关 API 测试。Windows PowerShell 使用 `npm.cmd`。

## 更新规则

运行入口、目录职责、API 顶层路由、持久化优先级、部署适配或测试映射变化时必须同步更新本文件。局部文案、样式或不改变模块边界的逻辑修改无需更新。
