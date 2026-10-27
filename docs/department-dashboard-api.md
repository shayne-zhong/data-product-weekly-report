# 部门驾驶舱供数接口与文件格式 v1

适用范围：本次后台首页。所有统计均属于所选部门；本说明不代表已接入生产外部平台。网站读取、预检、确认导入已实现；外部查询协议为待数据提供方实现的约定。当前没有自动拉取、定时同步或外部凭证配置。

## 1. 接口边界与鉴权

| 接口 | 责任方 / 状态 | 用途 |
| --- | --- | --- |
| `GET /api/admin/dashboard` | 工作台 / 已实现 | 读取授权部门的真实业务统计和有效导入结果 |
| `POST /api/admin/dashboard/imports/preview` | 工作台 / 已实现 | 校验导入文档并返回确认依据；不写入 |
| `POST /api/admin/dashboard/imports` | 工作台 / 已实现 | 根据预检摘要和当前版本重新校验、确认入库 |
| `GET {provider-base}/v1/department-dashboard/snapshot` | 外部数据提供方 / 待建设 | 按部门和期间提供同一 v1 文档；当前工作台不会主动调用 |
| `GET /api/admin/overview` | 工作台 / 原接口保留 | 既有概览；不因本次改造改变契约 |

网站三个新增接口使用现有后台管理员 `Authorization: Bearer <ADMIN_SESSION_TOKEN>`。普通员工会话不能使用。部门负责人仅能读写自己的部门；全局管理员显式指定部门，未指定时使用首个启用部门。外部方只能获得其授权来源的服务身份，鉴权方式、有效期、轮换和网络边界另行确认。**不要把工作台完整管理员令牌交给外部系统或供应商。**

## 2. 通用 v1 文档

JSON 与 CSV 经解析后使用同一数据结构，所有字段名区分大小写。JSON 文件为 UTF-8，可有 BOM。

| 字段 | 类型 / 必填 | 规则 |
| --- | --- | --- |
| `schemaVersion` | 整数 / 是 | 固定 `1` |
| `batchId` | 字符串 / 是 | 来源侧生成稳定批次 ID；重试保留原值 |
| `departmentId` | 字符串 / 是 | 工作台真实部门 ID，须与请求和授权范围一致 |
| `sourceId` | 字符串 / 是 | 稳定来源 ID；同一个来源更新时保持不变 |
| `sourceName` | 字符串 / 是 | 1–160 字符的可读来源名称，例如某 BI 平台的正式名称；不含控制字符 |
| `asOf` | ISO 8601 字符串 / 是 | 带 `Z` 或时区偏移的业务源截止/生成时间，例如 `2026-10-26T08:00:00+08:00` |
| `records` | 数组 / 是 | 每批 1–500 条；空模板填好前不能导入 |

`batchId`、`departmentId`、`sourceId` 最长 80 字符，首字符必须为英文字母或数字，其余仅允许英文字母、数字、`.`、`_`、`-`。每批文档上限 1 MiB（1,048,576 字节）；预检和确认接口的**整个原始 JSON 请求体**也须小于等于此限制，包含外层 `departmentId`、`document`、哈希、版本及全部空白字符。文件转换成 JSON 后还会增加请求开销，因此不要把文件大小正好做到上限，超限应拆成不同批次。每部门最多保留 5000 条观测；供页面查看的详细批次审计保留最近 50 条，精简批次防重索引随状态持续保留。`asOf` 包含时分秒，可有 1–3 位毫秒，不能超过服务器当前时间 5 分钟；网站规范化为 UTC ISO 时间。`receivedAt` 是工作台成功接收时间，由网站生成；不能替代业务源的 `asOf`。未在字段表中列出的字段会被拒绝。

| records 字段 | 类型 / 必填 | 规则 |
| --- | --- | --- |
| `metric` | 字符串 / 是 | 下节允许的指标 ID |
| `periodStart`、`periodEnd` | `YYYY-MM-DD` / 是 | 含首尾日、真实公历日期、开始不晚于结束、同一自然年（2020–2100）；结束不晚于 `asOf` 的北京时间日期 |
| `value` | 数字 / 是 | 非负；次数、Token、人数必须为整数；比例为 0–100 的百分数。仅比例分母为 0 时允许 `null` |
| `unit` | 字符串 / 是 | 必须与指标注册单位完全相同 |
| `dimensionType` | 字符串 / 否 | 默认 `total`；只允许对应指标的维度类型 |
| `dimension` | 字符串 / 否 | 默认空字符串、最长 160 字符且不含控制字符；`total` 使用空字符串，其他维度填写真实分类或账号 |
| `coverage` | 字符串 / 是 | `complete` 或 `partial`；分别代表该来源约定范围完整或部分覆盖 |
| `numerator`、`denominator` | 整数 / 比例必填 | 非负安全整数；分子不得大于分母；与 `value=分子÷分母×100` 的差不超过 0.05 个百分点。非比例记录不得含这两个字段 |
| `annualTarget` | 数字 / 否 | 明确属于该自然年的全年目标，不随当前筛选期间缩小；单位与指标一致，比例为 0–100，其他为非负安全整数 |
| `validForHours` | 整数 / 否 | 默认 24；范围 1–8760 小时，以业务 `asOf` 判断过期 |

未知值不得填 `0`。未接入来源、没有测量的格子、不知道的分母均不提交记录；页面显示缺数。已确认的真实零值可填 `0`。比例分母为 0 时 `numerator=0`、`denominator=0`、`value=null`，页面显示不适用。

## 3. 指标注册表

`total` 表示来源约定范围内的总数；各维度记录不自动相加成总数。不要把维度小计和总计重复累加。

| metric | 含义 | unit | 期间语义 | 允许 dimensionType |
| --- | --- | --- | --- | --- |
| `report_visits` | 报表有效访问次数 | `count` | 期间累计 | `total` |
| `data_ai_calls` | 数据 AI 业务调用次数 | `count` | 期间累计 | `total` |
| `report_count` | 有效报表资产数 | `count` | 期末存量 | `total` |
| `report_active_rate` | 报表活跃率 | `percent` | 显式分子分母 | `total` |
| `business_users` | 已确认口径的业务平台用户数 | `count` | 期末存量 | `total` |
| `data_coverage` | 数据覆盖率 | `percent` | 显式分子分母 | `total` |
| `metric_count` | 有效指标资产数 | `count` | 期末存量 | `total` |
| `warehouse_table_count` | 有效仓库表数 | `count` | 期末存量 | `total`, `warehouse_layer` |
| `service_api_count` | 有效数据服务接口数 | `count` | 期末存量 | `total` |
| `quality_pass_rate` | 质量参检通过率 | `percent` | 显式分子分母 | 仅 `domain` |
| `token_total` | 已接入来源 Token 总量 | `tokens` | 期间累计 | `total`, `domain`, `platform` |
| `token_input` | 输入 Token | `tokens` | 期间累计 | `total` |
| `token_output` | 输出 Token | `tokens` | 期间累计 | `total` |
| `ai_app_count` | 有效 AI 应用数 | `count` | 期末存量 | `total`, `domain`, `platform` |
| `ai_active_app_count` | 活跃 AI 应用数 | `count` | 期末存量 | `total` |
| `ai_talent_count` | 经评估 AI 人才数 | `people` | 期末存量 | `total`, `domain`, `talent_level` |
| `hr_employees` | HR 在职员工数 | `people` | 期末存量 | `total` |
| `employee_goal_rate` | 员工指标达成率 | `percent` | 显式分子分母 | 仅 `person` |
| `employee_key_task_rate` | 员工重点任务达成率 | `percent` | 显式分子分母 | 仅 `person` |

维度规则：

- `domain`、`platform`、`warehouse_layer`、`talent_level` 使用提供方确认且稳定的真实分类名称。人才主要层级须互斥；不能根据任务文本推断专家或学习者。
- `quality_pass_rate` 的 `dimension` 固定写为 `领域|质量维度`，例如 `供应链|完整性`；质量维度仅可为 `完整性`、`准确性`、`一致性`、`及时性`、`唯一性`、`有效性`。该行只代表对应参检范围，不代表其他领域已检测。
- `person` 的 `dimension` 是所选部门已存在的网站账号 `username`，不能用显示姓名、邮箱或其他部门账号代替。
- `total` 的 `dimension` 为空。注册表未列出的维度或指标拒绝导入。

## 4. 期间、来源与覆盖规则

查询期间由网站响应的 `context.startDate` / `context.endDate` 为准。累计量要求该完整期间的记录，网站不把日/月片段擅自拼成全年；存量是期末快照，不能跨月相加；比例必须在该期间内由同口径分子分母计算。所有展示总值都要求记录的起止日期与查询期间精确一致，存量记录也须附完整查询期间边界。趋势只显示查询范围内有真实观测的期间，历史未采集就留空，不能倒推。

每条观测键为 `sourceId + metric + periodStart + periodEnd + dimensionType + dimension`，同批不允许重复键。同一键的新内容必须使用更晚 `asOf`；相同 `asOf` 仅允许各记录字段完全相同，较早或同一截止时间的不同观测均拒绝覆盖。不同来源即使提供同一总数，也保留来源且选择较新结果展示，不相加；`asOf` 相同则选择接收较晚的结果。来源优先级尚未形成独立治理配置；提供方应先明确每个指标的权威来源。

`coverage=complete` 只说明该来源约定范围完整，不自动证明全集团、全渠道或全部门已覆盖。仅接入部分模型渠道时标为已接入渠道用量；部分覆盖不能外推总量。超过 `validForHours` 后保留最后真实值并灰显。点击“刷新”读取工作台已存记录，**不会触发外部源取数**。

## 5. 文件模板与 CSV

文件：[空 JSON 模板](../public/dashboard-templates/blank.json)、[空 CSV 模板](../public/dashboard-templates/blank.csv)。网站中的直接下载地址为 [`/dashboard-templates/blank.json`](/dashboard-templates/blank.json) 与 [`/dashboard-templates/blank.csv`](/dashboard-templates/blank.csv)，也可从“导入数据”窗口的模板入口下载。空模板没有示例业务数字，必须用真实信息补齐后导入。

CSV 为 UTF-8（允许 BOM），第一行包含以下全部 18 个列名，不可缺列、增加或重复列；解析器允许调整列顺序，模板采用下列固定顺序：

```csv
schemaVersion,batchId,departmentId,sourceId,sourceName,asOf,metric,periodStart,periodEnd,value,unit,dimensionType,dimension,coverage,numerator,denominator,annualTarget,validForHours
```

每行重复文档级六个字段，且全文件必须一致。字段含逗号、换行或双引号时用双引号包围，内部双引号写为两个双引号，遵循 RFC 风格引号转义。非比例的分子分母留空；可选字段留空。解析器将空 `value` 转为 `null`，服务器仅在比例分母为 0 时接受，不能用作任意缺失值。CSV 在浏览器转换为 v1 文档后，仍经过同一服务端预检与确认校验。

以下是**纯虚构、不可直接用于正式导入**的格式示例；部门与来源 ID 必须换成真实值，数字必须从正式来源取得：

```json
{
  "schemaVersion": 1,
  "batchId": "example-20261026-01",
  "departmentId": "EXAMPLE_DEPARTMENT",
  "sourceId": "example-bi",
  "sourceName": "虚构 BI 格式演示",
  "asOf": "2026-10-26T08:00:00+08:00",
  "records": [
    {"metric":"report_visits","periodStart":"2026-01-01","periodEnd":"2026-10-26","value":120,"unit":"count","coverage":"partial"},
    {"metric":"report_active_rate","periodStart":"2026-01-01","periodEnd":"2026-10-26","value":80,"unit":"percent","numerator":8,"denominator":10,"coverage":"partial"}
  ]
}
```

## 6. 网站调用步骤

以下令牌是占位符。使用已登录后台页面的导入入口即可，无需手工取出管理员令牌。

### 6.1 读取

```http
GET /api/admin/dashboard?departmentId=<DEPARTMENT_ID>&year=2026&period=ytd
Authorization: Bearer <ADMIN_SESSION_TOKEN>
```

`year` 为 2020–2100 整数，默认北京时间当前年。`period` 默认为 `ytd`，支持 `ytd`、`full`、`q1`–`q4`、`m01`–`m12`；本年 `ytd` 为 1 月 1 日至北京时间今天，其他年份 `ytd` 与 `full` 都是完整自然年；月/季采用完整自然月/季，不自动截到今天，因此尚未结束的月/季通常没有完整期间观测。

返回包含所选部门、选定期间、当前版本、来源状态、外部指标、网站真实任务/成员/目标贡献及缺数说明。工作台启用账号不能代替 HR 人数；任务记录完成率不能代替重点任务达成率；工作总结条数不能代替 BI 报表数量。实际字段见第 8 节。

### 6.2 预检

```http
POST /api/admin/dashboard/imports/preview
Authorization: Bearer <ADMIN_SESSION_TOKEN>
Content-Type: application/json

{"departmentId":"<DEPARTMENT_ID>","document":{ "schemaVersion":1,"batchId":"<STABLE_BATCH_ID>","departmentId":"<DEPARTMENT_ID>","sourceId":"<SOURCE_ID>","sourceName":"<SOURCE_NAME>","asOf":"<ISO8601_WITH_OFFSET>","records":["<REAL_RECORDS>"] }}
```

`document` 在以上说明中是文档对象；示例中的占位字符串不是有效记录。预检成功后保留响应中的 `previewHash` 与 `revision`，确认请求把该 `revision` 放到 `expectedRevision`；向操作员展示部门、来源、统计期间、记录数、覆盖和警告。该步骤不写入数据。

### 6.3 确认入库

```http
POST /api/admin/dashboard/imports
Authorization: Bearer <ADMIN_SESSION_TOKEN>
Content-Type: application/json

{"departmentId":"<DEPARTMENT_ID>","document":{ "...":"与预检时完全相同的真实文档对象" },"previewHash":"<HASH_FROM_PREVIEW>","expectedRevision":<REVISION_FROM_PREVIEW>}
```

占位对象仅说明请求结构，不能直接执行。服务器重新校验原文、哈希、权限及版本后写入。任何修改都必须重新预检；不能只改 JSON 再复用旧哈希。并发版本变化时刷新驾驶舱并重新预检。

### 6.4 幂等与重试

同一部门与 `batchId`、同一规范化内容重复提交，返回已处理结果，不重复计数。同部门的不同来源也不能复用同一批次 ID；建议在批次 ID 中带来源前缀。相同批次 ID 改变内容返回冲突；更正数据请生成新批次 ID。页面只展示最近 50 条详细审计，但精简 `batchIndex` 持续保存哈希与处理结果，较早批次仍能防重；这一保证依赖当前持久化状态保留，不能代替原始源文件和外部对账留档。

网络超时后先查看驾驶舱来源或批次状态，再以原文和原批次重试。鉴权/校验错误不自动重试；版本或哈希冲突必须重新预检。未建设后台自动重试和同步任务。

## 7. 外部提供方查询协议（待建设）

以下 URL **不属于本次已实现的网站路由**，由数据提供方建设或双方适配器未来实现：

```http
GET {provider-base}/v1/department-dashboard/snapshot?departmentId=<DEPARTMENT_ID>&periodStart=2026-01-01&periodEnd=2026-10-26
Authorization: Bearer <SOURCE_SCOPED_SERVICE_TOKEN>
```

成功响应 `200 application/json`，响应体直接是第 2 节 v1 文档，不额外包 `data`。提供方必须按服务身份授权部门过滤，并返回真实业务 `asOf`、稳定 `sourceId` 和可追溯 `batchId`。无权限 `403`；无有效快照 `404`；参数错误 `400`；源故障 `5xx`。无数据时不生成全 0 的成功快照。外部原生接口若格式不同，由提供方导出或后续适配器转换，不能在页面上伪造映射。

需要双方确认后才能建设自动同步：网络可达、来源身份授权、部门映射、指标定义、分页/配额、刷新频率、历史覆盖、失败重试上限、凭证保管及来源验收人。本次先使用文件导入，不把这份协议写成外部接口已存在。

## 8. 网站响应与错误码

成功均为 `200 application/json`，没有额外 `data` 包装。字段与实现 `lib/department-dashboard.mjs`、`api/[...path].mjs` 对齐。

| 读取响应字段 | 内容 |
| --- | --- |
| `schemaVersion` | `1` |
| `context` | `departmentId`, `departmentName`, 可选部门数组 `departments`, `year`, `period`, `startDate`, `endDate` |
| `metrics` | 19 项指标数组；每项含 `id`, `label`, `unit`, `kind`, `dimensions`, `value`, `status`；有数据时附来源、时间、覆盖、可选比例与目标 |
| `trends` | 按指标 ID 索引的真实总量观测数组，每项含 `periodStart`, `periodEnd` 与观测内容 |
| `distributions` | 按指标 ID 索引的精确期间维度观测数组，每项含 `dimensionType`, `dimension` 与观测内容 |
| `operations` | `activeAccounts`, `tasks`, `completedTasks`, `completionRate`, `overdueTasks`, `blockedTasks`, `unassignedTasks`, `scopeNote` |
| `people` | 本部门启用账号的任务记录、明细及可用的导入个人指标；显示姓名与稳定 `username` 分开 |
| `goals` | 所选年度与目标文档年度一致时的目标及贡献；附 `scopeNote`，贡献沿用本部门全部已完成任务，不按筛选期间/年份重算 |
| `sources` | 来源数组；`sourceId`, `sourceName`, `asOf`, `receivedAt`, `mode`, `records`, `status` |
| `revision` | 当前部门导入状态版本，非负整数 |
| `imports` | 最近 50 条审计；`batchId`, `sourceId`, `sourceName`, `asOf`, `receivedAt`, `recordCount`, `revision` |
| `updatedAt` | 最近导入的接收时间；没有导入时为 `null`，不是业务截止 |
| `fetchedAt` | 本次网站读取生成时间（ISO 时间）；没有导入时也有此值，不代表外部源更新或已抓取来源 |

观测的 `source` 是 `{sourceId,sourceName,mode:"import"}`；`asOf` 和 `receivedAt` 为独立字段，`coverage` 保留原值，年度目标在响应中叫 `target`。状态代码包括 `available`、`partial`、`stale`、`missing`、`not_applicable`。`quality_pass_rate` 和个人比例不推算总体，须看对应维度明细；`not_applicable` 的 `reason` 可区分无总体口径与分母为零。

网站任务按所属周与查询期间相交筛选，展示其当前状态，结转记录未跨周去重；逾期相对北京时间今天判断。目标贡献复用原有规则，不能当作所选期间的外部实测结果。页面说明和响应 `scopeNote` 都须保留这些限制。

以下响应采用第 5 节的**虚构格式示例**，哈希以占位符缩写。预检返回的是 `revision`：

```json
{
  "previewHash": "<SHA256_HASH>",
  "revision": 0,
  "summary": {
    "departmentId": "EXAMPLE_DEPARTMENT",
    "sourceId": "example-bi",
    "sourceName": "虚构 BI 格式演示",
    "recordCount": 2,
    "metricCount": 2,
    "completeRecords": 0,
    "partialRecords": 2
  },
  "warnings": ["批次包含部分覆盖记录，页面将保留部分覆盖标识。"],
  "document": {
    "schemaVersion": 1,
    "batchId": "example-20261026-01",
    "departmentId": "EXAMPLE_DEPARTMENT",
    "sourceId": "example-bi",
    "sourceName": "虚构 BI 格式演示",
    "asOf": "2026-10-26T00:00:00.000Z",
    "records": [
      {"metric":"report_active_rate","periodStart":"2026-01-01","periodEnd":"2026-10-26","value":80,"unit":"percent","dimensionType":"total","dimension":"","coverage":"partial","validForHours":24,"numerator":8,"denominator":10},
      {"metric":"report_visits","periodStart":"2026-01-01","periodEnd":"2026-10-26","value":120,"unit":"count","dimensionType":"total","dimension":"","coverage":"partial","validForHours":24}
    ]
  }
}
```

上例 `warnings` 仅展示其中一项，真实预检还含精确期间提醒，过期时另有警告；规范化 `document` 会补齐默认维度/有效期、排序记录并将时间转 UTC。确认成功返回 `{batchId,revision,duplicate,summary}`，首次 `duplicate=false` 且版本递增；相同批次内容重试为 `duplicate=true`，返回该批次原版本，不再写入。预检已执行来源回滚、批次防重和容量检查；确认时按最新状态再次校验，期间发生其他写入时仍可能因版本或来源冲突拒绝，需重新预检。

| HTTP | code | 含义 / 处理 |
| --- | --- | --- |
| `400` | `DASHBOARD_INVALID_CONTEXT` | 年份或期间无效，改用允许值 |
| `400` | `DASHBOARD_INVALID_JSON` | 原始请求体不是合法 JSON，修正编码、引号及结构后重试 |
| `401` | 既有鉴权响应可能只有 `error` | 后台会话过期、身份失效或凭证不适用，重新登录 |
| `403` | `DASHBOARD_FORBIDDEN` | 角色无权或跨部门请求，核实权限 |
| `404` | `DASHBOARD_DEPARTMENT_NOT_FOUND` | 部门不存在或已停用 |
| `422` | `DASHBOARD_INVALID_DOCUMENT` | 字段、值、维度、期间、比例或请求类型不合规，修正后重新预检 |
| `409` | `DASHBOARD_PREVIEW_MISMATCH` | 文档与预检哈希不一致，重新预检 |
| `409` | `DASHBOARD_BATCH_CONFLICT` | 同部门批次 ID 已用于不同内容，核对后使用新批次 |
| `409` | `DASHBOARD_REVISION_CONFLICT` | 当前版本已更新，刷新并重新预检 |
| `409` | `DASHBOARD_SOURCE_ROLLBACK` | 同一来源键试图用旧时间或同时间不同内容覆盖，核对源截止 |
| `409` | `DASHBOARD_CAPACITY_LIMIT` | 超过部门 5000 条观测，由管理员规划归档，不能盲目重试 |
| `413` | `DASHBOARD_BODY_TOO_LARGE` | 整个原始 JSON 请求体超过 1 MiB（包括空白和外层字段），缩小并拆分不同批次 |

领域错误返回示例：`{"error":"数据版本已更新，请重新预览","code":"DASHBOARD_REVISION_CONFLICT"}`。请求体大小、JSON 解析或服务故障还可能由通用 HTTP 层返回其他错误；调用方同时处理非 2xx，不只匹配上述代码。错误不得写入部分观测，预检成功不等于已入库。
