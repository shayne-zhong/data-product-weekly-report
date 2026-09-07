# WorkBuddy 内网生产部署检查清单

## 一、合并与镜像

- [ ] 生产代码包含 PR #6 的合并提交 `97a611e` 或更新版本。
- [ ] 执行 `npm ci`、`npm test`、`npm run build`。
- [ ] 使用仓库 `Dockerfile` 构建镜像；容器内端口默认为 `3000`。
- [ ] 挂载或配置现有持久化服务，确保服务重启后任务、水位、账号映射和 OAuth state 不丢失。

## 二、网站环境变量

- [ ] 保留现有 `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET`，并为 Node 配置 `STATE_PATH` 或为 Vercel 配置 `BLOB_READ_WRITE_TOKEN`。
- [ ] 生成独立随机值 `WORKBUDDY_OPEN_API_TOKEN`。
- [ ] 设置 `WORKBUDDY_DEPARTMENT_ID=data-product`。
- [ ] 设置 WorkBuddy 内网身份解析地址 `WORKBUDDY_OAUTH_RESOLVER_URL`。
- [ ] 生成另一枚独立随机值 `WORKBUDDY_OAUTH_RESOLVER_TOKEN`。
- [ ] 设置企业 ID `WECOM_OAUTH_CORP_ID`。
- [ ] 首次上线设置通讯录 JSON 与唯一批次 ID；以后变更 JSON 时同步更换批次 ID。
- [ ] 不把 Token、企业 ID 或通讯录 JSON提交到 Git。

建议在部署服务器生成两枚不同 Token：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 三、WorkBuddy 配置

- [ ] 网站地址指向生产内网地址，不使用本地联调端口。
- [ ] 任务接口使用 `Authorization: Bearer <WORKBUDDY_OPEN_API_TOKEN>`。
- [ ] 关闭分页，水位按整数处理，并按 `task_id + updated_at` 幂等消费。
- [ ] 409 视为任务已终态，不重试；422 记录业务拒绝，不重试。
- [ ] OAuth 身份解析接口校验 `WORKBUDDY_OAUTH_RESOLVER_TOKEN`，返回 `wecom_userid`、`username`、`corp_id`、`department_id`。
- [ ] 生产使用部门专属机器人，授权成员范围覆盖数据产品部。

## 四、部署后冒烟验证

将 `<BASE_URL>` 和 `<OPEN_TOKEN>` 替换为生产值：

```powershell
Invoke-RestMethod -Uri '<BASE_URL>/healthz'
Invoke-RestMethod -Uri '<BASE_URL>/api/open/tasks?updated_since=0' -Headers @{ Authorization = 'Bearer <OPEN_TOKEN>' }
```

验收：

- [ ] `/healthz` 返回 200。
- [ ] 错误 Token 请求增量接口返回 401。
- [ ] 正确 Token 请求返回 `tasks` 数组，字段符合联调文档。
- [ ] 修改网站任务后，以此前最大 `updated_at` 查询能取得该任务。
- [ ] 完成一个满足指标规则的任务返回 200；重复完成返回 409。
- [ ] 完成一个不满足指标规则的任务返回 422，网站状态不变。

## 五、剩余外部联调门槛

- [ ] 给一名非机器人授权人的数据产品部员工创建真实待办，确认成员范围、提醒和负责人正确。
- [ ] 从企微工作台发起 OAuth，确认 `/wecom/callback` 返回 302 并可免登网站。
- [ ] 重复使用相同 state，确认返回 400。
- [ ] OAuth 解析服务暂停时，确认账号密码登录仍可使用。

上述两项真实企微验证完成后，再将同步服务切换为正式周期运行。
