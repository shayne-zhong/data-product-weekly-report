# WorkBuddy 同步日志与配置后台设计

## 背景

部门工作台已经提供 WorkBuddy 增量任务查询、完成状态回写、账号与企微 `userid` 映射及 OAuth 免登。现有网站能够观测 API 调用，却无法知道 WorkBuddy 在企微侧创建、更新或重建待办的最终结果；生产配置主要依赖环境变量，也缺少可视化映射维护能力。

本设计在不改变既有任务接口契约的前提下，增加仅供全局管理员使用的同步运维后台，并让 WorkBuddy 回传企微侧执行结果，形成完整链路日志。

## 目标与非目标

### 目标

1. 在后台提供运行概览、生产配置、userid 映射和同步日志。
2. 网站自动记录接口侧关键行为，WorkBuddy 回传企微侧真实结果。
3. 支持生产配置即时生效，并安全加密两枚 Token。
4. 日志保留 30 天且最多 5000 条，支持筛选和稳定分页。
5. 所有页面和 API 仅允许全局管理员访问。

### 非目标

1. 不把轮询频率、企微机器人授权或重试策略迁入网站配置；这些仍由 WorkBuddy 管理。
2. 不允许同步事件回传接口修改网站任务、账号或配置。
3. 不开放给部门负责人或普通员工。
4. 不增加任务删除同步、Webhook 或其他企微反向编辑。
5. 不保存或展示 Token 明文、OAuth code、完整请求头及错误堆栈。

## 推荐架构

新增两个小型领域模块：

- `lib/workbuddy-config.mjs`：配置归一化、环境变量与后台覆盖合并、加密字段掩码、映射唯一性校验。
- `lib/workbuddy-sync-log.mjs`：日志归一化、幂等写入、统计、筛选、游标分页和保留策略。

统一 API 继续作为唯一业务入口：

- 管理端读取和修改配置、映射、概览及日志。
- 现有开放任务接口调用统一的“有效配置”解析器，不再只读取环境变量。
- WorkBuddy 通过新开放接口回传企微执行结果。

同步日志和配置仍存入现有统一状态，不新增数据库或外部日志系统。内网单实例和现有持久化锁保证一次写入的一致性。

## 权限模型

后台入口只在全局管理员会话中展示。所有 `/api/admin/workbuddy/*` 路由必须复用现有管理员 Token 校验，并额外确认角色为 `admin`；部门负责人返回 403。

`POST /api/open/sync-events` 使用当前生效的任务开放 API Token。普通员工 Cookie、普通用户 Token、管理员 Token 和 OAuth Token 均不能代替它。

## 状态结构

统一状态新增：

```json
{
  "workbuddy": {
    "enabled": true,
    "departmentId": "data-product",
    "openApiToken": {
      "encrypted": {},
      "last4": "abcd",
      "updatedAt": 1787968800000,
      "updatedBy": "admin"
    },
    "oauthResolverUrl": "http://workbuddy.internal/oauth/resolve",
    "oauthResolverToken": {
      "encrypted": {},
      "last4": "wxyz",
      "updatedAt": 1787968800000,
      "updatedBy": "admin"
    },
    "corpId": "ww00000000000000",
    "status": {
      "lastPollAt": 0,
      "lastSuccessfulPollAt": 0,
      "lastPollCount": 0,
      "lastWatermark": 0,
      "lastWritebackAt": 0,
      "lastResultReportedAt": 0
    },
    "syncEvents": [],
    "syncEventIds": {}
  }
}
```

账号目录中的 `wecomUserId` 旁增加 `wecomUserIdUpdatedAt` 和 `wecomUserIdUpdatedBy`。旧状态缺少这些字段时按空值兼容，不执行破坏性迁移。

### 配置优先级

1. `enabled: false` 明确停用集成，环境变量不能绕过停用状态。
2. 后台已保存的单项配置优先。
3. 未保存或清除后台覆盖值时使用对应环境变量。
4. 两处都缺失时，该能力返回 503，并在后台显示“未配置”。

为了兼容当前已部署环境，旧状态没有 `workbuddy.enabled` 时视为启用，并继续使用环境变量。

## 管理 API

### 读取概览与配置

```http
GET /api/admin/workbuddy
Authorization: Bearer <ADMIN_TOKEN>
```

响应包含：

- `enabled`、集成部门及可选部门列表；
- OAuth 地址和企业 ID；
- 两枚 Token 的 `configured`、`source`（`admin` 或 `environment`）及 `mask`；
- 最近运行状态、24 小时统计和未绑定账号数；
- 当前部门映射摘要。

响应永远不返回加密对象或 Token 明文。

### 修改生产配置

```http
PATCH /api/admin/workbuddy/config
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json
```

请求可包含：

```json
{
  "enabled": true,
  "department_id": "data-product",
  "oauth_resolver_url": "http://workbuddy.internal/oauth/resolve",
  "corp_id": "ww00000000000000",
  "open_api_token": "new-secret-or-omitted",
  "clear_open_api_token": false,
  "oauth_resolver_token": "new-secret-or-omitted",
  "clear_oauth_resolver_token": false
}
```

规则：

- 省略 Token 字段表示保持不变；Token 最少 24 个字符。
- `clear_*` 只清除后台覆盖值，随后恢复环境变量来源；停用必须使用 `enabled: false`。
- URL 必须是 `http` 或 `https`，企业 ID 和部门 ID 必须为非空安全文本。
- 两枚 Token 必须不同。
- 保存时加密 Token，只保存末四位；配置审计事件仅记录变化字段名。
- 响应只返回掩码配置，并用 `warnings` 提示 WorkBuddy Token 需要同步更新、OAuth Token 变化会使未消费 state 失效。

### 查询和修改映射

```http
GET /api/admin/workbuddy/mappings?query=&status=&before=&limit=
PATCH /api/admin/workbuddy/mappings/:username
```

映射列表仅返回当前集成部门账号，支持按网站账号、姓名、企微 `userid` 搜索，以及 `mapped`、`unmapped`、`conflict` 状态筛选。

修改请求：

```json
{"wecom_userid":"zhangsan"}
```

传空字符串表示清除。服务端按网站账号精确定位，校验账号属于集成部门，并在一次持久化中完成唯一性检查、映射更新、相关任务重新打时间戳和审计日志写入。冲突返回 409，且不产生部分修改。

### 查询日志

```http
GET /api/admin/workbuddy/logs?from=&to=&result=&action=&task_id=&user=&before=&limit=
```

- 默认返回最近 50 条，最大 100 条。
- `before` 是由日志时间与日志 ID 编码的稳定不透明游标。
- 按 `occurredAt`、`id` 倒序排列。
- 筛选在服务端执行，响应包含 `events` 和 `next_before`。

## WorkBuddy 结果回传 API

### 请求

```http
POST /api/open/sync-events
Authorization: Bearer <WORKBUDDY_OPEN_API_TOKEN>
Content-Type: application/json
```

```json
{
  "event_id": "workbuddy-event-uuid",
  "task_id": "task_123",
  "action": "created",
  "result": "success",
  "wecom_todo_id": "todo-id",
  "attempt": 1,
  "message": "",
  "occurred_at": 1787968800000
}
```

允许动作：`created`、`updated`、`recreated`、`skipped`、`failed`、`retry_scheduled`。允许结果：`success`、`failed`、`skipped`、`retrying`。

约束：

- `event_id`、`task_id`、动作、结果和 `occurred_at` 必填。
- `occurred_at` 为 Unix 毫秒，允许与服务器时间相差最多 24 小时。
- `attempt` 为 0 到 100 的整数；文本字段有长度上限。
- 网站使用当前任务和账号目录补充标题及负责人快照；任务已删除时仍保存回传字段，但不恢复任务。
- 相同 `event_id` 返回 200 和原日志 ID，不重复写入。
- 接口只写日志与运行状态，绝不修改任务、映射或配置。

成功响应：

```json
{"accepted":true,"duplicate":false,"log_id":"sync_xxx"}
```

## 网站自动日志

网站产生以下事件：

| 动作 | 触发条件 | 明细日志 |
| --- | --- | --- |
| `polled` | 增量查询成功 | 仅返回任务数大于 0 时记录；空查询只更新概览 |
| `poll_failed` | 参数错误或内部服务异常 | 记录脱敏原因；错误 Token 不保存请求内容 |
| `writeback_completed` | 完成回写成功 | 记录任务与负责人 |
| `writeback_terminal` | 返回 409 | 记录终态结果 |
| `writeback_rejected` | 返回 422 | 记录业务拒绝摘要 |
| `oauth_mapped` | OAuth 自动补齐映射 | 记录网站账号，不记录 code |
| `oauth_rejected` | 身份、部门或映射冲突 | 记录脱敏原因 |
| `config_changed` | 管理员保存配置 | 只记录字段名和管理员账号 |
| `mapping_changed` | 管理员修改映射 | 记录账号及新增、替换或清除动作 |

高频错误 Token 尝试只更新内存或概览计数，不逐条持久化，避免攻击者填满状态。所有 `message` 经过单行化、长度截断和敏感模式清理。

## 日志结构与保留策略

日志规范结构：

```json
{
  "id": "sync_uuid",
  "externalEventId": "workbuddy-event-uuid-or-empty",
  "source": "website",
  "action": "writeback_completed",
  "result": "success",
  "taskId": "task_123",
  "taskTitle": "准备月报",
  "username": "zhangsan",
  "displayName": "张三",
  "wecomTodoId": "todo-id",
  "attempt": 1,
  "message": "",
  "occurredAt": 1787968800000,
  "recordedAt": 1787968801000
}
```

每次写入和管理员读取日志时执行清理：

1. 删除 `occurredAt` 早于当前时间 30 天的事件。
2. 按 `occurredAt`、`id` 排序，只保留最新 5000 条。
3. 同步删除已清理事件对应的 `syncEventIds` 幂等索引。

日志写入失败不得回滚已成功的任务读取或状态回写；在业务变更与日志可同一次保存时优先原子写入，独立查询日志失败仅影响可观测性。

## 后台界面

在现有设置中心增加仅全局管理员可见的“企微任务同步”导航项。

### 运行概览

顶部展示六个紧凑指标：最近成功拉取、最近状态回写、最近企微回传、水位、未绑定员工、近 24 小时失败数。其下以状态标签展示成功、失败、跳过、待重试计数。

### 生产配置

- 集成启用开关；
- 集成部门下拉选择；
- OAuth 解析地址和企业 ID 普通输入框；
- 两枚 Token 使用密码输入框，默认空白，旁边显示来源与掩码；
- “替换”通过输入新值保存，“清除后台覆盖”恢复环境变量；
- 保存前若 Token 变化，显示明确确认提示，不把值写入本地存储。

### userid 映射

使用可搜索表格展示账号、姓名、状态、注册状态、企微 `userid` 和更新时间。单行进入编辑态，保存前在服务端校验唯一性。未绑定、停用和冲突使用不同状态标签，不展示批量模糊匹配能力。

### 同步日志

提供时间范围、结果、动作和关键词筛选；表格展示时间、任务、负责人、动作、结果、企微待办 ID、次数和摘要。默认最新 50 条，使用“加载更多”游标分页。错误摘要限制两行，点击后显示完整脱敏文本。

## 错误处理

- 后台配置校验失败返回 400；映射冲突返回 409；非全局管理员返回 403。
- Token 加解密失败返回 503，旧配置保持不变。
- 回传事件参数错误返回 400，错误 Token 返回 401，配置停用返回 503。
- WorkBuddy 回传失败由 WorkBuddy 按同一 `event_id` 重试，网站幂等接收。
- 日志读取或统计异常不能暴露原始状态、密钥或堆栈。

## 测试与验收

### 领域模块

- 配置覆盖、环境回退、显式停用、两枚 Token 不同及掩码输出。
- 事件规范化、敏感信息清理、幂等写入、30 天清理和 5000 条上限。
- 筛选条件、稳定游标及相同时间戳下的确定顺序。
- userid 一对一约束、清除映射及相关任务重新进入增量。

### API

- 全局管理员可访问；部门负责人、普通员工及匿名请求被拒绝。
- Token 保存后立即用于增量、回写和事件回传；明文不出现在响应、日志或普通设置接口。
- 重复 `event_id` 只生成一条日志；事件回传不修改任务。
- 空拉取只更新状态，有任务拉取和所有回写结果生成正确日志。
- OAuth code、Token、Authorization 头和错误堆栈不进入日志。

### UI

- 入口只对全局管理员显示，四个区域可读取和保存。
- Token 字段默认空白，只显示掩码和来源，变更警告清晰。
- 映射搜索、编辑、冲突提示及日志筛选、加载更多行为可用。
- 页面刷新后不会在 DOM、前端状态或浏览器存储中恢复 Token 明文。

### 回归

- 现有 WorkBuddy 增量、完成回写、OAuth 和目录初始化测试继续通过。
- 现有管理员、部门负责人、普通员工权限不变。
- 全量测试、Lint 和生产构建通过。

## 预计修改范围

- `PRD.MD`：新增同步后台需求及验收标准。
- `PROJECT_ARCHITECTURE.md`：增加配置与日志领域模块和路由。
- `lib/workbuddy-config.mjs`：配置合并、加密与公开投影。
- `lib/workbuddy-sync-log.mjs`：日志写入、清理、统计、筛选和分页。
- `lib/workbuddy-auth.mjs`：改为使用解析后的有效配置进行 Token 校验和 OAuth 调用。
- `lib/open-task-sync.mjs`：复用映射变化后的任务重打时间戳能力。
- `api/[...path].mjs`：新增管理 API、事件回传及网站自动日志。
- `public/index.html`：新增全局管理员同步后台界面。
- 对应领域、API 和 UI 测试文件。
