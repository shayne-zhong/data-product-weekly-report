/* Department report UI: the host supplies its existing authentication and navigation. */
window.createPeriodReportUi = function ({ api, adminHeaders, isAdmin, notify }) {
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const labels = { queued: "等待本机领取", running: "生成中", validating: "校验中", completed: "已完成", failed: "失败", cancelled: "已取消" };
  let data = { jobs: [], workers: [] }, reading = false, current = null, lastFocus = null;
  const panel = document.createElement("section");
  panel.className = "admin-section panel"; panel.dataset.adminPanel = "period-reports"; panel.hidden = true;
  panel.innerHTML = `<div class="admin-section-head"><div><h3>经营报告</h3><p>自动汇集部门任务、周报和月报，使用本机 Codex 与报告 Skill 生成 HTML。</p></div><button class="ghost-btn" id="pr-refresh">刷新</button></div>
    <form id="pr-form" class="admin-record-filters"><label>部门<select id="pr-department" required></select></label><label>年份<input id="pr-year" type="number" min="2000" max="2100" required value="${new Date().getFullYear()}"></label><label>报告周期<select id="pr-period"><option value="quarter:1">第一季度</option><option value="quarter:2">第二季度</option><option value="quarter:3">第三季度</option><option value="quarter:4">第四季度</option><option value="half:1">上半年</option><option value="half:2">下半年</option><option value="year:1">年度</option></select></label><button class="btn" id="pr-generate">生成报告</button></form>
    <p id="pr-message" role="status" aria-live="polite"></p><div id="pr-workers"></div><details><summary>连接本机设备</summary><p>首次连接：下载配置，在本机安装程序中选择此文件。电脑在线且未休眠时领取任务，关机时任务保留在网站。</p><button class="ghost-btn" id="pr-pair">下载本机连接配置</button><p class="subtitle">连接配置仅保存到自己的电脑。新下载的配置需重新安装；旧设备可在下方停用。</p></details><div id="pr-jobs" style="margin-top:20px"></div>`;
  document.querySelector(".admin-content").append(panel);
  el("pr-period").value = `quarter:${Math.floor(new Date().getMonth() / 3) + 1}`;
  const publicPanel = document.createElement("section");
  publicPanel.className = "panel"; publicPanel.style.cssText = "padding:18px;margin-bottom:18px";
  publicPanel.innerHTML = '<details id="pr-public-details"><summary style="cursor:pointer;font-weight:700">部门 HTML 经营报告</summary><div id="pr-public" style="margin-top:12px">展开后读取报告</div></details>';
  el("reportView").prepend(publicPanel);
  const dialog = document.createElement("dialog");
  dialog.id = "pr-viewer";
  dialog.style.cssText = "width:96vw;max-width:none;height:94vh;padding:0;border:1px solid #ddd;border-radius:8px;background:#f6f4ee";
  dialog.innerHTML = '<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;flex-wrap:wrap"><strong id="pr-viewer-title" style="flex:1"></strong><button class="ghost-btn" id="pr-download">下载 HTML</button><button class="ghost-btn" id="pr-close" autofocus>关闭</button></div><p id="pr-viewer-note" style="padding:0 16px;margin:0 0 8px;font-size:12px"></p><iframe id="pr-frame" title="部门经营报告预览" sandbox="allow-scripts allow-modals" allow="fullscreen" style="width:100%;height:calc(100% - 95px);border:0;background:#f2eee7"></iframe>';
  document.body.append(dialog);

  function message(text, error = false) { el("pr-message").textContent = text; el("pr-message").style.color = error ? "#b91c1c" : "#606266"; }
  function download(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function rows(jobs, admin) {
    if (!jobs.length) return '<p class="subtitle">暂无经营报告</p>';
    return `<div class="table-wrap"><table class="admin-record-table"><thead><tr><th>部门 / 周期</th><th>版本</th><th>状态</th><th>资料</th><th>操作</th></tr></thead><tbody>${jobs.map((j) => `<tr><td>${esc(j.departmentName)}<br>${esc(j.period.label)}</td><td>V${j.version}</td><td>${esc(labels[j.status])}${j.message ? `<br><small>${esc(j.message)}</small>` : ""}</td><td>任务 ${j.sources.taskCount} · 周报 ${j.sources.weeklyReportCount} · 月报 ${j.sources.monthlyReportCount}</td><td>${j.status === "completed" ? `<button class="ghost-btn" data-pr-open="${esc(j.id)}">打开报告</button> <a href="${esc(j.href)}" target="_blank" rel="noopener">固定链接</a>` : ""}${admin && ["failed", "cancelled", "completed"].includes(j.status) ? `<button class="ghost-btn" data-pr-retry="${esc(j.id)}">${j.status === "completed" ? "重新生成" : "重试"}</button>` : ""}${admin && ["queued", "running", "validating"].includes(j.status) ? `<button class="ghost-btn" data-pr-cancel="${esc(j.id)}">取消</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  }
  async function load() {
    if (reading) return; reading = true;
    try {
      data = await api("/api/admin/period-reports", { headers: adminHeaders() });
      const selected = el("pr-department").value;
      el("pr-department").innerHTML = data.departments.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("");
      if (data.departments.some((d) => d.id === selected)) el("pr-department").value = selected;
      el("pr-generate").disabled = !data.generationSupported || !data.departments.length;
      el("pr-pair").disabled = !data.generationSupported;
      el("pr-workers").innerHTML = `<p>${data.workers.some((w) => w.online) ? "本机已连接" : "本机未在线，生成任务将排队等待"}</p>` + data.workers.filter((w) => !w.revoked).map((w) => `<p class="subtitle">设备 ${esc(w.id.slice(0, 8))} · ${w.online ? "在线" : "离线"} <button class="ghost-btn" data-pr-revoke="${esc(w.id)}">停用</button></p>`).join("");
      el("pr-jobs").innerHTML = rows(data.jobs, true);
      if (!data.generationSupported) message("此部署不支持生成，请连接单实例 Node 工作台。", true);
    } finally { reading = false; }
  }
  async function submit(input) {
    const result = await api("/api/admin/period-reports", { method: "POST", headers: adminHeaders(), body: JSON.stringify(input) });
    message(result.duplicate ? "本周期已有任务，将继续已有任务。" : "生成任务已创建，完成后会自动出现在网站。"); await load();
  }
  el("pr-form").addEventListener("submit", async (event) => {
    event.preventDefault(); el("pr-generate").disabled = true;
    const [kind, part] = el("pr-period").value.split(":");
    try { await submit({ departmentId: el("pr-department").value, year: Number(el("pr-year").value), kind, part: Number(part) }); }
    catch (error) { message(error.message, true); }
    finally { el("pr-generate").disabled = !data.generationSupported; }
  });
  el("pr-refresh").onclick = () => load().catch((e) => message(e.message, true));
  el("pr-pair").onclick = async () => {
    el("pr-pair").disabled = true;
    try {
      const result = await api("/api/admin/period-reports/pair", { method: "POST", headers: adminHeaders(), body: "{}" });
      download(JSON.stringify({ siteUrl: location.origin, token: result.token, workerId: result.workerId }, null, 2), "workbench-report-connection.json", "application/json");
      message("连接配置已下载，请在本机安装程序中选择此文件。"); await load();
    } catch (error) { message(error.message, true); }
    finally { el("pr-pair").disabled = false; }
  };
  async function open(id) {
    const result = await api(`/api/period-reports/${encodeURIComponent(id)}`, { headers: isAdmin() ? adminHeaders() : {} });
    current = result; lastFocus = document.activeElement;
    el("pr-viewer-title").textContent = `${result.job.departmentName} · ${result.job.period.label} · V${result.job.version}`;
    el("pr-viewer-note").textContent = "AI 生成草稿；技术检查已完成，业务来源、口径与结论仍需负责人复核。";
    el("pr-frame").srcdoc = result.html; dialog.showModal(); el("pr-close").focus();
  }
  function close() { dialog.close(); el("pr-frame").srcdoc = ""; current = null; lastFocus?.focus(); }
  el("pr-close").onclick = close;
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } });
  el("pr-download").onclick = () => { if (current) download(current.html, `${current.job.period.label}-V${current.job.version}.html`, "text/html;charset=utf-8"); };
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-pr-open],[data-pr-retry],[data-pr-cancel],[data-pr-revoke]");
    if (!button) return; button.disabled = true;
    try {
      if (button.dataset.prOpen) await open(button.dataset.prOpen);
      if (button.dataset.prRetry) { const job = data.jobs.find((j) => j.id === button.dataset.prRetry); await submit({ departmentId: job.departmentId, ...job.period }); }
      if (button.dataset.prCancel) { await api("/api/admin/period-reports/cancel", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ jobId: button.dataset.prCancel }) }); await load(); }
      if (button.dataset.prRevoke) { await api("/api/admin/period-reports/revoke", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ workerId: button.dataset.prRevoke }) }); await load(); }
    } catch (error) { message(error.message, true); notify(error.message); }
    finally { button.disabled = false; }
  });
  el("pr-public-details").addEventListener("toggle", async () => {
    if (!el("pr-public-details").open) return;
    try { const result = await api("/api/period-reports"); el("pr-public").innerHTML = rows(result.reports, false); }
    catch (e) { el("pr-public").textContent = e.message; }
  });
  setInterval(() => { if (!panel.hidden && !el("adminView").hidden && isAdmin() && !document.hidden) load().catch((e) => message(e.message, true)); }, 10_000);
  return { load, openFromUrl: async () => { const id = new URLSearchParams(location.search).get("periodReport"); if (id) await open(id); } };
};
