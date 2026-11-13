/*
 * js/cycle-plan.js
 * 训练计划页（A/B 多计划，动作选择与排序）
 *
 * 数据：
 * - training_plans: 计划主表（plan_code A/B，支持每类多个）
 * - training_plan_items: 计划项（exercise_id, sort_order, sets/reps/duration_seconds/side）
 * - exercises: 动作库（提供 group_code、equipment_catalog_id、default_*；计划项参数独立保存）
 * - equipment_catalog: 器械规格展示
 *
 * 规则：
 * - A 计划可选 A/D 动作，B 计划可选 B/D 动作（DB 触发器校验 + 前端过滤）
 * - 新增到计划时复制 exercises.default_* 到 item；修改 item 不回写 exercises
 * - 同一动作可重复添加；器械仅来自 exercises -> equipment_catalog
 */

let tpPlans = [];
let tpExercises = [];
let tpEquipmentCatalog = [];

let editingPlanId = null;
let editingPlanOriginal = null;
let editingItems = []; // { _key, id|null, exercise_id, sort_order, sets, reps, duration_seconds, side }
let removedItemIds = [];
let tpSaving = false;
let tpNewItemSeq = 1;

let pickerState = {
  search: "",
  groupFilter: "",
  selectedIds: new Set(),
};

const TP_GROUP_LABELS = {
  A: "A｜上半身 + 核心",
  B: "B｜下半身 + 腹部",
  D: "D｜热身 + 拉伸",
};

function tpEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function tpSetStatus(message, type = "") {
  const box = document.getElementById("planStatus");
  if (!box) return;
  if (!message) {
    box.textContent = "";
    box.className = "status hidden";
    return;
  }
  box.textContent = message;
  box.className = "status" + (type ? " " + type : "");
}

function tpNullableInt(value) {
  const s = String(value ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function tpToInputValue(v) {
  return v == null ? "" : String(v);
}

function tpEquipmentLabel(equipmentCatalogId) {
  const row = tpEquipmentCatalog.find(
    (e) => String(e.id) === String(equipmentCatalogId),
  );
  if (!row) return "未设置";
  const type = String(row.equipment_type || "").trim();
  const rawSpec = row.spec_value;
  const spec = rawSpec == null ? "" : String(rawSpec).trim();
  if (!type && !spec) return "未设置";
  if (type === "无") return "无";
  if (type === "哑铃") {
    if (!spec) return "哑铃";
    return /kg$/i.test(spec) ? `哑铃 ${spec}` : `哑铃 ${spec}kg`;
  }
  if (type === "弹力绳") {
    if (!spec) return "弹力绳";
    return /磅$/.test(spec) ? `弹力绳 ${spec}` : `弹力绳 ${spec}磅`;
  }
  return `${type}${spec ? " " + spec : ""}`.trim() || "未设置";
}

function tpExerciseById(id) {
  return tpExercises.find((e) => String(e.id) === String(id)) || null;
}

function tpGroupLabel(code) {
  return TP_GROUP_LABELS[code] || code || "未分组";
}

function tpFormatDosage(item) {
  const sets = item?.sets;
  const reps = item?.reps;
  const seconds = item?.duration_seconds;
  const side = item?.side === "each_side" ? "每侧" : "双侧/不分侧";
  const repsText =
    reps != null ? `${reps}次${item?.side === "each_side" ? "/侧" : ""}` : null;
  const secText =
    seconds != null
      ? `${seconds}秒${item?.side === "each_side" ? "/侧" : ""}`
      : null;
  if (sets != null && (repsText || secText)) {
    const detail = [repsText, secText].filter(Boolean).join(" + ");
    return `${sets}组 × ${detail}（${side}）`;
  }
  const parts = [];
  if (sets != null) parts.push(`${sets}组`);
  if (repsText) parts.push(repsText);
  if (secText) parts.push(secText);
  if (!parts.length) return "未设置";
  return `${parts.join(" ")}（${side}）`;
}

function tpAllowedGroupsForPlan(planCode) {
  return planCode === "A" ? ["A", "D"] : planCode === "B" ? ["B", "D"] : [];
}

async function loadTrainingPlansPage() {
  tpSetStatus("正在读取训练计划与动作库……");
  try {
    const [plans, exercises, equipment] = await Promise.all([
      supabaseRequest(
        "training_plans?select=id,plan_code,name,description,is_active,sort_order&order=plan_code.asc,sort_order.asc,id.asc",
      ),
      supabaseRequest(
        "exercises?select=id,name,group_code,equipment_catalog_id,instructions,is_active,default_sets,default_reps,default_duration_seconds,default_side&order=group_code.asc,name.asc,id.asc",
      ),
      supabaseRequest(
        "equipment_catalog?select=id,equipment_type,spec_value&order=id.asc",
      ),
    ]);

    tpPlans = Array.isArray(plans) ? plans : [];
    tpExercises = Array.isArray(exercises) ? exercises : [];
    tpEquipmentCatalog = Array.isArray(equipment) ? equipment : [];

    renderPlanList();
    if (editingPlanId != null) {
      renderExercisePicker();
      renderPlanItemsEditor();
    }
    tpSetStatus(`已读取 ${tpPlans.length} 个计划、${tpExercises.length} 个动作。`, "ok");
  } catch (error) {
    console.error(error);
    tpSetStatus("读取失败：" + (error?.message || String(error)), "error");
    renderPlanListLoadError(error);
  }
}

function renderPlanListLoadError(error) {
  const box = document.getElementById("planList");
  if (!box) return;
  box.innerHTML = `<p class="muted">读取失败：${tpEscapeHtml(error?.message || String(error))}</p>`;
}

function renderPlanList() {
  const box = document.getElementById("planList");
  if (!box) return;

  if (!tpPlans.length) {
    box.innerHTML = '<p class="muted">暂无训练计划，请先在上方创建 A 或 B 计划。</p>';
    return;
  }

  const sections = ["A", "B"]
    .map((code) => {
      const list = tpPlans.filter((p) => p.plan_code === code);
      const itemsHtml = list.length
        ? list
            .map((plan) => {
              return `
                <div class="exercise exercise-card" style="margin-top:10px;">
                  <div class="exercise-row">
                    <div class="exercise-info" style="width:100%;">
                      <div class="exercise-name">${tpEscapeHtml(plan.name || "未命名计划")}</div>
                      <div class="exercise-detail">
                        <span class="tag tag-secondary">显示顺序：${tpEscapeHtml(plan.sort_order ?? 1)}</span>
                      </div>
                      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                        <button type="button" class="primary-btn" onclick="openPlanEditor(${plan.id})">✏️ 编辑内容</button>
                        <button type="button" class="secondary-btn" onclick="deleteTrainingPlan(${plan.id})">🗑 删除计划</button>
                      </div>
                    </div>
                  </div>
                </div>`;
            })
            .join("")
        : `<p class="muted" style="margin-top:8px;">暂无 ${code} 类计划。</p>`;

      return `
        <div style="margin-top:${code === "A" ? "0" : "16px"};">
          <h3 style="margin:0 0 4px 0;font-size:16px;">${tpEscapeHtml(TP_GROUP_LABELS[code])}</h3>
          ${itemsHtml}
        </div>`;
    })
    .join("");

  box.innerHTML = sections;
}

async function createTrainingPlan() {
  const plan_code = String(document.getElementById("newPlanCode")?.value || "").trim();
  const name = String(document.getElementById("newPlanName")?.value || "").trim();

  if (!["A", "B"].includes(plan_code)) {
    tpSetStatus("请选择有效的计划类型（A/B）。", "error");
    return;
  }
  if (!name) {
    tpSetStatus("请填写计划名称。", "error");
    return;
  }

  const sameType = tpPlans.filter((p) => p.plan_code === plan_code);
  const sort_order =
    (sameType.reduce((m, p) => Math.max(m, Number(p.sort_order) || 0), 0) || 0) + 1;

  try {
    const result = await supabaseRequest("training_plans", {
      method: "POST",
      body: {
        plan_code,
        name,
        is_active: true,
        sort_order,
      },
    });
    const created = Array.isArray(result) ? result[0] : null;
    tpSetStatus(`已创建 ${plan_code} 类计划「${name}」。`, "ok");
    document.getElementById("newPlanName").value = "";
    await loadTrainingPlansPage();
    if (created?.id != null) {
      await openPlanEditor(created.id);
    }
  } catch (error) {
    console.error(error);
    const msg = String(error?.message || error || "");
    if (msg.includes("23505") || msg.includes("duplicate") || msg.includes("unique")) {
      tpSetStatus("创建失败：同类型下计划名称可能已存在。", "error");
    } else {
      tpSetStatus("创建失败：" + msg, "error");
    }
  }
}

async function deleteTrainingPlan(planId) {
  const plan = tpPlans.find((p) => String(p.id) === String(planId));
  if (!plan) return;
  if (!window.confirm(`确定删除计划「${plan.name}」吗？\n\n该计划下的动作安排也会一并删除，且无法恢复。`)) {
    return;
  }
  try {
    await supabaseRequest(`training_plans?id=eq.${plan.id}`, { method: "DELETE" });
    if (String(editingPlanId) === String(plan.id)) closePlanEditor();
    tpSetStatus(`已删除计划「${plan.name}」。`, "ok");
    await loadTrainingPlansPage();
  } catch (error) {
    console.error(error);
    tpSetStatus("删除失败：" + (error?.message || String(error)), "error");
  }
}

function resetPickerState() {
  pickerState = { search: "", groupFilter: "", selectedIds: new Set() };
  const search = document.getElementById("exercisePickerSearch");
  if (search) search.value = "";
}

async function openPlanEditor(planId) {
  const plan = tpPlans.find((p) => String(p.id) === String(planId));
  if (!plan) {
    tpSetStatus("找不到该计划。", "error");
    return;
  }

  tpSetStatus("正在读取计划内容……");
  try {
    const items = await supabaseRequest(
      `training_plan_items?select=id,plan_id,exercise_id,sort_order,sets,reps,duration_seconds,side&plan_id=eq.${plan.id}&order=sort_order.asc,id.asc`,
    );

    editingPlanId = plan.id;
    editingPlanOriginal = { ...plan };
    removedItemIds = [];
    editingItems = (Array.isArray(items) ? items : []).map((it) => ({
      _key: `db-${it.id}`,
      id: it.id,
      exercise_id: it.exercise_id,
      sort_order: Number(it.sort_order) || 0,
      sets: it.sets ?? null,
      reps: it.reps ?? null,
      duration_seconds: it.duration_seconds ?? null,
      side: it.side ?? null,
    }));
    renumberEditingItems();
    resetPickerState();

    document.getElementById("editPlanName").value = plan.name || "";
    document.getElementById("editPlanSort").value = String(plan.sort_order ?? 1);

    const meta = document.getElementById("planEditorMeta");
    if (meta) {
      const allowed = tpAllowedGroupsForPlan(plan.plan_code)
        .map((g) => TP_GROUP_LABELS[g])
        .join("、");
      meta.innerHTML = `类型：<strong>${tpEscapeHtml(plan.plan_code)}</strong>（可选动作：${tpEscapeHtml(allowed)}）`;
    }
    const title = document.getElementById("planEditorTitle");
    if (title) title.textContent = `✏️ 编辑计划：${plan.plan_code}｜${plan.name}`;

    renderExercisePicker();
    renderPlanItemsEditor();

    const card = document.getElementById("planEditorCard");
    card?.classList.remove("hidden");
    card?.scrollIntoView({ behavior: "smooth", block: "start" });
    tpSetStatus(`已打开计划「${plan.name}」，共 ${editingItems.length} 个动作条目。`, "ok");
  } catch (error) {
    console.error(error);
    tpSetStatus("读取计划内容失败：" + (error?.message || String(error)), "error");
  }
}

function closePlanEditor() {
  editingPlanId = null;
  editingPlanOriginal = null;
  editingItems = [];
  removedItemIds = [];
  resetPickerState();
  document.getElementById("planEditorCard")?.classList.add("hidden");
}

function getPickerAllowedGroups() {
  const plan = tpPlans.find((p) => String(p.id) === String(editingPlanId));
  return plan ? tpAllowedGroupsForPlan(plan.plan_code) : [];
}

function getFilteredPickerExercises() {
  const plan = tpPlans.find((p) => String(p.id) === String(editingPlanId));
  if (!plan) return [];
  const allowed = new Set(tpAllowedGroupsForPlan(plan.plan_code));
  const q = String(pickerState.search || "").trim().toLowerCase();
  const gf = pickerState.groupFilter;

  return tpExercises.filter((e) => {
    if (e.is_active === false) return false;
    if (!allowed.has(e.group_code)) return false;
    if (gf && e.group_code !== gf) return false;
    if (q) {
      const name = String(e.name || "").toLowerCase();
      if (!name.includes(q)) return false;
    }
    return true;
  });
}

function renderExercisePicker() {
  renderExercisePickerFilters();
  renderExercisePickerList();
  updateExercisePickerSelectedCount();
}

function renderExercisePickerFilters() {
  const box = document.getElementById("exercisePickerGroupFilters");
  if (!box) return;
  const allowed = getPickerAllowedGroups();
  if (!allowed.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = allowed
    .map((code) => {
      const active = pickerState.groupFilter === code;
      return `<button type="button" class="${active ? "primary-btn" : "secondary-btn"}" onclick="setExercisePickerGroupFilter('${code}')">${code}</button>`;
    })
    .join("");
}

function setExercisePickerGroupFilter(code) {
  const next = code || "";
  pickerState.groupFilter = pickerState.groupFilter === next ? "" : next;
  renderExercisePicker();
}

function onExercisePickerSearch(value) {
  pickerState.search = value || "";
  renderExercisePickerList();
  updateExercisePickerSelectedCount();
}

function renderExercisePickerList() {
  const box = document.getElementById("exercisePickerList");
  if (!box) return;
  if (editingPlanId == null) {
    box.innerHTML = '<p class="muted">请先选择计划。</p>';
    return;
  }
  const list = getFilteredPickerExercises();
  if (!list.length) {
    box.innerHTML = '<p class="muted">没有匹配的启用动作。</p>';
    return;
  }

  box.innerHTML = list
    .map((e) => {
      const id = String(e.id);
      const checked = pickerState.selectedIds.has(id) ? "checked" : "";
      const eq = tpEquipmentLabel(e.equipment_catalog_id);
      return `
        <label style="display:flex;gap:10px;align-items:flex-start;padding:8px 4px;border-bottom:1px solid #f0f0f0;cursor:pointer;">
          <input type="checkbox" ${checked} onchange="toggleExercisePickerSelection('${id}', this.checked)" style="width:auto;margin-top:4px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;color:#222;">${tpEscapeHtml(e.name)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
              <span class="tag tag-primary">${tpEscapeHtml(e.group_code)}</span>
              <span class="tag tag-secondary">器械：${tpEscapeHtml(eq)}</span>
            </div>
          </div>
        </label>`;
    })
    .join("");
}

function toggleExercisePickerSelection(id, checked) {
  const key = String(id);
  if (checked) pickerState.selectedIds.add(key);
  else pickerState.selectedIds.delete(key);
  updateExercisePickerSelectedCount();
}

function updateExercisePickerSelectedCount() {
  const el = document.getElementById("exercisePickerSelectedCount");
  if (el) el.textContent = `已选 ${pickerState.selectedIds.size} 个`;
}

function clearExercisePickerSelection() {
  pickerState.selectedIds.clear();
  renderExercisePickerList();
  updateExercisePickerSelectedCount();
}

function renumberEditingItems() {
  editingItems.forEach((item, idx) => {
    item.sort_order = idx + 1;
  });
}

function addSelectedExercisesToPlan() {
  const plan = tpPlans.find((p) => String(p.id) === String(editingPlanId));
  if (!plan) return;
  const allowed = tpAllowedGroupsForPlan(plan.plan_code);
  const ids = Array.from(pickerState.selectedIds);
  if (!ids.length) {
    tpSetStatus("请先勾选要添加的动作。", "error");
    return;
  }

  let added = 0;
  ids.forEach((id) => {
    const exercise = tpExerciseById(id);
    if (!exercise) return;
    if (!allowed.includes(exercise.group_code)) return;
    editingItems.push({
      _key: `new-${tpNewItemSeq++}`,
      id: null,
      exercise_id: exercise.id,
      sort_order: editingItems.length + 1,
      sets: exercise.default_sets ?? null,
      reps: exercise.default_reps ?? null,
      duration_seconds: exercise.default_duration_seconds ?? null,
      side: exercise.default_side ?? null,
    });
    added += 1;
  });

  renumberEditingItems();
  pickerState.selectedIds.clear();
  renderExercisePicker();
  renderPlanItemsEditor();
  if (added > 0) {
    tpSetStatus(`已添加 ${added} 个动作（已复制各自默认参数，可在下方修改）。`, "ok");
  } else {
    tpSetStatus("未添加任何动作，请检查所选动作是否可用。", "error");
  }
}

function setItemField(index, field, value) {
  const item = editingItems[index];
  if (!item) return;
  if (field === "side") {
    item.side = value === "both" || value === "each_side" ? value : null;
    return;
  }
  if (["sets", "reps", "duration_seconds"].includes(field)) {
    item[field] = tpNullableInt(value);
  }
}

function movePlanItem(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= editingItems.length) return;
  const tmp = editingItems[index];
  editingItems[index] = editingItems[target];
  editingItems[target] = tmp;
  renumberEditingItems();
  renderPlanItemsEditor();
}

function removePlanItem(index) {
  const item = editingItems[index];
  if (!item) return;
  if (item.id != null) removedItemIds.push(item.id);
  editingItems.splice(index, 1);
  renumberEditingItems();
  renderPlanItemsEditor();
}

function renderPlanItemsEditor() {
  const box = document.getElementById("planItemsEditor");
  if (!box) return;
  if (!editingItems.length) {
    box.innerHTML = '<p class="muted">该计划还没有动作。请从上方勾选并添加动作。</p>';
    return;
  }

  box.innerHTML = `
    <h3 style="margin:0 0 8px 0;font-size:16px;">计划动作（共 ${editingItems.length} 项，按顺序执行）</h3>
    <div class="editor-rows">
      ${editingItems.map((item, index) => renderPlanItemRow(item, index)).join("")}
    </div>
    <p class="muted" style="margin-top:8px;">提示：同一动作可重复添加，且每条参数独立。器械由动作库关联决定，不在计划中修改。</p>
  `;
}

function renderPlanItemRow(item, index) {
  const ex = tpExerciseById(item.exercise_id);
  const name = ex?.name || `动作 #${item.exercise_id}`;
  const group = ex?.group_code || "?";
  const equipment = tpEquipmentLabel(ex?.equipment_catalog_id);
  const inactive = ex && ex.is_active === false;
  const side = item.side || "";

  return `
    <div class="editor-row ${inactive ? "is-disabled" : ""}">
      <div class="editor-row-head">
        <strong>#${index + 1} ${tpEscapeHtml(name)}</strong>
        <div class="editor-row-tools">
          <button type="button" class="mini-btn" onclick="movePlanItem(${index}, -1)" ${index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="mini-btn" onclick="movePlanItem(${index}, 1)" ${index === editingItems.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="mini-btn" onclick="removePlanItem(${index})">移除</button>
        </div>
      </div>
      <div class="exercise-detail" style="margin-bottom:8px;">
        <span class="tag tag-primary">${tpEscapeHtml(tpGroupLabel(group))}</span>
        <span class="tag tag-secondary">器械：${tpEscapeHtml(equipment)}</span>
        ${inactive ? '<span class="tag tag-off">动作已停用</span>' : ""}
      </div>
      <div class="form-grid">
        <label>
          <span>组数</span>
          <input type="number" min="1" step="1" value="${tpToInputValue(item.sets)}" placeholder="如 3" oninput="setItemField(${index}, 'sets', this.value)">
        </label>
        <label>
          <span>次数</span>
          <input type="number" min="1" step="1" value="${tpToInputValue(item.reps)}" placeholder="如 12" oninput="setItemField(${index}, 'reps', this.value)">
        </label>
        <label>
          <span>时长(秒)</span>
          <input type="number" min="1" step="1" value="${tpToInputValue(item.duration_seconds)}" placeholder="如 30" oninput="setItemField(${index}, 'duration_seconds', this.value)">
        </label>
        <label>
          <span>计量侧别</span>
          <select onchange="setItemField(${index}, 'side', this.value)">
            <option value="" ${side === "" ? "selected" : ""}>未指定</option>
            <option value="both" ${side === "both" ? "selected" : ""}>双侧/不分侧</option>
            <option value="each_side" ${side === "each_side" ? "selected" : ""}>每侧</option>
          </select>
        </label>
      </div>
      <div class="muted" style="margin-top:6px;font-size:12px;">当前：${tpEscapeHtml(tpFormatDosage(item))}</div>
    </div>
  `;
}

async function savePlanEditor() {
  if (tpSaving || editingPlanId == null) return;
  const plan = tpPlans.find((p) => String(p.id) === String(editingPlanId));
  if (!plan) return;

  const name = String(document.getElementById("editPlanName")?.value || "").trim();
  const sort_order = tpNullableInt(document.getElementById("editPlanSort")?.value) ?? 1;

  if (!name) {
    tpSetStatus("计划名称不能为空。", "error");
    return;
  }
  if (sort_order <= 0) {
    tpSetStatus("显示顺序必须大于 0。", "error");
    return;
  }

  for (let i = 0; i < editingItems.length; i++) {
    const it = editingItems[i];
    if (it.sets != null && it.sets <= 0) return tpSetStatus(`第 ${i + 1} 项组数必须大于 0。`, "error");
    if (it.reps != null && it.reps <= 0) return tpSetStatus(`第 ${i + 1} 项次数必须大于 0。`, "error");
    if (it.duration_seconds != null && it.duration_seconds <= 0) return tpSetStatus(`第 ${i + 1} 项时长必须大于 0。`, "error");
  }

  tpSaving = true;
  tpSetStatus("正在保存计划……");
  try {
    const updatedPlan = await supabaseRequest(`training_plans?id=eq.${plan.id}`, {
      method: "PATCH",
      body: { name, sort_order },
    });
    if (!Array.isArray(updatedPlan) || updatedPlan.length === 0) {
      throw new Error("计划信息未更新（可能无权限或记录不存在）。");
    }

    for (const itemId of removedItemIds) {
      await supabaseRequest(`training_plan_items?id=eq.${itemId}`, { method: "DELETE" });
    }

    const existingIds = editingItems.filter((it) => it.id != null).map((it) => it.id);
    for (let i = 0; i < existingIds.length; i++) {
      const id = existingIds[i];
      const tempOrder = 100000 + i + 1;
      await supabaseRequest(`training_plan_items?id=eq.${id}`, {
        method: "PATCH",
        body: { sort_order: tempOrder },
      });
    }

    const finalItemsState = [];
    for (let i = 0; i < editingItems.length; i++) {
      const it = editingItems[i];
      const payload = {
        plan_id: plan.id,
        exercise_id: it.exercise_id,
        sort_order: i + 1,
        sets: it.sets,
        reps: it.reps,
        duration_seconds: it.duration_seconds,
        side: it.side,
      };
      if (it.id != null) {
        const res = await supabaseRequest(`training_plan_items?id=eq.${it.id}`, {
          method: "PATCH",
          body: payload,
        });
        const row = Array.isArray(res) ? res[0] : null;
        finalItemsState.push({
          _key: `db-${it.id}`,
          id: it.id,
          exercise_id: row?.exercise_id ?? it.exercise_id,
          sort_order: i + 1,
          sets: row?.sets ?? it.sets,
          reps: row?.reps ?? it.reps,
          duration_seconds: row?.duration_seconds ?? it.duration_seconds,
          side: row?.side ?? it.side,
        });
      } else {
        const res = await supabaseRequest("training_plan_items", {
          method: "POST",
          body: payload,
        });
        const row = Array.isArray(res) ? res[0] : null;
        if (!row?.id) throw new Error("新增动作条目失败。");
        finalItemsState.push({
          _key: `db-${row.id}`,
          id: row.id,
          exercise_id: row.exercise_id ?? it.exercise_id,
          sort_order: i + 1,
          sets: row.sets ?? it.sets,
          reps: row.reps ?? it.reps,
          duration_seconds: row.duration_seconds ?? it.duration_seconds,
          side: row.side ?? it.side,
        });
      }
    }

    removedItemIds = [];
    editingItems = finalItemsState;
    tpSetStatus(`计划「${name}」已保存，共 ${editingItems.length} 个动作条目。`, "ok");
    await loadTrainingPlansPage();
    await openPlanEditor(plan.id);
  } catch (error) {
    console.error(error);
    const msg = String(error?.message || error || "");
    if (msg.includes("23505") || msg.includes("uq_training_plan_items_plan_sort")) {
      tpSetStatus("保存失败：排序冲突，请重试。", "error");
    } else if (msg.includes("INVALID_EXERCISE_GROUP_FOR_PLAN")) {
      tpSetStatus("保存失败：存在不符合计划类型的动作（A 计划仅可选 A/D，B 计划仅可选 B/D）。", "error");
    } else {
      tpSetStatus("保存失败：" + msg, "error");
    }
    try { await loadTrainingPlansPage(); if (editingPlanId != null) await openPlanEditor(editingPlanId); } catch (_) {}
  } finally {
    tpSaving = false;
  }
}

document.addEventListener("DOMContentLoaded", function () {
  loadTrainingPlansPage();
});
