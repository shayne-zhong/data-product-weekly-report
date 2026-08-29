# WorkBuddy 企微原生待办集成设计

## 背景

数据产品部员工继续在部门工作台维护任务，企微原生待办负责向负责人触达和提醒。企微侧由 WorkBuddy 实现，工作台不直接接入企微待办 CLI，而是提供可靠的增量任务数据、身份映射、OAuth 回调和任务变更通知。

当前任务统一经后端 API 创建、修改和删除，任务实体已有稳定的 `id`、`ownerUsername`、`status`、`dueDate` 和 `updatedAt`。现有删除逻辑会物理移除任务，因此必须增加独立的持久化变更日志，才能让 WorkBuddy 感知删除。

## 目标与非目标

### 目标

- 为 WorkBuddy 提供仅限数据产品部的增量任务查询 API。
- 支持首次按 `updated_since` 拉取、游标分页、连续同步和故障恢复。
- 将任务创建、更新、状态变化和删除写入不可变变更日志。
- 维护网站账号与企微 `userid` 的管理员预绑定关系。
- 支持企微 OAuth 回调，并由 WorkBuddy 解析企微员工身份。
- 通过签名 Webhook 提醒 WorkBuddy 及时拉取增量。
- 保证 WorkBuddy、OAuth 或 Webhook 故障不影响工作台任务保存和密码登录。

### 非目标

- 不覆盖数据产品部以外的部门。
- 不把企微待办中的修改或完成状态回写工作台。
- 不在工作台中直接调用或封装企微待办 CLI。
- 不移除现有账号密码登录。
- 不自动按姓名、手机号或邮箱推断账号映射。
- 不在第一阶段实现变更日志压缩、跨部门令牌或通用集成平台。

## 总体架构

数据流如下：

```text
员工更新工作台任务
        ↓
任务状态、变更日志和 Webhook Outbox 同次持久化
        ↓
Webhook 通知 WorkBuddy 有新变化
        ↓
WorkBuddy 使用服务令牌拉取任务增量
        ↓
WorkBuddy 创建、更新、完成或删除企微原生待办
```

登录流如下：

```text
员工从企微进入工作台
        ↓
网站生成一次性 state 并发起企微 OAuth
        ↓
企微回调网站并携带 code 与 state
        ↓
网站校验 state，服务端将 code 交给 WorkBuddy 解析
        ↓
网站按管理员预绑定关系创建现有工作台会话
```

工作台是任务事实源。WorkBuddy 是企微待办适配器和企微身份解析方。二者通过明确的服务端契约通信，任一外部调用失败都不能改变已经成功保存的工作台任务。

## 数据模型

### 员工映射

在现有账号设置中增加服务端字段：

```text
wecomUserId       企微员工稳定标识，可为空
wecomDisplayName  最近一次确认的企微显示名称，可为空
wecomBoundAt      最近绑定时间
wecomBoundBy      执行绑定的管理员账号
```

一个企微员工标识只能绑定一个网站账号；一个网站账号最多绑定一个企微员工标识。后台普通列表仅展示“已绑定/未绑定”和企微员工显示名称，原始标识只在管理员编辑和 WorkBuddy 增量响应中使用。

绑定、换绑或解绑后，为该网站账号负责的所有未完成任务追加新的 `upsert` 变更，使 WorkBuddy 能重新判断创建或转交关系。

### 任务变更日志

状态文档增加单调递增序号和不可变事件列表：

```json
{
  "eventId": "change_...",
  "sequence": 123,
  "departmentId": "configured-data-product-department",
  "changeType": "upsert",
  "taskId": "task_...",
  "updatedAt": 1787968800000,
  "snapshot": {
    "task_id": "task_...",
    "title": "准备月度经营分析",
    "description": "补齐指标口径说明",
    "owner": {
      "username": "zhangsan",
      "display_name": "张三",
      "wecom_userid": "internal-value-or-null",
      "mapped": true
    },
    "status": "进行中",
    "due_date": "2026-09-01",
    "updated_at": "2026-08-29T10:00:00.000Z",
    "deleted": false
  }
}
```

删除事件使用 `changeType=delete`，并保留最小墓碑：

```json
{
  "event_id": "change_...",
  "task_id": "task_...",
  "updated_at": "2026-08-29T10:00:00.000Z",
  "deleted": true
}
```

任务更新与变更事件在同一次 `saveState` 中保存。只有本地持久化成功后，API 才返回任务操作成功。第一阶段不自动删除变更日志或墓碑。

### Webhook Outbox

每次产生任务变更时，同时写入 Outbox 条目：

```text
eventId, eventType, occurredAt, status,
attemptCount, nextAttemptAt, lastAttemptAt, lastError
```

同一个变更事件只对应一个 Outbox 条目。重复投递继续使用同一事件编号。

## 增量任务查询 API

### 请求

```text
GET /api/integrations/workbuddy/tasks
Authorization: Bearer <部门级服务令牌>
```

首次同步或按时间恢复：

```text
?updated_since=2026-08-29T00:00:00.000Z&limit=100
```

连续同步或翻页：

```text
?cursor=<opaque-cursor>&limit=100
```

请求必须提供 `updated_since` 或 `cursor` 之一，不能同时提供。`updated_since` 必须是有效的 UTC ISO 时间，查询边界为大于等于。`limit` 默认 100，最小 1，最大 500。

### 响应

```json
{
  "items": [
    {
      "event_id": "change_...",
      "task_id": "task_...",
      "title": "准备月度经营分析",
      "description": "补齐指标口径说明",
      "owner": {
        "username": "zhangsan",
        "display_name": "张三",
        "wecom_userid": "internal-value-or-null",
        "mapped": true
      },
      "status": "进行中",
      "due_date": "2026-09-01",
      "updated_at": "2026-08-29T10:00:00.000Z",
      "deleted": false
    }
  ],
  "has_more": false,
  "next_cursor": null,
  "checkpoint": {
    "cursor": "opaque-resume-cursor",
    "updated_at": "2026-08-29T10:00:00.000Z"
  }
}
```

游标包含已消费序号和本轮查询水位，并由服务端防篡改。首次请求确定水位后，后续分页只读取该水位以内的事件；分页期间新产生的事件留给下一轮，避免一轮同步无限增长。

WorkBuddy 按响应顺序应用事件并保存 `checkpoint.cursor`。正常情况下后续请求使用游标；游标丢失或不可用时，使用最近成功的 `checkpoint.updated_at` 作为包含边界重新拉取，并按 `event_id` 去重。

### 鉴权与范围

- 服务令牌来自运行环境，不写入状态文档、浏览器或日志。
- 使用恒定时间比较校验令牌。
- 令牌绑定一个配置的部门标识；第一阶段只能绑定数据产品部。
- 接口不接受普通员工会话代替服务令牌。
- 无效或缺失令牌返回 401；令牌有效但集成部门配置无效时返回 503；参数错误返回 400；不可继续使用的游标返回 410。

### 基线迁移

部署后首次运行时，为数据产品部当时存在的每个任务生成一条 `upsert` 事件，并记录基线版本和完成时间。基线标记与事件同次保存；重复启动或补偿运行不得重复生成基线。

## 任务变更写入规则

- 新建任务：追加 `upsert`。
- 修改标题、描述、负责人、状态或截止日期：追加 `upsert`。
- 其他同步字段没有变化：不追加事件。
- 标记已完成：追加状态为“已完成”的 `upsert`，由 WorkBuddy 完成企微待办。
- 从已完成恢复：追加新状态的 `upsert`，由 WorkBuddy按其能力恢复或重新创建企微待办。
- 删除任务：先构造并写入 `delete` 墓碑，再物理删除业务任务。
- 账号绑定变化：为该账号负责的未完成任务追加 `upsert`。

每个事件使用独立编号。相同任务可以在增量流中出现多次，WorkBuddy 不应只按任务编号去重，而应按事件编号去重并按顺序应用。

## Webhook 设计

### 请求

Outbox 执行器向配置的 WorkBuddy 地址发送：

```json
{
  "event_id": "change_...",
  "event_type": "tasks_changed",
  "occurred_at": "2026-08-29T10:00:00.000Z"
}
```

请求头包含事件编号、Unix 时间戳和 HMAC-SHA256 签名。签名输入为 `timestamp + "." + rawBody`。Webhook 不包含标题、负责人、描述等业务详情。

### 投递规则

- 任务和 Outbox 保存成功后才允许发送。
- 首次立即尝试；失败后按有限退避再次尝试，总尝试次数最多三次。
- 2xx 视为成功；网络错误、超时、429 和 5xx 可重试；其他 4xx 直接记为最终失败。
- 单次请求设置短超时，不阻塞任务 API 响应。
- Node 服务启动时补偿扫描待发送条目，并按固定短周期调用同一个 Outbox 执行器。
- 超过重试上限后保留失败条目，不自动无限重试。

后台集成状态至少展示启用状态、最近一次成功时间、待发送数量、最终失败数量和最近错误摘要。错误摘要必须截断并清除令牌、签名、OAuth code、请求头和响应正文中的敏感内容。

Webhook 是实时性优化，不是数据完整性的唯一保证。即使所有 Webhook 均丢失，WorkBuddy 仍可按固定轮询和游标补齐任务。

## OAuth 免登设计

### 发起入口

```text
GET /api/auth/wecom/start?return_to=<allowed-path>
```

服务端生成高熵一次性 `state`，记录创建时间、允许的站内回跳路径和已使用状态，五分钟后过期。企微授权 URL 使用公开的企业和应用标识构造，应用密钥不进入工作台。

### 回调入口

```text
GET /api/auth/wecom/callback?code=<one-time-code>&state=<one-time-state>
```

处理顺序：

1. 校验 `state` 存在、未过期、未使用且回跳路径合法。
2. 原子标记 `state` 已使用，防止并发重复兑换。
3. 通过独立服务端凭证调用 WorkBuddy 身份解析接口并传递一次性 `code`。
4. 校验 WorkBuddy 返回成功、员工身份有效且属于当前企业。
5. 按企微员工标识查找唯一的网站账号映射。
6. 校验账号有效且属于数据产品部。
7. 创建现有工作台会话并跳回已验证的站内路径。

找不到映射时返回稳定提示“企微账号尚未绑定，请联系数据产品部管理员”，不回显内部标识，不创建临时账号，也不尝试按姓名自动匹配。

OAuth code、WorkBuddy 身份解析凭证和完整身份响应不得写入业务日志。WorkBuddy 不可用或解析失败时返回可读错误，用户仍可使用原账号密码登录。

## 配置与密钥边界

运行环境至少提供：

```text
WORKBUDDY_ENABLED
WORKBUDDY_DEPARTMENT_ID
WORKBUDDY_TASK_API_TOKEN
WORKBUDDY_WEBHOOK_URL
WORKBUDDY_WEBHOOK_SECRET
WORKBUDDY_OAUTH_RESOLVER_URL
WORKBUDDY_OAUTH_RESOLVER_TOKEN
WECOM_OAUTH_CORP_ID
WECOM_OAUTH_AGENT_ID
WECOM_OAUTH_REDIRECT_URI
```

增量 API 令牌、Webhook 签名密钥和 OAuth 身份解析凭证必须独立。设置查询只返回是否已配置，不返回密钥明文。

## 错误处理与恢复

- 任务保存失败：任务、变更日志和 Outbox 均不得部分成功。
- 变更事件生成失败：任务写入整体失败，避免出现无法同步的已保存任务。
- Webhook 失败：任务保存保持成功，Outbox 记录失败并有限重试。
- WorkBuddy 拉取重复事件：按事件编号忽略重复，仍推进已确认的安全游标。
- 负责人未绑定：返回 `mapped=false`，WorkBuddy 暂停该任务的企微操作；绑定后工作台重新发出任务事件。
- OAuth state 或 code 无效：拒绝登录，不回退为名称匹配。
- OAuth 解析服务不可用：不创建会话，提示使用密码登录。
- 服务重启：重新读取持久化变更日志、OAuth state 和 Outbox，不依赖内存恢复。

## 权限与隐私

- WorkBuddy 服务令牌只能读取配置部门的同步字段，不返回任务附件、目标贡献、每日记录、创建人或更新人等额外内容。
- OAuth 建立会话后完全复用现有 `taskVisibleToActor`、创建、编辑、删除和附件权限，不增加旁路权限。
- 只有数据产品部负责人或更高权限管理员可以维护本部门员工映射和查看集成状态。
- 无权限访问时保持现有 404/403 边界，不泄露其他部门任务、映射或集成是否存在。
- 所有令牌、签名密钥、OAuth code 和企微应用密钥均不得出现在前端、状态响应或错误摘要中。

## 管理界面

后台账号管理为数据产品部账号增加企微绑定状态和绑定/解绑操作。保存时检查一对一唯一性，冲突时明确提示，不覆盖另一账号已有绑定。

后台增加精简的 WorkBuddy 集成状态：

- 是否启用和配置是否完整；
- 最近成功的增量拉取时间；
- 最近成功的 Webhook 时间；
- 待发送和最终失败数量；
- 最近一次经过脱敏和截断的错误摘要。

第一阶段不提供在后台修改服务令牌、签名密钥或外部地址的输入框，密钥和地址由部署配置维护。

## 测试与验收

### 领域测试

1. 新建、同步字段修改、状态变化和删除分别产生正确事件。
2. 删除业务任务后墓碑仍可查询。
3. 同一毫秒内多个事件按序号稳定排序，不遗漏。
4. 基线迁移重复执行不重复生成事件。
5. 账号换绑仅重新发出该账号负责的未完成任务。

### API 测试

1. `updated_since` 使用包含边界并返回规定字段。
2. 游标分页在查询期间出现新事件时保持固定水位。
3. 重复游标请求结果稳定，保存的 checkpoint 能继续拉取。
4. 缺失或错误令牌返回 401，不能读取其他部门。
5. 参数错误和不可继续使用的游标分别返回 400 和 410。

### OAuth 测试

1. 已绑定员工成功建立现有账号会话并沿用任务权限。
2. 未绑定、非数据产品部或停用账号不能免登。
3. 过期、伪造和重复使用的 state 均被拒绝。
4. WorkBuddy 解析失败时不创建会话，密码登录保持可用。
5. 日志和错误响应不包含 code、令牌或内部员工标识。

### Webhook 测试

1. 任务保存成功后产生 Outbox，保存失败不产生孤立通知。
2. 签名内容、时间戳和事件编号稳定可校验。
3. 重复投递沿用事件编号，最多尝试三次。
4. Webhook 超时或失败不改变任务 API 的成功结果。
5. 服务重启后继续处理待发送条目，最终失败可在后台观察。

### 端到端验收

使用 WorkBuddy 测试环境执行：首次基线同步、新建、编辑、负责人转交、完成、删除、Webhook 重复、WorkBuddy 离线恢复、员工免登和密码备用登录。每一步分别核对工作台持久化状态、增量响应与企微原生待办结果，不能只以生成端返回成功作为验收依据。

## 预计修改范围

- `PRD.MD`：记录确认后的产品规则与验收标准。
- `PROJECT_ARCHITECTURE.md`：增加集成路由、变更日志、OAuth 和 Outbox 数据流。
- `api/[...path].mjs`：接入增量查询、OAuth、映射管理和集成状态路由，并在任务写入点调用领域模块。
- `lib/task-change-log.mjs`：生成基线、增量事件、墓碑、游标和查询水位。
- `lib/workbuddy-integration.mjs`：服务令牌校验、OAuth 身份解析与响应投影。
- `lib/webhook-outbox.mjs`：Webhook 签名、有限重试、状态摘要和补偿执行。
- `lib/runtime-config.mjs`：读取并校验 WorkBuddy 与企微 OAuth 运行配置。
- `lib/state-store.mjs`：兼容新增的变更日志、映射、OAuth state 和 Outbox 状态。
- `server.mjs`：启动补偿和短周期 Outbox 调度。
- `public/index.html`：企微免登入口、账号绑定管理与集成状态展示。
- `test/`：新增领域、API、OAuth、Webhook、权限和最小 UI 回归测试。
