# 经营总览统一导航实施计划

> 用户已确认在本会话完成修改、验证并推送 GitHub。各步骤紧密关联，按顺序执行。

**Goal:** 后台只保留原有左侧导航，经营总览作为固定默认内容页。

**Architecture:** 继续使用现有同源 iframe 和授权请求桥，仅恢复父页面导航及页签，移除子页面独立导航及其专用事件。指标与导入接口不变。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node 内置测试、浏览器交互验证。

- [x] 同步 PRD；修改 `public/index.html`，删除 `dashboard-home` 隐藏导航及页签规则，保留内容区零边距，将 iframe 高度设为 `calc(100vh - 104px)`，为原有 64px 顶栏和 40px 页签留位。
- [x] 修改 `public/admin-dashboard.html`，删除独立 `aside.sidebar`；删除 `public/admin-dashboard.js` 对侧栏状态、配置按钮、导航高亮的专用读写，保留来源页内跳转和全部数据交互。
- [x] 检查总览弹性布局在剩余宽度内可用；按需要最小调整 `public/admin-dashboard.css` 的工具栏换行。
- [x] 同步 `PROJECT_ARCHITECTURE.md` 和 `SESSION_HANDOFF.md`，准确说明原后台应用壳和最新验证结果。
- [x] 运行 `node --test test/department-dashboard-ui.test.mjs test/workbench-ui.test.mjs`、`npm.cmd run lint`、`npm.cmd run build`；检查 `git diff --check`。
- [x] 隔离浏览器核验桌面单侧栏、总览数据渲染、成员页切换返回、手机原导航抽屉和导入预检入口；提交并推送 `main`，核对远端 SHA。
