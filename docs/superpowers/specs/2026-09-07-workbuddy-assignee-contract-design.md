# WorkBuddy 增量任务负责人字段修复设计

## 目标

让 `GET /api/open/tasks?updated_since=` 明确返回负责人姓名、网站账号和企微 `userid`，并修复历史任务只有负责人姓名时无法关联账号映射的问题，同时保持现有 WorkBuddy 字段兼容。

## 根因

当前投影只返回 `assignee_userid`。该值依赖网站账号已经绑定企微 `userid`，未绑定时按契约返回 `null`，响应中没有其他字段说明负责人是谁。另有历史任务只保存 `owner`、未保存 `ownerUsername`；开放接口当前只按 `ownerUsername` 查账号，未复用业务接口已有的“本部门唯一同名账号”解析规则，导致即使账号已映射也可能返回 `null`。

## 响应契约

每条任务继续返回原有字段，并新增：

- `assignee_name`：任务负责人显示姓名；无人负责时为 `null`。
- `assignee_username`：负责人网站账号；无法唯一解析时为 `null`。
- `assignee_userid`：负责人企微 `userid`；账号尚未映射时为 `null`。

原有字段保持为：`task_id`、`title`、`description`、`status`、`due_date`、`updated_at`。新增字段为向后兼容扩展，WorkBuddy 继续使用 `assignee_userid` 创建企微待办，现有消费者可忽略另外两个字段。

## 负责人解析

1. 优先使用任务保存的 `ownerUsername`，在当前部门精确查找账号。
2. 若 `ownerUsername` 为空，则用任务保存的 `owner` 在当前部门按姓名精确匹配。
3. 只有姓名恰好匹配一个账号时才关联；零个或多个匹配均不猜测网站账号及企微 `userid`。
4. `assignee_name` 优先使用已解析账号的姓名，否则使用任务已有 `owner`。
5. 禁止把网站账号直接当作企微 `userid`。

## 增量行为

负责人姓名、网站账号或企微映射的变化都属于开放接口可见变化，必须更新任务指纹并推进严格递增的 `updated_at`。本周过滤、排序、鉴权和完成状态回写保持不变。

## 其他字段审计结论

- `task_id` 始终来自任务 ID。
- `title`、`description` 和 `status` 始终投影为字符串；WorkBuddy 对空标题已有“未命名任务”兜底。
- `due_date` 使用 `YYYY-MM-DD`，未设置时为 `null`，与 WorkBuddy 兼容。
- `updated_at` 继续使用非负且严格递增的 Unix 秒整数。

本次不改变这些字段的语义，不增加分页、删除同步或负责人自动猜测。

## 修改范围

- `PRD.MD`：补充负责人三字段及安全解析规则。
- `lib/open-task-sync.mjs`：扩展指纹和任务投影。
- `api/[...path].mjs`：让开放接口复用唯一负责人解析结果。
- `test/open-task-sync.test.mjs`、`test/workbuddy-open-api.test.mjs`：覆盖新字段、历史任务和映射空值。
- `docs/workbuddy-integration-api.md`、`PROJECT_ARCHITECTURE.md`：同步接口契约和数据流。

## 验收标准

1. 正常任务同时返回正确的负责人姓名、网站账号和企微 `userid`。
2. 已映射的历史任务仅有负责人姓名时，能够安全返回三个负责人字段。
3. 未映射账号仍返回姓名和网站账号，`assignee_userid` 为 `null`。
4. 重名或无法匹配时不猜测账号和企微 `userid`。
5. 现有任务字段、本周过滤、增量水位和状态回写测试全部通过。
