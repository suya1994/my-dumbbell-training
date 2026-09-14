/* ============================================================
   settings.js
   私人哑铃训练系统 - 设置模块

   负责：

   1. 读取 user_settings
   2. 保存每周力量训练次数
   3. 保存每次期望训练时间
   4. 保存固定力量训练教练规则（ai_behavior）
   5. 提供 getAISettings() 给 ai-plan.js 使用
   ============================================================ */

/* ============================================================
   默认 AI 设置
   ============================================================ */

const DEFAULT_AI_SETTINGS = {
  weekly_strength_target: 3,

  expected_duration_minutes: 30,

  behavior:
    "根据训练历史动态调整训练，不为了变化而变化；优先保证动作安全和训练可执行性；如果当前训练方案合理，可以继续使用，不强行更换。",
};

/* ============================================================
   当前设置缓存

   页面和 ai-plan.js 都可以通过：

   getAISettings()

   获取。
   ============================================================ */

let currentAISettings = null;

/* ============================================================
   将数据库记录转换成网站使用的设置格式
   ============================================================ */

function normalizeAISettings(row) {
  if (!row || typeof row !== "object") {
    return {
      weekly_strength_target: DEFAULT_AI_SETTINGS.weekly_strength_target,

      expected_duration_minutes: DEFAULT_AI_SETTINGS.expected_duration_minutes,

      behavior: DEFAULT_AI_SETTINGS.behavior,
    };
  }

  /* ========================================================
       每周训练目标
    ======================================================== */

  let weeklyTarget = Number(row.weekly_strength_target);

  if (!Number.isFinite(weeklyTarget) || weeklyTarget < 1 || weeklyTarget > 7) {
    weeklyTarget = DEFAULT_AI_SETTINGS.weekly_strength_target;
  }

  let expectedDuration = Number(row.expected_duration_minutes);

  if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) {
    expectedDuration = DEFAULT_AI_SETTINGS.expected_duration_minutes;
  }

  /* ========================================================
       固定力量训练教练规则
    ======================================================== */

  const behavior = String(
    row.ai_behavior ?? DEFAULT_AI_SETTINGS.behavior,
  ).trim();

  return {
    weekly_strength_target: weeklyTarget,

    expected_duration_minutes: expectedDuration,

    behavior: behavior || DEFAULT_AI_SETTINGS.behavior,
  };
}

/* ============================================================
   获取 AI 设置

   其他 JS 文件使用：

   const settings = getAISettings();

   ============================================================ */

function getAISettings() {
  if (!currentAISettings) {
    currentAISettings = normalizeAISettings(null);
  }

  return {
    weekly_strength_target: currentAISettings.weekly_strength_target,

    expected_duration_minutes: currentAISettings.expected_duration_minutes,

    behavior: currentAISettings.behavior,
  };
}

/* ============================================================
   从 Supabase 读取设置
   ============================================================ */

async function loadAISettings() {
  try {
    const result = await supabaseRequest(
      "user_settings" + "?select=*" + "&order=id.asc" + "&limit=1",
    );

    /* ====================================================
           数据库还没有记录
        ==================================================== */

    if (!result || !result.length) {
      console.log("user_settings 暂无数据，创建默认设置。");

      await createDefaultAISettings();

      return getAISettings();
    }

    /* ====================================================
           保存到内存
        ==================================================== */

    currentAISettings = normalizeAISettings(result[0]);

    /* ====================================================
           更新页面
        ==================================================== */

    populateAISettingsForm(currentAISettings);

    updateSettingsStatus();

    return getAISettings();
  } catch (error) {
    console.error("读取 AI 设置失败：", error);

    /*
           数据库读取失败时：

           页面仍然可以使用默认设置，
           但不会假装已经保存到数据库。
        */

    currentAISettings = normalizeAISettings(null);

    populateAISettingsForm(currentAISettings);

    updateSettingsStatus("⚠️ 无法读取数据库设置，当前使用默认设置");

    return getAISettings();
  }
}

/* ============================================================
   创建默认设置
   ============================================================ */

async function createDefaultAISettings() {
  const payload = {
    weekly_strength_target: DEFAULT_AI_SETTINGS.weekly_strength_target,

    expected_duration_minutes: DEFAULT_AI_SETTINGS.expected_duration_minutes,

    ai_behavior: DEFAULT_AI_SETTINGS.behavior,
  };

  const result = await supabaseRequest("user_settings", {
    method: "POST",

    body: payload,
  });

  if (!result || !result.length) {
    throw new Error("创建默认 AI 设置失败。");
  }

  currentAISettings = normalizeAISettings(result[0]);

  return currentAISettings;
}

/* ============================================================
   将设置显示到页面
   ============================================================ */

function populateAISettingsForm(settings) {
  if (!settings) {
    return;
  }

  const weeklyTarget = document.getElementById("weeklyStrengthTarget");

  if (weeklyTarget) {
    weeklyTarget.value = settings.weekly_strength_target;
  }

  const expectedDuration = document.getElementById("expectedDurationMinutes");

  if (expectedDuration) {
    expectedDuration.value = settings.expected_duration_minutes;
  }

  const behavior = document.getElementById("aiBehavior");

  if (behavior) {
    behavior.value = settings.behavior;
  }
}

/* ============================================================
   保存 AI 设置
   ============================================================ */

async function saveAISettings() {
  try {
    /* ====================================================
           每周力量训练次数
        ==================================================== */

    const weeklyTargetInput = document.getElementById("weeklyStrengthTarget");

    const value = Number(weeklyTargetInput?.value);

    if (!Number.isFinite(value) || value < 1 || value > 7) {
      alert("每周力量训练次数必须是 1～7 次。");

      return;
    }

    /* ====================================================
           每次期望训练时间
        ==================================================== */

    const durationInput = document.getElementById("expectedDurationMinutes");

    const expectedDuration = Number(durationInput?.value);

    if (
      !Number.isFinite(expectedDuration) ||
      expectedDuration <= 0 ||
      expectedDuration > 180
    ) {
      alert("每次期望训练时间必须是有效的分钟数。");

      return;
    }

    /* ====================================================
           固定力量训练教练规则
        ==================================================== */

    const behavior = document.getElementById("aiBehavior")?.value.trim() || "";

    /* ====================================================
           确保数据库记录存在
        ==================================================== */

    const id = await ensureSettingsRow();

    /* ====================================================
           写入 Supabase
        ==================================================== */

    await supabaseRequest("user_settings?id=eq." + id, {
      method: "PATCH",

      body: {
        weekly_strength_target: value,

        expected_duration_minutes: expectedDuration,

        ai_behavior: behavior,
      },
    });

    /* ====================================================
           更新本地缓存
        ==================================================== */

    currentAISettings = {
      __id: id,

      weekly_strength_target: value,

      expected_duration_minutes: expectedDuration,

      behavior: behavior || DEFAULT_AI_SETTINGS.behavior,
    };

    /* ====================================================
           刷新页面
        ==================================================== */

    updateSettingsStatus();

    alert("AI教练设置已经保存。🤖");

    console.log("AI设置已保存到 Supabase：", getAISettings());
  } catch (error) {
    console.error("保存 AI 设置失败：", error);

    alert("AI设置保存失败：\n\n" + (error.message || String(error)));
  }
}

/* ============================================================
   确保数据库存在设置记录

   同时保存数据库 id，
   方便后续 PATCH。
   ============================================================ */

async function ensureSettingsRow() {
  if (currentAISettings && currentAISettings.__id) {
    return currentAISettings.__id;
  }

  const result = await supabaseRequest(
    "user_settings" + "?select=*" + "&order=id.asc" + "&limit=1",
  );

  if (result && result.length) {
    currentAISettings = normalizeAISettings(result[0]);

    currentAISettings.__id = result[0].id;

    return result[0].id;
  }

  const created = await createDefaultAISettings();

  if (!created) {
    throw new Error("无法创建用户设置。");
  }

  const rows = await supabaseRequest(
    "user_settings" + "?select=id" + "&order=id.asc" + "&limit=1",
  );

  if (!rows || !rows.length) {
    throw new Error("设置已经创建，但无法读取设置 ID。");
  }

  currentAISettings.__id = rows[0].id;

  return rows[0].id;
}

/* ============================================================
   HTML 转义

   防止文本包含：

   <
   >
   "
   '

   时破坏页面 HTML。
   ============================================================ */

function escapeSettingsHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ============================================================
   当前设置状态
   ============================================================ */

function updateSettingsStatus(customMessage) {
  const box = document.getElementById("settingsStatus");

  if (!box) {
    return;
  }

  if (customMessage) {
    box.innerHTML = `<div class="settings-status-item">
                ${escapeSettingsHTML(customMessage)}
            </div>`;

    return;
  }

  const settings = getAISettings();

  box.innerHTML = `

        <div class="settings-status-item">

            <strong>每周力量训练次数：</strong>

            ${settings.weekly_strength_target} 次

        </div>

        <div class="settings-status-item">

            <strong>每次期望训练时间：</strong>

            ${settings.expected_duration_minutes} 分钟

        </div>

        <div class="settings-status-item">

            <strong>固定力量训练教练规则：</strong>

            ${escapeSettingsHTML(settings.behavior || "暂无")}

        </div>

    `;
}

/* ============================================================
   页面初始化
   ============================================================ */

document.addEventListener("DOMContentLoaded", async function () {
  console.log("正在读取 AI 教练设置……");

  try {
    await loadAISettings();
  } catch (error) {
    console.error("设置页面初始化失败：", error);
  }
});