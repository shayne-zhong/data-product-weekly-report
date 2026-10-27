import { parseDashboardFile } from "./dashboard-import.js";

const $ = id => document.getElementById(id);
const channel = "department-dashboard-v1";
const pending = new Map();
const colors = ["#5c83df", "#1aa2a0", "#8376d8", "#e7a967", "#df6879", "#8d9cae"];
const dimensionNames = ["完整性", "准确性", "一致性", "及时性", "唯一性", "有效性"];
const state = { data: null, selectedMetric: "report_visits", search: "", page: 1, error: "", preview: null, drawerFocus: null, importGeneration: 0 };
const labels = { available: "已获取", partial: "部分覆盖", stale: "已过期", missing: "未获取", not_applicable: "不适用" };
const names = { report_visits: "报表访问次数", data_ai_calls: "数据AI调用次数", report_count: "BI报表数量", report_active_rate: "报表活跃率", business_users: "业务有效用户数", data_coverage: "数据覆盖率", metric_count: "企业指标总数", warehouse_table_count: "数仓有效表数", service_api_count: "数据服务接口", quality_pass_rate: "六性质量通过率", token_total: "Token消耗", token_input: "输入Token", token_output: "输出Token", ai_app_count: "已上线AI应用", ai_active_app_count: "活跃AI应用", ai_talent_count: "已评估AI人才", hr_employees: "HR在职员工", employee_goal_rate: "员工指标达成", employee_key_task_rate: "重点任务达成" };
const ways = {
  report_visits: "由 BI 平台提供有效访问日志的去重汇总，剔除健康检查与重试。",
  data_ai_calls: "由数据 AI 服务提供成功业务请求统计；网站的周报提炼配额不能替代。",
  report_count: "从 BI 平台已发布且未下线的唯一报表目录取得，不使用工作总结数量。",
  report_active_rate: "同一截止日的近30天活跃报表 / 已发布报表，必须提供分子、分母和比例。",
  business_users: "由业务平台提供截止日有效用户目录去重数；与网站账号、活跃用户、HR员工分开。",
  data_coverage: "通过验收的纳管对象 / 同版规划对象，需要规划清单与验收记录。",
  metric_count: "从已发布、有效的企业指标目录取得，不把工作台目标行数作为指标总数。",
  warehouse_table_count: "接入仓库元数据，统计有效数据表；可附 ODS/DWD/DWS/ADS 分层。",
  service_api_count: "接入服务目录或 API 网关的已发布可用接口，不使用网站自身路由数量。",
  quality_pass_rate: "质量检测结果需包含领域、六性维度、通过量、参检量与检测截止；不由规则数量推断得分。",
  token_total: "网站调用日志与供应商账单去重；外部渠道逐个验证用量获取能力。缺少渠道时只能标为部分覆盖。",
  token_input: "保留供应商输入用量原始口径；缓存属于输入子集时不得重复加总。",
  token_output: "保留输出及推理原始口径，已包含的推理 Token 不重复计入。",
  ai_app_count: "建立唯一应用ID、上线状态、主要领域、主要平台及负责人台账；不按账号或对话计数。",
  ai_active_app_count: "在同一应用目录上定义活跃窗口并取得实际使用记录，不根据已上线状态推断活跃。",
  ai_talent_count: "由确认后的人员能力评估台账取得；分层、领域和人数按当前部门互斥归集，不推断集团总量。",
  hr_employees: "接入 HR 或经负责人确认的在职名册；网站启用账号不能替代。",
  employee_goal_rate: "先明确个人目标、贡献归属和权重，再提供员工账号维度的实际结果与计算分子分母。",
  employee_key_task_rate: "先确认重点定义、期间和跨周结转去重，再提供员工账号维度的完成结果。",
};

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function fmt(value, digits = 1) { return value == null ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits }); }
function when(value) { if (!value || !Number.isFinite(Date.parse(value))) return "未知"; return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
function unit(metric) { return ({ report_visits: "次", data_ai_calls: "次", report_count: "张", business_users: "人", warehouse_table_count: "张表" })[metric.id] || ({ count: "个", tokens: "Token", percent: "%", people: "人" })[metric.unit] || metric.unit || ""; }
function metric(id) { return state.data?.metrics.find(m => m.id === id) || { id, label: names[id], value: null, status: "missing", reason: "尚未接入或读取" }; }
function sourceName(m) { return m?.source?.sourceName || "尚无来源"; }
function statusTag(m) { return `<span class="tag ${m.status === "available" && !state.error ? "green" : m.status === "partial" || m.status === "stale" ? "orange" : "muted"}">${esc(state.error && m.value != null ? "读取失败 · 旧值" : labels[m.status] || m.status)}</span>`; }
function valueClass(m) { return m.value == null || m.status === "stale" || state.error ? "gray-value" : ""; }
function send(body) { if (window.parent !== window) window.parent.postMessage({ channel, ...body }, window.location.origin); }
function request(action, body) {
  if (window.parent === window) return Promise.reject(Error("请从已登录网站的后台首页进入；此页面不自行读取登录凭证。"));
  const id = `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error("请求超时，已保留最近有效值。请刷新后核对；导入可用同一批次重试。")); }, 45000);
    pending.set(id, { resolve, reject, timer });
    send({ type: "request", id, action, ...(action === "load" ? { query: body } : { body }) });
  });
}
function filters() { return { departmentId: $("departmentSelect").value, year: $("yearSelect").value, period: $("periodSelect").value }; }
async function refresh() {
  $("refreshButton").disabled = true;
  try { await request("load", filters()); } catch (error) { showError(error.message); }
  finally { $("refreshButton").disabled = false; }
}
function showError(message) { state.error = message; $("dataError").textContent = message + (state.data ? " 当前显示上次成功读取的范围与旧值。" : " 未知指标保持灰色。"); $("dataError").hidden = false; render(); }
function empty(title, sub = "未获取的数据保留灰色，不以 0 或示例值补齐。") { return `<div class="empty-chart"><strong>${esc(title)}</strong><small>${esc(sub)}</small></div>`; }
function kpi(id, selected = false) {
  const m = metric(id), has = m.value != null;
  const target = m.target == null ? "年度目标未配置" : `年度目标 ${fmt(m.target)} ${unit(m)}`;
  const progress = has && m.target > 0 ? Math.min(100, m.value / m.target * 100) : null;
  return `<button class="card kpi ${selected ? "active" : ""}" data-select-metric="${id}" aria-pressed="${selected}"><div class="status-row"><span class="tiny" style="margin-right:auto">${esc(names[id] || m.label)}</span>${statusTag(m)}</div><div class="metric ${valueClass(m)}">${fmt(m.value)}<small style="font-size:11px;font-weight:400;margin-left:5px">${has ? esc(unit(m)) : ""}</small></div><div class="tiny">${esc(target)}</div><div class="progress">${progress == null ? "" : `<span style="display:block;height:100%;width:${progress}%;background:${m.status === "stale" || state.error ? "#bac2cf" : "#5c83df"}"></span>`}</div><div class="source-line">${esc(sourceName(m))} · ${m.asOf ? esc(when(m.asOf)) : "无统计截止"}</div></button>`;
}
function observationFacts(m, id) {
  return `<dl><dt>指标</dt><dd>${esc(names[id] || m.label || id)}</dd><dt>当前值</dt><dd>${fmt(m.value)} ${m.value == null ? "" : esc(unit(m))}</dd><dt>状态</dt><dd>${esc(labels[m.status] || m.status)}${state.error && m.value != null ? "；刷新失败，保留旧值" : ""}</dd><dt>来源</dt><dd>${esc(sourceName(m))}</dd><dt>方式</dt><dd>${m.source?.mode === "import" ? "人工导入；刷新仅重读网站已保存数据" : "未接入"}</dd><dt>统计范围</dt><dd>${esc(state.data?.context.departmentName || "未知")} · ${esc(state.data?.context.startDate || "未知")} 至 ${esc(state.data?.context.endDate || "未知")}</dd><dt>业务截止</dt><dd>${esc(when(m.asOf))}</dd><dt>入库时间</dt><dd>${esc(when(m.receivedAt))}</dd><dt>覆盖</dt><dd>${m.coverage === "complete" ? "来源声明完整覆盖" : m.coverage === "partial" ? "仅部分覆盖，不能代表部门总量" : "未知"}</dd>${m.numerator == null ? "" : `<dt>计算</dt><dd>${fmt(m.numerator)} / ${fmt(m.denominator)}${m.denominator === 0 ? "（分母为零，不适用）" : ""}</dd>`}<dt>原因 / 边界</dt><dd>${esc(m.reason || "按来源原始统计口径展示，不自动补齐缺口。")}</dd><dt>获取方式</dt><dd>${esc(ways[id] || "请按统一数据契约提供真实来源。")}</dd></dl>`;
}
function openDrawer(title, sub, html) {
  state.drawerFocus = document.activeElement;
  $("drawerTitle").textContent = title; $("drawerSub").textContent = sub; $("drawerBody").innerHTML = html;
  $("drawer").inert = false; $("overlay").classList.add("show"); $("drawer").classList.add("show");
  $("dashboardLayout").inert = true; document.body.style.overflow = "hidden"; $("drawerClose").focus();
}
function closeDrawer() { $("drawer").classList.remove("show"); $("drawer").inert = true; $("overlay").classList.remove("show"); $("dashboardLayout").inert = false; document.body.style.overflow = ""; state.drawerFocus?.focus?.(); state.preview = null; state.importGeneration++; }
function showMetric(id, observation) { const m = observation ? { ...metric(id), ...observation } : metric(id); openDrawer(names[id] || m.label || id, "真实来源、覆盖范围与获取方式", observationFacts(m, id)); }
function renderChart(id, element) {
  const rows = (state.data?.trends[id] || []).filter(r => r.value != null).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  if (rows.length < 2) { $(element).innerHTML = empty(rows.length ? "仅有一条期间记录，暂不形成趋势" : "历史数据尚未采集", rows.length ? `${rows[0].periodStart} 至 ${rows[0].periodEnd}：${fmt(rows[0].value)} ${unit(metric(id))}` : "提供真实分期记录后启用，缺失月份不会补线。"); return; }
  if (rows.some((r, i) => i && r.periodStart <= rows[i - 1].periodEnd)) {
    $(element).innerHTML = `<div class="inline-note">存在重叠的累计 / 单期记录，保留原始期间明细，不连成误导趋势。</div><table class="small-table"><tbody>${rows.map(r => `<tr><td>${esc(r.periodStart)} — ${esc(r.periodEnd)}</td><td>${fmt(r.value)}</td><td>${statusTag(r)}</td></tr>`).join("")}</tbody></table>`; return;
  }
  const W = 640, H = 220, L = 60, R = 20, T = 22, B = 35, max = metric(id).unit === "percent" ? 100 : Math.max(1, ...rows.map(r => r.value)) * 1.12;
  const x = i => L + (W - L - R) * i / (rows.length - 1), y = v => T + (H - T - B) * (1 - v / max);
  let svg = "";
  for (let i = 0; i < 4; i++) { const v = max * i / 3; svg += `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" stroke="#edf1f6"/><text x="${L - 9}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="#91a0b4">${fmt(v, 0)}</text>`; }
  rows.forEach((r, i) => {
    const gray = r.status === "stale" || state.error, color = gray ? "#b6bfcd" : "#5c83df";
    if (i && Date.parse(r.periodStart) - Date.parse(rows[i - 1].periodEnd) === 86400000) svg += `<line x1="${x(i - 1)}" y1="${y(rows[i - 1].value)}" x2="${x(i)}" y2="${y(r.value)}" stroke="${color}" stroke-width="2.5"/>`;
    svg += `<circle cx="${x(i)}" cy="${y(r.value)}" r="3.5" fill="${color}"><title>${esc(r.periodStart)} 至 ${esc(r.periodEnd)}：${fmt(r.value)}</title></circle><text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="9" fill="#91a0b4">${esc(r.periodEnd.slice(5))}</text>`;
  });
  $(element).innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(names[id])}真实期间记录趋势">${svg}</svg><p class="status-note">单位：${esc(unit(metric(id)))}；不连接有缺口的期间，不将部分覆盖当完整总量。</p>`;
}
function distribution(id, dimensionType, element, title) {
  const rows = (state.data?.distributions[id] || []).filter(r => r.dimensionType === dimensionType);
  if (!rows.length) { $(element).innerHTML = empty(title || "分布尚未接入", "没有真实分类明细，不显示模拟比例。"); return; }
  const max = Math.max(1, ...rows.map(r => r.value || 0));
  $(element).innerHTML = rows.map((r, i) => `<div class="distribution-row"><span>${esc(r.dimension)}</span><div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, (r.value || 0) / max * 100))}%;background:${r.status === "stale" || state.error ? "#bec6d2" : colors[i % colors.length]}"></div></div><span class="${valueClass(r)}" style="text-align:right">${fmt(r.value)}</span></div>`).join("") + '<p class="status-note">条长为分类相对量；跨来源或批次不自动计算总体占比。</p>';
}
function renderQuality() {
  const rows = state.data?.distributions.quality_pass_rate || [], domains = [...new Set(rows.map(r => r.dimension.slice(0, r.dimension.lastIndexOf("|"))))];
  $("qualityTable").innerHTML = `<thead><tr><th>业务领域</th>${dimensionNames.map(n => `<th>${n}</th>`).join("")}</tr></thead><tbody>${(domains.length ? domains : ["领域待接入"]).map(domain => `<tr><td>${esc(domain)}</td>${dimensionNames.map(name => {
    const index = rows.findIndex(r => r.dimension === domain + "|" + name), r = rows[index];
    const color = !r || r.value == null || r.status === "stale" || state.error ? "#f1f3f7" : r.status === "partial" ? "#fff3e4" : "#edf6f2";
    return `<td><div style="background:${color};border-radius:6px;padding:10px 5px;color:${!r || r.status === "stale" || state.error ? "#a2aab7" : "#59746c"}"><button class="quality-cell" data-quality-index="${index}" aria-label="${esc(domain + name)}">${r?.value == null ? "—" : fmt(r.value) + "%"}</button></div></td>`;
  }).join("")}</tr>`).join("")}</tbody>`;
}
function renderPeople() {
  const d = state.data, o = d?.operations, members = d?.people || [], hr = metric("hr_employees");
  const summary = [["HR在职员工", fmt(hr.value), hr.value == null ? "权威名册未接入" : sourceName(hr)], ["启用网站账号", o ? fmt(o.activeAccounts) : "—", "网站配置口径"], ["任务记录完成", o ? `${fmt(o.completedTasks)} / ${fmt(o.tasks)}` : "—", "本期所属周记录的当前状态"], ["记录完成率", o?.completionRate == null ? "—" : fmt(o.completionRate) + "%", "不是重点任务或个人KPI"]];
  $("peopleSummary").innerHTML = summary.map((a, i) => `<div style="padding:19px 22px;border-right:1px solid #edf1f6"><span class="tiny">${a[0]}</span><div class="metric ${!o || state.error || i === 0 && (hr.value == null || hr.status === "stale") ? "gray-value" : ""}">${esc(a[1])}</div><span class="tiny">${esc(a[2])}</span></div>`).join("");
  $("taskScope").textContent = o ? o.scopeNote + ` 未归属记录：${o.unassignedTasks} 条。` : "读取后按所属周窗口展示；未获取时不推算人数和完成率。";
  const tasks = members.flatMap(p => p.tasksDetail.map(t => ({ ...t, person: p.name }))), grouped = new Map();
  for (const t of tasks) { const g = grouped.get(t.module || "未分组") || { total: 0, done: 0 }; g.total++; if (t.status === "已完成") g.done++; grouped.set(t.module || "未分组", g); }
  $("teamGroups").innerHTML = grouped.size ? [...grouped].map(([name, g]) => `<div class="distribution-row"><span>${esc(name)}</span><div class="track"><div class="fill" style="width:${g.done / g.total * 100}%;background:${state.error ? "#b9c3d0" : "#5c83df"}"></div></div><span>${g.done} / ${g.total}</span></div>`).join("") : '<div class="empty-people">当前范围没有已归属的任务记录。</div>';
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const risks = tasks.filter(t => t.status === "阻塞" || t.status !== "已完成" && t.dueDate && t.dueDate < today);
  $("peopleRisks").innerHTML = risks.length ? risks.slice(0, 5).map(t => `<div class="risk-item" style="padding:11px 0;border-bottom:1px solid #edf1f6"><div style="font-size:12px;font-weight:600">${esc(t.title)}</div><div class="tiny">${esc(t.person)} · ${esc(t.status)} · 截止 ${esc(t.dueDate || "未填写")}</div>${t.blocker ? `<div class="tiny">阻塞：${esc(t.blocker)}</div>` : ""}</div>`).join("") : '<div class="empty-people">已归属的本期任务未发现阻塞或逾期。</div>';
  renderPeopleRows();
}
function renderPeopleRows() {
  const people = (state.data?.people || []).filter(p => (p.name + p.username + p.team + p.tasksDetail.map(t => t.title).join(" ")).toLowerCase().includes(state.search.toLowerCase()));
  const pages = Math.max(1, Math.ceil(people.length / 10)); state.page = Math.min(state.page, pages);
  $("peopleTbody").innerHTML = people.slice((state.page - 1) * 10, state.page * 10).map(p => `<tr><td><strong>${esc(p.name)}</strong><div class="tiny">${esc(p.username)}</div></td><td>${esc(p.team)}</td><td>${p.completedTasks} / ${p.tasks}</td><td class="${p.keyTaskMetric?.status === "stale" || state.error ? "gray-value" : ""}">${fmt(p.keyTaskRate)}${p.keyTaskRate == null ? "" : "%"}${p.keyTaskMetric ? `<div>${statusTag(p.keyTaskMetric)}</div>` : '<div class="tiny">待确认数据</div>'}</td><td class="${p.kpiMetric?.status === "stale" || state.error ? "gray-value" : ""}">${fmt(p.kpiRate)}${p.kpiRate == null ? "" : "%"}${p.kpiMetric ? `<div>${statusTag(p.kpiMetric)}</div>` : '<div class="tiny">个人目标未接入</div>'}</td><td>${p.blockedTasks || p.overdueTasks ? `<span class="tag orange">阻塞 ${p.blockedTasks} · 逾期 ${p.overdueTasks}</span>` : '<span class="tag">未见记录风险</span>'}</td><td><button data-person="${esc(p.username)}">查看 →</button></td></tr>`).join("") || '<tr><td colspan="7" class="empty-people">没有符合条件的成员。</td></tr>';
  $("peopleCount").textContent = `共 ${people.length} 个启用账号 · 每页10条`;
  $("pageNumber").textContent = `${state.page} / ${pages}`; $("prevPage").disabled = state.page === 1; $("nextPage").disabled = state.page === pages;
}
function personDrawer(username) {
  const p = state.data?.people.find(p => p.username === username); if (!p) return;
  openDrawer(p.name + " · 任务与指标", state.data.context.departmentName + " · 网站启用账号", `<div class="inline-note">任务为当前所选期间所属周的记录状态；AI能力不从任务推断，个人指标仅显示经确认的数据。</div><h4>任务记录 ${p.completedTasks} / ${p.tasks} 已完成</h4><div class="drawer-list">${p.tasksDetail.map(t => `<div class="card"><strong>${esc(t.title)}</strong><div class="tiny">${esc(t.module)} · ${esc(t.status)} · 截止 ${esc(t.dueDate || "未填写")}</div>${t.blocker ? `<p class="status-note">阻塞：${esc(t.blocker)}</p>` : ""}</div>`).join("") || '<p class="status-note">当前期间没有已归属任务。</p>'}</div><h4>个人指标</h4>${p.kpiMetric ? observationFacts({ ...metric("employee_goal_rate"), ...p.kpiMetric }, "employee_goal_rate") : '<p class="status-note">尚无经确认的个人目标达成结果。</p>'}<h4>重点任务</h4>${p.keyTaskMetric ? observationFacts({ ...metric("employee_key_task_rate"), ...p.keyTaskMetric }, "employee_key_task_rate") : '<p class="status-note">重点定义、去重与统计数据待确认。</p>'}`);
}
function renderSources() {
  const d = state.data, sources = d?.sources || [];
  $("sourceCards").innerHTML = `<article class="card"><div class="card-title">网站内部数据</div><div class="source-line">${d ? "已读取授权部门的账号、任务与目标贡献" : "尚未读取"}</div><div class="source-line">网站响应 ${esc(when(d?.fetchedAt))}</div><span class="tag ${d && !state.error ? "green" : "muted"}">${d && !state.error ? "实时读取已保存记录" : "未连接或刷新失败"}</span></article>` + sources.map(s => `<article class="card"><div class="card-title">${esc(s.sourceName)}</div><div class="source-line">业务截止 ${esc(when(s.asOf))}</div><div class="source-line">入库 ${esc(when(s.receivedAt))} · ${s.records} 条观测</div><div class="status-row" style="margin-top:9px"><span class="tag">人工导入</span>${statusTag(s)}</div></article>`).join("");
  $("metricStatusRows").innerHTML = (d?.metrics || Object.keys(names).map(metric)).map(m => `<tr class="source-row"><td>${esc(names[m.id] || m.label)}</td><td>${statusTag(m)}</td><td>${esc(sourceName(m))}</td><td>${esc(when(m.asOf))}</td><td><button data-metric="${esc(m.id)}">查看 →</button></td></tr>`).join("");
  $("importHistory").innerHTML = d?.imports.length ? `<div class="table-shell"><table class="small-table"><thead><tr><th>批次</th><th>来源</th><th>业务截止</th><th>接收时间</th><th>条数 / 版本</th></tr></thead><tbody>${d.imports.slice().reverse().map(i => `<tr><td>${esc(i.batchId)}</td><td>${esc(i.sourceName)}</td><td>${esc(when(i.asOf))}</td><td>${esc(when(i.receivedAt))}</td><td>${i.recordCount} / v${i.revision}</td></tr>`).join("")}</tbody></table></div>` : '<p class="status-note" style="padding-top:15px">暂无导入记录；模板不含任何默认业务数字。</p>';
}
function render() {
  document.body.classList.toggle("read-failed", Boolean(state.error));
  const d = state.data;
  if (d) {
    const c = d.context;
    $("scopeLabel").textContent = c.departmentName; $("pageTitle").textContent = c.departmentName + " · 经营管理总览";
    $("yearEyebrow").textContent = "MANAGEMENT OVERVIEW / " + c.year;
    $("asOf").textContent = "网站响应 " + when(d.fetchedAt);
    $("periodLabel").textContent = "统计期间 " + c.startDate + " 至 " + c.endDate;
    $("departmentSelect").innerHTML = c.departments.map(dep => `<option value="${esc(dep.id)}">${esc(dep.name)}</option>`).join("");
    $("departmentSelect").value = c.departmentId; $("yearSelect").value = String(c.year); $("periodSelect").value = c.period;
    $("talentScope").textContent = c.departmentName + " · 部门范围";
    $("footerTime").textContent = "网站响应 " + when(d.fetchedAt) + " · 数据版本 v" + d.revision;
  }
  const available = d?.metrics.filter(m => m.value != null && m.status === "available").length || 0, limited = d?.metrics.filter(m => m.status === "partial" || m.status === "stale").length || 0;
  $("readiness").innerHTML = [["已获取完整指标", d ? available : "—"], ["部分覆盖 / 过期", d ? limited : "—"], ["已接入外部来源", d ? d.sources.length : "—"], ["网站启用账号", d ? d.operations.activeAccounts : "—"]].map(([label, value]) => `<div><div class="tiny">${label}</div><div class="metric ${!d || state.error ? "gray-value" : ""}">${value}</div></div>`).join("");
  $("dataBoundary").textContent = `真实零值与缺数分别展示。${d ? "当前部门：" + d.context.departmentName + "；网站内部数据已读取，外部数据仍须按来源逐项接入。" : "尚未获取真实业务值。"}`;
  $("riskSummary").textContent = d ? `任务记录：阻塞 ${d.operations.blockedTasks} 条，逾期 ${d.operations.overdueTasks} 条，未归属 ${d.operations.unassignedTasks} 条。缺数不代表业务正常或异常。` : "风险判断只基于已获取的任务记录，不推测未接入的业务表现。";
  $("dataKpis").innerHTML = ["report_visits", "data_ai_calls", "report_count", "report_active_rate", "business_users"].map(id => kpi(id, id === state.selectedMetric)).join("");
  $("metricChartTitle").textContent = (names[state.selectedMetric] || "年度指标") + " · 真实期间记录";
  renderChart(state.selectedMetric, "metricChart");
  $("goalRows").innerHTML = d?.goals.length ? '<p class="status-note">目标文档属于所选年度；当前贡献复用全部已完成关联任务，不按所选期间推算经营实测。</p><div class="annual-goal-list">' + d.goals.map(g => `<div class="annual-goal-item"><strong>${esc(g.title || "未命名目标")}</strong><br>任务贡献 ${fmt(g.current)} ${esc(g.unit)} · 原目标 ${esc(g.annualTarget ?? "未配置")}<br>预计值 ${esc(g.expectedCurrent ?? "未配置")}</div>`).join("") + "</div>" : '<div class="empty-people">当前年度没有可展示的目标文档。</div>';
  const coverage = metric("data_coverage");
  $("coverageRing").innerHTML = `<div class="ring" style="--ring:${coverage.value == null ? 0 : coverage.value};--ringColor:${coverage.status === "stale" || state.error ? "#bdc5d2" : "#10a6a1"}"><div class="ring-body"><strong class="${valueClass(coverage)}" style="font-size:23px">${fmt(coverage.value)}${coverage.value == null ? "" : "%"}</strong><small>已验收覆盖</small></div></div><div>${statusTag(coverage)}<p class="status-note" style="margin-top:10px">${coverage.denominator == null ? "规划与验收清单待接入" : `${fmt(coverage.numerator)} / ${fmt(coverage.denominator)} 个对象`}</p></div>`;
  $("assetKpis").innerHTML = ["metric_count", "warehouse_table_count", "service_api_count"].map(id => kpi(id)).join("");
  const layers = d?.distributions.warehouse_table_count || [];
  $("warehouseLayers").innerHTML = layers.length ? '<p class="module-note">数仓分层：' + layers.map(r => esc(r.dimension) + " " + fmt(r.value)).join(" · ") + "</p>" : '<p class="module-note">数仓分层尚未接入，不预填 ODS / DWD / DWS / ADS 数量。</p>';
  renderQuality();
  $("aiKpis").innerHTML = ["token_total", "token_input", "token_output", "ai_app_count"].map(id => kpi(id)).join("");
  renderChart("token_total", "tokenChart"); distribution("token_total", "domain", "tokenDomains", "领域用量尚未接入"); distribution("ai_app_count", "domain", "appDomains", "应用领域台账尚未接入");
  $("platformRows").innerHTML = '<div class="tiny">应用数量</div><div id="platformAppBars"></div><div class="tiny" style="margin-top:16px">Token用量</div><div id="platformTokenBars"></div>';
  distribution("ai_app_count", "platform", "platformAppBars", "应用平台分类未接入"); distribution("token_total", "platform", "platformTokenBars", "渠道用量未接入");
  const talent = metric("ai_talent_count"); $("talentTotal").innerHTML = `<div class="metric ${valueClass(talent)}">${fmt(talent.value)} <small style="font-size:12px;font-weight:400">${talent.value == null ? "" : "人"}</small></div>${statusTag(talent)}`;
  distribution("ai_talent_count", "talent_level", "talentLevels", "能力评估与层级待接入"); distribution("ai_talent_count", "domain", "talentDomains", "人才领域分布待接入");
  renderPeople(); renderSources();
}

function importDrawer() {
  if (!state.data) { showError("请先成功读取有权访问的部门，再导入数据。"); return; }
  state.preview = null;
  state.importGeneration++;
  openDrawer("导入数据", state.data.context.departmentName + " · 先预检，再确认入库", `<p class="status-note">文件使用统一供数标准。请填入实际部门、来源、统计期间与业务截止；导入只更新驾驶舱观测，不修改任务、成员或原年度目标。</p><div class="drawer-actions"><a class="btn" href="/dashboard-templates/blank.csv" download>下载 CSV 空模板</a><a class="btn" href="/dashboard-templates/blank.json" download>下载 JSON 空模板</a></div><label class="import-file">选择 JSON / CSV UTF-8 文件<input id="importFile" type="file" accept=".json,.csv,application/json,text/csv"></label><div id="importInfo" class="inline-note">当前部门ID：<strong>${esc(state.data.context.departmentId)}</strong>。每批最多500条、整个请求不超过1 MB。外部接口尚不能提供时，可使用同一字段标准人工导出。</div><div id="importError" class="import-message" role="status" hidden></div><div id="importPreview" hidden></div><div class="drawer-actions"><button class="btn" id="previewImport">校验与预览</button><button class="btn primary" id="commitImport" disabled>确认导入</button></div><p class="status-note" style="margin-top:14px">文件或统计范围变化后必须重新预检；确认时服务器会再次校验。刷新只读取已保存数据，不自动向外部平台取数。</p>`);
  $("importFile").onchange = () => { state.importGeneration++; state.preview = null; $("commitImport").disabled = true; $("importPreview").hidden = true; $("importError").hidden = true; };
  $("previewImport").onclick = async () => {
    state.preview = null; $("commitImport").disabled = true; $("importPreview").hidden = true; $("importError").hidden = true;
    const generation = ++state.importGeneration;
    const file = $("importFile").files[0]; if (!file) { $("importError").textContent = "请先选择真实数据文件。"; $("importError").hidden = false; return; }
    $("previewImport").disabled = true;
    try {
      if (file.size > 1024 * 1024) throw Error("文件不能超过1 MB，请拆分批次。");
      const doc = parseDashboardFile(await file.text(), file.name.split(".").pop().toLowerCase());
      if (doc.departmentId !== state.data.context.departmentId) throw Error("文件部门与当前所选部门不同；请调整页面部门后重新预检，不能静默更改来源范围。");
      const result = await request("preview", { departmentId: doc.departmentId, document: doc });
      if (generation !== state.importGeneration) return;
      state.preview = { result, document: result.document, departmentId: doc.departmentId };
      const s = result.summary;
      $("importPreview").className = "import-preview"; $("importPreview").hidden = false;
      $("importPreview").innerHTML = `<strong>预检通过 · 尚未写入</strong><br>部门：${esc(state.data.context.departmentName)}<br>来源：${esc(s.sourceName)}<br>记录：${s.recordCount} 条 / ${s.metricCount} 项指标<br>完整记录：${s.completeRecords} · 部分覆盖：${s.partialRecords}<br>业务截止：${esc(when(result.document.asOf))}<br>批次：${esc(result.document.batchId)}<br>当前版本：v${result.revision}${result.warnings.length ? '<p class="status-note">' + result.warnings.map(esc).join("<br>") + "</p>" : ""}<div class="table-shell"><table class="small-table"><thead><tr><th>指标 / 维度</th><th>统计期间</th><th>值</th></tr></thead><tbody>${result.document.records.slice(0, 8).map(r => `<tr><td>${esc(names[r.metric] || r.metric)}${r.dimension ? " / " + esc(r.dimension) : ""}</td><td>${esc(r.periodStart)} — ${esc(r.periodEnd)}</td><td>${fmt(r.value)} ${esc(r.unit)}</td></tr>`).join("")}</tbody></table></div>${result.document.records.length > 8 ? '<p class="status-note">预览显示前8条；全部记录均经过服务器校验。</p>' : ""}`;
      $("commitImport").disabled = false;
    } catch (error) { if (generation === state.importGeneration && $("importError")) { $("importError").textContent = error.message; $("importError").hidden = false; } }
    finally { if (generation === state.importGeneration && $("previewImport")) $("previewImport").disabled = false; }
  };
  $("commitImport").onclick = async () => {
    if (!state.preview) return;
    const { result, document: doc, departmentId } = state.preview;
    $("commitImport").disabled = true; $("previewImport").disabled = true; $("importError").hidden = true;
    try {
      const saved = await request("commit", { departmentId, document: doc, previewHash: result.previewHash, expectedRevision: result.revision });
      state.preview = null;
      $("importPreview").innerHTML = `<strong>${saved.duplicate ? "批次此前已导入，没有重复记数" : "导入已保存"}</strong><p>数据版本 v${saved.revision}。页面已重读网站保存的结果；如统计期间不同，请切换到对应期间查看。</p><p class="status-note">外部数据仍按人工导入标识，不会伪装为平台自动采集。</p>`;
    } catch (error) { $("importError").textContent = error.message + " 请重新预检后再确认；同一批次可安全重试。"; $("importError").hidden = false; state.preview = null; }
    finally { $("previewImport").disabled = false; }
  };
}
function guideDrawer() {
  openDrawer("数据接入 · 实施步骤", "先小范围核对，再逐项扩大", '<h4>1. 确认来源与口径</h4><p class="status-note">先选一个部门、一个来源、一个统计期间。请 BI、数据治理、AI平台、HR 等数据提供方确认字段、覆盖、历史和时效。</p><h4>2. 接口与文件共用字段</h4><p class="status-note">提供方按统一 v1 结构交付。能提供接口时按供数协议准备；暂时没有接口，可导出 UTF-8 CSV 或 JSON，先在这里预检。</p><h4>3. 预检后确认入库</h4><p class="status-note">核对部门、来源、期间、分子分母和小样本原始值。预检不写入；点击确认后服务器重新校验并留存批次与版本。</p><h4>4. 查看覆盖与过期</h4><p class="status-note">每个指标可查看业务截止、入库时间、人工导入和覆盖限制。数据过期保留灰色旧值，不自动当成 0。</p><div class="drawer-actions"><a class="btn" href="/dashboard-templates/blank.csv" download>CSV空模板</a><a class="btn" href="/dashboard-templates/blank.json" download>JSON空模板</a></div><div class="inline-note">完整接口和字段文档：docs/department-dashboard-api.md；落地分工指南：docs/department-dashboard-rollout.md。当前没有外部自动拉取，不需要把后台管理员凭证交给供应商。</div>');
}

window.addEventListener("message", event => {
  if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.channel !== channel) return;
  const m = event.data;
  if (m.type === "data" && m.payload?.context && Array.isArray(m.payload.metrics)) {
    const previousDepartment = state.data?.context.departmentId;
    state.data = m.payload; state.error = "";
    if (previousDepartment !== state.data.context.departmentId) { state.search = ""; state.page = 1; $("personSearch").value = ""; }
    $("dataError").hidden = true; render();
  } else if (m.type === "error") showError(m.error || "读取失败");
  else if (m.type === "response") {
    const callback = pending.get(m.id); if (!callback) return; clearTimeout(callback.timer); pending.delete(m.id);
    if (m.error) callback.reject(Error(m.error)); else callback.resolve(m.result);
  }
});
const currentYear = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric" }).format(new Date()));
$("yearSelect").innerHTML = Array.from({ length: currentYear - 2019 + 1 }, (_, i) => currentYear + 1 - i).map(y => `<option value="${y}">${y} 年</option>`).join(""); $("yearSelect").value = String(currentYear);
$("refreshButton").onclick = refresh; ["departmentSelect", "yearSelect", "periodSelect"].forEach(id => $(id).onchange = refresh);
$("drawerClose").onclick = closeDrawer; $("overlay").onclick = closeDrawer; $("importButton").onclick = importDrawer; $("guideButton").onclick = guideDrawer;
$("methodButton").onclick = () => { openDrawer("指标口径与边界", "真实数据、缺口与来源分开展示", '<p class="status-note">流量按统计期累计，存量按截止日快照，比例需分子分母。年度目标不按季度或月度自动摊分；同一指标跨来源不相加。网站目标的任务贡献与经营实测分开。</p><p class="status-note">部分覆盖不等于全部门，过期保留灰色旧值，缺历史不补曲线。当前人才范围是所选部门，附件中的集团人才和模拟组织不作为真实业务数据。</p><p class="status-note">网站任务按所属周与查询期间相交筛选，展示其当前状态，跨周结转记录尚未去重。网站账号不能替代 HR 编制；每日 AI 配额不能换算 Token。</p>'); };
$("metricDetails").onclick = () => showMetric(state.selectedMetric);
$("personSearch").oninput = e => { state.search = e.target.value; state.page = 1; renderPeopleRows(); };
$("prevPage").onclick = () => { state.page--; renderPeopleRows(); }; $("nextPage").onclick = () => { state.page++; renderPeopleRows(); };
$("exportButton").onclick = () => { if (!state.data) return; const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json;charset=utf-8" }), url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `部门总览-${state.data.context.departmentId}-${state.data.context.year}-${state.data.context.period}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
document.addEventListener("click", event => {
  const jump = event.target.closest("[data-jump]"); if (jump) { document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }
  const selected = event.target.closest("[data-select-metric]"); if (selected) { if (["report_visits", "data_ai_calls", "report_count", "report_active_rate", "business_users"].includes(selected.dataset.selectMetric)) { state.selectedMetric = selected.dataset.selectMetric; render(); } else showMetric(selected.dataset.selectMetric); }
  const detail = event.target.closest("[data-metric]"); if (detail) showMetric(detail.dataset.metric);
  const person = event.target.closest("[data-person]"); if (person) personDrawer(person.dataset.person);
  const quality = event.target.closest("[data-quality-index]"); if (quality) showMetric("quality_pass_rate", state.data?.distributions.quality_pass_rate[Number(quality.dataset.qualityIndex)]);
});
document.addEventListener("keydown", e => { if (!$("drawer").classList.contains("show")) return; if (e.key === "Escape") closeDrawer(); if (e.key === "Tab") { const controls = [...$("drawer").querySelectorAll('button:not(:disabled),a[href],input,select,[tabindex="0"]')].filter(x => !x.hidden && x.getClientRects().length); if (e.shiftKey && document.activeElement === controls[0]) { e.preventDefault(); controls.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === controls.at(-1)) { e.preventDefault(); controls[0]?.focus(); } } });
render(); send({ type: "ready" });
if (window.parent === window) showError("请从已登录网站的后台首页进入；此页面不会自行读取生产凭证。");
