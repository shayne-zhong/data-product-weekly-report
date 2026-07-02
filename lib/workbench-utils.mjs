export const priorityQuadrants = ["重要紧急", "重要不紧急", "不重要紧急", "不重要不紧急"];

export function taskProgressPercent(task = {}) {
  const manual = Number(String(task.progress ?? "").match(/\d+(?:\.\d+)?/)?.[0]);
  if (Number.isFinite(manual)) return Math.max(0, Math.min(100, Math.round(manual)));
  if (task.status === "已完成") return 100;
  if (task.status === "阻塞") return 35;
  const logCount = (task.dailyLogs || []).filter((log) => log.progress?.trim()).length;
  if (task.status === "进行中") return Math.min(85, 35 + logCount * 12);
  return logCount ? 20 : 8;
}

export function latestLog(task = {}) {
  return [...(task.dailyLogs || [])].reverse().find((log) => log.progress?.trim());
}

export function reportTaskImportLine(task = {}, index = 0) {
  const percent = taskProgressPercent(task);
  const detail = latestLog(task)?.progress || task.description || task.blocker || "";
  return `${index + 1}、${task.title || "未命名任务"}：整体进度${percent}%${detail ? `，${detail}` : ""}`;
}

export function taskCounts(tasks = []) {
  return {
    total: tasks.length,
    todo: tasks.filter((task) => task.status === "待开始").length,
    doing: tasks.filter((task) => task.status === "进行中").length,
    blocked: tasks.filter((task) => task.status === "阻塞").length,
    done: tasks.filter((task) => task.status === "已完成").length,
    carry: tasks.filter((task) => task.status !== "已完成" || task.carryToNextWeek).length,
  };
}

export function groupCompletedTasks(tasks = []) {
  return tasks
    .filter((task) => task.status === "已完成")
    .sort((a, b) => (b.completedAt || b.updatedAt || 0) - (a.completedAt || a.updatedAt || 0))
    .reduce((groups, task) => {
      const date = new Date(task.completedAt || task.updatedAt || Date.now());
      const key = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}`;
      groups[key] = [...(groups[key] || []), task];
      return groups;
    }, {});
}

export function parseTaskImportTable(text = "") {
  const lines = String(text).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(/\t|,/).map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(/\t|,/).map((item) => item.trim());
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}
