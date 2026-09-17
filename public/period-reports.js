/* Department report UI: the host supplies its existing authentication and navigation. */
window.createPeriodReportUi = function ({ api, adminHeaders, isAdmin, notify }) {
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const labels = { queued: "排队中", generating: "生成中", validating: "校验中", published: "已正式发布", failed: "失败", cancelled: "已终止" };
  let data = { jobs: [] }, reading = false, current = null, lastFocus = null;
  const panel = document.createElement("section");
  panel.className = "admin-section panel"; panel.dataset.adminPanel = "period-reports"; panel.hidden = true;
  const periodOptions = [
    ...Array.from({ length: 12 }, (_, index) => `<option value="month:${index + 1}">${index + 1}月</option>`),
    ...[1, 2, 3, 4].map((part) => `<option value="quarter:${part}">第${part}季度</option>`),
    '<option value="half:1">上半年</option><option value="half:2">下半年</option><option value="year:1">年度</option>',
  ].join("");
  panel.innerHTML = `<div class="admin-section-head"><div><h3>部门总结报告管理</h3><p>按报告周期汇集已归档的总结与年度目标，使用网站配置的 DeepSeek 生成正式 HTML 报告。</p></div><button class="ghost-btn" id="pr-refresh">刷新</button></div>
    <form id="pr-form" class="admin-record-filters"><label>部门<select id="pr-department" required></select></label><label>年份<input id="pr-year" type="number" min="2000" max="2100" required value="${new Date().getFullYear()}"></label><label>报告周期<select id="pr-period">${periodOptions}</select></label><button class="btn" id="pr-generate">生成报告</button></form>
    <p id="pr-message" role="status" aria-live="polite"></p><div id="pr-jobs" style="margin-top:20px"></div>`;
  document.querySelector(".admin-content").append(panel);
  el("pr-period").value = `quarter:${Math.floor(new Date().getMonth() / 3) + 1}`;
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
  function sourceSummary(job) {
    const sources = job.sources || {};
    const parts = [`目标 ${sources.goalCount || 0}`];
    if (sources.monthlySummaryCount) parts.push(`月度总结 ${sources.monthlySummaryCount}`);
    if (sources.quarterlySummaryCount) parts.push(`季度总结 ${sources.quarterlySummaryCount}`);
    return parts.join(" · ");
  }
  function rows(jobs, admin) {
    if (!jobs.length) return '<p class="subtitle">暂无部门总结报告</p>';
    return `<div class="table-wrap"><table class="admin-record-table"><thead><tr><th>部门 / 周期</th><th>版本</th><th>状态</th><th>资料</th><th>操作</th></tr></thead><tbody>${jobs.map((j) => {
      const published = j.status === "published";
      const active = ["queued", "generating", "validating"].includes(j.status);
      return `<tr><td>${esc(j.departmentName)}<br>${esc(j.period.label)}</td><td>${j.version ? `V${j.version}` : "—"}</td><td>${esc(labels[j.status] || j.status)}${j.message ? `<br><small>${esc(j.message)}</small>` : ""}</td><td>${esc(sourceSummary(j))}</td><td>${published ? `<button class="ghost-btn" data-pr-open="${esc(j.id)}">预览</button> <button class="ghost-btn" data-pr-download="${esc(j.id)}">下载 HTML</button> <a href="${esc(j.href)}" target="_blank" rel="noopener">固定链接</a>` : ""}${admin && active ? ` <button class="ghost-btn" data-pr-cancel="${esc(j.id)}">终止</button>` : ""}${admin && ["failed", "published", "cancelled"].includes(j.status) ? ` <button class="ghost-btn" data-pr-retry="${esc(j.id)}">${published ? "重新生成" : "重试"}</button> <button class="ghost-btn" data-pr-delete="${esc(j.id)}">删除</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }
  async function load() {
    if (reading) return; reading = true;
    try {
      data = await api("/api/admin/period-reports", { headers: adminHeaders() });
      const selected = el("pr-department").value;
      el("pr-department").innerHTML = data.departments.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("");
      if (data.departments.some((d) => d.id === selected)) el("pr-department").value = selected;
      el("pr-generate").disabled = !data.generationSupported || !data.departments.length;
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
  async function open(id) {
    const result = await api(`/api/period-reports/${encodeURIComponent(id)}`, { headers: isAdmin() ? adminHeaders() : {} });
    current = result; lastFocus = document.activeElement;
    el("pr-viewer-title").textContent = `${result.job.departmentName} · ${result.job.period.label} · V${result.job.version}`;
    el("pr-viewer-note").textContent = `正式版本 · 资料截止 ${result.job.snapshotCapturedAtLabel} · ${result.job.skillVersion} · ${result.job.model}`;
    el("pr-frame").srcdoc = result.html; dialog.showModal(); el("pr-close").focus();
  }
  function close() { dialog.close(); el("pr-frame").srcdoc = ""; current = null; lastFocus?.focus(); }
  el("pr-close").onclick = close;
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } });
  el("pr-download").onclick = () => { if (current) download(current.html, `${current.job.period.label}-V${current.job.version}.html`, "text/html;charset=utf-8"); };
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-pr-open],[data-pr-retry],[data-pr-download],[data-pr-cancel],[data-pr-delete]");
    if (!button) return; button.disabled = true;
    try {
      if (button.dataset.prOpen) await open(button.dataset.prOpen);
      if (button.dataset.prRetry) { const job = data.jobs.find((j) => j.id === button.dataset.prRetry); await submit({ departmentId: job.departmentId, ...job.period }); }
      if (button.dataset.prDownload) {
        const result = await api(`/api/period-reports/${encodeURIComponent(button.dataset.prDownload)}`, { headers: adminHeaders() });
        download(result.html, `${result.job.period.label}-V${result.job.version}.html`, "text/html;charset=utf-8");
      }
      if (button.dataset.prCancel) {
        const id = button.dataset.prCancel;
        if (!confirm("确认终止这项生成任务？已产生的模型调用消耗无法撤销。")) return;
        await api(`/api/admin/period-reports/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: adminHeaders() });
        message("生成任务已终止。"); await load();
      }
      if (button.dataset.prDelete) {
        const id = button.dataset.prDelete;
        if (!confirm("确认删除这份部门总结报告？此操作不会删除来源总结或目标。")) return;
        await api(`/api/admin/period-reports/${encodeURIComponent(id)}`, { method: "DELETE", headers: adminHeaders() });
        message("部门总结报告已删除。"); await load();
      }
    } catch (error) { message(error.message, true); notify(error.message); }
    finally { button.disabled = false; }
  });
  setInterval(() => { if (!panel.hidden && !el("adminView").hidden && isAdmin() && !document.hidden) load().catch((e) => message(e.message, true)); }, 10_000);
  async function loadPublicReports() {
    const result = await api("/api/period-reports");
    return result.reports || [];
  }
  return { load, loadPublicReports, open, openFromUrl: async () => { const id = new URLSearchParams(location.search).get("periodReport"); if (id) await open(id); } };
};
