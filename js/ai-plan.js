/*
 * js/ai-plan.js
 * AI教练：展示训练计划列表，点击生成计划总结并复制给 AI
 */

let aiPlans = [];
let aiPlanItemsByPlanId = new Map();
let aiExercisesById = new Map();
let aiEquipmentById = new Map();
let aiSelectedPlanId = null;

const AI_GROUP_LABELS = {
  A: "A｜上半身 + 核心",
  B: "B｜下半身 + 腹部",
  D: "D｜热身 + 拉伸",
};

function aiEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function aiEquipmentLabel(equipmentCatalogId) {
  const row = aiEquipmentById.get(String(equipmentCatalogId));
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
  return `${type}${spec ? " " + spec : ""}`.trim();
}

function aiFormatDosage(item) {
  const sets = item?.sets;
  const reps = item?.reps;
  const seconds = item?.duration_seconds;
  const side = item?.side === "each_side" ? "每侧" : "双侧/不分侧";
  const repsText = reps != null ? `${reps}次${item?.side === "each_side" ? "/侧" : ""}` : null;
  const secText = seconds != null ? `${seconds}秒${item?.side === "each_side" ? "/侧" : ""}` : null;

  if (sets != null && (repsText || secText)) {
    return `${sets}组 × ${[repsText, secText].filter(Boolean).join(" + ")}（${side}）`;
  }
  const parts = [];
  if (sets != null) parts.push(`${sets}组`);
  if (repsText) parts.push(repsText);
  if (secText) parts.push(secText);
  if (parts.length) return `${parts.join(" ")}（${side}）`;
  return "未设置";
}

async function aiLoadData() {
  const listBox = document.getElementById("aiPlanList");
  if (!listBox) return;

  try {
    const [plans, exercises, equipment, items] = await Promise.all([
      supabaseRequest(
        "training_plans?select=id,plan_code,name,sort_order,is_active&order=plan_code.asc,sort_order.asc,id.asc",
      ),
      supabaseRequest(
        "exercises?select=id,name,group_code,equipment_catalog_id,instructions,is_active&order=group_code.asc,name.asc,id.asc",
      ),
      supabaseRequest("equipment_catalog?select=id,equipment_type,spec_value&order=id.asc"),
      supabaseRequest(
        "training_plan_items?select=id,plan_id,exercise_id,sort_order,sets,reps,duration_seconds,side&order=plan_id.asc,sort_order.asc,id.asc",
      ),
    ]);

    aiPlans = Array.isArray(plans) ? plans : [];
    aiExercisesById = new Map((Array.isArray(exercises) ? exercises : []).map((e) => [String(e.id), e]));
    aiEquipmentById = new Map((Array.isArray(equipment) ? equipment : []).map((e) => [String(e.id), e]));

    aiPlanItemsByPlanId = new Map();
    (Array.isArray(items) ? items : []).forEach((it) => {
      const key = String(it.plan_id);
      if (!aiPlanItemsByPlanId.has(key)) aiPlanItemsByPlanId.set(key, []);
      aiPlanItemsByPlanId.get(key).push(it);
    });

    renderAIPlanList();
  } catch (error) {
    console.error("AI教练读取训练计划失败：", error);
    if (listBox) {
      listBox.innerHTML = `<div class="muted">读取训练计划失败：${aiEscapeHtml(error?.message || String(error))}</div>`;
    }
  }
}

function renderAIPlanList() {
  const box = document.getElementById("aiPlanList");
  if (!box) return;

  if (!aiPlans.length) {
    box.innerHTML = `<div class="muted">暂无训练计划。请先在“训练计划”页创建。</div>`;
    return;
  }

  box.innerHTML = aiPlans
    .map((plan) => {
      const id = String(plan.id);
      const code = String(plan.plan_code || "").toUpperCase();
      const name = plan.name || "未命名计划";
      const count = (aiPlanItemsByPlanId.get(id) || []).length;
      const selected = aiSelectedPlanId === id;
      const activeTag = plan.is_active === false ? ' <span class="tag tag-off">停用</span>' : "";
      const border = selected ? "border:2px solid #4a90e2;" : "border:1px solid #eee;";
      return `
        <div style="padding:12px 14px; margin-bottom:10px; border-radius:10px; ${border} background:#fff;">
          <div style="font-size:16px; font-weight:600; line-height:1.5; margin-bottom:4px; word-break:break-word;">
            ${aiEscapeHtml(code)}｜${aiEscapeHtml(name)}${activeTag}
          </div>
          <div class="muted" style="margin-bottom:10px;">
            ${aiEscapeHtml(AI_GROUP_LABELS[code] || code)} · ${count} 个动作
          </div>
          <button type="button" class="${selected ? "secondary-btn" : "primary-btn"}" style="width:100%;" onclick="selectAIPlan('${id}')">
            ${selected ? "已选择" : "生成总结"}
          </button>
        </div>
      `;
    })
    .join("");
}

function buildAIPlanSummary(plan) {
  const id = String(plan.id);
  const code = String(plan.plan_code || "").toUpperCase();
  const name = plan.name || "未命名计划";
  const items = aiPlanItemsByPlanId.get(id) || [];

  const lines = [];
  lines.push(`训练计划：${code}｜${name}`);
  lines.push(`计划类型：${AI_GROUP_LABELS[code] || code}`);
  lines.push(`动作数量：${items.length}`);
  lines.push("");
  lines.push("动作清单：");

  if (!items.length) {
    lines.push("- （暂无动作）");
  } else {
    items.forEach((item, index) => {
      const ex = aiExercisesById.get(String(item.exercise_id)) || {};
      const exName = ex.name || `动作 #${item.exercise_id}`;
      const exGroup = ex.group_code ? `[${ex.group_code}] ` : "";
      const equipment = aiEquipmentLabel(ex.equipment_catalog_id);
      const dosage = aiFormatDosage(item);
      lines.push(`${index + 1}. ${exGroup}${exName}`);
      lines.push(`   - 器械：${equipment}`);
      lines.push(`   - 目标：${dosage}`);
      const instructions = String(ex.instructions || "").trim();
      if (instructions) {
        lines.push(`   - 要点：${instructions.replace(/\s+/g, " ")}`);
      }
    });
  }

  lines.push("");
  lines.push("说明：以上为该训练计划的动作与目标参数，请基于此进行分析或调整建议。");
  return lines.join("\n");
}

function selectAIPlan(planId) {
  const plan = aiPlans.find((p) => String(p.id) === String(planId));
  if (!plan) return;

  aiSelectedPlanId = String(plan.id);
  const summary = buildAIPlanSummary(plan);

  const empty = document.getElementById("aiPlanSummaryEmpty");
  const textarea = document.getElementById("aiPlanSummary");
  const copyBtn = document.getElementById("aiCopyPlanSummaryBtn");

  if (empty) empty.classList.add("hidden");
  if (textarea) {
    textarea.classList.remove("hidden");
    textarea.value = summary;
  }
  if (copyBtn) copyBtn.disabled = false;

  renderAIPlanList();
}

async function copyAIPlanSummary() {
  const textarea = document.getElementById("aiPlanSummary");
  const copyBtn = document.getElementById("aiCopyPlanSummaryBtn");
  const text = textarea?.value || "";
  if (!text) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
    }
    if (copyBtn) {
      const old = copyBtn.textContent;
      copyBtn.textContent = "✅ 已复制";
      setTimeout(() => { copyBtn.textContent = old || "📋 复制计划总结"; }, 1500);
    }
  } catch (error) {
    console.error("复制失败：", error);
    alert("复制失败，请手动全选复制。");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // 仅在首页存在 AI 教练区域时加载
  if (document.getElementById("aiPlanList")) {
    aiLoadData();
  }
});
