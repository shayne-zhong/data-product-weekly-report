# 部门工作台项目架构

## 文档用途

本文件是项目架构的公共入口。每个开发任务开始时先阅读本文件，再根据任务定向读取最少的实现文件。产品需求、项目状态和单次交接分别以 `PRD.MD`、`PROJECT_STATUS.md`、`SESSION_HANDOFF.md` 为准。

## 项目概览

部门工作台是面向部门任务、目标、周报和个人工作管理的单页 Web 应用。前端使用原生 HTML、CSS 和 JavaScript，Node.js ESM 提供统一 API 与生产静态服务。

## 运行与构建入口

- `public/index.html`：单页应用入口，包含结构、样式、状态和交互。
- `public/admin-dashboard.html`、`public/admin-dashboard.css`、`public/admin-dashboard.js`：后台默认经营总览内容页，统一使用父页面原有左侧分组导航与页签，子页面不再提供独立侧栏；通过可信同源嵌入页隔离样式，缺数灰显，不含模拟经营数据。
- `public/dashboard-host.js`：后台父页面的授权请求桥，校验消息来源窗口、同源和操作白名单；后台凭证不发送到驾驶舱页。`public/dashboard-import.js`：将 UTF-8 CSV/JSON 转为统一导入对象，空模板位于 `public/dashboard-templates/`。
- `server.mjs`：Node 生产入口，提供 `/healthz`、转发 `/api` 和精确路径 `/wecom/callback`、托管静态资源，并在直接运行时负责两个后台任务的启动补偿与白天小时调度。
- `/healthz` 的 `features.departmentDashboard: 1` 标记当前进程已加载驾驶舱后端，用于区分静态文件更新与后台进程实际发布，不包含凭证或业务数据。
- `api/[...path].mjs`：统一后端 API 处理器；`api/index.js` 为 Vercel 标准 JavaScript 适配入口，直接复用同一处理器。`vercel.json` 将 `/api/:path*` 转为 `/api/index?path=:path*`，避免带方括号的函数匹配与入口识别问题。
- `scripts/build.mjs`：校验内联脚本，生成 `build` 目录和构建清单。

常用命令：`npm.cmd start`、`npm.cmd test`、`npm.cmd run build`、`npm.cmd run lint`、`npm.cmd run format:check`。

## 核心目录与职责

- `public/`：浏览器端单页应用和静态资源。
- `api/`：鉴权、任务、目标、周报、设置和 AI 请求编排。
- `lib/`：可独立测试的领域逻辑、安全、持久化和附件能力。
- `test/`：API、领域模块、生产构建和 UI 行为测试。
- `scripts/`：构建、静态服务和状态迁移或恢复工具。
- `data/`：本地附件等运行数据；`build/`：生成产物，不作为源代码修改。

## 主要模块映射

- 任务与指标贡献：`lib/task-core.mjs`、`lib/workbench-utils.mjs` 及对应任务测试；指标当前值由已完成待办的 `goalLinks` 贡献数汇总。
- WorkBuddy 企微待办：`lib/open-task-sync.mjs` 负责秒级严格递增时间戳、增量投影、负责人解析和映射变化对账；负责人优先按本部门网站账号精确解析，历史任务仅允许按本部门唯一同名账号兜底。`lib/workbuddy-auth.mjs` 负责 Bearer Token、通讯录映射、OAuth state 和身份解析；`lib/workbuddy-config.mjs` 负责环境变量与后台加密配置的优先级、安全投影和校验；`lib/workbuddy-sync-log.mjs` 负责双源日志脱敏、幂等、游标查询及 30 天/5000 条保留；统一 API 负责部门过滤、完成规则复用、会话创建和管理员运维接口。
- 周任务结转：`lib/weekly-rollover.mjs` 负责北京时间周窗口、按部门持久化防重和任务复制；`server.mjs` 是唯一自动调度器，提供启动补偿及北京时间 08:00–20:00 的整点小时检查，浏览器加载周数据不触发结转。
- 持久化：`lib/state-store.mjs`、`test/state-store.test.mjs`、`test/persistence-api.test.mjs`。
- 部门驾驶舱：`lib/department-dashboard.mjs` 负责授权部门、北京时间期间、真实账号/任务/目标贡献聚合、指标观测、时效、来源去重、导入预检和确认；`state.dashboard.departments` 保存部门观测、版本、防重索引与最近50条导入审计，不改原任务/目标。统一 API 提供 `GET /api/admin/dashboard`、`POST /api/admin/dashboard/imports/preview`、`POST /api/admin/dashboard/imports`；导入请求体上限1 MB，服务端再次验证预检哈希和版本。外部自动拉取尚未启用。
- 配置：`lib/runtime-config.mjs`、`test/runtime-config.test.mjs`。
- 鉴权安全：`lib/admin-session.mjs`、`lib/login-throttle.mjs`、`lib/password-hash.mjs`、`lib/encrypted-secret.mjs`。
- 待办产物：`lib/task-artifact-service.mjs`、`lib/artifact-core.mjs`、`lib/artifact-store.mjs`、`lib/artifact-preview.mjs`、`lib/multipart-file.mjs`。
- 部门总结报告：`lib/period-report-context.mjs` 负责月度、季度、半年和年度的分层总结与目标快照；`lib/period-report-skill.mjs` 和 `lib/deepseek-period-report.mjs` 负责网站版 Skill 与 DeepSeek 边界；`lib/period-report-service.mjs` 管理后台任务、Codex HTML 上传、终止、删除、正式版本和访问；`lib/multipart-file.mjs` 解析受限的上传文件与字段；`lib/period-report-engine.mjs` 固定渲染网站生成报告；`public/period-reports.js` 提供后台生成、上传、管理、受限预览和上传报告的新窗口沙盒运行。
- 迁移校验：`lib/vercel-state-source.mjs`、`lib/state-fingerprint.mjs` 及相关脚本。

## 请求与数据流

1. 浏览器从 `public/index.html` 发起 `/api/*` 请求。
2. Node 与 Vercel 两种入口最终调用 `api/[...path].mjs`。
3. API 完成鉴权和路由，并调用 `lib/` 领域服务。
4. `lib/state-store.mjs` 在存在 Blob Token 时使用 Vercel Blob；Node 生产环境可通过显式 `STATE_PATH` 使用本地持久化 JSON，非生产环境默认使用临时目录 JSON。
5. API 返回 JSON，浏览器更新页面状态和视图。

WorkBuddy 仅通过内网 Node 服务访问 `GET /api/open/tasks?updated_since=`、`PUT /api/open/tasks/:task_id/status`、`POST /api/open/sync-events` 和 `/wecom/callback`。三个开放接口使用同一部门级 Bearer Token，OAuth 使用独立解析凭证；普通员工会话不能替代开放接口 Token。增量任务查询复用 `weeklyRolloverWindow` 的北京时间周一至周日窗口，只投影当前周任务；状态回写仍允许处理已有历史企微待办。`POST /api/open/sync-events` 单条接收 WorkBuddy 对企微待办的真实执行结果，只写日志和概览，不修改网站任务；本期不增加 HMAC、不开放 3902 端口或网站出站 webhook。任务的 `openUpdatedAt`、全局 `openTaskClock`、账号 `wecomUserId`、通讯录批次、已消费 OAuth state、加密后台配置和同步日志均随现有 JSON 状态持久化。后台 `/api/admin/workbuddy/*` 只允许全局管理员访问，提供掩码配置、映射、运行概览和日志查询；前端入口位于后台“企微待办”。持久化后台配置优先于环境变量，显式停用优先于两者；网站不控制 WorkBuddy 的 5 分钟轮询或 5/30/120 秒、最多三次的结果回传重试。当前不增加其他部署入口的企微根路径适配。

周任务结转仅由直接运行的 Node 服务调度：服务启动时补偿检查，并在北京时间每日 08:00–20:00 的整点每小时检查。执行结果以“部门 + 源周 + 目标周”持久化防重；Vercel 不运行定时任务，也不暴露外部调度入口。

报告自动归档仅由直接运行的 Node 服务调度：服务启动时补偿检查，并在北京时间每日 08:00–20:00 的整点每小时检查；执行器仍按后台的周/月/季配置判断到期报告并保证幂等。

顶层路由包括 `auth`、`admin`、`settings`、`weeks`、`week`、`tasks`、`task`、`reports`、`report`、`period-reports`、`goals`、`accounts`、`ai`、`open`、`wecom`。`admin/period-reports` 在单实例 Node 服务中创建后台 DeepSeek 生成任务；`period-reports` 按会话部门权限提供已正式发布的 HTML 报告；`open` 仅接受 WorkBuddy Bearer Token，`wecom/callback` 仅处理内网企微 OAuth 回调。

## 定向读取指南

- 待办任务：任务 UI → `lib/task-core.mjs`、`lib/workbench-utils.mjs` → 任务测试；涉及保存或产物时补读任务 API 与 `lib/task-artifact-service.mjs`。
- 周任务结转：`server.mjs` 小时调度 → API 内部执行器 → `lib/weekly-rollover.mjs` → 结转、持久化与生产服务测试。
- 部门目标：目标 UI → `lib/task-core.mjs` 的贡献汇总 → 目标与任务 API 测试。
- 周报：周报 UI → 报告 API → `test/report-api.test.mjs`。
- 经营报告：后台 UI → `admin/period-reports` → 网站后台 DeepSeek 任务 → `period-reports` 受限预览 → `test/period-reports.test.mjs`。
- 登录管理：鉴权 UI → 鉴权 API → 管理员和安全模块。
- 后台首页与外部供数：`public/index.html` 概览挂载 → `public/dashboard-host.js` 同源请求桥 → `admin/dashboard` → `lib/department-dashboard.mjs` → `test/department-dashboard.test.mjs`、`test/department-dashboard-api.test.mjs`、`test/department-dashboard-ui.test.mjs`；供数契约与操作指南见 `docs/department-dashboard-api.md`、`docs/department-dashboard-rollout.md`。
- WorkBuddy 企微集成：`lib/open-task-sync.mjs`、`lib/workbuddy-auth.mjs`、`lib/workbuddy-config.mjs`、`lib/workbuddy-sync-log.mjs` → `api/[...path].mjs` 的 `open`/`wecom`/`admin/workbuddy` 路由 → `public/index.html` 后台运维界面与 `server.mjs` 内网回调转发 → 对应 WorkBuddy 测试。
- 部署持久化：运行入口和平台适配 → `lib/state-store.mjs` → 生产测试。
- 构建：`scripts/build.mjs` → `package.json` → `test/production-build.test.mjs`。

## 验证策略

优先运行与改动直接对应的测试；跨入口或持久化改动再运行生产构建或相关 API 测试。Windows PowerShell 使用 `npm.cmd`。

## 更新规则

运行入口、目录职责、API 顶层路由、持久化优先级、部署适配或测试映射变化时必须同步更新本文件。局部文案、样式或不改变模块边界的逻辑修改无需更新。
