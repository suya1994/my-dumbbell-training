/* ============================================================
   settings.js
   私人哑铃训练系统 - 设置模块

   第4步：Supabase 数据库版

   负责：

   1. 读取 user_settings
   2. 保存训练目标
   3. 保存 AI 教练设置
   4. 提供 getAISettings() 给 ai-plan.js 使用
   5. 动作限制支持添加 / 删除
   6. 不再使用 localStorage
============================================================ */

/* ============================================================
   默认 AI 设置
============================================================ */

const DEFAULT_AI_SETTINGS = {
  weekly_strength_target: 3,

  goals: ["腰腹收紧 / 核心稳定", "臀部塑形", "手臂", "背部"],

  focus:
    "重点关注动作完成度、训练难度、左右侧力量差异、训练量变化以及身体感受。",

  behavior:
    "根据训练历史动态调整训练，不为了变化而变化；优先保证动作安全和训练可执行性；如果当前训练方案合理，可以继续使用，不强行更换。",

  limitations: "深蹲、罗马尼亚硬拉、俯身哑铃划船",

  restrictions:
    "腰部容易疲劳，需要保护腰部；左手力量比右手弱；训练时间控制在20～25分钟；目前使用两个5kg哑铃、瑜伽垫、椅子和桌子。",
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

      goals: [...DEFAULT_AI_SETTINGS.goals],

      focus: DEFAULT_AI_SETTINGS.focus,

      behavior: DEFAULT_AI_SETTINGS.behavior,

      limitations: DEFAULT_AI_SETTINGS.limitations,

      restrictions: DEFAULT_AI_SETTINGS.restrictions,
    };
  }

  /* ========================================================
       AI目标
    ======================================================== */

  let goals = [];

  if (Array.isArray(row.ai_goals)) {
    goals = row.ai_goals
      .map(function (item) {
        return String(item || "").trim();
      })
      .filter(Boolean);
  }

  if (!goals.length) {
    goals = [...DEFAULT_AI_SETTINGS.goals];
  }

  /* ========================================================
       每周训练目标
    ======================================================== */

  let weeklyTarget = Number(row.weekly_strength_target);

  if (!Number.isFinite(weeklyTarget) || weeklyTarget < 1 || weeklyTarget > 7) {
    weeklyTarget = DEFAULT_AI_SETTINGS.weekly_strength_target;
  }

  /* ========================================================
       最终设置
    ======================================================== */

  return {
    weekly_strength_target: weeklyTarget,

    goals,

    focus: String(row.ai_focus ?? DEFAULT_AI_SETTINGS.focus).trim(),

    behavior: String(row.ai_behavior ?? DEFAULT_AI_SETTINGS.behavior).trim(),

    limitations: String(
      row.ai_limitations ?? DEFAULT_AI_SETTINGS.limitations,
    ).trim(),

    restrictions: String(
      row.ai_restrictions ?? DEFAULT_AI_SETTINGS.restrictions,
    ).trim(),
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

    goals: [...currentAISettings.goals],

    focus: currentAISettings.focus,

    behavior: currentAISettings.behavior,

    limitations: currentAISettings.limitations,

    restrictions: currentAISettings.restrictions,
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

           正常情况下第3步已经插入了默认记录。

           如果没有：

           自动创建默认记录。
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

    ai_goals: DEFAULT_AI_SETTINGS.goals,

    ai_focus: DEFAULT_AI_SETTINGS.focus,

    ai_behavior: DEFAULT_AI_SETTINGS.behavior,

    ai_limitations: DEFAULT_AI_SETTINGS.limitations,

    ai_restrictions: DEFAULT_AI_SETTINGS.restrictions,
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

  /* ========================================================
       每周训练目标
    ======================================================== */

  const weeklyTarget = document.getElementById("weeklyStrengthTarget");

  if (weeklyTarget) {
    weeklyTarget.value = settings.weekly_strength_target;
  }

  /* ========================================================
       AI目标复选框
    ======================================================== */

  const goalCheckboxes = document.querySelectorAll('input[name="aiGoal"]');

  goalCheckboxes.forEach(function (checkbox) {
    checkbox.checked = settings.goals.includes(checkbox.value);
  });

  /* ========================================================
       AI重点关注
    ======================================================== */

  const focus = document.getElementById("aiFocus");

  if (focus) {
    focus.value = settings.focus;
  }

  /* ========================================================
       AI教练行为
    ======================================================== */

  const behavior = document.getElementById("aiBehavior");

  if (behavior) {
    behavior.value = settings.behavior;
  }

  /* ========================================================
       AI训练限制
    ======================================================== */

  const restrictions = document.getElementById("aiRestrictions");

  if (restrictions) {
    restrictions.value = settings.restrictions;
  }

  /* ========================================================
       动作限制

       settings.html 已经有：

       loadAILimitationsUI()

       所以这里不直接操作 DOM。

       等页面初始化完成后，
       它会自己读取 getAISettings()。
    ======================================================== */
}

/* ============================================================
   保存每周训练目标
============================================================ */

async function saveTrainingSettings() {
  const input = document.getElementById("weeklyStrengthTarget");

  if (!input) {
    return;
  }

  const value = Number(input.value);

  if (!Number.isFinite(value) || value < 1 || value > 7) {
    alert("每周力量训练次数必须是 1～7 次。");

    return;
  }

  try {
    await ensureSettingsRow();

    const updated = await supabaseRequest(
      "user_settings?id=eq." + currentAISettings.__id,
      {
        method: "PATCH",

        body: {
          weekly_strength_target: value,
        },
      },
    );

    /*
           更新本地缓存
        */

    currentAISettings.weekly_strength_target = value;

    alert("每周训练目标已经保存。💪");

    updateSettingsStatus();
  } catch (error) {
    console.error("保存训练目标失败：", error);

    alert("保存训练目标失败：\n\n" + (error.message || String(error)));
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

  /*
       再读取一次 ID
    */

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
   保存 AI 教练设置
============================================================ */

async function saveAISettings() {
  try {
    /* ====================================================
           读取 AI目标
        ==================================================== */

    const goals = [];

    document
      .querySelectorAll('input[name="aiGoal"]:checked')
      .forEach(function (checkbox) {
        goals.push(checkbox.value);
      });

    /* ====================================================
           AI重点关注
        ==================================================== */

    const focus = document.getElementById("aiFocus")?.value.trim() || "";

    /* ====================================================
           AI教练行为
        ==================================================== */

    const behavior = document.getElementById("aiBehavior")?.value.trim() || "";

    /* ====================================================
           训练限制
        ==================================================== */

    const restrictions =
      document.getElementById("aiRestrictions")?.value.trim() || "";

    /* ====================================================
           不会 / 不适合的动作

           settings.html 当前维护：

           window.__currentAILimitations
        ==================================================== */

    let limitations = "";

    if (typeof window.__currentAILimitations === "string") {
      limitations = window.__currentAILimitations.trim();
    } else if (
      currentAISettings &&
      typeof currentAISettings.limitations === "string"
    ) {
      limitations = currentAISettings.limitations.trim();
    }

    /* ====================================================
           如果用户一个目标都没有

           不阻止保存。

           AI 可以理解为暂时没有特别目标。
        ==================================================== */

    /* ====================================================
           确保数据库记录存在
        ==================================================== */

    const id = await ensureSettingsRow();

    /* ====================================================
           写入 Supabase
        ==================================================== */

    const updated = await supabaseRequest("user_settings?id=eq." + id, {
      method: "PATCH",

      body: {
        ai_goals: goals,

        ai_focus: focus,

        ai_behavior: behavior,

        ai_limitations: limitations,

        ai_restrictions: restrictions,
      },
    });

    /* ====================================================
           更新本地缓存
        ==================================================== */

    currentAISettings = {
      __id: id,

      weekly_strength_target:
        currentAISettings?.weekly_strength_target ??
        DEFAULT_AI_SETTINGS.weekly_strength_target,

      goals: [...goals],

      focus,

      behavior,

      limitations,

      restrictions,
    };

    /* ====================================================
           刷新页面
        ==================================================== */

    updateSettingsStatus();

    alert("AI私人教练设置已经保存。🤖");

    console.log("AI设置已保存到 Supabase：", currentAISettings);
  } catch (error) {
    console.error("保存 AI 设置失败：", error);

    alert("AI设置保存失败：\n\n" + (error.message || String(error)));
  }
}

/* ============================================================
   HTML 转义

   防止动作名称包含：

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

  const goalsText = settings.goals.length
    ? settings.goals.join("、")
    : "暂未设置";

  const limitationsText = settings.limitations ? settings.limitations : "暂无";

  box.innerHTML = `

        <div class="settings-status-item">

            <strong>每周训练目标：</strong>

            ${settings.weekly_strength_target} 次

        </div>


        <div class="settings-status-item">

            <strong>AI训练目标：</strong>

            ${escapeSettingsHTML(goalsText)}

        </div>


        <div class="settings-status-item">

            <strong>AI重点关注：</strong>

            ${escapeSettingsHTML(settings.focus || "暂无")}

        </div>


        <div class="settings-status-item">

            <strong>AI教练行为：</strong>

            ${escapeSettingsHTML(settings.behavior || "暂无")}

        </div>


        <div class="settings-status-item">

            <strong>不会 / 不适合的动作：</strong>

            ${escapeSettingsHTML(limitationsText)}

        </div>


        <div class="settings-status-item">

            <strong>训练限制 / 其它要求：</strong>

            ${escapeSettingsHTML(settings.restrictions || "暂无")}

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

    /*
               settings.html 里的动作限制 UI
               在 settings.js 加载之后再读取。

               这里主动调用，
               避免因为脚本加载顺序导致默认值
               没有显示。
            */

    if (typeof loadAILimitationsUI === "function") {
      loadAILimitationsUI();
    }
  } catch (error) {
    console.error("设置页面初始化失败：", error);
  }
});
