# 任务可选择未贡献年度指标

**Goal:** 默认关联年度指标，显式选择未贡献时允许完成且统计为零，保存后正确回显。

**Architecture:** 使用任务布尔字段 `contributesToAnnualGoal`，仅严格等于 false 时免除贡献要求。缺省为 true；沿用现有任务保存 API、权限和自动保存。保留此前录入的关联草稿，选择未贡献期间不展示、不统计。

**Tech Stack:** 原生 HTML/JavaScript、Node.js ESM、node:test。

- [x] 更新 PRD，明确默认、免填、保存、统计和历史兼容要求。
- [x] 在 task-core、workbench-ui、task-permissions-api 现有测试中补充默认拒绝无指标完成、显式免贡献完成、遗留关联不计数、界面回显以及 API 保存/重读的场景，先运行确认预期失败。
- [x] lib/task-core.mjs：新建任务保存布尔选择，completedGoalContributionById 跳过显式 false 的任务，applyTaskStatus 仅对默认关联模式要求有效贡献。
- [x] public/index.html：任务详情指标区提供“关联年度指标 / 未贡献年度指标”选择；关闭贡献时隐藏指标输入并排除统计，完成规则保持一致，沿用自动保存和错误提示。
- [x] api/[...path].mjs：已完成任务切回关联模式时复用完成校验，不能无有效贡献进入关联模式。
- [x] 运行上述三组测试及生产构建；检查实际 diff，只保留本功能改动。

验证：三组针对性测试 101 项通过；生产构建成功；git diff --check 通过。未部署。
