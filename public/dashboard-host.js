/* The authenticated host owns credentials. The dashboard only receives scoped results. */
(function () {
  "use strict";
  const channel = "department-dashboard-v1";
  window.DepartmentDashboardHost = {
    create(options) {
      let latest = null, query = {}, sequence = 0, destroyed = false;
      const send = body => { if (!destroyed) options.frame.contentWindow?.postMessage({ channel, ...body }, window.location.origin); };
      const authorized = () => !destroyed && options.isAuthorized();
      async function load(filters = query) {
        if (!authorized()) throw Error("后台登录已过期，请重新登录。");
        const next = {};
        for (const key of ["departmentId", "year", "period"]) if (filters[key] !== undefined && filters[key] !== "") next[key] = String(filters[key]);
        const current = ++sequence;
        const data = await options.request("/api/admin/dashboard?" + new URLSearchParams(next), { headers: options.headers() });
        if (current !== sequence || !authorized()) return null;
        query = next; latest = data;
        send({ type: "data", payload: data, allowedSections: options.sections() });
        return data;
      }
      async function listener(event) {
        if (event.source !== options.frame.contentWindow || event.origin !== window.location.origin || event.data?.channel !== channel) return;
        const message = event.data;
        if (!authorized()) { send({ type: "error", error: "后台未登录或登录已过期。" }); return; }
        if (message.type === "ready") {
          if (latest) send({ type: "data", payload: latest, allowedSections: options.sections() });
          return;
        }
        if (message.type === "navigate") {
          if (typeof message.section === "string" && options.sections().includes(message.section)) options.openSection(message.section);
          return;
        }
        if (message.type !== "request" || typeof message.id !== "string" || message.id.length > 80) return;
        try {
          let result;
          if (message.action === "load") result = await load(message.query || query);
          else if (message.action === "preview" || message.action === "commit") {
            if (!latest?.context?.departmentId || message.body?.departmentId !== latest.context.departmentId) throw Error("导入部门与当前所选部门不一致，请重新选择并预检。");
            const path = message.action === "preview" ? "/api/admin/dashboard/imports/preview" : "/api/admin/dashboard/imports";
            result = await options.request(path, { method: "POST", headers: { ...options.headers(), "Content-Type": "application/json" }, body: JSON.stringify(message.body) });
            if (message.action === "commit") await load(query);
          } else throw Error("不支持此操作。");
          send({ type: "response", id: message.id, result });
        } catch (error) {
          send({ type: "response", id: message.id, error: error.message || "数据读取失败，已保留最近有效数据。" });
        }
      }
      window.addEventListener("message", listener);
      return {
        load,
        error(error) { send({ type: "error", error: error.message || String(error) }); },
        destroy() { destroyed = true; latest = null; sequence++; window.removeEventListener("message", listener); },
      };
    },
  };
})();
