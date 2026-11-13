/*
 * exercises.js
 * 动作库（A/B/D 分组 + 固定器械规格）
 *
 * 数据结构：
 * - exercises(id, name, group_code, equipment_catalog_id, instructions, is_active)
 * - equipment_catalog(id, equipment_type, spec_value[, is_active])
 */

let exercisesLibrary = [];
let equipmentCatalog = [];

const EXERCISE_PAGE_SIZE = 10;

const GROUP_LABELS = {
  A: "A｜上半身 + 核心",
  B: "B｜下半身 + 腹部",
  D: "D｜热身 + 拉伸",
};

const GROUP_ORDER = ["A", "B", "D"];

let exerciseLibraryState = {
  page: 1,
  groupFilter: "all",
  editingId: null,
};

/* =========================================================
   工具
========================================================= */

function exerciseEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function exerciseStatus(message, type = "") {
  const box = document.getElementById("exerciseLibraryStatus");
  if (!box) return;
  box.textContent = message;
  box.className = "status" + (type ? " " + type : "") + (message ? "" : " hidden");
}

async function exerciseSafeRequest(path) {
  try {
    return { data: await supabaseRequest(path), error: null };
  } catch (error) {
    return { data: [], error };
  }
}

function formatEquipmentLabel(item) {
  if (!item) return "未指定器械";
  const type = String(item.equipment_type || "");
  const value = item.spec_value;

  if (type === "无") return "无";
  if (type === "哑铃") {
    const n = Number(value);
    return `哑铃 ${Number.isFinite(n) ? n : value}kg`;
  }
  if (type === "弹力绳") {
    const n = Number(value);
    return `弹力绳 ${Number.isFinite(n) ? n : value}磅`;
  }
  return type || "未指定器械";
}

function getEquipmentById(id) {
  return equipmentCatalog.find((item) => String(item.id) === String(id)) || null;
}

function getEquipmentLabelById(id) {
  return formatEquipmentLabel(getEquipmentById(id));
}

function getGroupLabel(code) {
  return GROUP_LABELS[code] || code || "未分组";
}

function formatDefaultDosage(exercise) {
  const sets = exercise?.default_sets;
  const reps = exercise?.default_reps;
  const seconds = exercise?.default_duration_seconds;
  const side = exercise?.default_side === "each_side" ? "每侧" : "双侧/不分侧";
  const parts = [];

  if (sets != null) parts.push(`${sets}组`);
  if (reps != null) parts.push(`${reps}次${exercise?.default_side === "each_side" ? "/侧" : ""}`);
  if (seconds != null) parts.push(`${seconds}秒${exercise?.default_side === "each_side" ? "/侧" : ""}`);
  if (!parts.length) return "未设置";
  if (sets != null && (reps != null || seconds != null)) {
    // show sets × detail
    const detail = [reps != null ? `${reps}次${exercise?.default_side === "each_side" ? "/侧" : ""}` : null, seconds != null ? `${seconds}秒${exercise?.default_side === "each_side" ? "/侧" : ""}` : null].filter(Boolean).join(" + ");
    return `${sets}组 × ${detail}（${side}）`;
  }
  return `${parts.join(" ")}（${side}）`;
}

function toNullableInt(value) {
  const s = String(value ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/* =========================================================
   读取
========================================================= */

async function loadExercisesPage() {
  exerciseStatus("正在读取动作库……");

  const [exerciseResult, equipmentResult] = await Promise.all([
    exerciseSafeRequest(
      "exercises?select=id,name,group_code,equipment_catalog_id,instructions,is_active,default_sets,default_reps,default_duration_seconds,default_side&order=group_code.asc,name.asc,id.asc",
    ),
    exerciseSafeRequest(
      "equipment_catalog?select=id,equipment_type,spec_value&order=id.asc",
    ),
  ]);

  exercisesLibrary = Array.isArray(exerciseResult.data) ? exerciseResult.data : [];
  equipmentCatalog = Array.isArray(equipmentResult.data) ? equipmentResult.data : [];

  renderEquipmentOptions();
  renderEquipmentCatalogList();
  renderExercisesLibrary();

  const firstError = exerciseResult.error || equipmentResult.error;
  if (firstError) {
    const msg = String(firstError?.message || firstError || "未知错误");
    exerciseStatus("读取失败：" + msg, "error");
    return;
  }

  const activeCount = exercisesLibrary.filter((e) => e.is_active !== false).length;
  exerciseStatus(
    `动作库已读取：共 ${exercisesLibrary.length} 个，启用 ${activeCount} 个。`,
    "ok",
  );
}

/* =========================================================
   器械规格
========================================================= */

function getEquipmentOptionsHtml(selectedId = null) {
  const active = equipmentCatalog.filter((e) => e.is_active !== false);
  const source = active.length ? active : equipmentCatalog;
  const options = source
    .map((item) => {
      const label = formatEquipmentLabel(item);
      const selected = String(item.id) === String(selectedId) ? " selected" : "";
      return `<option value="${exerciseEscapeHtml(item.id)}"${selected}>${exerciseEscapeHtml(label)}</option>`;
    })
    .join("");
  return options || '<option value="">暂无可用器械规格</option>';
}

function renderEquipmentOptions() {
  const select = document.getElementById("newExerciseEquipment");
  if (!select) return;

  select.innerHTML = getEquipmentOptionsHtml(null);

  // 默认优先选“无”
  const none = equipmentCatalog.find((e) => e.equipment_type === "无" && e.spec_value == null);
  if (none) {
    select.value = String(none.id);
  }
}

function renderEquipmentCatalogList() {
  const box = document.getElementById("equipmentCatalogList");
  const summary = document.getElementById("equipmentSummary");
  if (!box) return;

  const list = Array.isArray(equipmentCatalog) ? equipmentCatalog : [];
  if (summary) {
    summary.textContent = `共 ${list.length} 种固定规格。`;
  }

  if (!list.length) {
    box.innerHTML = '<p class="muted">未读取到器械规格数据。</p>';
    return;
  }

  box.innerHTML = list
    .map((item) => {
      const label = formatEquipmentLabel(item);
      return `
        <div class="exercise">
          <div class="exercise-row">
            <div class="exercise-info">
              <div class="exercise-name">
                🎒 ${exerciseEscapeHtml(label)}
                <span class="tag tag-ok">固定规格</span>
              </div>
              <div class="exercise-detail">类型：${exerciseEscapeHtml(item.equipment_type || "-")}；规格值：${exerciseEscapeHtml(item.spec_value ?? "无")}；ID：${exerciseEscapeHtml(item.id)}</div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

/* =========================================================
   查询辅助 / 筛选
========================================================= */

function exerciseMatchesSearch(exercise, keyword) {
  if (!keyword) return true;
  const equipmentLabel = getEquipmentLabelById(exercise.equipment_catalog_id);
  const groupLabel = getGroupLabel(exercise.group_code);
  const haystack = [
    exercise.name,
    exercise.group_code,
    groupLabel,
    equipmentLabel,
    exercise.instructions,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(keyword);
}

function onExerciseFiltersChanged() {
  exerciseLibraryState.page = 1;
  renderExercisesLibrary();
}

function setExerciseGroupFilter(code) {
  const next = code || "all";
  exerciseLibraryState.groupFilter =
    exerciseLibraryState.groupFilter === next && next !== "all" ? "all" : next;
  exerciseLibraryState.page = 1;
  renderExercisesLibrary();
}

function updateGroupFilterButtons() {
  document.querySelectorAll(".group-filter-btn").forEach((btn) => {
    const active = (btn.dataset.group || "") === exerciseLibraryState.groupFilter;
    btn.classList.toggle("primary-btn", active);
    btn.classList.toggle("secondary-btn", !active);
  });

  const hint = document.getElementById("exerciseFilterHint");
  if (hint) {
    hint.textContent =
      exerciseLibraryState.groupFilter === "all"
        ? "默认显示全部；点击 A/B/D 可按分组筛选，再次点击取消筛选。"
        : `当前筛选：${getGroupLabel(exerciseLibraryState.groupFilter)}（再次点击同一按钮可取消筛选）`;
  }
}

/* =========================================================
   渲染
========================================================= */

function renderExercisesLibrary() {
  const box = document.getElementById("exercisesLibrary");
  if (!box) return;

  updateGroupFilterButtons();

  const keyword = String(document.getElementById("exerciseSearch")?.value || "")
    .trim()
    .toLowerCase();

  const exercises = Array.isArray(exercisesLibrary) ? exercisesLibrary : [];
  const filtered = exercises.filter((exercise) => {
    const groupOk =
      exerciseLibraryState.groupFilter === "all" ||
      String(exercise.group_code) === String(exerciseLibraryState.groupFilter);
    return groupOk && exerciseMatchesSearch(exercise, keyword);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / EXERCISE_PAGE_SIZE));
  if (exerciseLibraryState.page > totalPages) exerciseLibraryState.page = totalPages;
  if (exerciseLibraryState.page < 1) exerciseLibraryState.page = 1;

  const start = (exerciseLibraryState.page - 1) * EXERCISE_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + EXERCISE_PAGE_SIZE);

  const summary = document.getElementById("exerciseLibrarySummary");
  if (summary) {
    const activeCount = exercises.filter((e) => e.is_active !== false).length;
    summary.textContent =
      `共 ${exercises.length} 个动作（启用 ${activeCount}，停用 ${exercises.length - activeCount}）；` +
      `筛选后 ${filtered.length} 个；第 ${exerciseLibraryState.page}/${totalPages} 页。`;
  }

  if (!filtered.length) {
    box.innerHTML = '<p class="muted">没有匹配的动作。可尝试清空搜索或切换分组筛选。</p>';
    renderExercisePagination(0, 1);
    return;
  }

  const groups = new Map();
  pageItems.forEach((exercise) => {
    const code = GROUP_ORDER.includes(exercise.group_code) ? exercise.group_code : "other";
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(exercise);
  });

  const orderedCodes = [...GROUP_ORDER.filter((c) => groups.has(c)), ...(groups.has("other") ? ["other"] : [])];

  box.innerHTML = orderedCodes
    .map((code) => {
      const items = groups.get(code) || [];
      return items.map((exercise) => renderExerciseCard(exercise)).join("");
    })
    .join("");

  renderExercisePagination(filtered.length, totalPages);
}

function renderExercisePagination(total, totalPages) {
  const box = document.getElementById("exercisePagination");
  if (!box) return;

  if (!total || totalPages <= 1) {
    box.innerHTML = total ? `<div class="muted" style="text-align:center;">共 ${total} 个动作</div>` : "";
    return;
  }

  const page = exerciseLibraryState.page;
  box.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:nowrap;">
      <button type="button" class="secondary-btn" ${page <= 1 ? "disabled" : ""} onclick="changeExercisePage(${page - 1})" style="flex:1;min-width:0;">上一页</button>
      <span class="muted" style="white-space:nowrap;font-size:13px;">${page} / ${totalPages}（${total}）</span>
      <button type="button" class="secondary-btn" ${page >= totalPages ? "disabled" : ""} onclick="changeExercisePage(${page + 1})" style="flex:1;min-width:0;">下一页</button>
    </div>
  `;
}

function changeExercisePage(page) {
  exerciseLibraryState.page = Number(page) || 1;
  renderExercisesLibrary();
}

function renderExerciseCard(exercise) {
  const active = exercise.is_active !== false;
  const isEditing = String(exerciseLibraryState.editingId) === String(exercise.id);
  const groupLabel = getGroupLabel(exercise.group_code);
  const equipmentLabel = getEquipmentLabelById(exercise.equipment_catalog_id);

  const groupOptionsHtml = GROUP_ORDER.map((code) => {
    const selected = String(exercise.group_code) === code ? "selected" : "";
    return `<option value="${code}" ${selected}>${exerciseEscapeHtml(GROUP_LABELS[code] || code)}</option>`;
  }).join("");
  const equipmentOptionsHtml = getEquipmentOptionsHtml(exercise.equipment_catalog_id);

  const editHtml = isEditing
    ? `
      <div class="exercise-detail" style="display:grid;gap:8px;margin-top:8px;">
        <label style="display:grid;gap:4px;">
          <span><strong>动作名称</strong></span>
          <input id="editName-${exercise.id}" type="text" value="${exerciseEscapeHtml(exercise.name || "")}" placeholder="动作名称">
        </label>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
          <label style="display:grid;gap:4px;">
            <span><strong>类型</strong></span>
            <select id="editGroup-${exercise.id}">${groupOptionsHtml}</select>
          </label>
          <label style="display:grid;gap:4px;">
            <span><strong>器械</strong></span>
            <select id="editEquipment-${exercise.id}">${equipmentOptionsHtml}</select>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
          <label style="display:grid;gap:4px;"><span>默认组数</span><input id="editSets-${exercise.id}" type="number" min="1" step="1" value="${exercise.default_sets ?? ""}" placeholder="如 3"></label>
          <label style="display:grid;gap:4px;"><span>默认次数</span><input id="editReps-${exercise.id}" type="number" min="1" step="1" value="${exercise.default_reps ?? ""}" placeholder="如 12"></label>
          <label style="display:grid;gap:4px;"><span>默认时长(秒)</span><input id="editSeconds-${exercise.id}" type="number" min="1" step="1" value="${exercise.default_duration_seconds ?? ""}" placeholder="如 30"></label>
          <label style="display:grid;gap:4px;"><span>计量侧别</span>
            <select id="editSide-${exercise.id}">
              <option value="" ${exercise.default_side == null ? "selected" : ""}>未指定</option>
              <option value="both" ${exercise.default_side === "both" ? "selected" : ""}>双侧/不分侧</option>
              <option value="each_side" ${exercise.default_side === "each_side" ? "selected" : ""}>每侧</option>
            </select>
          </label>
        </div>
        <label style="display:grid;gap:4px;">
          <span><strong>动作要点</strong></span>
          <textarea id="exerciseInstructions-${exercise.id}" class="note" rows="4">${exerciseEscapeHtml(exercise.instructions || "")}</textarea>
        </label>
        <div style="display:flex;gap:8px;">
          <button type="button" class="primary-btn" onclick="saveExerciseEdits(${exercise.id})" style="flex:1;">保存</button>
          <button type="button" class="secondary-btn" onclick="cancelEditExercise()" style="flex:1;">取消</button>
        </div>
      </div>`
    : `
      <div class="exercise-detail"><strong>默认计量：</strong>${exerciseEscapeHtml(formatDefaultDosage(exercise))}</div>
      <div class="exercise-detail"><strong>动作要点：</strong>${exercise.instructions ? exerciseEscapeHtml(exercise.instructions) : '<span class="muted">暂无</span>'}</div>
      <div style="margin-top:6px;">
        <button type="button" class="secondary-btn" onclick="startEditExercise(${exercise.id})">✏️ 编辑</button>
      </div>`;

  return `
    <div class="exercise exercise-card ${active ? "" : "is-disabled"}">
      <div class="exercise-row">
        <div class="exercise-info">
          <div class="exercise-name">
            ${exerciseEscapeHtml(exercise.name || "未命名动作")}
            <span class="tag ${active ? "tag-ok" : "tag-off"}">${active ? "启用" : "停用"}</span>
          </div>
          <div class="exercise-detail">
            <span class="tag tag-primary">${exerciseEscapeHtml(groupLabel)}</span>
            <span class="tag tag-secondary">器械：${exerciseEscapeHtml(equipmentLabel)}</span>
          </div>
          ${editHtml}
        </div>
      </div>
      <button type="button" class="secondary-btn exercise-toggle" onclick="toggleExerciseActive(${exercise.id})">
        ${active ? "⏸ 停用动作" : "▶️ 启用动作"}
      </button>
    </div>
  `;
}

/* =========================================================
   启用 / 停用 / 编辑要点 / 新增
========================================================= */

async function toggleExerciseActive(exerciseId) {
  const exercise = exercisesLibrary.find((item) => String(item.id) === String(exerciseId));
  if (!exercise) {
    exerciseStatus("找不到该动作。", "error");
    return;
  }

  const nextActive = exercise.is_active === false;
  if (!window.confirm((nextActive ? "启用" : "停用") + `动作「${exercise.name}」？`)) {
    return;
  }

  try {
    const result = await supabaseRequest(`exercises?id=eq.${exercise.id}`, {
      method: "PATCH",
      body: { is_active: nextActive },
    });
    if (!Array.isArray(result) || result.length === 0) {
      throw new Error("未更新任何记录。");
    }
    exerciseStatus(`动作「${exercise.name}」已${nextActive ? "启用" : "停用"}。`, "ok");
    await loadExercisesPage();
  } catch (error) {
    console.error(error);
    exerciseStatus("操作失败：" + (error?.message || String(error)), "error");
  }
}

function startEditExercise(exerciseId) {
  exerciseLibraryState.editingId = exerciseId;
  renderExercisesLibrary();
}

function cancelEditExercise() {
  exerciseLibraryState.editingId = null;
  renderExercisesLibrary();
}

async function saveExerciseEdits(exerciseId) {
  const exercise = exercisesLibrary.find((item) => String(item.id) === String(exerciseId));
  if (!exercise) {
    exerciseStatus("找不到该动作。", "error");
    return;
  }

  const name = String(document.getElementById(`editName-${exerciseId}`)?.value || "").trim();
  const group_code = String(document.getElementById(`editGroup-${exerciseId}`)?.value || "").trim();
  const equipment_catalog_id_raw = String(document.getElementById(`editEquipment-${exerciseId}`)?.value || "").trim();
  const instructions = String(document.getElementById(`exerciseInstructions-${exerciseId}`)?.value || "").trim();
  const default_sets = toNullableInt(document.getElementById(`editSets-${exerciseId}`)?.value);
  const default_reps = toNullableInt(document.getElementById(`editReps-${exerciseId}`)?.value);
  const default_duration_seconds = toNullableInt(document.getElementById(`editSeconds-${exerciseId}`)?.value);
  const sideRaw = String(document.getElementById(`editSide-${exerciseId}`)?.value || "").trim();
  const default_side = sideRaw === "each_side" || sideRaw === "both" ? sideRaw : null;

  if (!name) return exerciseStatus("请填写动作名称。", "error");
  if (!["A", "B", "D"].includes(group_code)) return exerciseStatus("请选择有效的动作类型（A/B/D）。", "error");
  if (!equipment_catalog_id_raw) return exerciseStatus("请选择器械。", "error");
  const equipment_catalog_id = Number(equipment_catalog_id_raw);
  if (!Number.isFinite(equipment_catalog_id)) return exerciseStatus("器械选择无效。", "error");
  if (default_sets != null && default_sets <= 0) return exerciseStatus("默认组数必须大于 0。", "error");
  if (default_reps != null && default_reps <= 0) return exerciseStatus("默认次数必须大于 0。", "error");
  if (default_duration_seconds != null && default_duration_seconds <= 0) return exerciseStatus("默认时长必须大于 0。", "error");

  try {
    const result = await supabaseRequest(`exercises?id=eq.${exercise.id}`, {
      method: "PATCH",
      body: {
        name,
        group_code,
        equipment_catalog_id,
        instructions: instructions || null,
        default_sets,
        default_reps,
        default_duration_seconds,
        default_side,
      },
    });
    if (!Array.isArray(result) || result.length === 0) {
      throw new Error("未更新任何记录。");
    }
    exerciseLibraryState.editingId = null;
    exerciseStatus(`动作「${name}」已更新。`, "ok");
    await loadExercisesPage();
  } catch (error) {
    console.error(error);
    const msg = String(error?.message || error || "");
    if (msg.includes("duplicate") || msg.includes("unique") || msg.includes("23505")) {
      exerciseStatus("保存失败：动作名称已存在。", "error");
    } else {
      exerciseStatus("保存失败：" + msg, "error");
    }
  }
}

function openAddExerciseForm() {
  renderEquipmentOptions();
  document.getElementById("addExerciseForm")?.classList.remove("hidden");
  document.getElementById("newExerciseName")?.focus();
}

function closeAddExerciseForm() {
  document.getElementById("addExerciseForm")?.classList.add("hidden");

  const name = document.getElementById("newExerciseName");
  if (name) name.value = "";
  const group = document.getElementById("newExerciseGroup");
  if (group) group.value = "A";
  const instructions = document.getElementById("newExerciseInstructions");
  if (instructions) instructions.value = "";

  ["newExerciseSets", "newExerciseReps", "newExerciseSeconds"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const side = document.getElementById("newExerciseSide");
  if (side) side.value = "";

  renderEquipmentOptions();
}

async function submitNewExercise() {
  const name = String(document.getElementById("newExerciseName")?.value || "").trim();
  const group_code = String(document.getElementById("newExerciseGroup")?.value || "").trim();
  const equipment_catalog_id = String(document.getElementById("newExerciseEquipment")?.value || "").trim();
  const instructions = String(document.getElementById("newExerciseInstructions")?.value || "").trim();
  const default_sets = toNullableInt(document.getElementById("newExerciseSets")?.value);
  const default_reps = toNullableInt(document.getElementById("newExerciseReps")?.value);
  const default_duration_seconds = toNullableInt(document.getElementById("newExerciseSeconds")?.value);
  const sideRaw = String(document.getElementById("newExerciseSide")?.value || "").trim();
  const default_side = sideRaw === "each_side" || sideRaw === "both" ? sideRaw : null;

  if (!name) {
    exerciseStatus("请填写动作名称。", "error");
    return;
  }
  if (!["A", "B", "D"].includes(group_code)) {
    exerciseStatus("请选择有效分组（A/B/D）。", "error");
    return;
  }
  if (!equipment_catalog_id) {
    exerciseStatus("请选择器械规格。", "error");
    return;
  }
  if (default_sets != null && default_sets <= 0) return exerciseStatus("默认组数必须大于 0。", "error");
  if (default_reps != null && default_reps <= 0) return exerciseStatus("默认次数必须大于 0。", "error");
  if (default_duration_seconds != null && default_duration_seconds <= 0) return exerciseStatus("默认时长必须大于 0。", "error");

  try {
    await supabaseRequest("exercises", {
      method: "POST",
      body: {
        name,
        group_code,
        equipment_catalog_id: Number(equipment_catalog_id),
        instructions: instructions || null,
        is_active: true,
        default_sets,
        default_reps,
        default_duration_seconds,
        default_side,
      },
    });

    exerciseStatus(`已新增动作「${name}」。`, "ok");
    closeAddExerciseForm();
    exerciseLibraryState.page = 1;
    await loadExercisesPage();
  } catch (error) {
    console.error(error);
    const msg = String(error?.message || error || "");
    if (msg.includes("duplicate") || msg.includes("unique") || msg.includes("23505")) {
      exerciseStatus("新增失败：动作名称已存在。", "error");
    } else if (msg.includes("column") && msg.includes("default_")) {
      exerciseStatus("新增失败：数据库尚未添加默认计量字段，请先执行 SQL 升级 exercises 表。", "error");
    } else {
      exerciseStatus("新增失败：" + msg, "error");
    }
  }
}

/* =========================================================
   启动
========================================================= */

document.addEventListener("DOMContentLoaded", function () {
  loadExercisesPage();
});
