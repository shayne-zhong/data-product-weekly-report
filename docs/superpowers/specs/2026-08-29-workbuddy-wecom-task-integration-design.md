# WorkBuddy 企微原生待办集成设计

## 背景

部门工作台是任务事实源，WorkBuddy 负责把任务同步到企微原生待办中心，并把员工在企微勾选完成的结果回写网站。本期完全按对方给出的四项接口契约实施，不扩展额外同步能力。

现有任务已包含标题、描述、负责人、状态、截止日期和毫秒级 `updatedAt`。外部完成回写必须复用工作台现有业务规则：任务关联年度指标且贡献数有效后才能完成。

## 目标与非目标

### 目标

1. 提供 `GET /api/open/tasks?updated_since=` 增量任务查询 API。
2. 提供 `PUT /api/open/tasks/:task_id/status` 完成状态回写 API。
3. 建立网站账号与企微 `userid` 的一对一映射，支持通讯录初始化及 OAuth 首登自动回填兜底。
4. 提供精确路径 `/wecom/callback`，接收企微授权 `code` 并建立现有网站会话。
5. 所有开放能力仅覆盖数据产品部，并保持认证、错误码和数据边界可验证。

### 非目标

1. 不覆盖数据产品部以外的部门。
2. 不实现 Webhook、游标分页、任务变更日志、删除墓碑或删除同步。
3. 除完成状态外，不接受来自企微的任务编辑、转交或删除。
4. 不按姓名模糊匹配账号，不自动创建网站账号。
5. 不移除现有账号密码登录，也不在网站内直接调用企微待办接口。

## 总体数据流

1. 网站任务发生对外可见变化后，在同一次持久化中写入新的 `openUpdatedAt`。
2. WorkBuddy 持有最近消费的最大 `updated_at`，定期调用增量查询 API，维护企微原生待办。
3. 员工在企微勾选完成后，WorkBuddy 调用状态回写 API；网站通过现有完成校验后更新任务，并生成新的 `openUpdatedAt`。
4. 员工从企微进入网站时，回调先校验一次性 `state`，再由 WorkBuddy 解析授权 `code`；网站根据既有映射或精确账号匹配建立会话。

## 开放 API 认证与部门范围

1. 两个任务开放 API 使用同一个部门级 Bearer Token，仅从服务端环境变量读取。
2. Token 比较使用恒定时间比较；不得接受普通员工会话 Cookie 代替开放 API Token。
3. OAuth 身份解析使用独立凭证，与任务开放 API Token 分离。
4. 所有任务查询和回写都在服务端强制限定为配置的数据产品部；不存在、已删除或跨部门任务统一返回 404。
5. 认证失败返回 401，不在响应或日志中暴露 Token、授权 `code` 或完整请求头。

## 秒级严格递增更新时间

### 数据结构

- 每个任务增加整数 `openUpdatedAt`，单位为 Unix 秒，仅用于开放接口增量同步。
- 全局持久化状态增加整数 `openTaskClock`，记录最近分配的开放接口时间戳。

### 分配规则

每次需要推进开放接口时间时，在同一持久化事务中计算：

```text
next = max(floor(currentTimeMillis / 1000), openTaskClock + 1)
task.openUpdatedAt = next
openTaskClock = next
```

该规则保证即使同一自然秒内连续修改多个任务，每次分配的 `updated_at` 仍严格递增。系统时间回拨也不会产生倒退或重复值。

### 触发范围

以下变化推进任务的 `openUpdatedAt`：

- 新建任务；
- 标题、描述、负责人、状态或截止日期变化；
- 负责人对应的企微 `userid` 发生变化。

仅内部展示、审计或不属于接口契约的字段变化不推进时间戳。业务保存失败时不得推进时间戳。

上线时为数据产品部现有任务执行一次幂等基线初始化；初始化结果和完成标记均持久化，重复启动不会再次改写已有时间戳。

## 增量任务查询 API

### 请求

```http
GET /api/open/tasks?updated_since=<unix-seconds>
Authorization: Bearer <WORKBUDDY_OPEN_API_TOKEN>
```

- `updated_since` 必填，必须是非负安全整数；首次同步传 `0`。
- 查询条件为 `openUpdatedAt > updated_since`。
- 仅返回当前仍存在的数据产品部任务，按 `updated_at` 升序排列。
- 本期不提供分页或游标；WorkBuddy 成功处理一批数据后保存其中最大的 `updated_at`。

### 成功响应

```json
{
  "tasks": [
    {
      "task_id": "task_123",
      "title": "准备月度经营分析",
      "description": "补齐指标口径说明",
      "assignee_userid": "wecom-user-or-null",
      "status": "进行中",
      "due_date": "2026-09-01",
      "updated_at": 1787968800
    }
  ]
}
```

字段规则：

- `task_id`：网站任务稳定 ID。
- `title`、`description`：字符串；无描述时返回空字符串。
- `assignee_userid`：企微 `userid`；负责人未绑定时返回 `null`。
- `status`：沿用网站现有状态值：`待开始`、`进行中`、`阻塞`、`已完成`。
- `due_date`：`YYYY-MM-DD`；无截止日期时返回 `null`。
- `updated_at`：严格递增的非负 Unix 秒整数。

错误响应：Token 错误返回 401；参数缺失或非法返回 400；开放接口配置缺失返回 503。

## 状态回写 API

### 请求

```http
PUT /api/open/tasks/:task_id/status
Authorization: Bearer <WORKBUDDY_OPEN_API_TOKEN>
Content-Type: application/json

{"status":"completed"}
```

接口文档以 `completed` 为规范值；为兼容现有中文状态，也接受 `已完成`。本期不接受其他目标状态。

### 首次成功

1. 调用现有任务状态变更逻辑，不另建一套完成规则。
2. 状态更新为 `已完成`，进度设为 100，写入完成时间，且不再参与跨期顺延。
3. 更新来源记录为 WorkBuddy 集成身份。
4. 分配新的 `openUpdatedAt`，使本次完成随后能被增量查询读到。

成功返回 200：

```json
{
  "task_id": "task_123",
  "status": "已完成",
  "updated_at": 1787968801
}
```

### 错误与幂等语义

- 任务已完成时返回 409，错误码为 `TASK_ALREADY_TERMINAL`；不得重复修改任务、贡献数、完成时间或开放接口时间戳。
- 请求其他状态时返回 400。
- 未关联年度指标或贡献数无效等现有完成前置条件不满足时返回 422，错误码为 `TASK_COMPLETION_REQUIREMENTS_NOT_MET`。
- 任务不存在、已删除或不属于集成部门时返回 404。

此处的幂等指重复请求不会产生重复状态副作用；按照对方契约，终态重复请求仍明确返回 409。

## 网站账号与企微 userid 映射

### 存储约束

1. 在现有网站账号目录增加 `wecomUserId` 字段。
2. 网站账号与企微 `userid` 必须一对一唯一；同一 `userid` 不得绑定多个网站账号。
3. 普通员工不能查看或修改他人的企微标识。

账号目录采用现有可分配任务负责人的账号来源，而不是只依赖已产生登录记录的用户集合，避免未登录员工无法预先绑定。

### 通讯录初始化

1. 接入部署时由 WorkBuddy 提供数据产品部账号映射批次，作为内部初始化过程处理，不新增本期公开 API。
2. 只按双方约定的网站账号标识做标准化后的精确匹配，不使用显示姓名、拼音或模糊匹配。
3. 初始化批次具有持久化批次标识并幂等执行，记录成功、跳过和冲突数量，不记录敏感凭证。
4. 映射新增或变化后，为该账号当前负责的任务重新分配 `openUpdatedAt`，使 WorkBuddy 能取得新的 `assignee_userid`。

### OAuth 首登回填兜底

1. WorkBuddy 身份解析结果必须同时包含已验证的 `wecom_userid` 和可精确对应网站账号的企业账号标识。
2. 若已有唯一映射，则直接使用对应网站账号登录。
3. 若尚未映射，仅在数据产品部存在唯一、有效且已注册的网站账号时自动回填并登录。
4. 若网站账号或企微 `userid` 已绑定其他对象、账号不存在、标识不唯一、账号未注册或部门不一致，则拒绝回填和登录。
5. 系统不得根据 OAuth 结果自动创建网站账号。

## OAuth 免登回调

### 路由

```http
GET /wecom/callback?code=<authorization-code>&state=<one-time-state>
```

Node、本地服务、Vercel 和 Netlify 入口都必须把该精确路径转发到统一后端处理器，不能要求调用方改用 `/api/...` 路径。

### 处理顺序

1. 校验 `code` 和 `state` 均存在。
2. 校验 `state` 由本站签发、五分钟内有效、回跳地址在白名单内且尚未使用；随后将其标记为已使用。
3. 服务端使用独立 OAuth 解析凭证，把一次性 `code` 发送给 WorkBuddy 身份解析接口。
4. 校验返回的企业身份、`wecom_userid` 和网站账号标识完整且属于配置的企业与数据产品部。
5. 按既有映射或 OAuth 首登回填规则解析网站账号。
6. 确认网站账号有效、已注册且属于数据产品部后，复用现有会话机制创建登录会话并安全跳转。

授权 `code` 不写入浏览器存储、业务数据或日志。WorkBuddy 身份解析不可用时返回明确失败页，但不得影响账号密码登录。

## 配置边界

服务端新增或使用以下配置：

```text
WORKBUDDY_OPEN_API_TOKEN
WORKBUDDY_DEPARTMENT_ID
WORKBUDDY_OAUTH_RESOLVER_URL
WORKBUDDY_OAUTH_RESOLVER_TOKEN
WECOM_OAUTH_CORP_ID
WECOM_OAUTH_AGENT_ID
WECOM_OAUTH_REDIRECT_URI
```

任务开放 API Token 与 OAuth 身份解析 Token 必须分离。任何密钥都不得进入前端代码、持久化业务状态、普通错误响应或日志。

## 错误处理与兼容性

1. 任务业务字段和 `openUpdatedAt` 必须在同一次持久化中成功；保存失败不得形成虚假增量。
2. 账号映射冲突时不修改任一现有映射，也不推进任务时间戳。
3. OAuth 身份解析失败不影响账号密码登录和现有任务功能。
4. 现有任务 API、后端权限、跨期顺延、年度指标贡献和附件能力保持原行为。
5. 本期不发送 Webhook；WorkBuddy 继续通过轮询增量 API 获得变化。
6. 本期不返回已删除任务；删除同步不属于验收范围。

## 测试与验收

### 增量查询

- 首次传 `0` 能取得现有数据产品部任务。
- 边界严格使用 `updated_at > updated_since`，保存最大值后下一轮不重复上一批。
- 同一秒连续变化以及系统时间回拨时，`updated_at` 仍严格递增。
- 约定业务字段变化会推进时间戳，非约定内部字段变化不会推进。
- 未绑定负责人返回 `null`，补齐映射后相关任务重新进入增量结果。
- 参数、Token、配置和跨部门边界返回约定错误。

### 状态回写

- 首次完成成功并在后续增量查询中出现。
- 重复完成返回 409，任务、完成时间、贡献数和 `updated_at` 均不再变化。
- 不满足现有完成条件返回 422 且任务保持原状。
- 不支持的状态返回 400；不存在、已删除和跨部门任务返回 404。

### 映射与 OAuth

- 通讯录初始化只做精确唯一匹配，重复执行不重复写入。
- OAuth 已有映射可登录；唯一未绑定账号可自动回填并登录。
- 映射冲突、账号歧义、未注册、失效或跨部门时均拒绝登录。
- `state` 过期、伪造或重复使用时均拒绝；授权 `code` 和密钥不进入日志。
- WorkBuddy 身份解析不可用时，账号密码登录仍可使用。

最终使用 WorkBuddy 测试环境进行一次独立端到端验收：网站修改任务后企微待办更新，企微勾选完成后网站状态回写，并验证重复回写的 409 行为。

## 预计修改范围

- `PRD.MD`：记录本期唯一范围和验收标准。
- `PROJECT_ARCHITECTURE.md`：补充开放 API、账号映射和 OAuth 路由边界。
- `api/[...path].mjs`：新增两个开放任务 API 和 OAuth 回调处理。
- `lib/open-task-sync.mjs`：封装时间戳分配、增量投影和基线初始化。
- `lib/workbuddy-auth.mjs`：封装 Bearer Token 校验、OAuth state 和身份解析。
- `lib/runtime-config.mjs`：读取 WorkBuddy 与企微服务端配置。
- `lib/state-store.mjs`：持久化开放时间钟、任务时间戳、账号映射和 OAuth state。
- `server.mjs` 及部署路由配置：支持精确路径 `/wecom/callback`。
- `public/index.html`：增加企微免登入口及失败提示。
- 对应测试文件：覆盖增量、回写、映射、OAuth 和多运行时路由。
