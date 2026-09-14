# 本机报告程序

后台“经营报告”页点击“下载本机连接配置”，将下载的 JSON 保存到本机。首次安装运行：

```powershell
node scripts/install-report-worker.mjs --config "$env:USERPROFILE\Downloads\workbench-report-connection.json"
```

安装程序复制执行文件到 `%LOCALAPPDATA%\DepartmentWorkbench\report-worker`，把连接配置限制为当前设备私有文件，并创建“Department Workbench Report Worker”登录启动任务。安装后立即开始领取排队任务；电脑关机或休眠时，网站保留任务，恢复在线后继续。

需要停用设备时，在后台“经营报告”页点击“停用”。重新下载配置并再次运行安装程序，会覆盖本机配置和登录启动项；旧凭证应先在后台停用。

本机要求：已经登录 Codex CLI、已安装 Playwright 可用浏览器、保留 `C:\Users\apple\.codex\skills\business-period-report`。默认使用 Codex 高推理档位；配置或登录失效时，后台显示失败原因，修复后点击“重试”创建新版本。
