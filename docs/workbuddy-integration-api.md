# WorkBuddy 联调接口说明

## 1. 联调范围

本期仅开放数据产品部以下能力：

1. 增量查询网站任务；
2. 将企微待办“完成”状态回写网站；
3. 初始化网站账号与企微 `userid` 映射；
4. 通过企微 OAuth 回调建立网站登录会话；
5. 回传 WorkBuddy 创建或更新企微待办的真实执行结果。

当前服务部署在内网。以下地址中的 `<WORKBENCH_BASE_URL>` 替换为部门工作台内网地址，地址末尾不要带 `/`。

## 2. 统一鉴权

三个开放接口使用同一个部门级 Bearer Token：

```http
Authorization: Bearer <WORKBUDDY_OPEN_API_TOKEN>
```

Token 通过安全渠道线下交换，不得放入 URL、浏览器代码或日志。OAuth 身份解析使用另一枚独立 Token，不能与任务接口 Token 共用。

## 3. 增量任务查询

### 请求

```http
GET <WORKBENCH_BASE_URL>/api/open/tasks?updated_since=<unix-seconds>
Authorization: Bearer <WORKBUDDY_OPEN_API_TOKEN>
```

- `updated_since` 必填，首次同步传 `0`。
- 参数和返回值均为非负 Unix 秒整数。
- 仅返回 `updated_at > updated_since` 的数据产品部当前任务。
- 返回结果按 `updated_at` 升序排列，且 `updated_at` 严格递增。
- 本期无分页、游标和删除记录。

### 200 响应

```json
{
  "tasks": [
    {
      "task_id": "task_123",
      "title": "准备月度经营分析",
      "description": "补齐指标口径说明",
      "assignee_userid": "zhangsan",
      "status": "进行中",
      "due_date": "2026-09-01",
      "updated_at": 1787968800
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `task_id` | string | 网站任务稳定 ID |
| `title` | string | 标题 |
| `description` | string | 描述，无内容时为空字符串 |
| `assignee_userid` | string/null | 负责人企微 `userid`，未映射时为 `null` |
| `status` | string | `待开始`、`进行中`、`阻塞`、`已完成` |
| `due_date` | string/null | `YYYY-MM-DD`，无截止日期时为 `null` |
| `updated_at` | integer | 严格递增的 Unix 秒 |

### WorkBuddy 消费规则

1. 成功处理整批任务后，保存本批最大 `updated_at`。
2. 下一次请求把该最大值原样作为 `updated_since`。
3. `assignee_userid` 为 `null` 时暂不创建或转交企微待办，映射补齐后该任务会以新的 `updated_at` 再次返回。
4. WorkBuddy 按 `task_id` 幂等创建或更新企微待办。

### 错误码

| HTTP | 场景 |
| --- | --- |
| 400 | `updated_since` 缺失、为负数、小数或超出安全整数范围 |
| 401 | Bearer Token 缺失或错误 |
| 503 | 网站未配置开放接口 Token 或部门 ID |

## 4. 完成状态回写

### 请求

```http
PUT <WORKBENCH_BASE_URL>/api/open/tasks/<task_id>/status
Authorization: Bearer <WORKBUDDY_OPEN_API_TOKEN>
Content-Type: application/json

{"status":"completed"}
```

规范请求值为 `completed`。接口同时兼容 `已完成`，但 WorkBuddy 应固定发送 `completed`。

### 首次成功：200

```json
{
  "task_id": "task_123",
  "status": "已完成",
  "updated_at": 1787968801
}
```

成功后网站任务进度为 100，并继续执行网站现有的完成规则。

### 错误码

| HTTP | `code` | 场景 |
| --- | --- | --- |
| 400 | 无 | 请求的状态不是 `completed` 或 `已完成` |
| 401 | 无 | Bearer Token 缺失或错误 |
| 404 | 无 | 任务不存在、已删除或不属于数据产品部 |
| 409 | `TASK_ALREADY_TERMINAL` | 任务已经完成；不会再次修改任务、贡献数或时间戳 |
| 422 | `TASK_COMPLETION_REQUIREMENTS_NOT_MET` | 任务未关联年度指标或未填写有效贡献数 |
| 503 | 无 | 网站未配置开放接口 Token 或部门 ID |

WorkBuddy 收到 409 时应把企微待办视为已经完成，不再重试；收到 422 时应提示负责人先到网站补齐年度指标及贡献数。

## 5. WorkBuddy 执行结果回传

该接口用于把 WorkBuddy 对企微原生待办的真实创建、更新、重建、跳过或失败结果写入网站同步日志。它不会创建、修改或完成网站任务。

### 请求

```http
POST <WORKBENCH_BASE_URL>/api/open/sync-events
Authorization: Bearer <WORKBUDDY_OPEN_API_TOKEN>
Content-Type: application/json

{
  "event_id": "wb-task_123-created-1",
  "task_id": "task_123",
  "action": "created",
  "result": "success",
  "wecom_todo_id": "wecom_todo_456",
  "attempt": 1,
  "message": "created",
  "occurred_at": 1787968800123
}
```

字段规则：

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `event_id` | 是 | WorkBuddy 生成的全局唯一幂等键，建议由任务 ID、动作和本次执行序号组成 |
| `task_id` | 是 | 网站任务 ID |
| `action` | 是 | `created`、`updated`、`recreated`、`skipped`、`failed`、`retry_scheduled` |
| `result` | 是 | `success`、`failed`、`skipped`、`retrying` |
| `wecom_todo_id` | 否 | 企微原生待办 ID；创建成功后建议传入 |
| `attempt` | 否 | 当前尝试次数，网站限制为 0–100 |
| `message` | 否 | 简短、安全的结果说明；不得包含 Token、授权 code、请求头或堆栈 |
| `occurred_at` | 是 | Unix 毫秒整数，必须在网站当前时间前后 24 小时内 |

### 200 响应与幂等

首次写入：

```json
{"log_id":"sync_123","duplicate":false}
```

同一个 `event_id` 重复提交时仍返回 200，并返回第一次写入的同一个 `log_id`：

```json
{"log_id":"sync_123","duplicate":true}
```

WorkBuddy 只有在 5xx 或网络失败时重试；400 表示字段或时间不合法，401 表示 Token 错误，503 表示网站集成已停用或开放接口配置不完整。

## 6. 账号与企微 userid 初始化

全局管理员可在网站后台“企微任务同步”中查看、绑定、替换或清除数据产品部的企微 `userid`。映射修改后，相关负责人任务会以新的 `updated_at` 再次进入增量结果。

首次部署仍可把 WorkBuddy 导出的映射批次写入网站服务端环境变量：

```text
WORKBUDDY_DIRECTORY_MAPPINGS_JSON=[{"username":"zhongnanhai","wecom_userid":"zhongnanhai"}]
WORKBUDDY_DIRECTORY_BATCH_ID=data-product-20260829-v1
```

规则：

- `username` 必须是网站账号，不是员工显示姓名。
- 只做标准化后的精确匹配，不做姓名或拼音猜测。
- 网站账号与企微 `userid` 一对一；冲突记录会跳过，不会覆盖旧映射。
- 同一批次 ID 只执行一次；更新映射内容时必须使用新的批次 ID。
- WorkBuddy 第一次调用增量查询时触发批次初始化，映射成功的负责人任务会重新进入增量结果。

## 7. OAuth 免登回调

### 企微应用回调地址

```text
<WORKBENCH_BASE_URL>/wecom/callback
```

WorkBuddy 发起企微 OAuth 时，把该地址配置为回调地址。企微回调请求格式：

```http
GET <WORKBENCH_BASE_URL>/wecom/callback?code=<authorization-code>&state=<signed-state>
```

### state 生成规则

WorkBuddy 使用 `WORKBUDDY_OAUTH_RESOLVER_TOKEN` 对 state 做 HMAC-SHA256 签名：

1. 生成 JSON：

```json
{
  "nonce": "<UUID>",
  "returnTo": "/",
  "expiresAt": 1787969100000
}
```

2. `payload = base64url(UTF8(JSON))`。
3. `signature = base64url(HMAC-SHA256(WORKBUDDY_OAUTH_RESOLVER_TOKEN, payload))`。
4. `state = payload + "." + signature`。

`expiresAt` 使用 Unix 毫秒，最长有效期五分钟；`returnTo` 只能是本站以单个 `/` 开头的相对路径。网站会拒绝过期、篡改或重复使用的 state。

### 网站调用 WorkBuddy 身份解析接口

网站收到回调后，服务端请求：

```http
POST <WORKBUDDY_OAUTH_RESOLVER_URL>
Authorization: Bearer <WORKBUDDY_OAUTH_RESOLVER_TOKEN>
Content-Type: application/json

{"code":"<authorization-code>"}
```

WorkBuddy 应返回：

```json
{
  "wecom_userid": "zhongnanhai",
  "username": "zhongnanhai",
  "corp_id": "<WECOM_OAUTH_CORP_ID>",
  "department_id": "data-product"
}
```

- `username` 必须是可与网站账号精确匹配的企业账号标识。
- `department_id` 必须与网站的 `WORKBUDDY_DEPARTMENT_ID` 一致。
- 网站仅允许有效、已注册、属于数据产品部的账号登录。
- 未绑定账号在唯一精确匹配时自动回填；账号或 `userid` 已绑定其他对象时返回冲突。
- 成功后网站返回 302，并通过 HttpOnly Cookie 建立现有网站会话。

### 回调错误

| HTTP | 场景 |
| --- | --- |
| 400 | `code`/`state` 缺失，state 无效、过期或重复使用 |
| 403 | 企业、部门或网站账号不符合要求 |
| 409 | `WECOM_MAPPING_CONFLICT`，网站账号或企微 `userid` 映射冲突 |
| 502 | WorkBuddy 身份解析接口不可用或返回无效数据 |
| 503 | 网站 OAuth 配置不完整 |

## 8. 网站服务端配置清单

```text
WORKBUDDY_OPEN_API_TOKEN=<任务接口 Bearer Token>
WORKBUDDY_DEPARTMENT_ID=data-product
WORKBUDDY_OAUTH_RESOLVER_URL=<WorkBuddy 身份解析接口内网地址>
WORKBUDDY_OAUTH_RESOLVER_TOKEN=<OAuth 身份解析与 state 签名 Token>
WECOM_OAUTH_CORP_ID=<企业微信企业 ID>
WORKBUDDY_DIRECTORY_MAPPINGS_JSON=<可选，首次通讯录映射 JSON>
WORKBUDDY_DIRECTORY_BATCH_ID=<可选，通讯录批次 ID>
```

环境变量是初始值和故障回退。全局管理员在网站后台保存的生产配置会加密持久化并优先生效；Token 只显示掩码，不能回显明文。后台显式停用同步时，即使环境变量仍存在，开放接口也返回 503。后台不提供 WorkBuddy 轮询间隔或重试次数配置，这两项继续由 WorkBuddy 管理。

## 9. 最小联调顺序

1. 网站与 WorkBuddy 分别配置两枚 Token、部门 ID、企业 ID 和身份解析地址。
2. WorkBuddy 准备通讯录映射 JSON，网站设置新的批次 ID。
3. 调用 `GET /api/open/tasks?updated_since=0`，确认字段和 `assignee_userid`。
4. 修改一个网站任务，再用上批最大 `updated_at` 查询，确认只返回增量。
5. 对有关联指标和有效贡献数的任务调用完成回写，确认 200；立即重复调用，确认 409。
6. 对无有效指标贡献的任务回写完成，确认 422。
7. WorkBuddy 创建企微待办后调用 `POST /api/open/sync-events`，确认首次返回 `duplicate:false`；原样重放后确认 `duplicate:true` 且 `log_id` 不变。
8. 从企微应用发起 OAuth，确认 `/wecom/callback` 建立会话；重复使用同一 state，确认 400。
9. 全局管理员在后台“企微任务同步”查看运行概览、映射和双源日志，确认失败信息不含 Token、授权 code、请求头或堆栈。
