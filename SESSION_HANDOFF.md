# 当前状态（2026-10-27）

- 完成：后台默认首页采用用户提供的驾驶舱样式；网站账号、任务与目标贡献按授权部门读取，外部缺数灰显；JSON/CSV 经预检、确认后保存，支持来源、期间、时效、防重与版本冲突校验。
- 文件入口：`public/admin-dashboard.*`、`public/dashboard-host.js`、`public/dashboard-import.js`、`lib/department-dashboard.mjs`；路由为 `/api/admin/dashboard` 及 `imports/preview`、`imports`。
- 验证：新增核心/API/CSV/消息桥用例、完整341项测试、lint、构建；隔离浏览器验证导入持久化、期间隔离、返回后台及窄屏。验证样本已从隔离预览恢复，不写入生产。
- 发布：用户明确授权上线，目标为 GitHub `main` 与内网自动部署；通过 `/healthz` 的 `features.departmentDashboard` 和资源哈希核实后端进程及静态文件。用户选择稍后自行登录核验真实首页，不手动重启内网服务。
- 后续：将 `docs/department-dashboard-api.md` 交给数据提供方，按 `docs/department-dashboard-rollout.md` 逐来源接入；外部自动拉取尚未启用。仓库原有全量格式及依赖审计问题需另行处理，不在此版本升级依赖。
