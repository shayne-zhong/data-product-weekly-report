# WorkBuddy 仅同步本周任务设计

## 目标

将 `GET /api/open/tasks?updated_since=` 的返回范围收紧为数据产品部当前自然周任务，同时保留现有增量水位、鉴权、字段契约和状态回写行为。

## 本周口径

- 使用北京时间（UTC+8）的周一至周日作为当前周。
- 复用周任务自动结转的 `weeklyRolloverWindow(now).targetWeekId`，避免查询接口与结转任务产生不同周口径。
- 只返回 `task.weekId` 等于当前周 ID 且 `task.openUpdatedAt > updated_since` 的任务。

## 接口行为

- 请求地址、Bearer Token、`updated_since` 参数及响应字段保持不变。
- 返回所有状态的本周任务，包括已完成任务，以便 WorkBuddy 同步状态。
- 上周、下周及其他部门任务不返回。
- 当前周无符合条件任务时返回 `200` 和 `{ "tasks": [] }`。
- `PUT /api/open/tasks/:task_id/status` 保持不变，已有历史企微待办仍可完成回写。

## 周切换边界

进入新一周后，查询接口只返回新周任务。旧周企微待办不会通过本接口收到删除事件；旧待办的关闭或清理由 WorkBuddy 负责，不纳入本次改动。

## 修改范围

- `PRD.MD`：记录本周任务过滤规则。
- `api/[...path].mjs`：复用当前周窗口并增加 `weekId` 条件。
- `test/workbuddy-open-api.test.mjs`：覆盖本周、上周、下周及增量查询。
- `docs/workbuddy-integration-api.md`、`PROJECT_ARCHITECTURE.md`：同步对外契约与架构说明。

## 验证标准

1. 首次查询只返回当前北京时间周的数据产品部任务。
2. 上周、下周和其他部门任务均被排除。
3. 本周任务修改后仍能通过保存的 `updated_at` 水位增量返回。
4. 鉴权、字段集合、排序和状态回写测试保持通过。
5. 相关测试、完整测试、代码检查和生产构建通过。
