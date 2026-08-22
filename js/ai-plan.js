/* ================================
   ai-plan.js
   ChatGPT AI训练计划中转模块

   稳定版

   核心逻辑：

   1. 下一次训练编号
      = workouts 中最近一次已保存训练 + 1

   2. AI设置统一从 settings.js
      的 getAISettings() 获取

   3. 如果设置尚未从 Supabase 加载，
      生成Prompt前会主动等待 / 加载设置

   4. 最近整次训练：
      最近5次

   5. 最近动作历史：
      按动作名称聚合
      → 同一个动作合并
      → 最近使用过的动作优先
      → 每个动作保留最近5次记录

   6. 增加：
      本周训练统计
      本月训练统计
      本年训练统计

   7. 最近身体数据：
      最近10条

   8. AI不限制动作数量

   9. 不把20～25分钟硬编码为绝对限制

   10. 网站自己确定 workout_number

   11. 每个动作必须包含：

       exercise_name
       equipment
       weight_kg
       reps
       sets
       notes

   12. ★ 导入同一个 workout_number 时：
       删除该编号下所有旧训练计划
       删除所有旧动作
       再重新创建唯一训练计划

   13. ★ 导入完成后：
       再次从数据库验证实际动作数量
================================ */

/* ============================================================
   工具：安全获取数组
============================================================ */

function getSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

/* ============================================================
   日期工具
============================================================ */

function aiPlanParseLocalDate(dateString) {
  if (!dateString) {
    return null;
  }

  const parts = String(dateString).split("-");

  if (parts.length !== 3) {
    return null;
  }

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }

  return new Date(year, month - 1, day);
}

/* ============================================================
   当前周一
============================================================ */

function aiPlanGetCurrentMonday() {
  const now = new Date();

  const day = now.getDay();

  const diff = day === 0 ? -6 : 1 - day;

  const monday = new Date(now);

  monday.setDate(now.getDate() + diff);

  monday.setHours(0, 0, 0, 0);

  return monday;
}

/* ============================================================
   当前月份开始
============================================================ */

function aiPlanGetCurrentMonthStart() {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

/* ============================================================
   当前年份开始
============================================================ */

function aiPlanGetCurrentYearStart() {
  const now = new Date();

  return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
}

/* ============================================================
   日期是否在范围内
============================================================ */

function aiPlanDateBetween(dateString, startDate, endDate) {
  const date = aiPlanParseLocalDate(dateString);

  if (!date) {
    return false;
  }

  return date >= startDate && date <= endDate;
}

/* ============================================================
   获取最近一次已经保存的训练编号
============================================================ */

async function getLatestWorkoutNumberForAI() {
  try {
    const workouts = await supabaseRequest(
      "workouts" +
        "?select=workout_number,workout_date,completion_percent" +
        "&order=workout_number.desc" +
        "&limit=1",
    );

    if (!workouts || !workouts.length) {
      return 0;
    }

    const number = Number(workouts[0].workout_number);

    if (!Number.isFinite(number)) {
      return 0;
    }

    return number;
  } catch (error) {
    console.error("读取最近训练编号失败：", error);

    throw error;
  }
}

/* ============================================================
   获取下一次训练编号
============================================================ */

async function getNextWorkoutNumber() {
  const latestWorkoutNumber = await getLatestWorkoutNumberForAI();

  return latestWorkoutNumber + 1;
}

/* ============================================================
   获取当前AI设置
============================================================ */

async function getCurrentAISettingsForPrompt() {
  try {
    if (typeof getAISettings !== "function") {
      throw new Error("找不到 getAISettings()。请确认 settings.js 已经加载。");
    }

    let settings = getAISettings();

    if (typeof loadAISettings === "function") {
      try {
        const loaded = await loadAISettings();

        if (loaded && typeof loaded === "object") {
          settings = loaded;
        }
      } catch (loadError) {
        console.error("AI生成前重新读取设置失败：", loadError);

        throw new Error(
          "无法从数据库读取当前AI教练设置。\n\n" +
            (loadError.message || String(loadError)),
        );
      }
    }

    if (!settings || typeof settings !== "object") {
      throw new Error("getAISettings() 没有返回有效设置。");
    }

    const weeklyTarget = Number(settings.weekly_strength_target);

    const normalizedSettings = {
      weekly_strength_target: Number.isFinite(weeklyTarget)
        ? weeklyTarget
        : null,

      goals: Array.isArray(settings.goals)
        ? settings.goals
            .map((item) => String(item || "").trim())
            .filter(Boolean)
        : [],

      focus: String(settings.focus || "").trim(),

      behavior: String(settings.behavior || "").trim(),

      limitations: String(settings.limitations || "").trim(),

      restrictions: String(settings.restrictions || "").trim(),
    };

    console.log("🤖 AI生成前读取到的最终设置：", normalizedSettings);

    return normalizedSettings;
  } catch (error) {
    console.error("读取当前AI设置失败：", error);

    throw new Error(
      "无法读取当前AI教练设置。\n\n" + (error.message || String(error)),
    );
  }
}

/* ============================================================
   获取最近5次整次训练
============================================================ */

function getRecentFiveWorkoutsForAI(history) {
  return getSafeArray(history)
    .slice()
    .sort((a, b) => {
      const dateA = String(a.workout_date || "");

      const dateB = String(b.workout_date || "");

      if (dateA !== dateB) {
        return dateB.localeCompare(dateA);
      }

      return Number(b.workout_number || 0) - Number(a.workout_number || 0);
    })
    .slice(0, 5);
}

/* ============================================================
   动作名称标准化
============================================================ */

function normalizeAIExerciseName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")");
}

/* ============================================================
   聚合动作历史
============================================================ */

function buildAIExerciseHistory(exercises, history) {
  const exerciseList = getSafeArray(exercises);

  const workoutMap = new Map();

  getSafeArray(history).forEach((workout) => {
    const number = Number(workout.workout_number);

    if (Number.isFinite(number)) {
      workoutMap.set(number, workout);
    }
  });

  const groups = new Map();

  exerciseList.forEach((exercise) => {
    const name = normalizeAIExerciseName(exercise.exercise_name);

    if (!name) {
      return;
    }

    if (!groups.has(name)) {
      groups.set(name, {
        exercise_name: name,

        count: 0,

        last_workout_number: null,

        last_workout_date: null,

        recent_records: [],
      });
    }

    const group = groups.get(name);

    group.count++;

    const workoutNumber = Number(exercise.workout_number);

    const workout = Number.isFinite(workoutNumber)
      ? workoutMap.get(workoutNumber)
      : null;

    const workoutDate =
      exercise.workout_date ||
      exercise.record_date ||
      workout?.workout_date ||
      null;

    const record = {
      workout_number: Number.isFinite(workoutNumber) ? workoutNumber : null,

      workout_date: workoutDate,

      exercise_order:
        exercise.exercise_order !== undefined ? exercise.exercise_order : null,

      exercise_name: name,

      weight_kg: exercise.weight_kg !== undefined ? exercise.weight_kg : null,

      reps: exercise.reps !== undefined ? exercise.reps : null,

      sets: exercise.sets !== undefined ? exercise.sets : null,

      completed: exercise.completed !== undefined ? exercise.completed : null,

      difficulty:
        exercise.difficulty !== undefined ? exercise.difficulty : null,

      notes: exercise.notes !== undefined ? exercise.notes : null,
    };

    group.recent_records.push(record);

    const currentNumber = Number.isFinite(workoutNumber)
      ? workoutNumber
      : -Infinity;

    const lastNumber = Number.isFinite(group.last_workout_number)
      ? group.last_workout_number
      : -Infinity;

    if (currentNumber > lastNumber) {
      group.last_workout_number = Number.isFinite(workoutNumber)
        ? workoutNumber
        : null;

      group.last_workout_date = workoutDate;
    }
  });

  const result = Array.from(groups.values());

  result.forEach((group) => {
    group.recent_records.sort((a, b) => {
      const numberA = Number(a.workout_number);

      const numberB = Number(b.workout_number);

      if (
        Number.isFinite(numberA) &&
        Number.isFinite(numberB) &&
        numberA !== numberB
      ) {
        return numberB - numberA;
      }

      return String(b.workout_date || "").localeCompare(
        String(a.workout_date || ""),
      );
    });

    group.recent_records = group.recent_records.slice(0, 5);
  });

  result.sort((a, b) => {
    const lastA = Number(a.last_workout_number);

    const lastB = Number(b.last_workout_number);

    if (Number.isFinite(lastA) && Number.isFinite(lastB) && lastA !== lastB) {
      return lastB - lastA;
    }

    return b.count - a.count;
  });

  return result;
}

/* ============================================================
   获取周 / 月 / 年训练统计
============================================================ */

function buildAITrainingSummary(history) {
  const records = getSafeArray(history);

  const now = new Date();

  const monday = aiPlanGetCurrentMonday();

  const monthStart = aiPlanGetCurrentMonthStart();

  const yearStart = aiPlanGetCurrentYearStart();

  const weekRecords = records.filter((record) =>
    aiPlanDateBetween(record.workout_date, monday, now),
  );

  const monthRecords = records.filter((record) =>
    aiPlanDateBetween(record.workout_date, monthStart, now),
  );

  const yearRecords = records.filter((record) =>
    aiPlanDateBetween(record.workout_date, yearStart, now),
  );

  function calculateStats(list) {
    const completionValues = list
      .map((record) => Number(record.completion_percent))
      .filter((value) => Number.isFinite(value));

    const averageCompletion = completionValues.length
      ? Math.round(
          completionValues.reduce((sum, value) => sum + value, 0) /
            completionValues.length,
        )
      : null;

    const totalMinutes = list.reduce(
      (sum, record) => sum + (Number(record.duration_minutes) || 0),
      0,
    );

    const workoutNumbers = list
      .map((record) => Number(record.workout_number))
      .filter((value) => Number.isFinite(value));

    return {
      workouts: list.length,

      total_minutes: totalMinutes,

      average_completion_percent: averageCompletion,

      latest_workout_number: workoutNumbers.length
        ? Math.max(...workoutNumbers)
        : null,

      dates: list.map((record) => record.workout_date).filter(Boolean),
    };
  }

  return {
    this_week: calculateStats(weekRecords),

    this_month: calculateStats(monthRecords),

    this_year: calculateStats(yearRecords),
  };
}

/* ============================================================
   生成AI训练Prompt
============================================================ */

async function generateAITrainingPrompt() {
  try {
    console.log("🤖 开始生成AI训练分析……");

    const aiSettings = await getCurrentAISettingsForPrompt();

    console.log("🤖 当前AI教练设置：", aiSettings);

    const nextNumber = await getNextWorkoutNumber();

    console.log("🤖 下一次训练编号：", nextNumber);

    const history =
      typeof records !== "undefined" && Array.isArray(records) ? records : [];

    const exercises =
      typeof exerciseRecords !== "undefined" && Array.isArray(exerciseRecords)
        ? exerciseRecords
        : [];

    const bodyData =
      typeof bodyMetricsRecords !== "undefined" &&
      Array.isArray(bodyMetricsRecords)
        ? bodyMetricsRecords
        : [];

    const recentWorkouts = getRecentFiveWorkoutsForAI(history);

    const recentExercises = buildAIExerciseHistory(exercises, history);

    const recentBodyData = getSafeArray(bodyData)
      .slice()
      .sort((a, b) => {
        const dateA = String(a.record_date || a.measurement_date || "");

        const dateB = String(b.record_date || b.measurement_date || "");

        return dateB.localeCompare(dateA);
      })
      .slice(0, 10);

    const trainingSummary = buildAITrainingSummary(history);

    const weeklyTargetText =
      aiSettings.weekly_strength_target !== null
        ? `${aiSettings.weekly_strength_target} 次`
        : "未设置";

    const goalsText = aiSettings.goals.length
      ? aiSettings.goals.join("、")
      : "暂未设置";

    const focusText = aiSettings.focus || "暂未设置";

    const behaviorText = aiSettings.behavior || "暂未设置";

    const limitationsText = aiSettings.limitations || "暂无特别限制";

    const restrictionsText = aiSettings.restrictions || "暂无其它要求";

    const prompt = `

你现在是我的私人哑铃增肌/塑形教练。

请根据我的当前AI教练设置、最近训练历史、动作历史、身体数据以及近期训练统计，分析后制定下一次实际可执行的训练计划。

不要机械套用固定计划。
不要为了变化而变化。
如果当前动作合理，可以继续使用。
只有历史数据支持时，才调整重量、次数、组数或更换动作。


========================
【当前AI教练设置】
========================

每周力量训练目标：
${weeklyTargetText}

训练目标：
${goalsText}

AI重点关注：
${focusText}

AI教练行为：
${behaviorText}

目前不会 / 不适合的动作：
${limitationsText}

训练限制 / 其它要求：
${restrictionsText}


========================
【基础训练条件】
========================

身高：162 cm
当前体重：52 kg


========================
【下一次训练】
========================

网站根据数据库实际训练记录判断：

第${nextNumber}次训练


========================
【近期训练统计】
========================

${JSON.stringify(trainingSummary, null, 2)}


========================
【最近5次整次训练】
========================

${JSON.stringify(recentWorkouts, null, 2)}


========================
【动作历史】
========================

动作历史已经按照动作名称进行聚合。

同一个动作的历史记录会合并。

最近训练过的动作会优先显示。

请重点观察：

- 哪些动作最近刚训练过
- 哪些动作长期反复出现
- 哪些动作完成得很好
- 哪些动作经常未完成
- 哪些动作长期感觉吃力
- 哪些动作已经明显轻松
- 左右手力量差异
- 动作是否需要继续使用
- 动作是否需要调整
- 是否需要休息某些肌群

${JSON.stringify(recentExercises, null, 2)}


========================
【最近身体数据】
========================

${JSON.stringify(recentBodyData, null, 2)}


========================
【动作完成情况说明】
========================

completed：

true = 动作完成
false = 动作未完成

difficulty：

easy = 轻松
normal = 正常
hard = 吃力
null = 未完成或没有记录


========================
【请重点分析】
========================

1. 最近训练频率是否合适

2. 本周已经完成多少次力量训练

3. 本周距离当前每周力量训练目标还差多少次

4. 本月训练情况

5. 本年度训练情况

6. 最近哪些肌群训练较多

7. 哪些肌群需要恢复

8. 最近哪些动作连续出现

9. 哪些动作适合继续使用

10. 哪些动作表现出进步

11. 哪些动作可能停滞

12. 哪些动作过于轻松

13. 哪些动作过于吃力

14. 是否存在左手明显弱于右手

15. 是否需要增加重量

16. 是否需要增加次数

17. 是否需要增加组数

18. 是否需要降低训练量

19. 是否需要更换动作

20. 是否需要安排恢复性训练

21. 下一次训练如何更好地服务当前AI教练设置中的目标


========================
【训练计划要求】
========================

必须使用现有训练条件。

必须遵守当前AI教练设置中的：

- 训练目标
- AI重点关注
- AI教练行为
- 目前不适合动作
- 训练限制 / 其它要求

不要自行增加用户没有提出的硬性限制。

如果当前AI教练设置中没有明确限制训练动作数量，
不要人为限制动作数量。

如果用户设置中包含训练时间，
应作为训练安排的重要参考，
但不要机械为了达到某个分钟数而堆砌动作。

力量训练前后的热身、激活、主训练、核心、拉伸等内容，
都可以根据实际需要安排。

不要为了增加动作数量而增加无意义动作。

不要为了变化而强行更换已经合适的动作。


========================
【动作安排】
========================

每个动作都必须明确：

exercise_order
exercise_name
equipment
weight_kg
reps
sets
notes

自重动作：

weight_kg = null

哑铃动作：

weight_kg = 实际使用重量

reps允许使用：

"10"
"10/侧"
"12/侧"
"30秒"
"60秒"

如果是单侧动作，
可以根据左右侧能力合理安排。

如果左侧较弱，
优先保证左侧动作质量。

不要为了追求左右完全一样，
强行让弱侧超过合理能力。


========================
【最终输出】
========================

严格只输出JSON。

不要输出Markdown。

不要使用 Markdown 代码块包裹 JSON。

不要输出解释文字。

格式：

{
  "workout_number": ${nextNumber},
  "title": "第${nextNumber}次训练",
  "focus": "训练重点",
  "duration_minutes": 23,
  "notes": "本次训练安排逻辑以及需要特别注意的问题",
  "exercises": [
    {
      "exercise_order": 1,
      "exercise_name": "动作名称",
      "equipment": "哑铃",
      "weight_kg": 5,
      "reps": "10",
      "sets": 3,
      "notes": "动作注意事项"
    }
  ]
}

再次强调：

只能输出JSON。
`;

    const box = document.getElementById("aiPrompt");

    if (box) {
      box.value = prompt.trim();
    } else {
      console.warn("没有找到 #aiPrompt。");
    }

    console.log("✅ AI训练Prompt生成完成。");

    return prompt.trim();
  } catch (error) {
    console.error("❌ 生成AI训练提示词失败：", error);

    alert("生成 AI 训练提示词失败：\n\n" + (error.message || String(error)));

    return null;
  }
}

/* ============================================================
   复制Prompt
============================================================ */

async function copyAIPrompt() {
  const box = document.getElementById("aiPrompt");

  if (!box || !box.value) {
    alert("请先生成给 ChatGPT 的训练分析。");

    return;
  }

  try {
    await navigator.clipboard.writeText(box.value);

    alert("已经复制好了。现在把它发给 ChatGPT，让 ChatGPT 制定下一次训练。");
  } catch (error) {
    console.error(error);

    try {
      box.select();

      document.execCommand("copy");

      alert("已经复制好了。现在把它发给 ChatGPT。");
    } catch (copyError) {
      console.error(copyError);

      alert("复制失败，请手动复制提示词。");
    }
  }
}

/* ============================================================
   清理 ChatGPT 返回内容
============================================================ */

function cleanAIPlanText(text) {
  let result = String(text || "").trim();

  if (!result) {
    return "";
  }

  result = result.replace(/^```(?:json)?\s*/i, "");

  result = result.replace(/\s*```$/i, "");

  return result.trim();
}

/* ============================================================
   从ChatGPT返回内容提取JSON
============================================================ */

function extractAIPlanJSON(text) {
  let source = String(text || "").trim();

  if (!source) {
    throw new Error("没有检测到任何内容。");
  }

  source = source
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/：/g, ":")
    .replace(/，/g, ",")
    .trim();

  try {
    return JSON.parse(source);
  } catch (error) {}

  source = cleanAIPlanText(source);

  try {
    return JSON.parse(source);
  } catch (error) {}

  const firstBrace = source.indexOf("{");

  if (firstBrace === -1) {
    throw new Error("没有找到 JSON 对象。");
  }

  let depth = 0;

  let inString = false;

  let escaped = false;

  let endIndex = -1;

  for (let i = firstBrace; i < source.length; i++) {
    const char = source[i];

    if (char === "\\" && !escaped) {
      escaped = true;

      continue;
    }

    if (char === '"' && !escaped) {
      inString = !inString;
    }

    escaped = false;

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth++;
    }

    if (char === "}") {
      depth--;

      if (depth === 0) {
        endIndex = i;

        break;
      }
    }
  }

  if (endIndex === -1) {
    throw new Error("找到了JSON开头，但没有找到完整的JSON结尾。");
  }

  const jsonText = source.slice(firstBrace, endIndex + 1);

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.error("提取出的JSON：", jsonText);

    throw new Error("找到了一段JSON，但JSON格式仍然无法解析。");
  }
}

/* ============================================================
   验证AI训练计划
============================================================ */

function validateAITrainingPlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("训练计划格式不正确。");
  }

  if (!Array.isArray(plan.exercises)) {
    throw new Error("训练计划中没有找到 exercises 动作列表。");
  }

  if (!plan.exercises.length) {
    throw new Error("训练计划中没有任何训练动作。");
  }

  for (let i = 0; i < plan.exercises.length; i++) {
    const exercise = plan.exercises[i];

    if (!exercise || typeof exercise !== "object") {
      throw new Error(`第 ${i + 1} 个动作格式不正确。`);
    }

    if (!exercise.exercise_name) {
      throw new Error(`第 ${i + 1} 个动作缺少 exercise_name。`);
    }

    if (
      exercise.sets !== undefined &&
      exercise.sets !== null &&
      exercise.sets !== ""
    ) {
      const sets = Number(exercise.sets);

      if (!Number.isFinite(sets) || sets <= 0) {
        throw new Error(`第 ${i + 1} 个动作的 sets 不正确。`);
      }
    }

    if (
      exercise.weight_kg !== undefined &&
      exercise.weight_kg !== null &&
      exercise.weight_kg !== ""
    ) {
      const weight = Number(exercise.weight_kg);

      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(`第 ${i + 1} 个动作的 weight_kg 不正确。`);
      }
    }
  }

  return true;
}

/* ============================================================
   ★★★ 获取某个训练编号的全部旧计划
============================================================ */

async function getAllPlansByWorkoutNumber(workoutNumber) {
  const number = Number(workoutNumber);

  if (!Number.isFinite(number)) {
    throw new Error("无效的 workout_number。");
  }

  const plans = await supabaseRequest(
    "training_plans" +
      "?select=id,workout_number,plan_date,title" +
      "&workout_number=eq." +
      number +
      "&order=id.asc",
  );

  return getSafeArray(plans);
}

/* ============================================================
   ★★★ 获取某个计划的动作数量
============================================================ */

async function getPlanExerciseCount(planId) {
  if (!planId) {
    return 0;
  }

  const exercises = await supabaseRequest(
    "training_plan_exercises" + "?select=id" + "&plan_id=eq." + planId,
  );

  return getSafeArray(exercises).length;
}

/* ============================================================
   ★★★ 删除某个计划的全部动作
============================================================ */

async function deleteAllExercisesForPlan(planId) {
  if (!planId) {
    return;
  }

  console.log(`🗑️ 开始删除 plan_id=${planId} 的全部旧动作……`);

  /*
     先读取数量，方便日志确认
  */

  const beforeCount = await getPlanExerciseCount(planId);

  console.log(`🗑️ plan_id=${planId} 删除前有 ${beforeCount} 个动作。`);

  if (beforeCount === 0) {
    return;
  }

  await supabaseRequest("training_plan_exercises" + "?plan_id=eq." + planId, {
    method: "DELETE",

    prefer: "return=minimal",
  });

  /*
     ★ 删除后重新查询

     如果还有动作，
     直接报错。

     不允许继续创建新计划，
     防止出现 14 → 28 → 42。
  */

  const afterCount = await getPlanExerciseCount(planId);

  console.log(`🗑️ plan_id=${planId} 删除后剩余 ${afterCount} 个动作。`);

  if (afterCount !== 0) {
    throw new Error(
      `旧训练计划的动作没有完全删除。\n\n` +
        `plan_id：${planId}\n` +
        `删除前：${beforeCount} 个动作\n` +
        `删除后仍剩：${afterCount} 个动作\n\n` +
        `请检查 Supabase training_plan_exercises 的 DELETE RLS 权限。`,
    );
  }
}

/* ============================================================
   ★★★ 删除某个训练计划
============================================================ */

async function deleteTrainingPlanById(planId) {
  if (!planId) {
    return;
  }

  console.log(`🗑️ 删除旧 training_plans：${planId}`);

  await supabaseRequest("training_plans?id=eq." + planId, {
    method: "DELETE",

    prefer: "return=minimal",
  });

  /*
     ★ 删除后确认
  */

  const remaining = await supabaseRequest(
    "training_plans" + "?select=id" + "&id=eq." + planId,
  );

  if (getSafeArray(remaining).length) {
    throw new Error(
      `旧训练计划 ${planId} 没有成功删除。\n\n` +
        `请检查 Supabase training_plans 的 DELETE RLS 权限。`,
    );
  }
}

/* ============================================================
   ★★★ 清理某个 workout_number 的全部旧计划
============================================================ */

async function removeAllExistingPlansForWorkoutNumber(workoutNumber) {
  console.log(`🧹 开始彻底清理第${workoutNumber}次训练的旧计划……`);

  /*
     ★ 不再使用 limit=1

     必须把同一个 workout_number
     下所有历史 plan 都找出来。
  */

  const oldPlans = await getAllPlansByWorkoutNumber(workoutNumber);

  console.log(`🧹 找到 ${oldPlans.length} 个旧训练计划：`, oldPlans);

  if (!oldPlans.length) {
    console.log(`🧹 第${workoutNumber}次训练没有旧计划，无需清理。`);

    return;
  }

  /*
     第一阶段：

     删除所有旧计划的动作
  */

  for (let i = 0; i < oldPlans.length; i++) {
    const plan = oldPlans[i];

    await deleteAllExercisesForPlan(plan.id);
  }

  /*
     第二阶段：

     删除所有旧 training_plans
  */

  for (let i = 0; i < oldPlans.length; i++) {
    const plan = oldPlans[i];

    await deleteTrainingPlanById(plan.id);
  }

  /*
     第三阶段：

     最终确认这个 workout_number
     已经没有任何旧计划。
  */

  const remainingPlans = await getAllPlansByWorkoutNumber(workoutNumber);

  if (remainingPlans.length) {
    throw new Error(
      `第${workoutNumber}次训练的旧计划没有完全删除。\n\n` +
        `数据库中仍然存在 ${remainingPlans.length} 个 training_plans 记录。\n\n` +
        `请检查 Supabase training_plans 的 DELETE RLS 权限。`,
    );
  }

  console.log(`✅ 第${workoutNumber}次训练的旧计划已经全部清理完成。`);
}

/* ============================================================
   ★★★ 验证最终计划动作数量
============================================================ */

async function verifyImportedPlan(planId, expectedCount) {
  if (!planId) {
    throw new Error("没有 plan_id，无法验证训练动作。");
  }

  const exercises = await supabaseRequest(
    "training_plan_exercises" +
      "?select=id,exercise_name" +
      "&plan_id=eq." +
      planId +
      "&order=exercise_order.asc",
  );

  const actualCount = getSafeArray(exercises).length;

  console.log("🔎 导入完成后的数据库动作数量：", {
    plan_id: planId,
    expected: expectedCount,
    actual: actualCount,
  });

  if (actualCount !== expectedCount) {
    throw new Error(
      `训练计划动作数量验证失败。\n\n` +
        `AI返回：${expectedCount} 个动作\n` +
        `数据库实际：${actualCount} 个动作\n\n` +
        `本次导入不会被视为成功。`,
    );
  }

  return actualCount;
}

/* ============================================================
   导入ChatGPT训练计划
============================================================ */

async function importAITrainingPlan() {
  const box = document.getElementById("aiPlanInput");

  if (!box || !box.value.trim()) {
    alert("请先把 ChatGPT 生成的训练计划粘贴进来。");

    return;
  }

  /* ========================================================
     1. 解析
  ======================================================== */

  let plan;

  try {
    plan = extractAIPlanJSON(box.value);
  } catch (error) {
    console.error("AI训练计划JSON解析失败：", error);

    alert(
      "无法识别 ChatGPT 返回的训练计划。\n\n" +
        "请把 ChatGPT 的完整回答直接复制过来，" +
        "不需要自己修改。\n\n" +
        "支持：\n" +
        "• 纯 JSON\n" +
        "• ```json 代码块\n" +
        "• JSON 前后带说明文字",
    );

    return;
  }

  /* ========================================================
     2. 验证
  ======================================================== */

  try {
    validateAITrainingPlan(plan);
  } catch (error) {
    console.error("AI训练计划格式验证失败：", error);

    alert("训练计划格式不正确：\n\n" + error.message);

    return;
  }

  /* ========================================================
     3. 网站确定下一次训练编号
  ======================================================== */

  let nextNumber;

  try {
    nextNumber = await getNextWorkoutNumber();
  } catch (error) {
    alert("无法确定下一次训练编号。\n\n" + (error.message || String(error)));

    return;
  }

  /* ========================================================
     4. 检查AI编号
  ======================================================== */

  const aiNumber = Number(plan.workout_number);

  if (Number.isFinite(aiNumber) && aiNumber !== nextNumber) {
    console.warn(
      `ChatGPT 返回的训练编号为 ${aiNumber}，但数据库判断下一次训练应为 ${nextNumber}。已自动使用 ${nextNumber}。`,
    );
  }

  /* ========================================================
     5. 最终计划
  ======================================================== */

  const finalPlan = {
    workout_number: nextNumber,

    title: String(plan.title || `第${nextNumber}次训练`).trim(),

    focus: String(plan.focus || "").trim(),

    duration_minutes: Number(plan.duration_minutes) || 23,

    notes: String(plan.notes || "").trim(),

    exercises: plan.exercises,
  };

  /* ========================================================
     6. ★★★ 写入Supabase

     重要：

     不再：

     existing + limit=1

     而是：

     先彻底删除这个 workout_number
     下所有旧计划和旧动作。

     然后重新创建唯一计划。
  ======================================================== */

  try {
    console.log(
      `🚀 准备导入第${finalPlan.workout_number}次训练，共 ${finalPlan.exercises.length} 个动作。`,
    );

    /*
       ★★★★★
       第一步：彻底清理旧计划

       如果数据库里已经有：

       plan A → 14动作
       plan B → 14动作
       plan C → 14动作

       这里会全部处理。
    */

    await removeAllExistingPlansForWorkoutNumber(finalPlan.workout_number);

    console.log(`✅ 旧第${finalPlan.workout_number}次训练已经完全清理。`);

    /*
       ★★★★★
       第二步：

       创建唯一的新 training_plans
    */

    const created = await supabaseRequest("training_plans", {
      method: "POST",

      body: {
        workout_number: finalPlan.workout_number,

        plan_date: todayString(),

        title: finalPlan.title,

        focus: finalPlan.focus,

        duration_minutes: finalPlan.duration_minutes,

        notes: finalPlan.notes,
      },
    });

    if (!created || !created.length || !created[0].id) {
      throw new Error("training_plans 创建成功后没有返回 plan_id。");
    }

    const planId = created[0].id;

    console.log("✅ 新训练计划创建成功：", {
      plan_id: planId,

      workout_number: finalPlan.workout_number,
    });

    /* ======================================================
       7. 写入动作
    ====================================================== */

    let insertedExerciseCount = 0;

    for (let i = 0; i < finalPlan.exercises.length; i++) {
      const exercise = finalPlan.exercises[i];

      if (!exercise || !exercise.exercise_name) {
        console.warn(
          `第 ${i + 1} 个动作缺少 exercise_name，已跳过。`,
          exercise,
        );

        continue;
      }

      /* ====================================================
         重量
      ==================================================== */

      let weight = null;

      if (
        exercise.weight_kg !== null &&
        exercise.weight_kg !== undefined &&
        exercise.weight_kg !== ""
      ) {
        const parsedWeight = Number(exercise.weight_kg);

        if (Number.isFinite(parsedWeight) && parsedWeight >= 0) {
          weight = parsedWeight;
        }
      }

      /* ====================================================
         组数
      ==================================================== */

      let sets = Number(exercise.sets);

      if (!Number.isFinite(sets) || sets <= 0) {
        sets = 1;
      }

      /* ====================================================
         次数
      ==================================================== */

      const reps =
        exercise.reps === null || exercise.reps === undefined
          ? ""
          : String(exercise.reps).trim();

      /* ====================================================
         写入
      ==================================================== */

      await supabaseRequest("training_plan_exercises", {
        method: "POST",

        body: {
          plan_id: planId,

          exercise_order: Number(exercise.exercise_order) || i + 1,

          exercise_name: String(exercise.exercise_name).trim(),

          equipment: String(exercise.equipment || "自重").trim(),

          weight_kg: weight,

          reps: reps,

          sets: sets,

          notes: String(exercise.notes || "").trim(),
        },
      });

      insertedExerciseCount++;
    }

    /* ========================================================
       8. 检查本次写入数量
    ======================================================== */

    if (insertedExerciseCount === 0) {
      throw new Error("训练计划创建成功，但没有成功写入任何训练动作。");
    }

    /*
       ★★★
       这里第一次确认：

       我们实际 POST 了多少个动作。
    */

    if (insertedExerciseCount !== finalPlan.exercises.length) {
      throw new Error(
        `动作写入数量不一致。\n\n` +
          `AI返回：${finalPlan.exercises.length} 个动作\n` +
          `实际写入：${insertedExerciseCount} 个动作`,
      );
    }

    /* ========================================================
       9. ★★★ 从数据库重新读取确认

       防止：

       AI 14
       JS POST 14
       数据库却不是14
    ======================================================== */

    const actualCount = await verifyImportedPlan(
      planId,
      finalPlan.exercises.length,
    );

    /* ========================================================
       10. 成功
    ======================================================== */

    alert(
      `第${finalPlan.workout_number}次训练计划已经成功导入！💪\n\n` +
        `共 ${actualCount} 个动作。`,
    );

    box.value = "";

    /* ========================================================
       刷新当前训练计划
    ======================================================== */

    if (typeof loadCurrentPlan === "function") {
      await loadCurrentPlan();
    }

    if (typeof loadPlans === "function") {
      await loadPlans();
    }

    if (typeof loadTrainingPlans === "function") {
      await loadTrainingPlans();
    }

    /* ========================================================
       状态
    ======================================================== */

    if (typeof setStatus === "function") {
      setStatus("☁️ AI训练计划已同步", "ok");
    }

    console.log("AI训练计划导入成功：", {
      workout_number: finalPlan.workout_number,

      plan_id: planId,

      exercise_count: actualCount,
    });
  } catch (error) {
    console.error("AI训练计划导入失败：", error);

    alert("AI训练计划导入失败：\n\n" + (error.message || String(error)));
  }
}
