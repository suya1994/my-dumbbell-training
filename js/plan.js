/*
 * js/plan.js
 * 首页：显示下一次训练计划（A/B 自动循环）+ 每个动作完成/未完成标记 + 训练次数统计
 */

let homePlans = [];
let homeExercises = [];
let homeEquipmentCatalog = [];
let homeCurrentPlan = null;
let homeCurrentItems = [];
let homeCompletedCount = 0;

const HOME_NEXT_PLAN_CODE_KEY = "homeNextPlanCode"; // 'A' or 'B'
const TRAINING_COUNTER_PATH = "training_counter?select=id,completed_count&id=eq.1";

const HOME_GROUP_LABELS = {
  A: "A｜上半身 + 核心",
  B: "B｜下半身 + 腹部",
  D: "D｜热身 + 拉伸",
};

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(text, type = "") {
  const box = document.getElementById("connectionStatus");
  if (!box) return;
  box.textContent = text;
  box.className = "status " + type;
}

function homeEquipmentLabel(equipmentCatalogId) {
  const row = homeEquipmentCatalog.find(
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

function homeExerciseById(id) {
  return homeExercises.find((e) => String(e.id) === String(id)) || null;
}

function homeFormatDosage(item) {
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

function homeGetNextPlanCode() {
  const v = String(localStorage.getItem(HOME_NEXT_PLAN_CODE_KEY) || "A").toUpperCase();
  return v === "B" ? "B" : "A";
}

function homeSetNextPlanCode(code) {
  localStorage.setItem(HOME_NEXT_PLAN_CODE_KEY, code === "B" ? "B" : "A");
}

function homePickPlanForCode(code) {
  const normalized = code === "B" ? "B" : "A";
  const candidates = homePlans
    .filter((p) => String(p.plan_code || "").toUpperCase() === normalized)
    .sort((a, b) => {
      const sa = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (sa !== 0) return sa;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
  return candidates[0] || null;
}

function homePickCyclePlan() {
  const preferred = homeGetNextPlanCode();
  let plan = homePickPlanForCode(preferred);
  if (!plan) plan = homePickPlanForCode(preferred === "A" ? "B" : "A");
  if (!plan) {
    const sorted = [...homePlans].sort((a, b) => {
      const ca = String(a.plan_code || "").localeCompare(String(b.plan_code || ""));
      if (ca !== 0) return ca;
      const sa = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (sa !== 0) return sa;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
    plan = sorted[0] || null;
  }
  return plan;
}

function homeStatusKey(planId) {
  return `homeActionStatus_${planId}`;
}

function homeGetActionStatusMap(planId) {
  try {
    const raw = localStorage.getItem(homeStatusKey(planId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function homeSetActionStatusMap(planId, map) {
  try {
    localStorage.setItem(homeStatusKey(planId), JSON.stringify(map || {}));
  } catch (_) {}
}

function homeGetItemStatus(itemId) {
  if (!homeCurrentPlan) return null;
  const map = homeGetActionStatusMap(homeCurrentPlan.id);
  const v = map[String(itemId)];
  return v === "done" || v === "todo" ? v : null;
}

function setHomeItemStatus(itemId, status) {
  if (!homeCurrentPlan) return;
  const map = homeGetActionStatusMap(homeCurrentPlan.id);
  if (status === "done" || status === "todo") {
    map[String(itemId)] = status;
  } else {
    delete map[String(itemId)];
  }
  homeSetActionStatusMap(homeCurrentPlan.id, map);
  renderHomePlanViewFromState();
}

async function loadCurrentPlan() {
  try {
    setStatus("正在读取训练计划……");
    const [plans, exercises, equipment, completedCount] = await Promise.all([
      supabaseRequest(
        "training_plans?select=id,plan_code,name,sort_order&order=plan_code.asc,sort_order.asc,id.asc",
      ),
      supabaseRequest(
        "exercises?select=id,name,group_code,equipment_catalog_id,instructions,is_active&order=group_code.asc,name.asc,id.asc",
      ),
      supabaseRequest(
        "equipment_catalog?select=id,equipment_type,spec_value&order=id.asc",
      ),
      homeLoadCompletedCount().catch((e) => {
        console.error("读取训练次数失败：", e);
        return null;
      }),
    ]);

    homePlans = Array.isArray(plans) ? plans : [];
    homeExercises = Array.isArray(exercises) ? exercises : [];
    homeEquipmentCatalog = Array.isArray(equipment) ? equipment : [];
    if (completedCount != null) homeCompletedCount = completedCount;

    if (!homePlans.length) {
      homeCurrentPlan = null;
      homeCurrentItems = [];
      renderHomeNoPlans();
      setStatus("☁️ 已连接数据库，但还没有训练计划", "ok");
      return;
    }

    const plan = homePickCyclePlan();
    if (!plan) {
      renderHomeNoPlans();
      setStatus("☁️ 未找到可用训练计划", "ok");
      return;
    }

    if (String(plan.plan_code).toUpperCase() === "A" || String(plan.plan_code).toUpperCase() === "B") {
      homeSetNextPlanCode(String(plan.plan_code).toUpperCase());
    }

    const items = await supabaseRequest(
      `training_plan_items?select=id,plan_id,exercise_id,sort_order,sets,reps,duration_seconds,side&plan_id=eq.${encodeURIComponent(plan.id)}&order=sort_order.asc,id.asc`,
    );

    homeCurrentPlan = plan;
    homeCurrentItems = Array.isArray(items) ? items : [];

    renderHomePlanViewFromState();

    if (completedCount == null) {
      setStatus("☁️ 已读取训练计划（训练次数读取失败，请确认已创建 training_counter 表）", "error");
    } else {
      setStatus("☁️ 已读取训练计划", "ok");
    }
  } catch (error) {
    console.error("读取训练计划失败：", error);
    renderHomeLoadError(error);
    setStatus("⚠️ 训练计划读取失败：" + (error?.message || String(error)), "error");
  }
}

function renderHomeNoPlans() {
  const title = document.getElementById("nextTrainingTitle");
  const box = document.getElementById("todayPlanContent") || document.getElementById("todayPlan");
  const save = document.getElementById("saveButton");
  const nextNo = homeCompletedCount + 1;
  if (title) title.textContent = `第${nextNo}次训练计划`;
  if (box) {
    box.innerHTML = `
      <h2>还没有训练计划</h2>
      <div class="muted">请先在“训练计划”页面创建 A/B 计划并添加动作。</div>
      <br>
      <button type="button" class="primary-btn" onclick="window.location.href='cycle-plan.html'">前往创建训练计划</button>
    `;
  }
  if (save) {
    save.disabled = true;
    save.textContent = "完成本次训练";
  }
}

function renderHomeLoadError(error) {
  const box = document.getElementById("todayPlanContent") || document.getElementById("todayPlan");
  const save = document.getElementById("saveButton");
  if (box) {
    box.innerHTML = `
      <h2>读取训练计划失败</h2>
      <div class="muted">${escapeHtml(error?.message || String(error))}</div>
      <br>
      <button type="button" class="secondary-btn" onclick="loadCurrentPlan()">重试</button>
    `;
  }
  if (save) save.disabled = true;
}

function renderHomePlanViewFromState() {
  const plan = homeCurrentPlan;
  const items = homeCurrentItems;
  if (!plan) {
    renderHomeNoPlans();
    return;
  }

  const title = document.getElementById("nextTrainingTitle");
  const code = String(plan.plan_code || "").toUpperCase();
  const nextNo = homeCompletedCount + 1;
  const progress = homeGetProgress(items);

  if (title) title.textContent = `第${nextNo}次训练计划 · ${code}｜${plan.name || "未命名计划"}`;

  const box = document.getElementById("todayPlanContent") || document.getElementById("todayPlan");
  if (box) {
    box.innerHTML = `
      <h2>第${nextNo}次训练 · ${escapeHtml(code)}｜${escapeHtml(plan.name || "未命名计划")}</h2>
      ${renderHomePlanItems(items)}
    `;
  }

  const save = document.getElementById("saveButton");
  if (save) {
    if (!items.length) {
      save.disabled = true;
      save.textContent = "完成本次训练";
    } else if (!progress.allMarked) {
      save.disabled = true;
      save.textContent = `请先标记所有动作（${progress.marked}/${progress.total}）`;
    } else {
      save.disabled = false;
      save.textContent = "完成本次训练";
    }
  }
}

function renderHomePlanItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return `
      <div class="analysis">
        <div class="muted">该计划还没有动作。请到“训练计划”页面编辑并添加动作。</div>
      </div>
    `;
  }

  const progress = homeGetProgress(items);

  return `
    <div class="exercise-detail" style="margin-bottom:10px;">
      <strong>本次进度：</strong>已标记 ${progress.marked} / ${progress.total}（完成 ${progress.done}，未完成 ${progress.todo}）
    </div>
    ${items
      .map((item, index) => {
        const ex = homeExerciseById(item.exercise_id);
        const name = ex?.name || `动作 #${item.exercise_id}`;
        const group = ex?.group_code || "?";
        const equipment = homeEquipmentLabel(ex?.equipment_catalog_id);
        const inactive = ex && ex.is_active === false;
        const dosage = homeFormatDosage(item);
        const instructions = ex?.instructions ? escapeHtml(ex.instructions) : "";
        const status = homeGetItemStatus(item.id);
        const isDone = status === "done";
        const isTodo = status === "todo";

        return `
          <div class="exercise" style="margin-top:10px;${inactive ? "opacity:.7;" : ""}">
            <div class="exercise-row">
              <div class="exercise-info" style="width:100%;">
                <div class="exercise-name">
                  ${index + 1}. ${escapeHtml(name)}
                  ${inactive ? '<span class="tag tag-off">动作已停用</span>' : ""}
                  ${isDone ? '<span class="tag tag-ok">已完成</span>' : ""}
                  ${isTodo ? '<span class="tag tag-off">未完成</span>' : ""}
                </div>
                <div class="exercise-detail" style="margin-top:4px;">
                  <span class="tag tag-primary">${escapeHtml(HOME_GROUP_LABELS[group] || group)}</span>
                  <span class="tag tag-secondary">器械：${escapeHtml(equipment)}</span>
                </div>
                <div class="exercise-detail" style="margin-top:6px;"><strong>计划目标：</strong>${escapeHtml(dosage)}</div>
                ${instructions ? `<div class="exercise-detail" style="margin-top:4px;"><strong>要点：</strong>${instructions}</div>` : ""}
                <div style="display:flex;gap:8px;margin-top:10px;">
                  <button type="button" class="${isDone ? "primary-btn" : "secondary-btn"}" style="flex:1;" onclick="setHomeItemStatus(${item.id}, '${isDone ? "null" : "done"}')">完成</button>
                  <button type="button" class="${isTodo ? "primary-btn" : "secondary-btn"}" style="flex:1;" onclick="setHomeItemStatus(${item.id}, '${isTodo ? "null" : "todo"}')">未完成</button>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join("")}
  `;
}

function homeGetProgress(items) {
  const total = Array.isArray(items) ? items.length : 0;
  let done = 0;
  let todo = 0;
  let marked = 0;
  (items || []).forEach((it) => {
    const s = homeGetItemStatus(it.id);
    if (s === "done") { done += 1; marked += 1; }
    if (s === "todo") { todo += 1; marked += 1; }
  });
  return { total, done, todo, marked, allMarked: total > 0 && marked === total };
}

function homeTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function homeLoadCompletedCount() {
  const rows = await supabaseRequest(TRAINING_COUNTER_PATH);
  if (Array.isArray(rows) && rows.length) {
    const n = Number(rows[0].completed_count);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
  }
  // 初始化计数行
  await supabaseRequest("training_counter", {
    method: "POST",
    body: { id: 1, completed_count: 0 },
    prefer: "return=representation,resolution=merge-duplicates",
  });
  return 0;
}

async function homeIncrementCompletedCount(expectedNext) {
  const updated = await supabaseRequest("training_counter?id=eq.1", {
    method: "PATCH",
    body: { completed_count: expectedNext, updated_at: new Date().toISOString() },
  });
  if (Array.isArray(updated) && updated.length) {
    const n = Number(updated[0].completed_count);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return expectedNext;
}

async function homeSyncCompletedCountFromSessions() {
  try {
    const sessions = await supabaseRequest("workout_sessions?select=id");
    const count = Array.isArray(sessions) ? sessions.length : 0;
    await supabaseRequest("training_counter?id=eq.1", {
      method: "PATCH",
      body: { completed_count: count, updated_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
    return count;
  } catch (_) {
    return null;
  }
}

async function homeSaveWorkoutSession() {
  const plan = homeCurrentPlan;
  const items = homeCurrentItems || [];
  const progress = homeGetProgress(items);
  const sessionNo = homeCompletedCount + 1;
  const completionPercent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  const sessionRows = await supabaseRequest("workout_sessions", {
    method: "POST",
    body: {
      session_no: sessionNo,
      workout_date: homeTodayString(),
      plan_id: plan?.id ?? null,
      plan_code: plan?.plan_code ?? null,
      plan_name: plan?.name ?? null,
      total_items: progress.total,
      done_items: progress.done,
      completion_percent: completionPercent,
    },
  });
  const session = Array.isArray(sessionRows) ? sessionRows[0] : null;
  if (!session?.id) throw new Error("保存训练记录失败（未返回会话ID）。");

  if (items.length) {
    const payload = items.map((item, index) => {
      const ex = homeExerciseById(item.exercise_id);
      const status = homeGetItemStatus(item.id) || "todo";
      return {
        session_id: session.id,
        sort_order: index + 1,
        exercise_id: item.exercise_id ?? null,
        exercise_name: ex?.name || `动作 #${item.exercise_id}`,
        group_code: ex?.group_code || null,
        equipment_label: homeEquipmentLabel(ex?.equipment_catalog_id),
        sets: item.sets ?? null,
        reps: item.reps ?? null,
        duration_seconds: item.duration_seconds ?? null,
        side: item.side ?? null,
        status,
      };
    });
    await supabaseRequest("workout_session_items", {
      method: "POST",
      body: payload,
    });
  }

  return { session, sessionNo };
}

async function completeCurrentHomePlan() {
  if (!homeCurrentPlan) return;
  const progress = homeGetProgress(homeCurrentItems);
  if (!progress.allMarked) {
    setStatus("请先为每个动作选择“完成”或“未完成”。", "error");
    renderHomePlanViewFromState();
    return;
  }

  const code = String(homeCurrentPlan.plan_code || "A").toUpperCase();
  const next = code === "A" ? "B" : "A";

  const saveBtn = document.getElementById("saveButton");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "正在保存训练记录…";
  }

  try {
    const { sessionNo } = await homeSaveWorkoutSession();
    try {
      homeCompletedCount = await homeIncrementCompletedCount(sessionNo);
    } catch (e) {
      // 记录已保存但计数更新失败，尝试按会话数同步
      const synced = await homeSyncCompletedCountFromSessions();
      if (synced != null) homeCompletedCount = synced;
      else homeCompletedCount = sessionNo;
    }

    try {
      localStorage.removeItem(homeStatusKey(homeCurrentPlan.id));
    } catch (_) {}
    homeSetNextPlanCode(next);

    setStatus(`✅ 已完成第 ${sessionNo} 次训练（${code} 计划），下一次将显示 ${next} 计划`, "ok");
    await loadCurrentPlan();
  } catch (error) {
    console.error("完成训练失败：", error);
    const msg = String(error?.message || error || "");
    if (msg.includes("workout_sessions") || msg.includes("PGRST205") || msg.includes("does not exist")) {
      setStatus("⚠️ 保存失败：请先在 Supabase 创建训练历史表（workout_sessions / workout_session_items）。", "error");
    } else {
      setStatus("⚠️ 完成训练失败：" + msg, "error");
    }
    renderHomePlanViewFromState();
  }
}

function setTrainingPlanActions(show) {
  const actions = document.getElementById("trainingPlanActions");
  if (!actions) return;
  actions.classList.toggle("hidden", !show);
}

// 兼容旧调用/占位
async function deleteCurrentTrainingPlan() {}
async function updateHomeTrainingHeader() {}