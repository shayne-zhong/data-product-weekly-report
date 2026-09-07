---
version: "4.0.0"
status: "AI Ready"
lastUpdated: "2026-09-03"
name: "Dongpeng Design System"
description: "东鹏企业级产品的 AI 可执行设计规范。YAML token 为精确值；Markdown 规则定义生成、扩展与验收行为。"
colors:
  brand-red: "#E21413"
  brand-red-subtle: "#FFF5F5"
  brand-blue: "#2563EB"
  on-brand: "#FFFFFF"
  text-primary: "#303133"
  text-secondary: "#606266"
  text-muted: "#6E7076"
  text-disabled: "#C0C4CC"
  canvas: "#F5F6F8"
  workspace-canvas: "#F5F7FA"
  surface: "#FFFFFF"
  surface-subtle: "#FAFAFA"
  border: "#EBEEF5"
  border-strong: "#DCDFE6"
  border-default: "#E5E6EB"
  sidebar-hover: "#F8F9FA"
  tabs-inactive-background: "#E5E8ED"
  disabled-text: "#C0C4CC"
  success: "#15803D"
  success-subtle: "#F0FDF4"
  warning: "#C2410C"
  warning-subtle: "#FFF4E5"
  processing: "#1D4ED8"
  processing-subtle: "#EAF3FF"
  error: "#E21413"
  error-subtle: "#FFF1F1"
  neutral: "#666666"
  neutral-subtle: "#F5F5F5"
  info: "#2563EB"
  info-subtle: "#EFF6FF"
gradients:
  # 品牌主按钮渐变唯一定义处；亮端 #C94A4D 保证 14px 白字在渐变全程 ≥4.5:1。
  brand-red-gradient:
    angle: "148.66deg"
    start: "#C94A4D"
    end: "#E21413"
    value: "linear-gradient(148.66deg, #C94A4D 0%, #E21413 100%)"
  # action-gradient 是组件引用副本，必须与 brand-red-gradient 保持一致；禁止单独修改，改时需同步两处。
  action-gradient:
    angle: "148.66deg"
    start: "#C94A4D"
    end: "#E21413"
    value: "linear-gradient(148.66deg, #C94A4D 0%, #E21413 100%)"
elevation:
  shadow-sm: "0 4px 12px rgba(48, 49, 51, 0.12)"
icons:
  stroke-width: "2px"
  small: "16px"
  medium: "24px"
  default-color: "{colors.text-secondary}"
  hover-color: "{colors.brand-red}"
  active-color: "{colors.brand-red}"
  mapping:
    search: { icon: "Search", size: "16px", position: "input-left" }
    create: { icon: "Plus", size: "16px" }
    import: { icon: "Upload", size: "16px" }
    export: { icon: "Download", size: "16px" }
    filter: { icon: "Filter", size: "16px" }
    setting: { icon: "Settings", size: "16px" }
    user: { icon: "User", size: "16px" }
    title: { size: "24px" }
typography:
  display-lg:
    fontFamily: "HarmonyOS Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.25
  heading-lg:
    fontFamily: "HarmonyOS Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.33
  heading-md:
    fontFamily: "HarmonyOS Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
  heading-sm:
    fontFamily: "HarmonyOS Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.375
  body-md:
    fontFamily: "HarmonyOS Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  body-sm:
    fontFamily: "HarmonyOS Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.54
  label-md:
    fontFamily: "HarmonyOS Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.43
  label-sm:
    fontFamily: "HarmonyOS Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  data-lg:
    fontFamily: "HarmonyOS Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.2
  data-md:
    fontFamily: "HarmonyOS Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
  data-table:
    fontFamily: "HarmonyOS Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
    textAlign: "right"
rounded:
  none: "0px"
  sm: "4px"
  md: "8px"
  full: "9999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "40px"
layout:
  desktop-header-height: "64px"
  desktop-header-padding-inline: "24px"
  desktop-sidebar-width: "216px"
  sidebar-nav-item-height: "40px"
  sidebar-icon-size: "16px"
  sidebar-icon-text-gap: "8px"
  sidebar-section-gap: "24px"
  main-content-width: "fluid"
  main-content-max-width: "none"
  main-content-padding-inline: "24px"
  page-padding-inline: "24px"
  page-section-gap: "24px"
  page-section-gap-lg: "32px"
  card-gap: "16px"
  card-padding: "24px"
  card-padding-compact: "16px"
  form-field-gap: "16px"
  form-section-gap: "24px"
  form-section-gap-lg: "32px"
  table-cell-padding-inline: "12px"
  table-cell-padding-inline-lg: "16px"
  control-height: "36px"
components:
  button-primary:
    background: "{gradients.action-gradient.value}"
    textColor: "{colors.on-brand}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: "36px"
    paddingInline: "16px"
    paddingBlock: "8px"
  button-secondary:
    background: "{colors.surface}"
    border: "1px solid {colors.brand-red}"
    textColor: "{colors.brand-red}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: "36px"
    paddingInline: "16px"
    paddingBlock: "8px"
  button-tertiary:
    background: "{colors.surface}"
    border: "1px solid {colors.border}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: "36px"
    paddingInline: "16px"
    paddingBlock: "8px"
  button-text:
    background: "transparent"
    textColor: "{colors.text-primary}"
    typography: "{typography.label-md}"
    minHeight: "36px"
    paddingInline: "8px"
    paddingBlock: "8px"
  button-text-primary:
    background: "transparent"
    textColor: "{colors.brand-blue}"
    typography: "{typography.label-md}"
    minHeight: "36px"
    paddingInline: "8px"
    paddingBlock: "8px"
  button-text-danger:
    background: "transparent"
    textColor: "{colors.error}"
    typography: "{typography.label-md}"
    minHeight: "36px"
    paddingInline: "8px"
    paddingBlock: "8px"
  button-icon:
    background: "transparent"
    iconColor: "{colors.text-primary}"
    width: "36px"
    height: "36px"
    iconSize: "16px"
    iconTextGap: "8px"
    rounded: "{rounded.sm}"
  button-danger:
    background: "{colors.error-subtle}"
    textColor: "{colors.error}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: "36px"
    paddingInline: "16px"
    paddingBlock: "8px"
  input-default:
    background: "{colors.surface}"
    border: "1px solid {colors.border-default}"
    hoverBorder: "1px solid {colors.border-strong}"
    focusBorder: "1px solid {colors.brand-red}"
    focusTransition: "none"
    outline: "none"
    boxShadow: "none"
    textColor: "{colors.text-primary}"
    placeholderTextColor: "{colors.text-muted}"
    disabledBackground: "{colors.surface-subtle}"
    disabledTextColor: "{colors.disabled-text}"
    errorBorder: "1px solid {colors.error}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    height: "36px"
    paddingInline: "12px"
    paddingBlock: "8px"
  select-default:
    height: "36px"
    rounded: "{rounded.sm}"
    background: "{colors.surface}"
    border: "1px solid {colors.border}"
    focusBorder: "0.5px solid {colors.brand-red}"
    outline: "none"
    boxShadow: "none"
    textColor: "{colors.text-primary}"
    placeholderTextColor: "{colors.text-muted}"
    paddingInline: "12px"
    textAlign: "left"
    arrowInsetInlineEnd: "12px"
    optionSelectedBackground: "{colors.brand-red}"
    optionSelectedTextColor: "{colors.on-brand}"
    optionHoverBackground: "{colors.brand-red-subtle}"
    optionHoverTextColor: "{colors.text-primary}"
    verticalAlign: "middle"
  filter-operator-select:
    width: "96px"
    height: "36px"
    verticalAlign: "middle"
    whiteSpace: "nowrap"
    labelGap: "24px"
    inputGap: "8px"
  date-range-picker:
    height: "36px"
    rounded: "{rounded.sm}"
    background: "{colors.surface}"
    border: "1px solid {colors.border-default}"
    focusBorder: "1px solid {colors.brand-red}"
    outline: "none"
    boxShadow: "none"
    placeholderTextColor: "{colors.text-muted}"
    valueTextColor: "{colors.text-primary}"
    displayFormat: "YYYY-MM-DD 至 YYYY-MM-DD"
    popupBackground: "{colors.surface}"
    popupBorder: "1px solid {colors.border}"
    popupRounded: "{rounded.md}"
    popupShadow: "{elevation.shadow-sm}"
    rangeStartBackground: "{colors.brand-red}"
    rangeEndBackground: "{colors.brand-red}"
    rangeBackground: "{colors.brand-red-subtle}"
    calendarPattern: "shadcn-date-picker-calendar"
  checkbox-default:
    width: "16px"
    height: "16px"
    border: "1px solid {colors.border-default}"
    hoverBorder: "1px solid {colors.brand-red}"
    focusBorder: "1px solid {colors.brand-red}"
    checkedBackground: "{colors.brand-red}"
    checkedBorder: "1px solid {colors.brand-red}"
    checkedIconColor: "{colors.on-brand}"
    outline: "none"
    boxShadow: "none"
  status-tag:
    height: "24px"
    paddingInline: "8px"
    rounded: "{rounded.sm}"
    typography: "{typography.label-sm}"
  status-tag-success:
    background: "{colors.success-subtle}"
    textColor: "{colors.success}"
  status-tag-warning:
    background: "{colors.warning-subtle}"
    textColor: "{colors.warning}"
  status-tag-processing:
    background: "{colors.processing-subtle}"
    textColor: "{colors.processing}"
  status-tag-error:
    background: "{colors.error-subtle}"
    textColor: "{colors.error}"
  status-tag-neutral:
    background: "{colors.neutral-subtle}"
    textColor: "{colors.neutral}"
  tag-success:
    background: "{colors.success-subtle}"
    textColor: "{colors.success}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    padding: "8px"
  alert-warning:
    background: "{colors.warning-subtle}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "16px"
  metric-card:
    background: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "24px"
  table-default:
    container: "{colors.surface}"
    border: "{colors.border}"
    rounded: "{rounded.md}"
    overflowX: "auto"
    cellPaddingInline: "{layout.table-cell-padding-inline}"
    cellPaddingInlineLg: "{layout.table-cell-padding-inline-lg}"
  table-header:
    height: "44px"
    background: "{colors.surface-subtle}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label-md}"
    sortIconSize: "16px"
  table-row:
    height: "48px"
    hoverBackground: "{colors.surface-subtle}"
    selectedBackground: "{colors.brand-red-subtle}"
  enterprise-tabs:
    height: "40px"
    activeBackground: "{colors.surface}"
    activeTextColor: "{colors.brand-red}"
    inactiveBackground: "{colors.tabs-inactive-background}"
    inactiveTextColor: "{colors.text-secondary}"
    hoverBackground: "{colors.sidebar-hover}"
  page-container:
    background: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  selection-toolbar:
    height: "48px"
    background: "{colors.surface}"
    borderBottom: "1px solid {colors.border-default}"
  form-default:
    container: "{colors.surface}"
    labelTypography: "{typography.label-md}"
    labelColor: "{colors.text-primary}"
    helpTextTypography: "{typography.body-sm}"
    fieldGap: "{layout.form-field-gap}"
    groupGap: "{layout.form-section-gap}"
    groupGapLg: "{layout.form-section-gap-lg}"
    controlHeight: "{layout.control-height}"
    controlRounded: "{rounded.sm}"
    controlBackground: "{colors.surface}"
    controlBorder: "{colors.border}"
    controlTextColor: "{colors.text-primary}"
    placeholderTextColor: "{colors.text-muted}"
businessStatusMapping:
  rtm-order:
    待提货: "{components.status-tag-warning}"
    待确认: "{components.status-tag-processing}"
    已完成: "{components.status-tag-success}"
    已取消: "{components.status-tag-error}"
    草稿: "{components.status-tag-neutral}"
---

# 东鹏 Design System v4.0.0

## 01 Foundations

### Brand Identity

东鹏产品界面服务于高信息密度的企业业务场景，包括桌面管理后台、RTM 工作台、助销宝移动端与企业汇报页面。

设计气质是专业、可靠、克制、高效。界面通过清晰的信息层级、留白、容器和细分割线组织复杂业务；不依赖装饰性阴影或多余高饱和色制造层级。

`brand-red` 是东鹏品牌识别色，用于：东鹏 Logo、品牌文字、当前选中状态和关键强调信息；它同时是企业后台主按钮品牌渐变的结束色，不作为大面积主按钮的单色背景。

全局规则优先于业务规则。RTM、助销宝、PPT 等业务系统只能补充业务模式，不得覆盖本文件的品牌、颜色、字体、间距、图标与组件语义。

### Token Source

YAML front matter 中的 token 是唯一精确值。AI 或前端生成界面时必须先读取 token；不得直接创建近似颜色、字号、间距、圆角、阴影或渐变。

组件只能引用 Foundations token，不得自行定义颜色、圆角、阴影或其近似值；页面只能通过 Component 和 Pattern 组合这些 token。

### Color

#### Brand Red and Gradient

| 角色 | Token | 使用场景 |
| --- | --- | --- |
| 品牌识别 | `brand-red` | Logo、品牌文字、当前选中、关键强调信息 |
| 品牌弱化背景 | `brand-red-subtle` | 左侧导航选中、表格选中状态、次按钮背景、弱品牌区域 |
| 文字主操作 | `brand-blue` | 查看、详情、跳转等 text-button-primary 操作 |
| 主操作渐变 | `action-gradient` | 企业后台大面积主要操作、激活分页按钮；使用既有的 148.66deg 品牌渐变 |
| 主要文字 | `text-primary` | 标题、数值、关键正文 |
| 次级文字 | `text-secondary` | 表单标签、辅助正文 |
| 弱化文字 | `text-muted` | 时间、备注、元信息、占位内容 |
| 页面与容器 | `canvas` / `surface` / `surface-subtle` | 页面底色、卡片、弱化分组 |
| 应用工作区 | `workspace-canvas` | 企业后台 Content Workspace 背景 |
| 侧边导航悬停 | `sidebar-hover` | Sidebar 菜单 hover 背景 |
| 非激活 Tabs | `tabs-inactive-background` | Enterprise Tabs 非当前页面背景 |
| 边界 | `border` / `border-strong` | 分割线、输入边框、明确边界 |
| 状态 | `success` / `warning` / `processing` / `error` / `neutral` / `info` | 成功、待关注、处理中、失败或危险、灰色中性状态，以及普通信息与系统通知 |

禁止重新引入 `primary-hover`、`primary-active` 等全局按钮状态色；按钮的 hover、active、disabled 必须由组件规则表达。

`brand-red-gradient` 是 Foundations/Color 中的主按钮渐变唯一定义，起始色、结束色与角度一律以 YAML `gradients` 为准（角度 `148.66deg`）。`action-gradient` 是该既有渐变在组件中的引用副本 token；不得新建其他红色渐变。

#### Semantic Colors

- `brand-red` 用于东鹏 Logo、品牌文字、当前选中状态与关键强调；它不代表错误。
- `error` 用于表单校验失败、系统错误与危险操作；它不代表品牌。
- `brand-red` 与 `error` 当前可以使用相同颜色值 `#E21413`，但二者语义完全不同。AI 不得按颜色值互相替换或混用。
- `info` / `info-subtle` 用于普通信息提示、系统通知与说明状态；不得用于品牌强调。
- `brand-blue` 仅用于 `text-button-primary` 的查看、详情与跳转操作；不代表东鹏品牌识别，也不得替代语义状态色。

#### Status Colors

状态颜色必须通过以下 token 引用，禁止 AI 自定义状态颜色。下表只列 token 名，色值一律以 YAML front matter 为准，避免正文与 token 双重维护导致漂移；数值相近的中性灰（`canvas` / `workspace-canvas`、`sidebar-hover` / `surface-subtle`）属刻意保留的分层语义，禁止视为近似色互换。

| 状态 | 文字 Token | 背景 Token |
| --- | --- | --- |
| success | `success` | `success-subtle` |
| warning | `warning` | `warning-subtle` |
| processing | `processing` | `processing-subtle` |
| error | `error` | `error-subtle` |
| neutral | `neutral` | `neutral-subtle` |

### Accessibility and Contrast

本设计系统遵循 WCAG 2.2 AA：

- 常规文字（未达大字号阈值的 14px / 13px / 12px 文字）与背景对比度必须 ≥ `4.5:1`；大字号文字（≥24px，或 ≥18.66px 且 bold）与图形、UI 组件边界 ≥ `3:1`。
- 白色 `on-brand` 只允许用于与白色对比 ≥4.5:1 的填充之上。`button-primary` 的品牌渐变两端均已按此校准（亮端 `#C94A4D`、深端 `#E21413`），保证 14px 白字全程达标；禁止在 `#F96766` 一类浅红底上放置白色常规文字，也禁止把"字重、字高、内边距"当作替代对比度的理由——它们不改变对比度数值。
- `brand-blue` 只用于常规字号查看/跳转文字并必须 ≥4.5:1；相关文字不得缩到 12px 以下再依赖颜色区分。
- 状态标签（`status-tag-*`，label-sm 12px）属于常规文字，其前景色必须 ≥4.5:1；状态不得以颜色为唯一表达，必须叠加文字或图标。
- hover / active / focus 必须成对定义前景与背景；状态切换后文字与背景的对比度不得低于默认态，仅 disabled 允许降低（下限 ≥3:1）。
- 所有可交互元素必须有可见的键盘焦点：
  - Input / Select / DatePicker / Checkbox 沿用既有约定：以单一 `brand-red` 边框作为焦点指示，focus 时不叠加 outline / box-shadow。
  - Text Button、Icon Button、Tabs、链接、菜单项等非表单控件必须通过 `:focus-visible` 提供可见焦点环（如 `2px solid brand-red` + `2px` offset）；禁止删除默认 outline 后不提供替代焦点指示。
- 触控目标：移动端最小 `44px × 44px`；桌面控件高度至少 `36px`。

### Typography

- 字体优先加载 `HarmonyOS Sans SC`；不可用时必须按 `Microsoft YaHei`、`PingFang SC`、系统无衬线字体的既定顺序回退。AI 不得自行替换字体。
- 页面标题使用 `heading-lg`；页面模块、卡片和内容分组标题使用 `heading-md`；局部或紧凑模块标题使用 `heading-sm`。
- 常规正文使用 `body-md`；紧凑列表、表格说明和元信息使用 `body-sm`。
- 控件文字使用 `label-md` 或 `label-sm`。
- Dashboard KPI 与首页核心指标使用 `data-lg`；其他核心业务数据使用 `data-md`；Table 内金额、数量、比例和编号使用 `data-table`。数值应统一对齐，单位弱于数值。
- 单一桌面页面默认不超过三种字号和三种字重。

#### Typography Semantics

- `display-lg` 仅用于欢迎页标题和独立大标题；禁止用于 Dashboard 指标卡、表格和普通模块标题。
- `heading-md` 用于页面模块标题、卡片标题和内容分组标题；禁止用于金额、数量和业务指标。
- `data-md` 用于数量、金额、百分比和核心业务数据；禁止用于普通标题。
- `data-table` 用于 Table 内金额、数量、比例和编号，使用 14px、400 字重并默认右对齐；禁止在 Table 单元格中使用 `data-lg`。
- `data-lg` 仅用于 Dashboard KPI 与首页核心指标，禁止用于 Table 单元格。

#### Numeric and Data Table

- 金额、数量和比例必须使用 `data-*` token。
- 表格、列表和数据卡片中的数字优先右对齐。
- 数字展示使用 tabular numerals，保持同类数据宽度一致。
- Table 内的金额、数量、比例和编号默认使用 `data-table`。

#### Presentation Boundary

- PPT 使用独立的演示字体规范，不直接复用后台 UI 字体层级。
- 本文的 UI Typography 仅适用于 Web、后台和移动业务系统。

### Radius

- 常规按钮、输入框、紧凑容器使用 `rounded.sm`（4px）。
- 卡片、独立信息模块使用 `rounded.md`（8px）。
- 头像、状态点、圆形图标按钮使用 `rounded.full`。
- 禁止在同一界面混用无语义的圆角；桌面后台禁止大面积胶囊化容器。

### Shadow

- Card 默认不使用明显阴影；通过 `canvas`、`surface`、间距和细分割线建立层级。
- Dropdown、Date Range Picker Popup、菜单与弹窗使用 `elevation.shadow-sm`；不得自行定义阴影值。
- 阴影仅用于悬浮层与临时浮起对象，禁止用于常规输入框、按钮 focus 或大面积卡片装饰。

### Layout and Spacing

#### Desktop Shell

| 规则 | 值 |
| --- | --- |
| 顶部站点栏 | 64px |
| 左侧导航 | 216px |
| 主内容宽度 | fluid（无最大宽度） |
| 通用控件高度 | 36px |
| 最小间距单位 | 4px |

#### Spacing

- 页面左右边距使用 `24px`。
- 页面模块之间使用 `24px`；需要更明显分组时使用 `32px`。
- 卡片之间使用 `16px`；需要更明显分组时使用 `24px`。
- 卡片内部默认使用 `24px`；高密度场景使用 `16px`。
- 表单字段之间使用 `16px`；表单分组之间使用 `24px`，需要更明显分组时使用 `32px`。
- 表格单元格水平 padding 使用 `12px`；信息较宽松时使用 `16px`。

#### Header

- Header 高度固定为 `64px`，包含 Logo 区域、平台导航和用户区域。
- Header 默认左右 padding 为 `24px`。

#### Sidebar

- Sidebar 宽度固定为 `216px`。
- 导航项高度为 `40px`；图标为 `16px`；图标与文字间距为 `8px`。
- 导航分组之间的间距为 `24px`。

#### Enterprise Backend Layout

- Sidebar 宽度固定为 `216px`，Header 高度固定为 `64px`。
- Main Content 使用 fluid 宽度，不设置全局 max-width；页面左右 padding 为 `24px`。
- 小于 `1024px` 时优先减少页面 padding；不得随意改变复杂后台布局。

- 桌面后台优先保留多列信息密度。
- 页面使用 `canvas`，主要模块使用 `surface`，弱化分组使用 `surface-subtle`。
- 模块内边距默认使用 16px 或 24px；同层级模块必须使用一致间距。
- 信息层级顺序：背景差异 → 容器 → 留白 → 分割线 → 轻阴影。
- 默认不使用明显阴影；仅浮层、菜单、弹窗、拖拽对象可使用轻阴影。
- 1024px 以下优先缩减边距、文本截断或横向滚动，不将复杂后台任意改为移动端单列。

### Enterprise Layout Foundation

企业后台固定由 **App Header → Sidebar Navigation → Content Workspace** 组成；三者是东鹏 RTM 后台的应用基础，不得按普通单页后台处理。

#### Application Header

- Header 高度固定为 `64px`，必须包含东鹏品牌 Logo、一级平台导航、搜索和用户信息。
- Logo 必须使用正式品牌资产或企业图标库资产；禁止使用文字替代 Logo，也不得删除品牌区域。
- 禁止 AI 自动生成 Logo、使用占位 Logo 或自行绘制近似品牌标识；没有正式资源时必须保留 Logo slot，等待正式资产接入。
- Logo Asset Protection：禁止修改正式 Logo 的比例、颜色、留白关系或品牌构图；禁止使用近似品牌标识。没有正式资源时必须保留 Logo Slot，不得自行创建替代方案。

#### Sidebar Navigation

- Sidebar 宽度固定为 `216px`，Default 背景透明。
- 菜单 hover 使用 `sidebar-hover`；当前 active 使用 `brand-red-subtle` 背景、`brand-red` 文字，并带有 `brand-red` active indicator。
- hover 与 active 必须有清晰区别；禁止使用纯红大面积背景。

#### Content Workspace

- Content Workspace 使用 `workspace-canvas` 背景；主内容区域保持 fluid，不设置全局最大宽度。
- Page Card 使用 `surface`（白色）背景和 `rounded.md`（8px）圆角。

### Enterprise Page Container

- 企业后台页面必须使用 `workspace-canvas` → 白色 Page Container 的两层结构；禁止将 Header、Filter、Toolbar、Table 或 Pagination 直接铺在灰色 canvas 上。
- Page Container 使用 `surface` 背景、`rounded.md`（8px）圆角和 `spacing.lg`（24px）内边距。
- Page Container 必须承载 Page Header、Filter、Toolbar、Table 与 Pagination；内部区域只能引用既有 Foundation token。
- 机器读取时必须引用 `components.page-container`；禁止透明内容区域、灰色 canvas 直接作为页面内容或无 Card 容器布局。

#### Mobile Rules

- 移动端不直接复用桌面后台布局。
- 小屏页面保留底部主操作、清晰筛选入口和可点击的状态反馈。
- 复杂数据表格在移动端应转换为信息卡片、详情页或可横向滚动区域。
- 移动端业务组件可以提高触达面积，但必须继承品牌、字体和状态语义。
- 断点策略：`≥1024px` 使用桌面布局；`768–1023px` 保留侧栏语义，可收敛为图标态或顶部 Tabs；`<768px` 侧栏改为抽屉或底部主导航，主操作固定在底部操作区。
- 触控目标最小 `44px`；36px 桌面控件与 4px 圆角 token 不直接约束移动触控主操作，触达面积可放大，但品牌、字体与状态语义必须继承。
- 页面不得整体横向滚动：复杂表格在窄屏改为信息卡片、详情页或容器内可横向滚动区域，并提供可滑动提示。

## 02 Components

所有交互组件必须具备默认、hover、active、focus、disabled 与适用的错误/选中状态。状态变化不得只依赖颜色，必须保留文字、图标、边框或结构反馈。

### Button

- 主按钮使用 `button-primary`，背景固定引用 `action-gradient`（即 YAML `gradients.brand-red-gradient` 的既有值，148.66deg 品牌红渐变），文字为白色，承担高视觉权重的主要行动。
- `button-primary` 仅用于创建、新增、查询、提交、保存、确认，以及页面唯一的主要行动。
- 创建订单、查询、保存、提交、确认和当前分页 active 状态等大面积主要操作必须引用既有的 `action-gradient`；禁止使用单色 `brand-red`、`#E21413` 单色填充、纯红色填充或其他自定义红色渐变作为背景。
- `button-primary` 必须保证白色文字可读；禁止仅通过调整颜色解决可读性问题，必要时通过字重、按钮高度和内边距保证可访问性。
- 所有 Button 必须定义 default、hover、active、focus、disabled、loading 状态。状态变化不能只依赖颜色，必须结合透明度、边框、图标或文本状态表达。
- 主按钮 hover、active、disabled 由组件自身通过透明度、边界或动效表达；不得新增全局 hover 色 token。
- 每个操作区域默认只允许一个主按钮。
- 次按钮使用 `button-secondary`：白色背景、`brand-red` 边框和 `brand-red` 文字，用于导入、导出、重置等次要操作。
- `button-text` 不使用背景色，使用 `text-primary`，仅用于取消、重置和其他辅助操作；不得作为主要行动，且必须支持 hover、focus、disabled 状态。
- Neutral Text Button Rules：`button-text` 是纯文字弱化按钮，无 Icon、border 或 background，文字颜色使用 `text-primary`（以 YAML `components.button-text.textColor` 为准，禁止改用 `text-secondary`）。仅用于取消、返回、重置、取消选择、关闭等辅助操作。
- 查看、详情、跳转继续使用 `button-text-primary`。AI 不得将 `button-text` 生成为链接风格或带图标按钮，也不得将其提升为 Primary、Secondary、Tertiary 或 Danger 操作。
- `button-text-primary` 使用 `brand-blue`，仅用于查看、详情和跳转；普通查看操作禁止使用 `brand-red`。
- `button-text-danger` 使用 `error`，仅用于删除、作废和危险操作。
- `button-icon` 为 `36px × 36px`，使用 `16px` 图标和 `4px` 圆角。纯图标按钮必须提供可访问名称；不得使用 emoji，优先使用企业图标库，缺少时使用 Lucide。图标与文字组合时，间距为 `8px`。
- `button-danger` 仅用于删除、作废和不可逆操作，必须使用 `error` token；禁止使用 `brand-red` 代替错误语义。
- Button 处于 loading 时必须保持原按钮尺寸、禁止重复点击、显示加载反馈并保留按钮语义；支持 `aria-busy` 或等价语义。
- 禁用状态不可响应点击，且必须保留可识别的禁用反馈。

#### Button Icon Rules

- 具有明确业务含义的按钮必须配合 `icons.small`（16px）图标，图标与文字间距为 `spacing.xs`（8px）。
- 创建使用 Plus；导入使用 Upload；导出使用 Download；自定义使用 Settings；筛选使用 Filter。
- 图标必须来自企业已有 Icon / 品牌资源；没有对应资源时才使用 Lucide，并遵守 Icon System。不得以 emoji、文字或随机 SVG 替代。

#### Button Hierarchy

- Primary Button：创建订单、创建、新增、查询、保存、提交和确认使用 `button-primary`；引用既有品牌渐变与白色文字，具有最高视觉权重。
- Secondary Button：导入、导出、重置使用 `button-secondary`；白色背景、`brand-red` 边框与 `brand-red` 文字。
- Tertiary Button：更多筛选、自定义、高级配置和辅助设置使用 `button-tertiary`，采用灰色 `border`、`text-secondary` 文字和白色背景；不得使用 `brand-red`，不得抢占主操作视觉。
- 层级示例：创建订单 > 导入/导出 > 更多筛选/自定义。
- 禁止将无 Button token、无点击语义或无状态反馈的裸文字作为按钮；查看、详情、跳转使用 `button-text-primary`，危险操作使用 `button-text-danger`。

### Form

- `form-default` 使用 `surface` 容器、`label-md` 字段名称和 `body-sm` 帮助文字；字段间距为 `16px`，分组间距为 `24px`，需要更明显分组时使用 `32px`。
- 默认使用 Vertical Form：桌面后台中的 label 与 input 垂直排列。高密度后台允许使用 Horizontal Form（label 左侧、input 右侧），但同组字段必须保持标签与控件对齐。
- 字段名称使用 `label-md` 和 `text-primary`。必填项使用 `*` 或文字说明；禁止仅通过红色表达必填。
- 复杂业务表单必须按业务语义分组。例如订单表单分为基础信息、客户信息、商品信息和审批信息。
- 提交区域默认右对齐：取消使用 `button-secondary`，提交使用 `button-primary`；禁止多个主按钮。

### Input, Select and Date Picker

- Input、Select 和 DatePicker 统一使用 36px 高度、`rounded.sm`（4px）圆角、`surface` 背景，以及单一 `brand-red` focus 边框（0.5px 或 1px）。
- 标签与控件默认间距 8px。
- 聚焦状态只能通过单一 `brand-red` 边框表达；禁止双边框、outline 或 box-shadow。
- 所有表单控件必须支持 default、hover、focus、disabled、error、success 状态。状态变化不得只依赖颜色，必须结合边框、图标或文本状态表达。
- Error 使用 `error`，且必须包含错误提示文字；success 使用 `success`，且必须包含成功或完成反馈。
- placeholder 与 value 必须使用不同 token：`input-default` 的 placeholder 使用 `text-muted`，value 使用 `text-primary`。

#### Form Alignment Rule

- 所有 Form Control 默认保持左对齐。
- Label、Operator Select、Input 与 Date Picker 属于表单控件，不继承 Table 数字右对齐规则。
- 日期范围选择器必须保持左侧内容对齐；禁止将 Date Picker、Input 或 Select 右对齐。
- Table 中的数据右对齐规则仅适用于 Table Cell，不适用于 Filter Form。

#### Input

- Input、Search Input、Filter Input、Form Input 和 Dialog Input 必须使用 `input-default` token，不能只针对筛选器。
- `input-default` 高度为 `36px`，使用 `surface` 背景、`rounded.sm`（4px）圆角和 `1px solid border-default`。
- default 状态 value 使用 `text-primary`，placeholder 使用弱文本颜色 `text-muted`；hover 使用 `1px solid border-strong`。
- focus 使用 `1px solid brand-red` 单线框，获取焦点必须立即生效；禁止动画延迟或 transition 导致颜色渐变。Input focus 与 Checkbox 边框保持相同视觉重量。正确示例为红色 1px 单线框；禁止 0.5px 边框、红色外发光、2px 边框、outline、box-shadow 或双层边框。
- disabled 使用 `surface-subtle` 背景与 `disabled-text` 文字。
- error 使用 `error` token；禁止使用 `brand-red` 代替错误语义。

##### Search Input

- Search Input 的 Search Icon 必须作为 Input Prefix 存在，遵循 `icons.mapping.search`：16px，位于输入区域左侧。
- 禁止将 Search Icon 独立漂浮在输入框外，或以文字模拟搜索图标。

#### Input Interaction

- Input 状态优先级固定为 focus > hover > default。
- focus 必须立即生效，使用 `1px solid brand-red`；禁止延迟出现、transition 动画、box-shadow、outline 或双边框。
- hover 仅在 Input 未 focus 时生效；Input 进入 focus 后，hover 不得覆盖 focus。

#### Select

- Select 用于后台筛选器和表单 Select，使用 `select-default` token。
- default 状态使用 `1px solid border`；focus 状态使用单一 `0.5px solid brand-red` 边框表达。
- Select 禁止使用 outline、box-shadow 或双重边框。
- Select option 的 selected 状态使用 `brand-red` 背景和白色文字；hover 状态使用 `brand-red-subtle` 背景和 `text-primary` 文字。禁止浏览器默认蓝色选中背景和系统默认高亮颜色；若原生 Select 无法满足，必须使用企业自定义 Select。
- Select 内部左右 padding 为 `12px`，文字区域左对齐；下拉箭头距离右侧边框为 `12px`。
- `filter-operator-select` 用于 `=`、不等于、包含、不包含、为空和不为空等筛选操作符，宽度固定为 `96px`，禁止文字换行，所有中文操作符必须完整展示。
- 筛选条件按 Label → Operator Select → Input 排列：Label 到 Select 间距为 `24px`，Select 到 Input 间距为 `8px`。
- Input 与 Select 高度均为 `36px`，垂直对齐方式为 middle。

#### Date Range Picker

- 日期范围必须使用 `date-range-picker`，禁止使用两个 Input 模拟日期范围。
- 禁止使用普通 DatePicker 模拟范围选择，禁止使用不支持月份切换的日历。
- 输入区域显示格式固定为 `YYYY-MM-DD 至 YYYY-MM-DD`。default 使用 `border-default`；focus 使用单一品牌红边框，禁止双边框与 shadow；placeholder 使用 `text-muted`，value 使用 `text-primary`，已选择日期范围必须持续可见。
- Calendar Popup 必须为独立浮层，使用白色背景、`border`、4px-8px 圆角和 `shadow-sm`；禁止无阴影直接贴页面。
- Calendar Header 必须支持上个月、下个月和当前年月展示（例如“2026年6月”）；年份和月份必须可切换，禁止只能显示月份文字或无法切换年月。
- 日期范围选择必须支持开始日期、结束日期和中间日期范围：selected-start 与 selected-end 使用品牌色背景，range 使用 `brand-red-subtle` 背景。选择后输入框必须显示完整范围。
- Calendar 底部必须提供今天、最近7天、最近30天、本月、上月快捷选项；它们仅作为辅助快速选择，不替代日期选择，点击后自动填充日期范围。
- 日期范围选择遵循 shadcn Date Picker / Calendar 的交互思路：一个触发器配合 Calendar 选择开始和结束日期，并保持 36px 高度与 Input / Select 一致。
- 输入框内容必须左对齐；Calendar Icon 固定在输入区域左侧，日期文本紧随 Icon 展示。
- 禁止将快捷日期（今天、最近7天、本月、上月）显示在 Input Value 区域；快捷日期只能位于 Calendar Popup 底部。
- Calendar Header 使用“2026年6月”格式；年份和月份必须通过 Calendar 内的选择状态可选，选择完成后返回日期选择。
- Calendar 必须展示完整月份日期网格，不能只展示局部日期或快捷选项。

##### Date Range Picker Interaction

Date Range Picker 必须为真实交互组件，不允许只生成视觉展示或静态 Demo。

###### Calendar Navigation

- Calendar Header 固定格式为 `< YYYY年MM月 >`。
- 左箭头切换上一月份，右箭头切换下一月份；禁止静态月份标题。

###### Month / Year Selection

- 年月必须可选择，支持年份选择和月份选择。
- 完成年份或月份选择后，必须返回日期选择视图，并展示所选年月的完整日期网格。

###### Range Selection

- Start Date 使用 `brand-red` 背景；End Date 使用 `brand-red` 背景；Between Dates 使用 `brand-red-subtle` 背景。
- Hover 必须提供与选择状态可区分的 hover background；不得仅依赖文字或边框表达日期范围状态。

###### Shortcut Buttons

- Calendar Popup 底部必须提供今天、最近7天、最近30天、本月、上月。
- 点击快捷按钮必须立即更新输入框日期范围；禁止仅展示按钮而没有实际日期更新。

###### Input Sync

- Calendar 选择结果必须同步至 Input，格式固定为 `YYYY-MM-DD 至 YYYY-MM-DD`。
- AI 生成 Date Range Picker 时必须实现导航、年月选择、范围选择、快捷日期和 Input 同步等交互状态；禁止生成静态 Demo。

### Checkbox

- `checkbox-default` 用于 Table 多选、全选和批量操作，尺寸固定为 `16px × 16px`，默认使用 `1px solid border-default`。
- checked 状态使用 `brand-red` 背景与边框，并使用白色 check 图标；hover 与 focus 使用 `brand-red` 边框。
- Checkbox 禁止双边框和浏览器默认蓝色 focus；必须保留可访问名称与选中状态语义。

### Status Tag

- Status Tag 必须使用语义色：success 为绿色、warning 为橙色、processing 为蓝色、error 为红色、neutral 为灰色。
- 分别使用 `status-tag-success`、`status-tag-warning`、`status-tag-processing`、`status-tag-error`、`status-tag-neutral` token；禁止随机颜色，禁止将 `brand-red` 作为所有状态颜色。
- Tag 高度为 `24px`，水平 padding 为 `8px`，圆角为 `4px`，文字使用 `label-sm`。
- 标签必须包含可读文字，例如“已完成”“待处理”“已逾期”；状态颜色不得替代真实业务状态说明。

#### Business Status Mapping

- RTM 订单状态必须优先使用以下业务映射：待提货使用 warning；待确认使用 processing；已完成使用 success；已取消使用 error；草稿使用 neutral。
- AI 生成业务状态时必须优先使用 `businessStatusMapping.rtm-order`，禁止根据文字含义自行选择颜色。

### Alert

- 提示由图标、标题、说明和可选关闭操作构成。
- 警告提示使用 `warning-subtle`；错误提示使用 `error-subtle`。
- 非阻塞提示可关闭；阻塞性风险必须说明后果和下一步。
- 关闭按钮必须可键盘聚焦且有可访问名称。

### Card and Metric

- 卡片使用 `surface`，默认 8px 圆角；通过容器、留白与边框表达层级。
- 数据卡片内依次呈现：指标名称、核心数值、趋势或辅助说明。
- Dashboard KPI 与首页核心指标使用 `data-lg`；单位和同比环比信息弱于核心数值。
- 趋势颜色必须表达业务语义，不能默认把红色等同于“上涨”或“更好”。

### Table

- `table-default` 使用 `surface` 容器、`border` 边界、`rounded.md` 圆角，并支持水平滚动；默认单元格水平 padding 为 `12px`，信息较宽松时使用 `16px`。
- Table Header 高度为 `44px`，使用 `surface-subtle` 背景、`label-md` 文字和 `text-secondary` 颜色。
- 可排序表头使用 `16px` 排序图标，必须定义 default、ascending、descending 状态，并支持 `aria-sort`。
- 文本列默认左对齐；金额、数量、比例和编号使用 `data-table` 且默认右对齐；日期使用 `body-md`；状态使用 Tag 组件，不得仅用颜色表达状态。
- 长文本必须支持截断、tooltip 或查看详情入口，不能挤压其他业务列。
- 数据行默认高度为 `48px`，必须定义 default、hover、selected、disabled、loading 状态。hover 使用弱化背景；selected 使用 `brand-red-subtle`；disabled 降低透明度且不可仅依靠颜色表达。
- Table 支持单选、多选、全选、半选与批量操作。Checkbox 必须使用 `checkbox-default`，并提供可访问名称与选中状态语义。
- 操作列默认最多展示 2 个直接操作；超过 2 个必须进入更多菜单。删除、作废和不可逆操作必须使用 `button-danger`；禁止堆叠多个品牌红按钮。
- Enterprise Table 默认 Row Height 固定为 48px；禁止为了展示更多数据压缩行高。页面首屏建议展示 8-10 行数据。

#### Empty and Loading

- Empty State 必须包含图标、标题、原因说明和可选的下一步操作。
- Loading State 支持 Skeleton；加载期间必须保持表格结构和行高稳定，禁止页面跳动。

#### Business Mapping

- 订单：金额列使用 `data-table` 并右对齐。
- 合同：状态使用 Tag 组件。
- 客户：客户名称默认左对齐。
- 报表：表格指标数字使用 `data-table`；禁止默认用红色表示增长。

#### Pagination

- 标签页使用清晰当前态：`brand-red` 文字或底边，并保留可读标签。
- 分页必须展示当前页、不可用状态和总量或范围信息。
- 当前分页 active 状态使用 `action-gradient` 与白色文字；禁止使用单色 `brand-red` 或 `#E21413` 背景。

### Icon

#### Icon System

- 图标使用优先级固定为：企业已有 Icon / 品牌资源 → Lucide Icons。一个页面不得混用多个图标库。
- 禁止使用 emoji、文字模拟 icon、随机 SVG、Unicode 图标或手绘近似图形替代正式图标。
- 统一使用 `icons.stroke-width`（2px）描边；Default 使用 `icons.default-color`（`text-secondary`），Hover 与 Active 使用 `icons.hover-color` / `icons.active-color`（`brand-red`）。
- Small 为 `icons.small`（16px），用于 Sidebar 导航、Table 操作、Tag、行内操作与 Input suffix。
- Medium 为 `icons.medium`（24px），用于 Dashboard 卡片、页面标题旁和功能入口。

#### Enterprise Icon Mapping

所有企业后台 icon 必须先匹配 `icons.mapping`：资源优先级为企业已有 icon 资产，其次才是 Lucide Icon；描边固定为 2px，禁止 emoji、文字模拟 icon、随机 SVG 或混用图标库。

| 业务语义 | Mapping | 图标 | 尺寸 | 位置 / 用途 |
| --- | --- | --- | --- | --- |
| 搜索 | `icons.mapping.search` | Search | 16px | Input 左侧 |
| 创建 | `icons.mapping.create` | Plus | 16px | 创建按钮 |
| 导入 | `icons.mapping.import` | Upload | 16px | 导入按钮 |
| 导出 | `icons.mapping.export` | Download | 16px | 导出按钮 |
| 筛选 | `icons.mapping.filter` | Filter | 16px | 筛选入口 |
| 设置 | `icons.mapping.setting` | Settings | 16px | 自定义、设置入口 |
| 用户 | `icons.mapping.user` | User | 16px | Header 用户区域 |
| 标题区 | `icons.mapping.title` | 按场景匹配 | 24px | 页面标题旁 |

#### Icon Usage Boundary

- Icon 不默认出现在 Enterprise Page Header 标题旁。Enterprise List Page、Detail Page 与 Form Page 的 Page Header 默认只使用 Typography。
- 页面标题默认结构为：Title → Description / Metadata。例如“提货订单”下使用“共386条提货记录”。
- 禁止自动生成 `[Icon] 提货订单` 这类普通后台标题；除非业务明确指定，Page Header 禁止生成 Title Icon。
- 24px Icon 仅用于 Dashboard 卡片、Quick Action、功能入口和模块入口。
- AI 不得为了增强视觉层级给普通企业后台页面标题自动添加装饰性 Icon。

## 03 Patterns

### Enterprise Application Shell

所有企业后台页面必须包含 Header、Sidebar 和 Content Area；禁止删除其中任一区域或退化为普通单页 Dashboard。

- Header、Sidebar 与 Content Workspace 必须遵守 `Enterprise Layout Foundation`。
- Content Area 使用 `workspace-canvas`；页面内主要区块使用 `Enterprise Page Container`、`surface`、`rounded.md` 与既有边框 token。

### Enterprise Backend Stable Baseline

企业后台稳定规范基于已验证的 RTM 提货订单页面收敛（自 v3.4.0 起，当前版本 v4.0.0）。企业后台页面必须保持以下结构：Header → Sidebar → Workspace → Page Container → Tabs → Page Header → Filter → Table → Pagination。

- 保持企业后台系统风格、fluid Workspace 与白色 Page Container；不得使用营销官网、实验性布局或任意视觉装饰替代业务信息结构。
- Page Header 禁止添加 Icon；标题仅使用 Typography。侧边栏导航、业务分类和功能入口可按 Icon System 使用 Icon。
- Primary 用于创建订单、查询；Secondary 用于导入、导出；Tertiary 用于自定义、更多筛选；`button-text` 用于取消选择、返回、关闭等辅助操作。
- Table Header 固定 44px，Row 固定 48px；选中行仅使用 `brand-red-subtle`，Selection Toolbar 保持白色普通 Toolbar，禁止整块红色选中区域。
- Date Range Picker 必须支持年/月切换、日期范围选择，以及今天、最近7天、最近30天、本月、上月快捷选择；禁止生成不可操作的假日期组件。
- 稳定版不继续引入实验性视觉规则。任何新规则必须先经过业务页面验证，再作为后续版本扩展。

### Page Tabs

企业后台多页面必须保留 Tabs，用于展示当前工作上下文。例如：首页、订单查询 ×、提货订单 ×。

- Sidebar 的每个可点击菜单项必须对应一个独立 Enterprise Tab；点击菜单时打开新 Tab，已存在时激活原 Tab，不得仅替换当前内容。菜单与 Tab 必须由同一份导航配置生成，禁止分别维护两套路由清单。
- Enterprise Tabs 使用 `enterprise-tabs` token，高度固定为 `40px`，必须支持可关闭的业务页标签。
- active Tab 使用 `surface`（`#FFFFFF`）背景和 `brand-red` 文字；当前页面必须使用 active。
- inactive Tab 使用 `tabs-inactive-background`（`#E5E8ED`）背景和 `text-secondary` 文字；非当前页面必须使用 inactive。
- hover 使用 `sidebar-hover`（`#F8F9FA`）背景，不改变文字的语义层级。
- 禁止使用随机灰色、浏览器默认 Tab 样式，或将 Tabs 被 Page Header、Filter、Toolbar 随机替代或删除。

### UI Layer Semantic Boundary

用于区分不同 UI 层级的职责，避免 AI 混淆组件用途；不同层级不得混用视觉规则。

#### Navigation Layer

包含 Header Platform Navigation、Sidebar Navigation 与 Dashboard Entry。

- 允许使用 Icon；Icon 用于识别入口、分类和功能。
- 必须遵守 Enterprise Icon Mapping、图标资源优先级与尺寸规则。

#### Page Navigation Layer

包含 Enterprise Tabs。

- Tabs 用于页面切换和工作上下文管理。
- 禁止将 Tabs 内容重复转换为 Page Header，或将 Page Header 作为 Tabs 的视觉替代。

#### Page Header Layer

包含 List Page Title、Detail Page Title 与 Form Page Title。

- Page Header 默认禁止 Icon。
- 固定结构为：Title → Description / Metadata。例如“提货订单”下使用“共386条提货记录”。
- 禁止生成“📦 提货订单”这类带装饰性 Icon 的普通后台标题。

#### Content Layer

- 普通模块标题默认禁止装饰 Icon。
- 仅当模块属于 Dashboard Feature Entry 时，才可以按照 Icon System 使用入口图标。

### Enterprise Backend Page Patterns

企业后台页面类型包括 List Page Pattern、Detail Page Pattern、Form Page Pattern 和 Dashboard Page Pattern。AI 生成后台页面时必须先判断页面类型，再调用对应 Pattern；禁止自由组合页面结构。

### Brand Landing Page Pattern

Design System 官网首页属于 Brand Landing Page Pattern，不属于 Enterprise Application Pattern；它与 Enterprise Application Shell 是两个独立 Pattern，不能互相套用密度、容器和结构规则。

- 允许使用 Hero Banner、品牌主视觉、3D 视觉元素、动态动画效果、创意视觉表达与大标题展示。
- 禁止将 Enterprise Backend 的 compact density、后台表格结构或普通 Card 容器强加到 Landing Page。
- 禁止删除已有 Hero 动画，或用普通后台 Card 替代品牌视觉区域。
- Landing Page 的品牌视觉、Hero 构图与动画规则优先于企业后台 Application Shell 规则。

### Dashboard

适用于 RTM 首页、经营看板和数据分析等桌面工作台。

- 容器使用 fluid，网格使用 responsive。
- 固定结构：Welcome Banner → KPI Cards → Quick Actions → Business Alert → Data List / Chart。
- KPI 使用 `data-lg`；普通表格数字使用 `data-table`，禁止表格数字使用大号字体。
- 禁止使用 `1180px` 固定宽度。
- 概览、资金、快捷操作、告警与待办使用清晰的白色模块分组。
- 快捷操作使用 24px 图标和短动宾结构名称，每组默认不超过 6 项。
- 告警必须同时显示严重程度、数量、影响对象和时间。
- 左侧导航为单选导航组；当前项使用 `brand-red-subtle` 和 `brand-red`。

#### Design System Dashboard

适用于 Design Intelligence Platform 管理后台，使用 Enterprise Application Shell、Tabs 与 `page-container`。

- 固定内容为：Design System Health → 指标卡 → 管理入口 → 最近更新时间。
- 必须展示组件数量、覆盖产品数量、AI 生成次数、规范违规数量和最近更新时间。
- 页面必须提供 Token 管理、Component 管理和 AI Skill 管理入口。
- 指标使用 `data-lg` 或 `data-md`，入口使用 `icons.medium`；不得生成营销型 Hero 或脱离 Page Container 的悬浮卡片。
- AI Governance Dashboard 必须展示：Design System Health、Components Count、Covered Products、AI Generation Count、AI Compliance Rate、Design Rule Violations、Latest DESIGN.md Version 与 Last Updated Time。

### Enterprise List Page

适用于订单列表、客户列表、合同列表和报表列表等可检索业务数据。

- 页面结构固定为：Application Shell → Tabs → Page Container → Page Header → Filter Area → Toolbar → Table → Pagination。
- Filter Area 与 Table 必须位于同一白色 Page Container 内；不得脱离 Page Container 直接铺在 `workspace-canvas`。
- Selection Toolbar 在存在可选择记录且已选中至少一项时，位于 Toolbar 与 Table 之间；未选择时隐藏。
- 容器使用 fluid；Table 宽度为 `100%`，table min-width 为 `1200px`；禁止使用 `1180px` 固定宽度。

#### Header

- 页面标题使用 `heading-lg`；标题下方必须使用 `text-secondary` 展示数据数量，例如“共386条提货记录”。
- 按钮区域右侧排列：创建等唯一主要行动使用 `button-primary`；导入、导出等辅助操作使用 `button-secondary` 或适用的低优先级按钮。
- 禁止无业务优先级的按钮混乱排列。

#### Filter

- 筛选区域必须使用 Form Layout，按业务字段分组；禁止页面自行增加筛选样式。
- 筛选条件固定为 Label → Operator Select → Input：Label 到 Operator 间距为 `24px`，Operator 到 Input 间距为 `8px`。
- Filter Operator 使用 `filter-operator-select`，宽度固定 `96px`、高度 `36px`，支持 `=`、不等于、包含、不包含、为空、不为空。
- 查询是主要行动，重置为低优先级行动。

#### Table Selection Rules

- 可选择列表必须在 Header 提供全选 Checkbox，并支持单选、多选和批量操作。
- 选中 Checkbox 使用 `brand-red`；选中行使用 `brand-red-subtle` 背景，且该背景仅作用于被选中的表格行。
- 禁止将 Selection Toolbar 整体渲染为浅红背景、创建大面积红色选中区域，或因选择状态改变 Table Card 结构。
- 默认隐藏 Selection Toolbar；仅当 `selectedCount > 0` 时显示。
- 显示时必须引用 `components.selection-toolbar`：高度 48px、`surface`（白色）背景、底部 `1px solid border-default`，显示“已选择 X 项”、批量导出与取消选择。

#### Table

- Table 容器使用 fluid layout，宽度为 `100%`；Header 高度为 `44px`，Row 高度为 `48px`。
- 数字与编号 Cell 使用 `data-table`，默认右对齐；文本 Cell 保持默认左对齐。
- 状态必须使用 Status Tag；不得以随机颜色或单独文字颜色替代语义状态。
- 行操作数量较多时使用更多菜单，避免每行堆叠多个主按钮。
- 默认操作为查看，必须使用 `button-text-primary`；删除、作废等危险操作必须使用 `button-text-danger`。普通查看禁止使用 `brand-red`。
- 空状态必须解释原因，并在可恢复时提供下一步操作。

#### Pagination

- Pagination 必须包含当前页、总页数、每页数量和总数据量。
- Table Footer 必须包含：全选、每页数量选择器、当前页、总页数与总数据量；默认 page size 为 20。

#### Table Footer Spacing

- Table Footer（全选、显示数量、Pagination）与 Table Body 保持 `spacing.md`（16px）间距。
- Footer 必须与 Table Container 左右边界对齐，内部控件保持垂直居中。
- 禁止 Footer 紧贴 Table 边缘，也禁止因为 Pagination 或全选区域改变 Table Card 结构。

### RTM Order List Template

提货订单必须使用 Enterprise List Page Template，不得删除既有区域或用通用 Ant Design 列表替代。

- Page Header：标题固定为“提货订单”，描述为“共386条提货记录”。
- Action Toolbar 位于右侧：创建订单使用 `button-primary`；导入、导出使用 `button-secondary`；自定义使用 `button-tertiary`。
- Filter Card 必须包含：参考单号、订单编号、创建时间、订单状态和日期范围。参考单号遵守 Label → Operator Select → Input；日期范围使用 `date-range-picker`。
- Table Card 必须支持 checkbox、全选、批量操作、Status Tag 与操作列。
- Footer 必须展示全选、显示数量和 Pagination。

### Detail

适用于订单详情、提货单详情、客户详情和合同详情。

- 固定结构：Page Header → Basic Information Card → Business Information Section → Detail Table → Action Footer。
- Page Header 左侧展示标题与 Status Tag，右侧展示操作按钮：主要操作使用 `button-primary`，普通操作使用 `button-secondary`，危险操作使用 `button-danger`。
- Information Card 必须使用 Card Component；禁止大面积空白和随机布局。
- 字段按 Label + Value 呈现，支持 2 列、3 列或 4 列，并根据页面宽度自适应。
- Action Footer 使用明确的业务优先级组织操作，不得堆叠多个主要操作。

### Analytics

适用于报表和数据分析。

- 容器使用 fluid；图表必须 responsive。

### Form

适用于创建订单、编辑订单、新增客户、审批与配置。

- 固定结构：Page Header → Form Container → Field Group → Submit Footer。
- Form Container 必须使用 Form Component；字段包含 Label、Required Mark 和 Input / Select / DatePicker。
- 默认使用 Vertical Form；复杂企业表单允许使用 Horizontal Form。
- 表单页面允许设置 max-width `1200px`，用于控制编辑内容的阅读与填写宽度。
- 字段以业务语义分组，例如基础信息、收货信息、审批信息。
- 必填项使用文字或星号标识，并提供错误说明。
- Submit Footer 固定在页面底部或表单结束区域；保存使用 `button-primary`，取消使用 `button-secondary`，删除使用 `button-danger`。禁止按钮散落页面。

### Enterprise Density

- 企业后台默认使用 compact density：标题避免过大，数字默认使用 `data-table`，卡片避免过度留白。
- 页面优先级为信息密度 > 装饰效果。
- 禁止营销官网风格、禁止大面积 Hero、禁止随机圆角。

### Mobile Sales

适用于助销宝客户跟进、筛选、录音、失单原因等移动业务。

- 使用移动端顶部标题、状态标签、筛选入口、客户卡片和底部主操作。
- 可选项、置顶、录音和原因选择必须提供选中/未选中状态。
- 选中状态使用 `aria-pressed` 或等价语义，并同步视觉反馈。
- 底部主操作始终可见，避免关键动作被长内容淹没。

## 04 AI Rules

### Token Priority Rules

- 生成顺序与规则优先级固定为：**Foundation → Component → Pattern → Page**。先读取 Foundations token，再选择组件，再套用页面 Pattern，最后组合成页面；低层级不得覆盖高层级规则。
- UI 层级生成优先级固定为：**Navigation Icon → Tabs → Page Header Typography → Content**。不同层级不得复用或混淆对方的图标、标题和入口视觉规则。
- 企业后台页面生成流程固定为：**Brand Identity → Application Shell → Page Template → Pattern → Component → Token**。此流程用于确定页面结构；具体视觉值仍必须引用 Foundations token，不能被页面层重新定义。
- 组件不得自行定义颜色、圆角、阴影、字体或间距；必须引用 Foundations 中已定义的 token。
- 图标必须先读取 `icons` token 与 Icon System；不得自行创建图标资源、描边值或图标颜色。
- 生成页面时必须使用 `spacing` token 与 Layout Spacing Semantic Rules。
- 禁止使用未定义的 padding，禁止随机设置页面间距，也禁止创建新的 spacing token。
- 生成企业后台页面时，Dashboard、List、Analytics 必须使用 fluid 容器；Form 可按需要使用 max-width。
- 禁止默认让所有页面使用 `1180px` 宽度。

### Enterprise Page Generation Rules

1. 先判断页面类型：List、Detail、Form 或 Dashboard。
2. 必须使用对应 Enterprise Backend Page Pattern，并调用已有 Component Rules。
3. 必须遵守 Layout Rules、Spacing Rules、Button Rules、Form Rules、Table Rules 和 Status Rules。
4. 禁止自定义页面结构、随机布局、随机颜色、随机组件尺寸，以及固定 `1180px` 后台宽度。
5. 必须保留企业应用 Shell 的 Logo、Sidebar 和多页面 Tabs；可选择列表必须保留 Table Selection。
6. 禁止将企业后台生成成单页 Dashboard 风格，也禁止以默认 Ant Design 样式覆盖本设计系统的品牌、布局或组件规范。
7. 企业列表页面必须生成 Enterprise Page Container，禁止让 Filter、Toolbar、Table 或 Pagination 直接落在 `workspace-canvas`；Header 必须优先使用正式品牌 Logo 资产。
8. Enterprise Tabs 必须引用 `enterprise-tabs` token；Table Selection 仅高亮选中行，Selection Toolbar 必须保持 `surface` 普通工具栏样式并在未选择时隐藏。

### Table Generation Rules

- 生成表格时必须使用已有 Table token 与 Table Pattern，保持企业后台信息密度。
- 禁止随机设置表格高度、列宽、状态颜色或自定义间距。
- 禁止在表格操作列中堆叠多个主按钮。
- 生成企业后台 Table 时，数字字段默认使用 `data-table`；只有 Dashboard KPI 与首页核心指标才能使用 `data-lg`。

### Enterprise List Page Generation Rules

- 生成企业后台列表页面时，必须使用 fluid container、统一的 List Page Filter Pattern、Table Component、Semantic Status 和 Text Button。
- 禁止使用页面最大宽度 `1180px`、自定义筛选布局、随机颜色或随机按钮样式。

### Form Generation Rules

- 生成表单时必须使用已有 Form Pattern 与 `form-default` token，保持字段对齐。
- 必须自动生成错误状态、loading 状态与校验反馈。
- 禁止随机设置字段间距、自定义输入高度、使用多种按钮颜色，或将品牌红作为普通文本使用。
- 生成后台页面时，所有输入框必须引用 `input-default`；禁止自定义 border、focus 色、圆角或添加阴影。

### Component Generation Rules

- 生成企业后台页面时，Checkbox 必须使用 `checkbox-default` token。
- 状态标签必须使用 Semantic Color Tokens 与对应 semantic status token；禁止随机颜色、浏览器默认颜色，或直接使用 `brand-red` 表示普通状态。
- 查看、详情和跳转必须使用 `button-text-primary`；删除、作废和危险操作必须使用 `button-text-danger` 或 `button-danger`。

### Component Validation Rules

- 页面生成后必须检查：Input 点击后立即出现 `brand-red` 边框。
- Status 必须符合 Business Status Mapping。
- 禁止生成浏览器默认蓝色 focus 或随机状态颜色。
- Date Range Picker 必须检查：支持年月切换、存在快捷日期、展示已选范围、Popup 使用阴影，且未错误生成普通 Input。
- Button 必须检查：存在 Primary / Secondary / Tertiary 三级层级；大面积主要操作和当前分页 active 状态引用既有 `action-gradient`，且未错误使用单色 `brand-red` 为辅助按钮赋予主操作视觉。

### Existing Creative Asset Protection

已有设计资产属于受保护内容。AI 修改页面时，必须优先保留现有品牌视觉资产与已验证创意表达。

- 禁止删除已有动画效果、替换核心视觉主体、重构品牌 Hero 动效、改变品牌主视觉构图，或自动生成新的 Logo / 品牌标识。
- 允许优化文字内容、排版、响应式布局、辅助组件和交互说明，但不得改变受保护资产的核心表达。
- 若修改涉及已有品牌视觉资产、Hero、动画或正式 Logo，AI 必须先明确说明影响范围、保留内容与潜在风险，获得确认后才能执行。
- Brand Landing Page 适用本保护规则；企业后台页面在不触及受保护资产时，按 Enterprise Application Pattern 生成。

### AI Page Generation Validation

生成企业后台页面前，AI 必须完成以下机器可读校验；任一项不通过不得输出为符合本规范的页面：

1. Icon 是否符合 `icons.mapping`、图标资源优先级、16px/24px 尺寸和 2px 描边要求。
2. 是否存在 `components.page-container`，且没有透明内容区域或灰色 canvas 直接承载页面内容。
3. Tabs 是否引用 `components.enterprise-tabs`，并满足 active、inactive、hover 和关闭行为。
4. 可选择表格是否在 `selectedCount > 0` 时才显示 `components.selection-toolbar`，并提供批量导出与取消选择。
5. 页面颜色是否全部引用 `colors`、`gradients`、语义状态 token；不得出现未定义的颜色值。
6. 组件、页面和业务扩展是否仅引用已定义 token；如需新 token，必须先提出并完成 Design System 更新，禁止生成未知 token。
7. Date Range Picker 是否左对齐、使用左侧 Calendar Icon、完整月份网格与 Popup 底部快捷日期，并实现月份导航、年月选择、范围选择和 Input 同步；Search Icon 是否作为 Input Prefix。
8. Enterprise Table 是否保持 48px Row Height、首屏约 8-10 行数据，且 Footer 包含全选、每页数量、当前页、总页数、总数据量与默认 20 条/页。

### Forbidden Behaviors and Color Rules

- 生成界面时必须使用本文件 YAML 中已定义的颜色 token。
- 禁止创建新的颜色值，也禁止使用近似颜色替代已有 token。
- 业务确需新颜色时，必须先提出新增 token，并在确认后才能使用。

1. 先读取 YAML token，再生成任何页面、组件、Figma 设计或前端代码。
2. 先识别场景：桌面后台、移动销售、数据列表、表单、工作台或汇报页面。
3. 先选择已有 Page Pattern；不存在适配模式时才组合基础组件。
4. 所有颜色、字体、圆角、间距和图标尺寸必须从本文件取得。
5. 企业后台大面积主按钮必须优先读取并使用既有 `action-gradient` token；禁止单色 `brand-red`、`#E21413`、纯红色或其他自定义红色渐变背景，辅助按钮必须遵守 Enterprise Button Hierarchy。
6. 品牌红仅用于品牌识别、当前选中和关键强调；不得泛滥为普通操作色。
7. 优先选择企业图标库；无对应图标时才使用 Lucide。
8. 新组件必须说明名称、用途、token、状态、可访问性和响应式行为。
9. 不得引入未经定义的品牌色、渐变色、字体、圆角或任意间距值。
10. 不得将移动端胶囊风格直接迁移至桌面后台，也不得把桌面表格强行压缩为移动单列表格。
11. 不得使用 emoji、文本字符或自绘图形替代正式图标。
12. 不得删除键盘焦点、禁用状态、错误提示、文本状态语义或可访问名称。
13. 生成结果必须检查：主按钮是否唯一、主按钮是否使用渐变、状态是否有文字说明、间距是否遵守 4px 体系、侧边栏是否为 216px。
14. 若需求与本规范冲突，优先遵循本规范；业务确有例外时，必须明确记录为业务级扩展。

## Governance

- 本文件是设计事实源；Figma、CSS、组件代码与页面文档应以它为约束。
- 修改全局 token 前，设计与前端必须共同确认影响范围。
- 新增组件或页面模式后，应将稳定规则回写到本文件。
- 版本号遵循语义化版本：破坏性基础变更升级主版本；新增 token、组件或模式升级次版本；说明修订升级补丁版本。
- 提交前执行 `npx -p @google/design.md designmd lint DESIGN.md`。

### Changelog

#### v4.0.0 — 2026-09-03 可访问性与一致性修订

- 新增 `Accessibility and Contrast` 章节（WCAG 2.2 AA）：常规文字 `4.5:1`、大字号与图形 `3:1`、`:focus-visible` 焦点环、移动端触控 ≥44px、hover/active/focus 对比度不得低于默认态。
- 修正 `button-text` 取值矛盾：统一为 `text-primary`（以 YAML 为准），删除正文中 `text-secondary` 的冲突表述。
- 按 AA 校准色值：`brand-blue` / `info` `#3B82F6 → #2563EB`；`text-muted` `#909399 → #6E7076`；`success` `#16A34A → #15803D`；`warning` `#ED6C02 → #C2410C`；`processing` `#4590E6 → #1D4ED8`。
- 品牌主按钮渐变亮端 `#F96766 → #C94A4D`，保证 14px 白字全程 ≥4.5:1；`action-gradient` 标注为引用副本，禁止单独改值。
- 合并重复 token（破坏性变更）：`border-hover` 并入 `border-strong`、`disabled-bg` 并入 `surface-subtle`；组件与正文引用已同步。
- 收敛色值双源：Status Colors 表与正文括号 hex 改为只引用 token，YAML front matter 为唯一精确值。
- 补充键盘焦点规范与 1024 / 768 移动断点策略。
