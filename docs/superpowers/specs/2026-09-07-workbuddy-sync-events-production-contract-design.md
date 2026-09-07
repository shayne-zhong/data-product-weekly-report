# WorkBuddy 生产结果回传兼容设计

## 背景

WorkBuddy 与部门工作台已通过增量查询和完成回写完成本地联调。生产阶段确认 `POST /api/open/sync-events` 的方向为 WorkBuddy 向网站回传企微待办执行结果，而不是网站向 WorkBuddy 推送任务变更。本期继续以 5 分钟轮询作为唯一下行通道，不开放 3902 端口，不增加网站出站 webhook。

## 目标

1. 解决 PR #9 与当前主干后台改版的冲突，并保留全局管理员的企微同步管理能力。
2. 给 WorkBuddy 提供稳定、幂等、非阻塞的单条结果回传接口。
3. 兼容双方已经形成的字段和枚举，避免生产联调双方同时返工。
4. 完成生产 Token、部门 ID 配置后的内网冒烟验证。

## 非目标

1. 不实现网站主动推送任务变更。
2. 不接受批量事件数组。
3. 不增加 HMAC 签名；继续使用现有部门级 Bearer Token。
4. 不开放 3902 端口，不改变 5 分钟轮询策略。
5. 不通过结果回传修改任务、映射或配置。

## 接口契约

### 请求

```http
POST /api/open/sync-events
Authorization: Bearer <WORKBUDDY_OPEN_API_TOKEN>
Content-Type: application/json
```

正式请求示例：

```json
{
  "event_id": "8b7fcf95-2fb0-4b36-95ef-48bd0c52ad5a",
  "action": "create",
  "result": "success",
  "task_id": "task_123",
  "todo_id": "wecom_todo_456",
  "occurred_at": 1788768000000,
  "duration_ms": 320,
  "operator_userid": "zhangsan",
  "result_message": "",
  "retry_count": 0
}
```

### 字段

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `event_id` | 是 | 非空稳定字符串，作为幂等键；重试必须复用 |
| `action` | 是 | `create`、`update`、`finish`、`delete`、`writeback` |
| `result` | 是 | `success`、`failure`、`retry`、`skipped`、`conflict`、`rejected` |
| `task_id` | 任务级事件必填 | 网站任务 ID |
| `todo_id` | 否 | 企微待办 ID |
| `occurred_at` | 是 | Unix 毫秒，与服务器时间偏差不超过 24 小时 |
| `duration_ms` | 否 | 非负整数 |
| `operator_userid` | 否 | 上行完成操作者的企微 userid |
| `result_message` | 否 | 脱敏、单行、限长的结果摘要 |
| `retry_count` | 否 | 0 到 100 的整数 |

为兼容 PR #9 已完成实现，接口同时接受：

- `wecom_todo_id` 作为 `todo_id` 的别名；
- `message` 作为 `result_message` 的别名；
- `attempt` 作为 `retry_count` 的别名；
- 动作 `created`、`updated`、`recreated`、`skipped`、`failed`、`retry_scheduled`；
- 结果 `failed`、`retrying`。

兼容值不改变事件业务含义，后台按调用方动作和结果展示，不进行会误导业务语义的强制折叠。

### 响应与重试

首次接收返回：

```json
{"accepted":true,"duplicate":false,"log_id":"sync_xxx"}
```

同一 `event_id` 重发时返回 200、`duplicate: true` 和原 `log_id`。2xx 表示成功；4xx 表示请求或鉴权错误，不自动重试；5xx 可在 5 秒、30 秒、120 秒后最多重试 3 次。回传队列和失败记录由 WorkBuddy 持久化，结果回传失败不得中断增量拉取、企微待办更新或完成回写。

## 安全与数据边界

- 本期仅使用 `WORKBUDDY_OPEN_API_TOKEN` Bearer 鉴权，不增加 HMAC。
- 不回传标题、描述及其他任务敏感正文。
- 网站对消息、账号和 ID 字段执行限长、换行清理和敏感模式脱敏。
- 错误 Token 不写入明细日志，避免攻击者填满持久状态。
- 日志保留 30 天且最多 5000 条，按 `event_id` 防重。

## 后台与数据流

1. WorkBuddy 每 5 分钟发现任务增量并完成企微动作。
2. 每个动作完成后异步发送一条 `sync-events` 事件。
3. 网站验证 Token、字段、时间窗口和幂等键，只写同步日志及概览。
4. 全局管理员在“企微任务同步”查看运行概览、配置、userid 映射和同步日志。
5. 日志写入失败不回滚已经完成的任务接口业务。

## 生产处理顺序

1. 将 PR #9 更新到最新 `main`，解决后台 HTML 与测试冲突。
2. 以测试先行方式扩展兼容字段、枚举、幂等和返回码。
3. 更新接口文档和生产检查清单。
4. 运行目标测试、全量测试、Lint 和生产构建。
5. 合并并部署后，在网站端配置与 WorkBuddy 相同的 Token 和 `data-product` 部门 ID。
6. 重启服务，确认增量接口由 503 变为 200，再由 WorkBuddy 执行 `node src/index.js --once`。

## 验收标准

1. 单条正式事件和兼容字段事件均返回 200 并形成一条脱敏日志。
2. 重复 `event_id` 返回 200 且不新增日志。
3. 数组、非法枚举、越界时间、错误 Token 分别返回 400 或 401。
4. 事件回传不修改任务、映射或配置。
5. 非全局管理员不能访问企微同步后台；Token 明文不出现在响应、DOM、日志或存储明文字段中。
6. 当前后台改版功能不回退，WorkBuddy 与现有权限测试通过。
7. 内网 `GET /api/open/tasks?updated_since=0` 使用生产 Token 返回 200，WorkBuddy 单次同步完成并产生可见结果日志。

## 风险与控制

- **主干冲突**：只在独立工作树处理，逐段保留当前后台布局和 PR #9 业务逻辑。
- **枚举歧义**：接受双方枚举但不错误归并；后续可在有真实日志后收敛。
- **回传拖慢主链路**：由 WorkBuddy 异步处理并限制三次重试。
- **生产密钥泄露**：部署和验证不打印 Token，不写入仓库或普通日志。
