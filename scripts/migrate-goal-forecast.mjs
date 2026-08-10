import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { assertStateFingerprint, fingerprintState } from "../lib/state-fingerprint.mjs";
import { createStateStore } from "../lib/state-store.mjs";

const CUTOFF_ENV = "MIGRATION_CUTOFF_MS";
const cutoffMs = process.env[CUTOFF_ENV] ? Number(process.env[CUTOFF_ENV]) : null;
const isWrite = process.argv.includes("--write");

if (isWrite && !cutoffMs) {
  console.error(`错误：使用 --write 时必须通过 ${CUTOFF_ENV} 环境变量提供上线时间边界（Unix 毫秒时间戳）。`);
  console.error(`示例：${CUTOFF_ENV}=1720000000000 node scripts/migrate-goal-forecast.mjs --write`);
  process.exit(1);
}

const stateStore = createStateStore();

function isRecoverable(row, cutoff) {
  if (!cutoff) return "no-cutoff";
  if (row.expectedCurrent && String(row.expectedCurrent).trim()) return "already-set";
  const updatedAt = Number(row.updatedAt || 0);
  if (updatedAt >= cutoff) return "post-cutoff";
  const oldCurrent = String(row.current || "").trim();
  if (!oldCurrent || oldCurrent === "0") return "no-value";
  return "recoverable";
}

const raw = await stateStore.load();
if (!raw) {
  console.error("错误：无法读取线上原始状态，迁移中止。");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = join("backups", "migration", `goal-forecast-${stamp}`);
await mkdir(backupDir, { recursive: true });
const backupPath = join(backupDir, "state-v1.json");
const reportPath = join(backupDir, "migration-report.json");
await writeFile(backupPath, JSON.stringify(raw, null, 2), "utf8");
console.log(`已备份原始状态至 ${backupPath}`);

const goalsByDepartment = raw.goalsByDepartment || {};
const entries = Object.entries(goalsByDepartment);
const report = {
  migratedAt: new Date().toISOString(),
  cutoffMs,
  sourceFingerprint: fingerprintState(raw),
  departments: {},
};
if (!entries.length) {
  report.totals = { recoverable: 0, unrecoverable: 0, alreadySet: 0, noValue: 0 };
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log("没有找到任何部门目标数据，无需迁移。");
  console.log(`迁移报告已保存至 ${reportPath}`);
  process.exit(0);
}

for (const [departmentId, goalsData] of entries) {
  const rows = goalsData.rows || [];
  if (!rows.length) {
    report.departments[departmentId] = { total: 0, recoverable: [], unrecoverable: [], alreadySet: [], noValue: [] };
    continue;
  }

  const recoverable = [];
  const unrecoverable = [];
  const alreadySet = [];
  const noValue = [];

  for (const row of rows) {
    const rowId = row.id || "unknown";
    const verdict = isRecoverable(row, cutoffMs);
    if (verdict === "recoverable") {
      recoverable.push({ id: rowId, name: row.name, oldCurrent: row.current, expectedCurrent: String(row.current || "").trim() });
    } else if (verdict === "post-cutoff") {
      unrecoverable.push({ id: rowId, name: row.name, oldCurrent: row.current, updatedAt: row.updatedAt });
    } else if (verdict === "already-set") {
      alreadySet.push({ id: rowId, name: row.name, expectedCurrent: row.expectedCurrent });
    } else {
      noValue.push({ id: rowId, name: row.name, oldCurrent: row.current });
    }
  }

  report.departments[departmentId] = { total: rows.length, recoverable, unrecoverable, alreadySet, noValue };
}

// Print preview
console.log("\n========== 迁移预览 ==========");
for (const [departmentId, deptReport] of Object.entries(report.departments)) {
  console.log(`\n--- 部门: ${departmentId}（共 ${deptReport.total} 个目标）---`);
  for (const group of ["recoverable", "alreadySet", "unrecoverable", "noValue"]) {
    const items = deptReport[group];
    if (!items.length) continue;
    for (const item of items) {
      const label = {
        recoverable: "✓ 可恢复",
        alreadySet: "⊘ 已有预计值",
        unrecoverable: "⊘ 无法恢复",
        noValue: "⊘ 无历史值",
      }[group];
      const extra = group === "recoverable"
        ? `  旧 current: "${item.oldCurrent}" → expectedCurrent: "${item.expectedCurrent}"`
        : group === "alreadySet"
        ? `  已有 expectedCurrent: "${item.expectedCurrent}"`
        : group === "unrecoverable"
        ? `  旧 current: "${item.oldCurrent}"（上线后更新: ${new Date(item.updatedAt).toISOString()}）`
        : `  旧 current: "${item.oldCurrent}"`;
      console.log(`  ${label} | ${item.id} | ${item.name}`);
      console.log(`  ${extra}`);
    }
  }
}

// Print summary
const totals = Object.values(report.departments).reduce(
  (acc, dept) => {
    acc.recoverable += dept.recoverable.length;
    acc.unrecoverable += dept.unrecoverable.length;
    acc.alreadySet += dept.alreadySet.length;
    acc.noValue += dept.noValue.length;
    return acc;
  },
  { recoverable: 0, unrecoverable: 0, alreadySet: 0, noValue: 0 },
);
console.log("\n========== 汇总 ==========");
console.log(`  可恢复:     ${totals.recoverable}`);
console.log(`  已有预计值: ${totals.alreadySet}`);
console.log(`  无法恢复:   ${totals.unrecoverable}`);
console.log(`  无历史值:   ${totals.noValue}`);
console.log(`  总计:       ${totals.recoverable + totals.unrecoverable + totals.alreadySet + totals.noValue}`);
report.totals = totals;
await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(`迁移报告已保存至 ${reportPath}`);

if (!isWrite) {
  console.log(`\n预览模式：未执行写入。如需写入，请确认以上报告后运行：`);
  console.log(`  ${CUTOFF_ENV}=<上线时间戳> node scripts/migrate-goal-forecast.mjs --write`);
  process.exit(0);
}

// Confirmation for write
console.log(`\n⚠ 即将把 ${totals.recoverable} 个可恢复目标的旧 current 值迁入 expectedCurrent。`);
console.log(`  重复执行不会覆盖已有 expectedCurrent。`);
console.log("  输入 yes 确认执行：");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise((resolve) => rl.question("> ", resolve));
rl.close();

if (answer.trim().toLowerCase() !== "yes") {
  console.log("已取消。");
  process.exit(0);
}

// Execute migration
let migrated = 0;
let skipped = 0;

for (const [departmentId, deptReport] of Object.entries(report.departments)) {
  if (!deptReport.recoverable.length) continue;
  const goalsData = goalsByDepartment[departmentId];
  if (!goalsData) continue;

  for (const row of goalsData.rows) {
    const item = deptReport.recoverable.find((item) => item.id === row.id);
    if (!item) continue;
    // Double-check: only migrate if still empty
    if (row.expectedCurrent && String(row.expectedCurrent).trim()) {
      skipped++;
      continue;
    }
    row.expectedCurrent = item.expectedCurrent;
    migrated++;
  }
}

const writtenFingerprint = fingerprintState(raw);
await stateStore.save(raw);
console.log(`\n已写入：${migrated} 个目标已恢复预计值，${skipped} 个跳过（已有预计值）。`);

// Readback verification
const reloaded = await stateStore.load();
if (!reloaded) {
  console.error("错误：写入后无法重新读取状态，请检查数据！");
  process.exit(1);
}
assertStateFingerprint(reloaded, writtenFingerprint);

const verifiedDepts = reloaded.goalsByDepartment || {};
let verifiedCount = 0;
let failedCount = 0;

for (const [departmentId, deptReport] of Object.entries(report.departments)) {
  const saved = verifiedDepts[departmentId];
  if (!saved) {
    console.error(`  验证失败：部门 ${departmentId} 在回读数据中不存在`);
    failedCount++;
    continue;
  }
  for (const item of deptReport.recoverable) {
    const row = saved.rows.find((row) => row.id === item.id);
    if (!row) {
      console.error(`  验证失败：目标 ${item.id} 在回读数据中不存在`);
      failedCount++;
    } else if (String(row.expectedCurrent || "").trim() !== item.expectedCurrent) {
      console.error(`  验证失败：目标 ${item.id} 的 expectedCurrent 不匹配（期望: "${item.expectedCurrent}"，实际: "${row.expectedCurrent}"）`);
      failedCount++;
    } else {
      verifiedCount++;
    }
  }
}

console.log(`\n回读验证：${verifiedCount} 个通过，${failedCount} 个失败。`);

report.result = { migrated, skipped, verifiedCount, failedCount, writtenFingerprint };
await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(`迁移报告已更新至 ${reportPath}`);

if (failedCount > 0) {
  console.error("回读验证未通过，请人工核对待恢复目标和备份快照。");
  process.exit(1);
}

console.log("迁移完成。");
