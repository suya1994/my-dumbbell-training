/*
 * 数据备份模块（当前版本）
 *
 * 适配当前数据结构：
 * - exercises, equipment_catalog
 * - training_plans, training_plan_items
 * - workout_sessions, workout_session_items
 * - body_metrics
 * - training_counter (completed_count)
 *
 * 规则：
 * - 导出：只读取 Supabase 数据，不修改。
 * - 导入：仅“合并恢复”，使用 POST + resolution=ignore-duplicates，不执行 DELETE/业务覆盖。
 * - 计数器：training_counter.completed_count 取 max(云端, 备份, 导入后会话数)。
 */

const BACKUP_APP = "my-dumbbell-training";
const BACKUP_VERSION = 3;

const BACKUP_TABLES = [
  { key: "exercises", label: "动作库" },
  { key: "equipment_catalog", label: "器械规格" },
  { key: "training_plans", label: "训练计划" },
  { key: "training_plan_items", label: "计划动作" },
  { key: "workout_sessions", label: "训练历史" },
  { key: "workout_session_items", label: "训练动作记录" },
  { key: "body_metrics", label: "身体数据" },
];

const BACKUP_IMPORT_ORDER = [
  "exercises",
  "equipment_catalog",
  "training_plans",
  "training_plan_items",
  "workout_sessions",
  "workout_session_items",
  "body_metrics",
];

const BACKUP_LABELS = Object.fromEntries(
  BACKUP_TABLES.map(({ key, label }) => [key, label]),
);

const BACKUP_FK_RULES = {
  training_plan_items: [
    { field: "plan_id", target: "training_plans" },
    { field: "exercise_id", target: "exercises" },
  ],
  workout_session_items: [
    { field: "session_id", target: "workout_sessions" },
  ],
};

const BACKUP_FK_TARGET_TABLES = [
  "exercises",
  "equipment_catalog",
  "training_plans",
  "workout_sessions",
];

let pendingBackup = null;
let pendingImportPlan = null;

function getBackupElement(id) {
  return document.getElementById(id);
}

function setBackupStatus(id, message, type = "") {
  const element = getBackupElement(id);
  if (!element) return;
  element.textContent = message;
  element.className = "backup-status" + (type ? " is-" + type : "");
}

function formatBackupDate(date = new Date()) {
  const ymd = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  const hms = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");
  return `${ymd}-${hms}`;
}

function escapeBackupHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function getBackupRows(tables, key) {
  return Array.isArray(tables?.[key]) ? tables[key] : [];
}

/* =========================================================
   导出
========================================================= */

async function exportBackup() {
  const button = getBackupElement("exportButton");
  if (button) {
    button.disabled = true;
    button.textContent = "正在生成备份……";
  }
  setBackupStatus("exportStatus", "正在从云端读取数据；此操作不会修改任何数据。");

  try {
    const results = await Promise.all(
      BACKUP_IMPORT_ORDER.map(async (key) => {
        let rows = [];
        try {
          rows = await supabaseRequest(key + "?select=*");
        } catch (error) {
          // 表不存在时按空表处理，避免因个别表缺失阻塞备份
          console.warn("读取表失败，按空表处理：", key, error);
          rows = [];
        }
        if (!Array.isArray(rows)) {
          throw new Error(key + " 返回的数据格式异常。");
        }
        return [key, rows];
      }),
    );

    const tables = Object.fromEntries(results);
    const rowCount = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);

    let completedCount = 0;
    try {
      const counterResult = await supabaseRequest(
        "training_counter?select=id,completed_count&id=eq.1&limit=1",
      );
      if (Array.isArray(counterResult) && counterResult.length) {
        completedCount = Number(counterResult[0].completed_count) || 0;
      }
    } catch (error) {
      console.warn("读取训练次数失败，按 0 处理：", error);
    }

    const backup = {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      counts: Object.fromEntries(
        Object.entries(tables).map(([key, rows]) => [key, rows.length]),
      ),
      counter: { completed_count: completedCount },
      tables,
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "哑铃训练数据备份-" + formatBackupDate() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setBackupStatus(
      "exportStatus",
      "备份完成：共导出 " + rowCount + " 条数据（含动作库、训练计划、训练历史、身体数据与训练次数）。",
      "success",
    );
  } catch (error) {
    console.error("数据备份失败：", error);
    setBackupStatus("exportStatus", "备份失败：" + (error?.message || String(error)), "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "下载备份文件";
    }
  }
}

/* =========================================================
   本地校验
========================================================= */

function validateBackup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("文件不是有效的备份文件。");
  }
  if (value.app !== BACKUP_APP) {
    throw new Error("该文件不是本应用导出的备份。");
  }

  const sourceVersion = Number(value.version);
  if (!Number.isFinite(sourceVersion)) {
    throw new Error("备份文件缺少版本信息。");
  }
  if (sourceVersion !== BACKUP_VERSION) {
    throw new Error(`暂不支持备份版本 v${sourceVersion}（当前仅支持 v${BACKUP_VERSION}）。请使用当前版本导出的备份文件。`);
  }

  const sourceTables = value.tables;
  if (!sourceTables || typeof sourceTables !== "object" || Array.isArray(sourceTables)) {
    throw new Error("备份文件缺少 tables 数据。");
  }

  const tables = {};
  for (const { key } of BACKUP_TABLES) {
    const rows = Array.isArray(sourceTables[key]) ? sourceTables[key] : [];
    if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error("“" + key + "”的数据格式不正确。");
    }
    tables[key] = rows;
  }

  const completedCount = Number(value.counter?.completed_count);
  return {
    app: value.app,
    version: sourceVersion,
    exported_at: value.exported_at || new Date().toISOString(),
    counter: { completed_count: Number.isFinite(completedCount) ? completedCount : 0 },
    tables,
  };
}

/* =========================================================
   云端 ID 读取
========================================================= */

async function fetchLocalIdSet(table) {
  const ids = new Set();
  const pageSize = 1000;
  let offset = 0;

  try {
    while (true) {
      const rows = await supabaseRequest(
        `${table}?select=id&order=id.asc&limit=${pageSize}&offset=${offset}`,
      );
      if (!Array.isArray(rows) || !rows.length) break;
      rows.forEach((row) => {
        if (row && row.id != null) ids.add(String(row.id));
      });
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  } catch (error) {
    console.warn("读取云端 ID 失败（该表可能尚未建立）：", table, error);
  }

  return ids;
}

async function loadLocalIdCache(tables) {
  const keys = Array.from(new Set(tables));
  const entries = await Promise.all(
    keys.map(async (key) => [key, await fetchLocalIdSet(key)]),
  );
  return new Map(entries);
}

function buildBackupIdSets(tables) {
  const map = new Map();
  for (const key of BACKUP_IMPORT_ORDER) {
    const ids = new Set();
    getBackupRows(tables, key).forEach((row) => {
      if (row && row.id != null) ids.add(String(row.id));
    });
    map.set(key, ids);
  }
  return map;
}

/* =========================================================
   依赖 / 重复分析
========================================================= */

function analyzeImportPlan(backup, localIds) {
  const tables = backup.tables;
  const backupIds = buildBackupIdSets(tables);
  const merged = new Map();

  const mergedIds = (key) => {
    if (!merged.has(key)) {
      const set = new Set(localIds.get(key) || []);
      (backupIds.get(key) || new Set()).forEach((id) => set.add(id));
      merged.set(key, set);
    }
    return merged.get(key);
  };

  const details = [];
  let total = 0;
  let totalDuplicate = 0;
  let totalMissingFk = 0;
  let totalImportable = 0;
  const importableRows = {};

  for (const key of BACKUP_IMPORT_ORDER) {
    const rows = getBackupRows(tables, key);
    const local = localIds.get(key) || new Set();
    const rules = BACKUP_FK_RULES[key] || [];

    let duplicate = 0;
    let missingFk = 0;
    let importable = 0;
    const validRows = [];

    rows.forEach((row) => {
      const isDuplicate = row.id != null && local.has(String(row.id));
      let hasMissingFk = false;

      for (const rule of rules) {
        const value = row[rule.field];
        if (value == null) continue;
        if (!mergedIds(rule.target).has(String(value))) {
          hasMissingFk = true;
          break;
        }
      }

      if (isDuplicate) {
        duplicate += 1;
      } else if (hasMissingFk) {
        missingFk += 1;
      } else {
        importable += 1;
        validRows.push(row);
      }
    });

    importableRows[key] = validRows;
    total += rows.length;
    totalDuplicate += duplicate;
    totalMissingFk += missingFk;
    totalImportable += importable;

    if (rows.length) {
      details.push({
        key,
        label: BACKUP_LABELS[key] || key,
        total: rows.length,
        duplicate,
        missingFk,
        importable,
      });
    }
  }

  return { details, importableRows, total, totalDuplicate, totalMissingFk, totalImportable };
}

/* =========================================================
   预览
========================================================= */

function renderImportPreview(backup, fileName, analysis) {
  const preview = getBackupElement("importPreview");
  const confirmRow = getBackupElement("importConfirmRow");
  const confirmation = getBackupElement("importConfirmed");
  if (!preview) return;

  const rowsHtml = analysis.details
    .map(
      (item) => `
        <tr>
          <td>${escapeBackupHtml(item.label)}</td>
          <td class="num">${item.total}</td>
          <td class="num">${item.duplicate}</td>
          <td class="num">${item.missingFk}</td>
          <td class="num">${item.importable}</td>
        </tr>
      `,
    )
    .join("");

  const warning =
    analysis.totalDuplicate || analysis.totalMissingFk
      ? `<div class="preview-warning">
           重复 ID ${analysis.totalDuplicate} 条将保留云端原内容；
           外键依赖缺失 ${analysis.totalMissingFk} 条不会提交。
         </div>`
      : "";

  preview.innerHTML = `
    <strong>已完成本地校验与云端冲突检查</strong>
    <div class="preview-counts">
      文件：${escapeBackupHtml(fileName)} · 备份版本 v${backup.version} · 共 ${analysis.total} 条 · 可新增 ${analysis.totalImportable} 条
    </div>
    <div class="preview-counts">
      备份训练次数：${Number(backup.counter?.completed_count) || 0} · 导出时间：${escapeBackupHtml(backup.exported_at || "未记录")}
    </div>
    ${warning}
    <div class="preview-table-wrap">
      <table class="preview-table">
        <thead>
          <tr>
            <th>表</th>
            <th class="num">备份条数</th>
            <th class="num">重复 ID</th>
            <th class="num">外键缺失</th>
            <th class="num">可新增</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="5">空备份</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="preview-counts">网页仅执行“合并恢复”：不会删除、不会覆盖云端已有行。</div>
  `;

  preview.classList.remove("hidden");
  if (confirmRow) confirmRow.classList.remove("hidden");
  if (confirmation) confirmation.checked = false;
}

/* =========================================================
   文件选择
========================================================= */

async function handleBackupFile(event) {
  const file = event.files?.[0];
  pendingBackup = null;
  pendingImportPlan = null;

  const importButton = getBackupElement("importButton");
  if (importButton) importButton.disabled = true;

  const importPreview = getBackupElement("importPreview");
  if (importPreview) importPreview.classList.add("hidden");

  const importConfirmRow = getBackupElement("importConfirmRow");
  if (importConfirmRow) importConfirmRow.classList.add("hidden");

  const importReport = getBackupElement("importReport");
  if (importReport) {
    importReport.classList.add("hidden");
    importReport.innerHTML = "";
  }

  if (!file) return;

  try {
    if (file.size > 20 * 1024 * 1024) {
      throw new Error("备份文件不能超过 20 MB。");
    }

    const content = await file.text();
    const backup = validateBackup(JSON.parse(content));

    setBackupStatus("importStatus", "正在检查云端重复 ID 与外键依赖……");

    const checkTables = [...BACKUP_IMPORT_ORDER, ...BACKUP_FK_TARGET_TABLES];
    const localIds = await loadLocalIdCache(checkTables);
    const analysis = analyzeImportPlan(backup, localIds);

    pendingBackup = backup;
    pendingImportPlan = analysis;

    renderImportPreview(backup, file.name, analysis);

    setBackupStatus(
      "importStatus",
      "校验通过：可新增 " + analysis.totalImportable + " 条；尚未向云端写入任何数据。",
      "success",
    );
  } catch (error) {
    console.error("备份文件校验失败：", error);
    setBackupStatus("importStatus", "无法导入：" + (error?.message || String(error)), "error");
  }
}

function updateImportButton() {
  const confirmation = getBackupElement("importConfirmed");
  const importButton = getBackupElement("importButton");
  const allowed = Boolean(pendingBackup && pendingImportPlan && confirmation && confirmation.checked);
  if (importButton) importButton.disabled = !allowed;
}

/* =========================================================
   导入
========================================================= */

async function importRows(table, rows) {
  const batchSize = 100;
  let imported = 0;

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const result = await supabaseRequest(table, {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=representation",
      body: batch,
    });
    imported += Array.isArray(result) ? result.length : 0;
  }

  return imported;
}

async function runBackupImports(analysis) {
  const report = [];
  let imported = 0;

  for (const key of BACKUP_IMPORT_ORDER) {
    const rows = analysis.importableRows[key] || [];
    const detail = analysis.details.find((item) => item.key === key);

    if (!rows.length) {
      if (detail) {
        report.push({
          key,
          label: detail.label,
          total: detail.total,
          duplicate: detail.duplicate,
          missingFk: detail.missingFk,
          added: 0,
          error: null,
        });
      }
      continue;
    }

    const base = detail || {
      key,
      label: BACKUP_LABELS[key] || key,
      total: rows.length,
      duplicate: 0,
      missingFk: 0,
    };

    try {
      const added = await importRows(key, rows);
      imported += added;
      report.push({
        key,
        label: base.label,
        total: base.total,
        duplicate: base.duplicate + Math.max(0, rows.length - added),
        missingFk: base.missingFk,
        added,
        error: null,
      });
    } catch (error) {
      report.push({
        key,
        label: base.label,
        total: base.total,
        duplicate: base.duplicate,
        missingFk: base.missingFk,
        added: 0,
        error: error?.message || String(error),
      });
      throw Object.assign(error, { backupReport: report, imported });
    }
  }

  return { imported, report };
}

async function mergeTrainingCounter(backupCount) {
  let before = 0;
  let sessionsCount = 0;

  try {
    const counter = await supabaseRequest("training_counter?select=completed_count&id=eq.1&limit=1");
    if (Array.isArray(counter) && counter.length) {
      before = Number(counter[0].completed_count) || 0;
    }
  } catch (error) {
    console.warn("读取 training_counter 失败：", error);
  }

  try {
    const sessions = await supabaseRequest("workout_sessions?select=id");
    sessionsCount = Array.isArray(sessions) ? sessions.length : 0;
  } catch (error) {
    console.warn("读取 workout_sessions 数量失败：", error);
  }

  const requested = Math.max(before, Number(backupCount) || 0, sessionsCount);
  let after = requested;

  try {
    await supabaseRequest("training_counter?id=eq.1", {
      method: "PATCH",
      prefer: "return=minimal",
      body: { completed_count: requested, updated_at: new Date().toISOString() },
    });
  } catch (error) {
    console.warn("更新 training_counter 失败（可能缺少记录/updated_at 字段）：", error);
    try {
      await supabaseRequest("training_counter?id=eq.1", {
        method: "PATCH",
        prefer: "return=minimal",
        body: { completed_count: requested },
      });
    } catch (e2) {
      console.warn("回退更新 training_counter 失败：", e2);
    }
  }

  try {
    const verify = await supabaseRequest("training_counter?select=completed_count&id=eq.1&limit=1");
    if (Array.isArray(verify) && verify.length) {
      after = Number(verify[0].completed_count) || 0;
    }
  } catch (_) {}

  return {
    before,
    sessionsCount,
    requested,
    after,
    verified: after >= requested && after >= before,
  };
}

function renderImportReport(result, counterMerge) {
  const box = getBackupElement("importReport");
  if (!box) return;

  const rows = result.report
    .filter((item) => item.total > 0)
    .map(
      (item) => `
        <tr>
          <td>${escapeBackupHtml(item.label)}</td>
          <td class="num">${item.total}</td>
          <td class="num">${item.added}</td>
          <td class="num">${item.duplicate}</td>
          <td class="num">${item.missingFk}</td>
          <td>${item.error ? escapeBackupHtml(item.error) : "成功"}</td>
        </tr>
      `,
    )
    .join("");

  box.innerHTML = `
    <strong>导入结果报告</strong>
    <div class="preview-counts">
      本次新增 ${result.imported} 条；
      训练次数：导入前 ${counterMerge.before} → 合并后 ${counterMerge.after}
      （备份 ${Number(pendingBackup?.counter?.completed_count) || 0}，会话数 ${counterMerge.sessionsCount}）。
    </div>
    <div class="preview-counts ${counterMerge.verified ? "" : "preview-warning"}">
      ${counterMerge.verified ? "✅ 训练次数合并校验通过。" : "⚠️ 训练次数校验未通过，请检查 training_counter。"}
    </div>
    <div class="preview-table-wrap">
      <table class="preview-table">
        <thead>
          <tr>
            <th>表</th>
            <th class="num">备份条数</th>
            <th class="num">新增</th>
            <th class="num">重复/跳过</th>
            <th class="num">外键缺失</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="6">没有需要导入的数据</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  box.classList.remove("hidden");
}

async function importBackup() {
  if (!pendingBackup || !pendingImportPlan || !(getBackupElement("importConfirmed")?.checked)) {
    return;
  }

  if (!pendingImportPlan.totalImportable) {
    // 即使无可新增行，也允许合并训练次数
  }

  if (
    !confirm(
      "确认执行合并导入？\n\n" +
        "只会新增云端不存在的数据；相同 ID 保留云端原内容。\n" +
        "不会执行 DELETE，也不会覆盖业务数据。\n\n" +
        "可新增：" +
        pendingImportPlan.totalImportable +
        " 条；重复 ID：" +
        pendingImportPlan.totalDuplicate +
        " 条；外键缺失跳过：" +
        pendingImportPlan.totalMissingFk +
        " 条。",
    )
  ) {
    return;
  }

  const button = getBackupElement("importButton");
  if (button) {
    button.disabled = true;
    button.textContent = "正在安全导入……";
  }

  const importReport = getBackupElement("importReport");
  if (importReport) {
    importReport.classList.add("hidden");
    importReport.innerHTML = "";
  }

  try {
    const result = await runBackupImports(pendingImportPlan);
    const counterMerge = await mergeTrainingCounter(
      Number(pendingBackup.counter?.completed_count) || 0,
    );

    renderImportReport(result, counterMerge);

    setBackupStatus(
      "importStatus",
      "合并导入完成：新增 " +
        result.imported +
        " 条；训练次数 " +
        counterMerge.after +
        (counterMerge.verified ? "（校验通过）" : "（请检查）"),
      counterMerge.verified ? "success" : "error",
    );
  } catch (error) {
    console.error("数据导入失败：", error);

    const partial = error.backupReport
      ? { imported: error.imported || 0, report: error.backupReport }
      : { imported: 0, report: [] };

    let counterMerge = null;
    try {
      counterMerge = await mergeTrainingCounter(
        Number(pendingBackup.counter?.completed_count) || 0,
      );
      renderImportReport(partial, counterMerge);
    } catch (counterError) {
      console.error("导入失败后的训练次数校验失败：", counterError);
    }

    setBackupStatus(
      "importStatus",
      "导入已停止：" +
        (error?.message || String(error)) +
        "。已成功导入的数据仍会保留；请查看导入结果报告。",
      "error",
    );
  } finally {
    if (button) {
      button.textContent = "确认导入";
      updateImportButton();
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const exportButton = getBackupElement("exportButton");
  if (exportButton) exportButton.addEventListener("click", exportBackup);

  const backupFile = getBackupElement("backupFile");
  if (backupFile) backupFile.addEventListener("change", handleBackupFile);

  const importConfirmed = getBackupElement("importConfirmed");
  if (importConfirmed) importConfirmed.addEventListener("change", updateImportButton);

  const importButton = getBackupElement("importButton");
  if (importButton) importButton.addEventListener("click", importBackup);
});
