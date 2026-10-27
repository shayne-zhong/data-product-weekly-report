# 部门后台首页与供数通道实施计划

> **For agentic workers:** Use subagent-driven-development for the bounded core/data-contract tasks, with parent integration and independent validation. Steps use checkbox (`- [x]`) syntax.

**Goal:** 使用用户选定的驾驶舱样式替换后台首页，直接读取网站真实数据，外部缺数灰显；提供共用契约的 JSON/CSV 导入与明确接口文档。

**Architecture:** 既有后台壳仅在首页展示独立的可信驾驶舱页面，认证凭证留在父页面，通过严格同源且校验窗口的消息桥请求 API。新增 `/api/admin/dashboard` 服务端按授权部门聚合，导入经过预检、用户确认、服务端重新校验及持久化；所有来源共用 v1 记录模型。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node ESM、现有 JSON 状态持久化、node:test，无新增依赖。

### 1. 数据核心与回归测试

- [x] 创建 `lib/department-dashboard.mjs` 和 `test/department-dashboard.test.mjs`；先测缺数灰显、部门隔离、期间、比例分母、真实零值、过期、批次幂等与并发版本冲突。
- [x] 统一导入结构：`schemaVersion, batchId, departmentId, sourceId, sourceName, asOf, records`；记录含 `metric, periodStart, periodEnd, value, unit, dimensionType, dimension, coverage`，可附 `numerator, denominator, annualTarget, validForHours`。
- [x] 导入按来源/指标/期间/维度覆盖自身键；跨来源不相加，展示最新结果并保留来源。上限每批500条/1MB、部门5000条观测、最近50条批次审计。
- [x] 使用 `node --test test/department-dashboard.test.mjs` 观察缺少功能的失败，再实现并通过。

### 2. 后台路由与持久化

- [x] 在 `api/[...path].mjs` 接入 GET首页数据、POST预检和POST确认导入；校验后台身份与负责人所属部门，拒绝跨部门；既有 overview 契约保留。
- [x] `test/department-dashboard-api.test.mjs` 覆盖未登录、负责人跨部门、全局选择部门、预检不写、提交后读取、重复批次、错误数据及版本冲突不写。
- [x] 持久化在既有 state 的 `dashboard` 命名空间；不迁移或改写既有业务。

### 3. 用户选定首页与导入交互

- [x] 新增 `public/admin-dashboard.html / .css / .js`，以附件视觉为样式依据；所有动态数据来自父页面授权读请求，不保留示例数组。
- [x] 修改 `public/index.html` 概览挂载与桥接；首页使用驾驶舱导航，其他后台页签继续使用原有后台壳；凭证不传入嵌入页。
- [x] 实现部门/年份/期间筛选、指标详情、来源状态、真实任务记录及人员明细、导入预检/确认/模板入口。读取失败保留旧结果并灰显。
- [x] 不将模拟集团人才、模拟团队、AI风险结论写成真实结果；风险只来自实际阻塞/逾期记录。

### 4. 供数文档与指导

- [x] 创建 `docs/department-dashboard-api.md`、`docs/department-dashboard-rollout.md` 与 `public/dashboard-templates/` 空模板；具体字段、单位、期间、比例、错误码、幂等、覆盖、鉴权边界均可直接交接。
- [x] 明确已实现网站接口与需要外部方实现的查询协议；当前不启用后台自动拉取，不索取/共享管理员令牌给外部系统。
- [x] 更新 `PROJECT_ARCHITECTURE.md`、`PRD.MD` 和 `SESSION_HANDOFF.md`，保留已有 PRD/原型修改。

### 5. 独立验证与交付

- [x] 运行新增核心/API测试、相关后台角色回归、生产构建及修改范围 lint；检查实际 Diff。
- [x] 使用隔离本地状态启动网站，浏览器验证登录后的首页、灰色缺数、真实聚合、导入预检与持久化、来源说明及切回既有后台功能。
- [x] 清除预览中的验证样本。用户后续已明确授权上线：提交并推送 GitHub main，等待内网自动部署，核验健康标记及资源；用户选择稍后自行登录，不扩展外部自动同步。
