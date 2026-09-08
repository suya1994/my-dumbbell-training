/*
 * 数据备份模块
 *
 * 导出：只读取 Supabase 数据。
 * 导入：只使用 POST + resolution=ignore-duplicates，绝不 PATCH 或 DELETE。
 */

const BACKUP_VERSION = 1;

/* 关联表必须先于依赖它的表导入。 */
const BACKUP_TABLES = [
  { key: "user_settings", label: "训练设置" },
  { key: "training_plans", label: "训练计划" },
  { key: "training_plan_exercises", label: "计划动作" },
  { key: "workouts", label: "训练记录" },
  { key: "workout_exercise_records", label: "动作完成记录" },
  { key: "other_activities", label: "其它运动" },
  { key: "body_metrics", label: "身体数据" },
];

let pendingBackup = null;

function getBackupElement(id) { return document.getElementById(id); }

function setBackupStatus(id, message, type = "") {
  const element = getBackupElement(id);
  if (!element) return;
  element.textContent = message;
  element.className = "backup-status" + (type ? " is-" + type : "");
}

function formatBackupDate(date = new Date()) {
  const parts = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")];
  return parts.join("") + "-" + [String(date.getHours()).padStart(2, "0"), String(date.getMinutes()).padStart(2, "0"), String(date.getSeconds()).padStart(2, "0")].join("");
}

async function exportBackup() {
  const button = getBackupElement("exportButton");
  if (button) { button.disabled = true; button.textContent = "正在生成备份……"; }
  setBackupStatus("exportStatus", "正在从云端读取数据；此操作不会修改任何数据。");

  try {
    const results = await Promise.all(BACKUP_TABLES.map(async ({ key }) => {
      const rows = await supabaseRequest(key + "?select=*");
      if (!Array.isArray(rows)) throw new Error(key + " 返回的数据格式异常。");
      return [key, rows];
    }));

    const tables = Object.fromEntries(results);
    const rowCount = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
    const backup = {
      app: "my-dumbbell-training",
      version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      tables,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "哑铃训练数据备份-" + formatBackupDate() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setBackupStatus("exportStatus", "备份完成：共导出 " + rowCount + " 条数据。", "success");
  } catch (error) {
    console.error("数据备份失败：", error);
    setBackupStatus("exportStatus", "备份失败：" + error.message, "error");
  } finally {
    if (button) { button.disabled = false; button.textContent = "下载备份文件"; }
  }
}

function validateBackup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("文件不是有效的备份文件。");
  if (value.app !== "my-dumbbell-training") throw new Error("该文件不是本应用导出的备份。");
  if (value.version !== BACKUP_VERSION) throw new Error("暂不支持此备份文件版本。");
  if (!value.tables || typeof value.tables !== "object" || Array.isArray(value.tables)) throw new Error("备份文件缺少数据内容。");

  const tables = {};
  for (const { key } of BACKUP_TABLES) {
    const rows = value.tables[key] ?? [];
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error("“" + key + "”的数据格式不正确。");
    }
    tables[key] = rows;
  }
  return { ...value, tables };
}

function showImportPreview(backup, fileName) {
  const preview = getBackupElement("importPreview");
  const confirmRow = getBackupElement("importConfirmRow");
  const confirmation = getBackupElement("importConfirmed");
  const counts = BACKUP_TABLES.filter(({ key }) => backup.tables[key].length)
    .map(({ key, label }) => label + " " + backup.tables[key].length + " 条")
    .join(" · ");
  const total = BACKUP_TABLES.reduce((sum, { key }) => sum + backup.tables[key].length, 0);
  preview.innerHTML = "<strong>已完成本地校验</strong><br>文件：" + escapeBackupHtml(fileName) + "<div class=\"preview-counts\">共 " + total + " 条" + (counts ? " · " + escapeBackupHtml(counts) : "（空备份）") + "</div>";
  preview.classList.remove("hidden");
  confirmation.checked = false;
  confirmRow.classList.remove("hidden");
}

function escapeBackupHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

async function handleBackupFile(event) {
  const file = event.target.files?.[0];
  pendingBackup = null;
  getBackupElement("importButton").disabled = true;
  getBackupElement("importPreview").classList.add("hidden");
  getBackupElement("importConfirmRow").classList.add("hidden");
  if (!file) return;

  try {
    if (file.size > 20 * 1024 * 1024) throw new Error("备份文件不能超过 20 MB。");
    const content = await file.text();
    pendingBackup = validateBackup(JSON.parse(content));
    showImportPreview(pendingBackup, file.name);
    setBackupStatus("importStatus", "文件校验通过，尚未向云端写入任何数据。", "success");
  } catch (error) {
    console.error("备份文件校验失败：", error);
    setBackupStatus("importStatus", "无法导入：" + error.message, "error");
  }
}

function updateImportButton() {
  const allowed = Boolean(pendingBackup && getBackupElement("importConfirmed").checked);
  getBackupElement("importButton").disabled = !allowed;
}

async function importRows(table, rows) {
  const batchSize = 100;
  let imported = 0;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const result = await supabaseRequest(table, {
      method: "POST",
      /* 冲突时跳过，不允许覆盖已有数据。 */
      prefer: "resolution=ignore-duplicates,return=representation",
      body: batch,
    });
    imported += Array.isArray(result) ? result.length : 0;
  }
  return imported;
}

async function importBackup() {
  if (!pendingBackup || !getBackupElement("importConfirmed").checked) return;
  const total = BACKUP_TABLES.reduce((sum, { key }) => sum + pendingBackup.tables[key].length, 0);
  if (!total) { setBackupStatus("importStatus", "这是一个空备份，没有需要导入的数据。", "error"); return; }
  if (!confirm("确认导入吗？\n\n系统只会新增云端不存在的数据；相同 ID 的记录将跳过，不会覆盖。")) return;

  const button = getBackupElement("importButton");
  button.disabled = true;
  button.textContent = "正在安全导入……";
  let imported = 0;
  try {
    for (const { key, label } of BACKUP_TABLES) {
      const rows = pendingBackup.tables[key];
      if (!rows.length) continue;
      setBackupStatus("importStatus", "正在导入“" + label + "”……");
      imported += await importRows(key, rows);
    }
    setBackupStatus("importStatus", "导入完成：新增 " + imported + " 条数据；其余同 ID 数据已安全跳过。", "success");
  } catch (error) {
    console.error("数据导入失败：", error);
    setBackupStatus("importStatus", "导入已停止：" + error.message + "。已成功导入的数据仍会保留。", "error");
  } finally {
    button.textContent = "确认导入";
    updateImportButton();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  getBackupElement("exportButton").addEventListener("click", exportBackup);
  getBackupElement("backupFile").addEventListener("change", handleBackupFile);
  getBackupElement("importConfirmed").addEventListener("change", updateImportButton);
  getBackupElement("importButton").addEventListener("click", importBackup);
});
