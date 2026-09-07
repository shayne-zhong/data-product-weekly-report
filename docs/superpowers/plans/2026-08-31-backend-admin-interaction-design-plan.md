# Backend Admin Interaction Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改部门工作台业务代码、不连接真实 API 的前提下，完成可点击的后台管理中心交互原型及完整交互规范，供用户确认后再制定编码实施计划。

**Architecture:** 设计阶段在独立原型目录中使用模拟数据呈现全局管理员和部门负责人两种视角，覆盖管理概览、组织权限、业务配置、系统安全与运行中心。原型只验证信息架构、页面布局、交互路径、状态反馈和权限可见性；确认门通过前不得修改 `public/`、`api/`、`lib/` 或 `test/`。

**Tech Stack:** 独立 HTML/CSS/JavaScript 交互原型、Markdown 交互规范、模拟 JSON 数据；不安装依赖，不调用真实服务。

---

## 范围与确认门

本计划只交付交互设计，不实施产品功能。原型可点击但属于设计资产，不写入业务仓库入口、不复用真实管理员凭证、不读取或写入生产数据。

确认门包括：

1. 用户确认总体信息架构和两类角色视角。
2. 用户确认管理概览、组织权限、配置、运行与审计页面。
3. 用户确认保存、确认、异常、无权限和下钻交互。
4. 用户明确回复可以进入编码计划后，才创建后续实现计划。

## 设计资产结构

**Create:**

- `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/index.html`：可点击原型入口，仅包含设计模拟。
- `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/styles.css`：设计令牌、布局、组件和状态样式。
- `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/app.js`：角色切换、页面导航、筛选、弹层和状态演示；不得发起网络请求。
- `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/mock-data.js`：匿名模拟部门、成员、任务、总结、定时任务与审计数据。
- `docs/superpowers/designs/2026-08-31-backend-admin-interaction-spec.md`：页面清单、交互规则、角色差异、状态矩阵与确认记录。

**Must not modify before approval:**

- `public/index.html`
- `api/[...path].mjs`
- `lib/**`
- `test/**`

### Task 1: 建立交互设计基线

**Files:**

- Read: `docs/superpowers/specs/2026-08-31-backend-admin-center-design.md`
- Create: `docs/superpowers/designs/2026-08-31-backend-admin-interaction-spec.md`

- [ ] **Step 1: 固定设计原则**

  在交互规范中记录四条不可变原则：待处理事项优先、角色范围显性展示、高风险操作独立确认、每个页面独立保存。

- [ ] **Step 2: 固定页面清单**

  记录九个评审页面：全局管理概览、部门管理概览、部门管理、成员管理、角色与负责范围、工作模块、业务配置、系统与安全、运行中心与操作审计。

- [ ] **Step 3: 固定演示数据口径**

  明确所有数值均为匿名模拟数据；任务完成率的分母为零时显示“—”；异常数量只计算当前角色授权范围。

- [ ] **Step 4: 记录原型边界**

  明确原型不得包含网络请求、真实密码、真实 API 密钥、真实员工信息、持久化写入和产品代码复用。

- [ ] **Step 5: 校验设计基线**

  对照产品设计文档的目标、非目标、角色矩阵、指标口径和验收标准，确保九个页面均有明确评审目的。

### Task 2: 设计后台框架与角色视角

**Files:**

- Read: `public/index.html` 中现有颜色变量、按钮、面板和导航样式片段
- Create: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/index.html`
- Create: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/styles.css`
- Create: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/app.js`
- Create: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/mock-data.js`
- Modify: `docs/superpowers/designs/2026-08-31-backend-admin-interaction-spec.md`

- [ ] **Step 1: 建立整体框架**

  原型包含顶部品牌区、当前角色、当前部门范围、返回工作台入口、左侧职责导航、页面标题区和主内容区。

- [ ] **Step 2: 固定视觉与密度基线**

  延续现有工作台的主色、字体和圆角语言，采用中等密度 B2B 管理界面：64px 顶栏、224px 侧栏、12px 栅格间距、低对比边框和白色内容面板；不使用装饰性渐变、霓虹色和大面积插画。

- [ ] **Step 3: 建立职责导航**

  左侧导航固定为管理概览、组织与权限、业务配置、系统与安全、运行中心；只在有授权范围的异常项上显示数字徽标。

- [ ] **Step 4: 建立角色切换器**

  原型顶部提供“全局管理员 / 部门负责人”演示切换。全局管理员可切换全部部门或指定部门；部门负责人固定为数据产品部，不显示全局范围选择器。

- [ ] **Step 5: 验证角色菜单**

  全局管理员显示全部导航；部门负责人只显示管理概览、组织与权限中的成员及工作模块、系统与安全中的本部门审计，不显示部门维护、AI、登录策略、归档规则和运行中心。

- [ ] **Step 6: 记录框架规则**

  在交互规范中写明页面标题格式“页面名称｜当前范围”、返回工作台恢复原业务上下文、导航徽标按授权范围计算。

### Task 3: 设计管理概览与异常下钻

**Files:**

- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/index.html`
- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/styles.css`
- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/app.js`
- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/mock-data.js`
- Modify: `docs/superpowers/designs/2026-08-31-backend-admin-interaction-spec.md`

- [ ] **Step 1: 设计范围与周期控制**

  顶部提供部门范围、本周/本月/本季度、最后更新时间和刷新操作；切换后同步更新卡片、异常和下钻参数。

- [ ] **Step 2: 设计待处理事项**

  首屏按运行失败、组织权限异常、业务数据异常、提醒排序，展示影响范围、发现时间、说明和“去处理”。

- [ ] **Step 3: 设计核心概况**

  依次展示任务与总结、组织概况、系统健康和 AI 状态；卡片提供口径说明，分母为零时显示“—”。

- [ ] **Step 4: 设计下钻行为**

  点击指标或异常后进入对应原型页面，并在标题下显示已继承的部门、周期和状态筛选标签；允许一键清除继承筛选。

- [ ] **Step 5: 验证两类视角**

  全局管理员可查看全部部门和指定部门；部门负责人只显示本部门指标，且不出现 AI、登录策略或全局运行操作。

### Task 4: 设计组织与权限页面

**Files:**

- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/index.html`
- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/styles.css`
- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/app.js`
- Modify: `docs/superpowers/designs/2026-08-31-backend-admin-interaction-spec.md`

- [ ] **Step 1: 设计部门管理**

  使用状态卡片与列表展示部门名称、负责人、成员数、启用状态和最近修改时间；停用操作显示影响摘要，不提供直接删除。

- [ ] **Step 2: 设计成员管理**

  使用“列表查看 + 右侧详情抽屉”结构；列表支持关键词、部门、角色、启用状态筛选，详情中编辑成员信息、角色和工作模块范围。

- [ ] **Step 3: 设计负责人更换**

  更换部门负责人使用独立对话框，同时选择新负责人和原负责人的新角色；确认前显示权限变化摘要。

- [ ] **Step 4: 设计角色保护反馈**

  演示模块负责人未关联工作模块、仍为部门负责人的账号尝试停用、跨部门操作三类阻断反馈。

- [ ] **Step 5: 设计工作模块管理**

  合并原全局和部门入口；全局管理员先选部门，部门负责人固定本部门；新增、改名和停用均在当前部门范围内完成。

### Task 5: 设计配置、安全与审计页面

**Files:**

- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/index.html`
- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/styles.css`
- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/app.js`
- Modify: `docs/superpowers/designs/2026-08-31-backend-admin-interaction-spec.md`

- [ ] **Step 1: 拆分业务配置**

  将工作模块、总结归档规则和 AI 服务拆成独立页面；每页只出现自己的保存操作和修改状态。

- [ ] **Step 2: 设计 AI 服务交互**

  展示供应商、模型、启用状态、密钥是否已配置、最近测试结果；配置或清除密钥使用独立确认，不显示完整密钥。

- [ ] **Step 3: 设计系统与安全**

  登录策略单独保存；操作审计支持部门、操作者、操作类型、结果和日期筛选。

- [ ] **Step 4: 设计未保存保护**

  修改后显示“有未保存内容”；切换页面弹出“保存并离开 / 放弃修改 / 继续编辑”，保存失败时保留输入。

- [ ] **Step 5: 设计高风险操作确认**

  密码重置、账号停用、负责人更换、密钥清除分别展示操作对象、影响和不可见敏感字段，确认按钮使用明确动作名称。

### Task 6: 设计运行中心

**Files:**

- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/index.html`
- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/styles.css`
- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/app.js`
- Modify: `docs/superpowers/designs/2026-08-31-backend-admin-interaction-spec.md`

- [ ] **Step 1: 设计任务状态**

  分开展示计划状态和执行状态；执行状态使用从未执行、执行中、成功、失败四种统一视觉语义。

- [ ] **Step 2: 设计执行记录**

  展示执行来源、开始与完成时间、源周期、目标周期、检查范围、成功、跳过、失败数量和安全错误摘要。

- [ ] **Step 3: 设计检查并补跑**

  操作名称固定为“检查并补跑”；确认文案说明只处理已经到期但尚未完成的内容，不重复创建、不提前归档。

- [ ] **Step 4: 设计进行中反馈**

  点击后禁用按钮，显示进行状态；刷新页面后原型从模拟服务端状态恢复执行中或完成结果，不展示无限重试。

- [ ] **Step 5: 验证角色隔离**

  切换到部门负责人时，运行中心入口、异常徽标和相关下钻全部不可见。

### Task 7: 补齐页面状态与可用性

**Files:**

- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/index.html`
- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/styles.css`
- Modify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/app.js`
- Modify: `docs/superpowers/designs/2026-08-31-backend-admin-interaction-spec.md`

- [ ] **Step 1: 建立状态演示器**

  原型提供仅供评审的状态切换，逐页演示加载中、空数据、无匹配结果、无权限、加载失败和正常状态。

- [ ] **Step 2: 校验键盘与焦点**

  导航、筛选、按钮、抽屉和对话框均可通过键盘到达；打开弹层后焦点进入弹层，关闭后返回触发按钮。

- [ ] **Step 3: 校验文案与危险层级**

  普通保存、高风险确认、阻断错误和系统失败使用不同文案与视觉层级，不以颜色作为唯一状态信号。

- [ ] **Step 4: 校验桌面适配**

  以 1440×900 为主要评审尺寸，并验证 1280×720 下导航、表格、抽屉和对话框不遮挡关键操作；首版不设计移动端后台。

- [ ] **Step 5: 更新状态矩阵**

  在交互规范中按页面列出正常、加载、空、错误、无权限、未保存和高风险确认状态，记录触发条件与恢复动作。

### Task 8: 形成一次性评审包

**Files:**

- Modify: `docs/superpowers/designs/2026-08-31-backend-admin-interaction-spec.md`
- Verify: `C:/Users/apple/.codex/visualizations/2026/08/31/01a05577-0c9c-7e41-bc80-b2fce0399f2a/admin-center-prototype/index.html`

- [ ] **Step 1: 按固定路径走查**

  依次演示：全局概览发现异常 → 下钻成员 → 修正角色范围 → 返回概览；运行失败 → 查看记录 → 检查并补跑；配置修改 → 离开提醒 → 保存失败后重试。

- [ ] **Step 2: 对照角色矩阵走查**

  切换部门负责人，确认只能看到本部门概览、成员、工作模块和本部门审计，所有全局配置和运维入口均不可达。

- [ ] **Step 3: 对照设计验收标准**

  逐条核对产品设计文档第 12 节的 12 项验收标准，并在交互规范中标记“原型已覆盖”或“编码阶段验证”。

- [ ] **Step 4: 生成评审清单**

  用户一次性确认五项：信息架构、角色视角、看板口径、关键交互、视觉与可用性；记录修改意见和最终结论。

- [ ] **Step 5: 停在确认门**

  未得到“页面与交互确认，可以进入编码计划”的明确回复前，不读取更多实现文件、不创建编码计划、不修改业务代码。

### Task 9: 确认后转入编码计划

**Files:**

- Read: `PROJECT_ARCHITECTURE.md`
- Read: `PRD.MD`
- Read: `docs/superpowers/specs/2026-08-31-backend-admin-center-design.md`
- Read: `docs/superpowers/designs/2026-08-31-backend-admin-interaction-spec.md`
- Create after approval: `docs/superpowers/plans/2026-08-31-backend-admin-center-implementation.md`

- [ ] **Step 1: 获取明确批准**

  只有用户明确确认页面与交互后，才开始本任务。

- [ ] **Step 2: 定向读取实现入口**

  按架构文档和已确认页面拆分，分 Session 读取后台 UI、管理 API、领域模块和相邻测试；单个 Session 只处理一个实现目标。

- [ ] **Step 3: 编写 TDD 实施计划**

  将权限、看板聚合、后台框架、组织权限、配置安全、运行中心和审计拆为可独立验证的任务，每项包含失败测试、最小实现、针对性验证和独立提交。

- [ ] **Step 4: 再次请求执行授权**

  提交编码实施计划供用户审阅；未获批准前不执行任何生产代码修改。

## 设计阶段完成标准

- 可点击原型覆盖九个评审页面和两类角色视角。
- 所有导航、筛选、下钻、抽屉、确认框和状态反馈可演示。
- 交互规范与产品设计中的信息架构、权限和指标口径一致。
- 原型目录不存在网络请求、真实数据和业务代码依赖。
- `public/`、`api/`、`lib/`、`test/` 在设计阶段保持不变。
- 用户完成一次性页面评审并明确决定是否进入编码计划。
