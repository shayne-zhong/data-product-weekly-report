# 当前状态（2026-10-27）

- 完成：经营总览沿用原后台左侧分组导航和页签，已移除其独立侧栏与配置导航；网站账号、任务与目标贡献按授权部门读取，外部缺数灰显；JSON/CSV 经预检、确认后保存。
- 文件入口：`public/admin-dashboard.*`、`public/dashboard-host.js`、`public/dashboard-import.js`、`lib/department-dashboard.mjs`；路由为 `/api/admin/dashboard` 及 `imports/preview`、`imports`。
- 验证：本次导航调整通过93项相关测试、lint、构建；隔离浏览器核验桌面单导航、成员页切换返回、手机原导航抽屉、灰色缺数和导入入口，无控制台错误。此前功能完整342项测试通过；本次未写入生产数据。
- 交付：用户最新要求以推送 GitHub `main` 为终点，停止继续修复或操作 Vercel 发布。功能代码已推送，最近核对本地与远端版本一致；内网最近核验仍为旧版，尚未确认自动更新成功。用户选择稍后自行登录核验真实首页，不手动重启内网服务。
- 后续：将 `docs/department-dashboard-api.md` 交给数据提供方，按 `docs/department-dashboard-rollout.md` 逐来源接入；外部自动拉取尚未启用。仓库原有全量格式及依赖审计问题需另行处理，不在此版本升级依赖。
