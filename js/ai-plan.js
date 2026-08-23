/* ============================================================
   ai-plan.js

   ChatGPT AI训练计划中转模块

   当前数据库结构：

   training_plans
       ↓
   training_plan_exercises

   workouts
       ↓
   workout_exercise_records

   已彻底取消 exercises 表。

   ------------------------------------------------------------

   数据职责：

   training_plans
   = AI生成的训练计划

   training_plan_exercises
   = 某个训练计划具体有哪些动作

   workouts
   = 用户实际完成过的某一次训练

   workout_exercise_records
   = 用户实际完成这次训练时，
     每个动作的完成情况和难度

   ------------------------------------------------------------

   动作难度：

   easy
   normal
   hard
   incomplete

   easy / normal / hard
   = completed = true

   incomplete
   = completed = false

   ------------------------------------------------------------

   时间字段：

   training_plans.duration_minutes
   = AI预计训练时长

   workouts.duration_minutes
   = 当时计划中的预计训练时长

   workouts.actual_duration_minutes
   = 用户训练完成后手动输入的实际训练时长

   AI分析历史时：

   duration_minutes
   = 计划预计时间

   actual_duration_minutes
   = 实际花费时间
============================================================ */

/* ============================================================
   工具函数
============================================================ */

function getSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

/* ============================================================
   日期工具
============================================================ */

function aiPlanGetDateValue(record) {
  if (!record || typeof record !== "object") {
    return "";
  }

  return String(
    record.workout_date ||
      record.record_date ||
      record.measurement_date ||
      record.plan_date ||
      "",
  );
}

/* ============================================================
   排序工具
============================================================ */

function aiPlanSortByDateDesc(a, b) {
  const dateA = aiPlanGetDateValue(a);
  const dateB = aiPlanGetDateValue(b);

  if (dateA !== dateB) {
    return dateB.localeCompare(dateA);
  }

  const numberA = Number(a?.workout_number);
  const numberB = Number(b?.workout_number);

  if (Number.isFinite(numberA) && Number.isFinite(numberB)) {
    return numberB - numberA;
  }

  return 0;
}

/* ============================================================
   AI对话模式
============================================================ */

/*
   HTML已经提供：

   input[name="aiConversationMode"]

   false = 继续当前对话
   true  = 新开ChatGPT对话

   ai-plan.js 不创建UI。
*/

function isNewAIConversation() {
  const selected = document.querySelector(
    'input[name="aiConversationMode"]:checked',
  );

  return selected ? selected.value === "new" : false;
}

/* ============================================================
   ① 获取训练设置
============================================================ */

async function getTrainingSettingsForAI() {
  try {
    if (typeof getAISettings !== "function") {
      throw new Error("找不到 getAISettings()。请确认 settings.js 已经加载。");
    }

    let settings = getAISettings();

    /*
       AI生成前重新从数据库读取一次
    */

    if (typeof loadAISettings === "function") {
      const loaded = await loadAISettings();

      if (loaded && typeof loaded === "object") {
        settings = loaded;
      }
    }

    if (!settings || typeof settings !== "object") {
      throw new Error("AI训练设置为空。");
    }

    const weeklyTarget = Number(settings.weekly_strength_target);

    return {
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
  } catch (error) {
    console.error("读取训练设置失败：", error);

    throw new Error(
      "无法读取当前AI教练设置。\n\n" + (error.message || String(error)),
    );
  }
}

/* ============================================================
   ② 获取当前训练状态
============================================================ */

async function getCurrentStateForAI() {
  try {
    const workouts = await supabaseRequest(
      "workouts" +
        "?select=workout_number,workout_date,completion_percent,duration_minutes,actual_duration_minutes" +
        "&order=workout_number.desc" +
        "&limit=1",
    );

    const list = getSafeArray(workouts);

    if (!list.length) {
      return {
        latest_saved_workout_number: 0,

        next_workout_number: 1,

        latest_workout: null,
      };
    }

    const latest = list[0];

    const latestNumber = Number(latest.workout_number);

    const safeLatestNumber = Number.isFinite(latestNumber) ? latestNumber : 0;

    return {
      latest_saved_workout_number: safeLatestNumber,

      next_workout_number: safeLatestNumber + 1,

      latest_workout: latest,
    };
  } catch (error) {
    console.error("读取当前训练状态失败：", error);

    throw new Error(
      "无法确定下一次训练编号。\n\n" + (error.message || String(error)),
    );
  }
}

/* ============================================================
   ③ 获取最近5条身体数据
============================================================ */

async function getBodyDataForAI() {
  try {
    const data = await supabaseRequest(
      "body_metrics" + "?select=*" + "&order=record_date.desc" + "&limit=5",
    );

    return getSafeArray(data);
  } catch (error) {
    console.error("读取身体数据失败：", error);

    /*
       身体数据不是AI生成训练计划的绝对必要条件。

       如果当前项目没有body_metrics表，
       不让整个AI功能崩溃。
    */

    return [];
  }
}

/* ============================================================
   ④ 获取最近N次训练计划及完整完成情况
============================================================ */

async function getRecentTrainingPlansWithResultsForAI(limit = 3) {
  try {
    const safeLimit =
      Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 3;

    console.log(`📚 正在读取最近${safeLimit}次训练计划及完成情况……`);

    /* ========================================================
       1. 最近N次训练计划
    ======================================================== */

    const plans = await supabaseRequest(
      "training_plans" +
        "?select=*" +
        "&order=workout_number.desc" +
        "&limit=" +
        safeLimit,
    );

    const recentPlans = getSafeArray(plans);

    if (!recentPlans.length) {
      return [];
    }

    /* ========================================================
       2. 读取这些计划的动作
    ======================================================== */

    const planExercises = await supabaseRequest(
      "training_plan_exercises?select=*",
    );

    const planExerciseRecords = getSafeArray(planExercises);

    /* ========================================================
       3. 读取实际训练记录

       这里只读取 workouts。

       不再读取 exercises。
    ======================================================== */

    const workouts = await supabaseRequest("workouts?select=*");

    const workoutRecords = getSafeArray(workouts);

    /* ========================================================
       4. 读取实际动作记录

       唯一来源：

       workout_exercise_records
    ======================================================== */

    const exerciseRecords = await supabaseRequest(
      "workout_exercise_records?select=*",
    );

    const actualExerciseRecords = getSafeArray(exerciseRecords);

    /* ========================================================
       5. 建立 plan_id → 计划动作
    ======================================================== */

    const planExerciseMap = new Map();

    planExerciseRecords.forEach((item) => {
      if (!item || item.id === undefined || item.id === null) {
        return;
      }

      const planId = String(item.plan_id);

      if (!planExerciseMap.has(planId)) {
        planExerciseMap.set(planId, []);
      }

      planExerciseMap.get(planId).push(item);
    });

    /* ========================================================
       6. 建立 workout_number → workout
    ======================================================== */

    const workoutMap = new Map();

    workoutRecords.forEach((workout) => {
      if (!workout) {
        return;
      }

      const number = Number(workout.workout_number);

      if (Number.isFinite(number)) {
        /*
           如果同一个workout_number存在多个版本，
           保留created_at更新的那个。

           正常情况下数据库应该只有一个。
        */

        const existing = workoutMap.get(number);

        if (!existing) {
          workoutMap.set(number, workout);

          return;
        }

        const existingCreated = new Date(existing.created_at || 0).getTime();

        const currentCreated = new Date(workout.created_at || 0).getTime();

        if (currentCreated >= existingCreated) {
          workoutMap.set(number, workout);
        }
      }
    });

    /* ========================================================
       7. 建立 plan_exercise_id → 实际动作记录
    ======================================================== */

    const actualExerciseMap = new Map();

    actualExerciseRecords.forEach((exercise) => {
      if (
        !exercise ||
        exercise.plan_exercise_id === undefined ||
        exercise.plan_exercise_id === null
      ) {
        return;
      }

      /*
         正常情况下：

         一个plan_exercise_id
         对应一次实际训练记录。

         如果存在重复，
         保留created_at更新的一条。
      */

      const key = String(exercise.plan_exercise_id);

      const existing = actualExerciseMap.get(key);

      if (!existing) {
        actualExerciseMap.set(key, exercise);

        return;
      }

      const existingCreated = new Date(existing.created_at || 0).getTime();

      const currentCreated = new Date(exercise.created_at || 0).getTime();

      if (currentCreated >= existingCreated) {
        actualExerciseMap.set(key, exercise);
      }
    });

    /* ========================================================
       8. 组合训练历史
    ======================================================== */

    const result = [];

    recentPlans.forEach((plan) => {
      const workoutNumber = Number(plan.workout_number);

      if (!Number.isFinite(workoutNumber)) {
        return;
      }

      const workout = workoutMap.get(workoutNumber);

      const planExercisesForThisPlan =
        planExerciseMap.get(String(plan.id)) || [];

      /* ======================================================
         按动作顺序排列
      ====================================================== */

      planExercisesForThisPlan.sort(
        (a, b) => Number(a.exercise_order || 0) - Number(b.exercise_order || 0),
      );

      const completed = [];

      const notCompleted = [];

      const easy = [];

      const normal = [];

      const difficult = [];

      const exercises = [];

      /* ======================================================
         处理每一个动作
      ====================================================== */

      planExercisesForThisPlan.forEach((planExercise) => {
        const actualExercise = actualExerciseMap.get(String(planExercise.id));

        const exerciseName = planExercise.exercise_name || "未知动作";

        /* ----------------------------------------------------
           训练计划原始要求
        ---------------------------------------------------- */

        const equipment = planExercise.equipment || "自重";

        let weight = null;

        if (
          planExercise.weight_kg !== undefined &&
          planExercise.weight_kg !== null &&
          planExercise.weight_kg !== ""
        ) {
          weight = planExercise.weight_kg;
        }

        const reps =
          planExercise.reps !== undefined && planExercise.reps !== null
            ? String(planExercise.reps)
            : "";

        const sets =
          planExercise.sets !== undefined && planExercise.sets !== null
            ? planExercise.sets
            : null;

        const planNotes = String(planExercise.notes || "").trim();

        /* ----------------------------------------------------
           实际完成情况
        ---------------------------------------------------- */

        let status = "未记录";

        let difficulty = "";

        if (actualExercise) {
          const completedValue = actualExercise.completed;

          if (completedValue === true) {
            status = "已完成";
          } else {
            status = "未完成";
          }

          difficulty = String(actualExercise.difficulty || "")
            .trim()
            .toLowerCase();
        }

        /* ----------------------------------------------------
           标准化difficulty

           数据库统一：

           easy
           normal
           hard
           incomplete
        ---------------------------------------------------- */

        if (!["easy", "normal", "hard", "incomplete"].includes(difficulty)) {
          difficulty = "";
        }

        /* ----------------------------------------------------
           根据difficulty汇总
        ---------------------------------------------------- */

        if (difficulty === "easy") {
          easy.push(exerciseName);
        }

        if (difficulty === "normal") {
          normal.push(exerciseName);
        }

        if (difficulty === "hard") {
          difficult.push(exerciseName);
        }

        /* ----------------------------------------------------
           完成 / 未完成汇总
        ---------------------------------------------------- */

        if (status === "已完成") {
          completed.push(exerciseName);
        }

        if (status === "未完成" || difficulty === "incomplete") {
          notCompleted.push(exerciseName);
        }

        /* ----------------------------------------------------
           实际记录中的扩展字段

           当前系统主要使用：

           completed
           difficulty

           如果数据库未来增加：

           actual_weight_kg
           actual_reps
           actual_sets
           notes

           仍然可以兼容。
        ---------------------------------------------------- */

        const actualWeight =
          actualExercise?.actual_weight_kg ??
          actualExercise?.weight_kg ??
          actualExercise?.weight ??
          null;

        const actualReps =
          actualExercise?.actual_reps ?? actualExercise?.reps ?? null;

        const actualSets =
          actualExercise?.actual_sets ?? actualExercise?.sets ?? null;

        const actualNotes =
          actualExercise?.actual_notes ??
          actualExercise?.notes ??
          actualExercise?.note ??
          "";

        /* ----------------------------------------------------
           完整动作历史
        ---------------------------------------------------- */

        exercises.push({
          exercise_order: planExercise.exercise_order ?? null,

          exercise_name: exerciseName,

          equipment: equipment,

          weight_kg: weight,

          reps: reps,

          sets: sets,

          notes: planNotes,

          status: status,

          difficulty: difficulty,

          actual_weight_kg: actualWeight,

          actual_reps: actualReps,

          actual_sets: actualSets,

          actual_notes: String(actualNotes || "").trim(),
        });
      });

      /* ======================================================
         训练时长

         duration_minutes
         = AI原计划预计时间

         actual_duration_minutes
         = 用户实际输入的训练时间
      ====================================================== */

      const plannedDuration =
        workout?.duration_minutes ?? plan.duration_minutes ?? null;

      const actualDuration = workout?.actual_duration_minutes ?? null;

      /* ======================================================
         生成这一条训练历史
      ====================================================== */

      result.push({
        workout_number: workoutNumber,

        workout_date: workout?.workout_date || plan.plan_date || null,

        title: plan.title || `第${workoutNumber}次训练`,

        focus: plan.focus || "",

        /*
           原计划预计时长
        */

        duration_minutes: plannedDuration,

        /*
           实际训练时长

           用户手动输入
        */

        actual_duration_minutes: actualDuration,

        completion_percent: workout?.completion_percent ?? null,

        body_note: workout?.body_note || workout?.notes || "",

        plan_notes: plan.notes || "",

        exercises: exercises,

        completed: completed,

        not_completed: notCompleted,

        easy: easy,

        normal: normal,

        difficult: difficult,
      });
    });

    /* ========================================================
       9. 按训练编号倒序
    ======================================================== */

    result.sort((a, b) => Number(b.workout_number) - Number(a.workout_number));

    console.log(`✅ 最近${safeLimit}次训练计划及完成情况读取完成。`, result);

    return result;
  } catch (error) {
    console.error("读取最近训练计划及完成情况失败：", error);

    throw new Error(
      "无法读取最近训练计划及完成情况。\n\n" + (error.message || String(error)),
    );
  }
}

/* ============================================================
   ⑤ 生成AI设置文本
============================================================ */

function formatAISettingsForPrompt(trainingSettings) {
  if (!trainingSettings || typeof trainingSettings !== "object") {
    return "当前没有提供AI训练设置。";
  }

  const weeklyTargetText =
    trainingSettings.weekly_strength_target !== null
      ? `${trainingSettings.weekly_strength_target} 次`
      : "未设置";

  const goalsText = trainingSettings.goals?.length
    ? trainingSettings.goals.join("、")
    : "未设置";

  const focusText = trainingSettings.focus || "未设置";

  const behaviorText = trainingSettings.behavior || "未设置";

  const limitationsText = trainingSettings.limitations || "暂无";

  const restrictionsText = trainingSettings.restrictions || "暂无";

  return `
【当前AI训练设置】

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
`.trim();
}

/* ============================================================
   ⑥ 生成训练历史说明
============================================================ */

function formatRecentTrainingHistoryForPrompt(
  recentTrainingPlansWithResults,
  historyCount,
) {
  const data = getSafeArray(recentTrainingPlansWithResults);

  if (!data.length) {
    return "目前没有可提供的训练历史。";
  }

  return `
【最近${historyCount}次训练计划及完成情况】

这里的 exercises 是每次训练当时真实保存的训练计划。

每个动作包含：

- exercise_name：动作名称
- equipment：器械
- weight_kg：计划重量
- reps：计划次数
- sets：计划组数
- notes：计划动作要求/注意事项
- status：实际是否完成
- difficulty：实际训练难度
- actual_weight_kg：如果数据库有记录，则为实际使用重量
- actual_reps：如果数据库有记录，则为实际完成次数
- actual_sets：如果数据库有记录，则为实际完成组数
- actual_notes：如果数据库有记录，则为实际动作备注

每次训练还包含：

- duration_minutes：原计划预计训练时间
- actual_duration_minutes：用户实际训练花费时间
- completion_percent：本次动作完成比例
- body_note：训练后的身体感受

特别注意：

duration_minutes 是“计划预计时间”。

actual_duration_minutes 是“实际训练时间”。

actual_duration_minutes 由用户训练完成后手动输入，
不要把它当成AI原计划时间。

动作难度统一使用：

easy
normal
hard
incomplete

含义：

easy
= 这个动作完成起来比较轻松

normal
= 正常难度

hard
= 这个动作比较吃力

incomplete
= 这个动作没有完成

如果某个动作没有实际记录，
status 会显示为“未记录”，
difficulty为空。

请同时参考：

1. 计划动作
2. 计划次数
3. 计划组数
4. 计划重量
5. 动作备注
6. 实际是否完成
7. 实际难度
8. 实际训练重量/次数/组数（如果有）
9. 实际训练时间
10. body_note
11. 最近几次训练之间的变化

尤其注意：

easy 表示这个动作对我来说偏轻松。

hard 表示这个动作对我来说偏吃力。

normal 表示正常。

incomplete 表示没有完成。

不要只根据动作名称判断训练负荷。

必须结合实际历史表现动态调整下一次训练。

${JSON.stringify(data, null, 2)}
`.trim();
}

/* ============================================================
   ⑦ 生成AI训练Prompt
============================================================ */

async function generateAITrainingPrompt() {
  try {
    console.log("🤖 开始生成AI训练提示词……");

    /* ========================================================
       判断AI对话模式
    ======================================================== */

    const isNewConversation = isNewAIConversation();

    const historyCount = isNewConversation ? 8 : 3;

    console.log("🤖 AI对话模式：", isNewConversation ? "新开对话" : "继续对话");

    console.log(`🤖 本次提供最近${historyCount}次训练历史。`);

    /* ========================================================
       数据读取
    ======================================================== */

    const dataPromises = [
      getCurrentStateForAI(),

      getBodyDataForAI(),

      getRecentTrainingPlansWithResultsForAI(historyCount),
    ];

    /*
       新开对话才读取AI设置
    */

    if (isNewConversation) {
      dataPromises.unshift(getTrainingSettingsForAI());
    }

    const dataResults = await Promise.all(dataPromises);

    let trainingSettings = null;

    let currentState = null;

    let bodyData = null;

    let recentTrainingPlansWithResults = null;

    if (isNewConversation) {
      trainingSettings = dataResults[0];

      currentState = dataResults[1];

      bodyData = dataResults[2];

      recentTrainingPlansWithResults = dataResults[3];
    } else {
      currentState = dataResults[0];

      bodyData = dataResults[1];

      recentTrainingPlansWithResults = dataResults[2];
    }

    const nextNumber = currentState.next_workout_number;

    /* ========================================================
       Prompt头部
    ======================================================== */

    const promptHeader = `
你是我的私人哑铃训练教练。

请根据以下真实训练数据，判断下一次最适合的力量训练计划。

你必须根据历史实际表现动态调整训练。

不要机械套用固定计划。
不要为了“变化”而强行更换动作。

如果某个动作最近表现良好，可以继续保留并逐步进阶。

如果某个动作连续吃力，应考虑：
- 保持当前负荷
- 降低次数
- 减少组数
- 降低重量
- 必要时更换动作

如果某个动作轻松完成，可以在合理范围内进阶。

下一次训练编号：
第${nextNumber}次
`.trim();

    /* ========================================================
       AI设置
    ======================================================== */

    let settingsSection = "";

    if (isNewConversation) {
      settingsSection = "\n\n" + formatAISettingsForPrompt(trainingSettings);
    } else {
      settingsSection = `
【AI训练设置】

本次为继续当前ChatGPT对话。

不要重复提供AI训练设置。

请继续使用当前ChatGPT对话中已经确定的：

- 训练目标
- AI重点关注
- AI教练行为
- 动作限制
- 其它训练要求

如果当前对话中已经存在这些设置，
以当前对话上下文为准。
`.trim();
    }

    /* ========================================================
       当前状态
    ======================================================== */

    const currentStateSection = `
【当前训练状态】

最近一次已保存训练：
第${currentState.latest_saved_workout_number}次

下一次训练：
第${nextNumber}次

请以数据库当前状态为准，
不要自行修改训练编号。
`.trim();

    /* ========================================================
       身体数据
    ======================================================== */

    const bodyDataSection = `
【最近5条身体数据】

${JSON.stringify(bodyData, null, 2)}

如果身体数据为空，
则不要虚构身体数据。
`.trim();

    /* ========================================================
       训练历史
    ======================================================== */

    const historySection =
      "\n\n" +
      formatRecentTrainingHistoryForPrompt(
        recentTrainingPlansWithResults,
        historyCount,
      );

    /* ========================================================
       AI判断规则
    ======================================================== */

    const analysisRules = `
【训练计划判断规则】

请重点分析：

1. 最近训练的动作选择
2. 每个动作的计划重量
3. 每个动作的计划次数
4. 每个动作的计划组数
5. 每个动作的实际完成情况
6. easy / normal / hard / incomplete
7. 最近几次训练中同一动作的变化
8. 是否存在连续未完成动作
9. 是否存在连续轻松完成动作
10. 当前身体数据
11. 当前训练目标
12. 当前训练限制
13. 计划训练时间
14. 实际训练时间

如果左右侧能力不同：

必须优先照顾较弱侧。

不要为了左右完全一致，
强行让较弱一侧超过合理能力。

不要仅仅因为一次easy就大幅增加负荷。

应结合最近几次同一动作的表现判断是否进阶。

如果历史数据显示某个动作：

- 连续easy → 可以合理进阶
- normal → 可以保持或小幅进阶
- hard → 优先保持、降低次数/组数或降低负荷
- incomplete → 不要机械增加负荷，必要时降低难度或更换动作

如果实际训练时间明显超过计划时间：

下一次应考虑减少动作数量、组数或训练复杂度。

如果实际训练时间明显短于计划时间，
且动作完成情况良好，
可以考虑合理增加训练内容，
但不要为了填满时间而强行增加动作。

训练动作应该围绕当前目标服务。

不要因为凑动作数量而加入没有必要的动作。

不要为了变化而变化。
`.trim();

    /* ========================================================
       动作输出格式
    ======================================================== */

    const outputRules = `
【下一次训练动作格式】

每个动作必须包含：

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

reps可以使用：

"8"
"8-10"
"10"
"10/侧"
"12/侧"
"30秒"
"45秒"
"60秒"

sets必须是数字。

例如：

{
  "exercise_order": 1,
  "exercise_name": "猫牛式",
  "equipment": "自重",
  "weight_kg": null,
  "reps": "8-10",
  "sets": 2,
  "notes": "动作缓慢，配合呼吸"
}

表示：

猫牛式（8-10次 × 2组）

不要把：

“8-10次 × 2组”

只写在notes里。

必须把次数放进reps，
把组数放进sets。

如果动作有左右侧：

可以使用：

"8/侧"
"10/侧"
"10-12/侧"

如果动作是时间：

使用：

"30秒"
"45秒"
"60秒"
`.trim();

    /* ========================================================
       最终输出格式
    ======================================================== */

    const finalOutputRules = `
【最终输出】

严格只输出JSON。

不要输出Markdown。
不要使用代码块。
不要输出解释文字。
不要在JSON前后添加任何说明。

格式：

{
  "workout_number": ${nextNumber},
  "title": "第${nextNumber}次训练",
  "focus": "训练重点",
  "duration_minutes": 23,
  "notes": "本次训练安排逻辑以及需要注意的问题",
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

duration_minutes：

表示AI预计这次训练需要多少分钟。

它不是用户实际完成训练所花的时间。

actual_duration_minutes：

不需要由ChatGPT输出。

这个字段由用户完成训练后，
在训练保存时手动输入。

只能输出JSON。
`.trim();

    /* ========================================================
       最终Prompt
    ======================================================== */

    const prompt = [
      promptHeader,

      settingsSection,

      currentStateSection,

      bodyDataSection,

      historySection,

      analysisRules,

      outputRules,

      finalOutputRules,
    ]
      .filter(Boolean)
      .join("\n\n");

    /* ========================================================
       写入页面
    ======================================================== */

    const box = document.getElementById("aiPrompt");

    if (box) {
      box.value = prompt.trim();
    } else {
      console.warn("没有找到 #aiPrompt。");
    }

    /* ========================================================
       日志
    ======================================================== */

    console.log("✅ AI训练Prompt生成完成。");

    console.log({
      newConversation: isNewConversation,

      historyCount: historyCount,

      includesAISettings: isNewConversation,

      nextWorkoutNumber: nextNumber,
    });

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
    alert("请先生成给 ChatGPT 的训练提示词。");

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
   清理ChatGPT返回内容
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

  /* ========================================================
     直接解析
  ======================================================== */

  try {
    return JSON.parse(source);
  } catch (error) {}

  /* ========================================================
     清理代码块
  ======================================================== */

  source = cleanAIPlanText(source);

  try {
    return JSON.parse(source);
  } catch (error) {}

  /* ========================================================
     从说明文字中提取JSON对象
  ======================================================== */

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

    /* ======================================================
       sets
    ====================================================== */

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

    /* ======================================================
       weight
    ====================================================== */

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

    /* ======================================================
       reps

       reps允许字符串：

       8
       8-10
       10/侧
       30秒
    ====================================================== */

    if (exercise.reps !== undefined && exercise.reps !== null) {
      const reps = String(exercise.reps).trim();

      if (!reps) {
        throw new Error(`第 ${i + 1} 个动作的 reps 不能为空。`);
      }
    }
  }

  return true;
}

/* ============================================================
   获取某个训练编号的全部旧计划
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
   获取某个计划的动作数量
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
   删除某个计划的全部动作
============================================================ */

async function deleteAllExercisesForPlan(planId) {
  if (!planId) {
    return;
  }

  const beforeCount = await getPlanExerciseCount(planId);

  console.log(`🗑️ plan_id=${planId} 删除前有 ${beforeCount} 个动作。`);

  if (beforeCount === 0) {
    return;
  }

  await supabaseRequest("training_plan_exercises" + "?plan_id=eq." + planId, {
    method: "DELETE",

    prefer: "return=minimal",
  });

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
   删除某个训练计划
============================================================ */

async function deleteTrainingPlanById(planId) {
  if (!planId) {
    return;
  }

  await supabaseRequest("training_plans?id=eq." + planId, {
    method: "DELETE",

    prefer: "return=minimal",
  });

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
   删除某个训练计划及其动作
============================================================ */

async function deleteTrainingPlanCompletely(planId) {
  if (!planId) {
    return;
  }

  /*
     当前数据库如果：

     training_plan_exercises.plan_id
     ↓
     training_plans.id

     没有设置CASCADE，

     就先删除动作，再删除计划。
  */

  await deleteAllExercisesForPlan(planId);

  await deleteTrainingPlanById(planId);
}

/* ============================================================
   清理某个 workout_number 的全部旧计划
============================================================ */

async function removeAllExistingPlansForWorkoutNumber(workoutNumber) {
  console.log(`🧹 开始清理第${workoutNumber}次训练的旧计划……`);

  const oldPlans = await getAllPlansByWorkoutNumber(workoutNumber);

  if (!oldPlans.length) {
    console.log(`ℹ️ 第${workoutNumber}次训练没有旧计划。`);

    return;
  }

  /*
     先删除动作
  */

  for (const plan of oldPlans) {
    await deleteAllExercisesForPlan(plan.id);
  }

  /*
     再删除计划
  */

  for (const plan of oldPlans) {
    await deleteTrainingPlanById(plan.id);
  }

  /*
     最终确认
  */

  const remainingPlans = await getAllPlansByWorkoutNumber(workoutNumber);

  if (remainingPlans.length) {
    throw new Error(
      `第${workoutNumber}次训练的旧计划没有完全删除。\n\n` +
        `数据库中仍然存在 ${remainingPlans.length} 个 training_plans 记录。\n\n` +
        `请检查 Supabase training_plans 的 DELETE RLS 权限。`,
    );
  }

  console.log(`✅ 第${workoutNumber}次训练旧计划清理完成。`);
}

/* ============================================================
   验证最终计划动作数量
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
        `数据库实际：${actualCount} 个动作`,
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
        "请把 ChatGPT 的完整回答直接复制过来。",
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
    const currentState = await getCurrentStateForAI();

    nextNumber = currentState.next_workout_number;
  } catch (error) {
    alert("无法确定下一次训练编号。\n\n" + (error.message || String(error)));

    return;
  }

  /* ========================================================
     4. 网站编号覆盖AI编号
  ======================================================== */

  const aiNumber = Number(plan.workout_number);

  if (Number.isFinite(aiNumber) && aiNumber !== nextNumber) {
    console.warn(
      `ChatGPT返回第${aiNumber}次，` +
        `数据库下一次应为第${nextNumber}次。` +
        `已使用网站编号。`,
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
     6. 写入Supabase
     
     重要：

     不再：

     先删除旧计划
     ↓
     再创建新计划

     而是：

     创建新计划
     ↓
     写入全部动作
     ↓
     验证成功
     ↓
     删除旧计划

     防止新计划导入失败时，
     把原来的旧计划一起删除。
  ======================================================== */

  let newPlanId = null;

  try {
    console.log(
      `🚀 准备导入第${finalPlan.workout_number}次训练，` +
        `共 ${finalPlan.exercises.length} 个动作。`,
    );

    /* ======================================================
       6.1 创建新的training_plans
    ====================================================== */

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

    newPlanId = created[0].id;

    console.log("✅ 新training_plans创建成功：", newPlanId);

    /* ======================================================
       6.2 写入动作
    ====================================================== */

    let insertedExerciseCount = 0;

    for (let i = 0; i < finalPlan.exercises.length; i++) {
      const exercise = finalPlan.exercises[i];

      if (!exercise || !exercise.exercise_name) {
        throw new Error(`第${i + 1}个动作无效，缺少exercise_name。`);
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

        if (!Number.isFinite(parsedWeight) || parsedWeight < 0) {
          throw new Error(`第${i + 1}个动作的weight_kg无效。`);
        }

        weight = parsedWeight;
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

         保留字符串：

         8-10
         10/侧
         30秒
      ==================================================== */

      const reps =
        exercise.reps === null || exercise.reps === undefined
          ? ""
          : String(exercise.reps).trim();

      if (!reps) {
        throw new Error(`第${i + 1}个动作缺少reps。`);
      }

      /* ====================================================
         动作顺序
      ==================================================== */

      const exerciseOrder = Number(exercise.exercise_order);

      const safeExerciseOrder =
        Number.isFinite(exerciseOrder) && exerciseOrder > 0
          ? exerciseOrder
          : i + 1;

      /* ====================================================
         写入training_plan_exercises
      ==================================================== */

      await supabaseRequest("training_plan_exercises", {
        method: "POST",

        body: {
          plan_id: newPlanId,

          exercise_order: safeExerciseOrder,

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

    /* ======================================================
       6.3 检查写入数量
    ====================================================== */

    if (insertedExerciseCount === 0) {
      throw new Error("训练计划创建成功，但没有成功写入任何训练动作。");
    }

    if (insertedExerciseCount !== finalPlan.exercises.length) {
      throw new Error(
        `动作写入数量不一致。\n\n` +
          `AI返回：${finalPlan.exercises.length} 个动作\n` +
          `实际写入：${insertedExerciseCount} 个动作`,
      );
    }

    /* ======================================================
       6.4 从数据库重新验证
    ====================================================== */

    const actualCount = await verifyImportedPlan(
      newPlanId,
      finalPlan.exercises.length,
    );

    /* ======================================================
       6.5 新计划已经完整成功

       现在才删除同编号旧计划。
    ====================================================== */

    const oldPlans = await getAllPlansByWorkoutNumber(finalPlan.workout_number);

    for (const oldPlan of oldPlans) {
      /*
         防止误删刚刚创建的新计划
      */

      if (String(oldPlan.id) === String(newPlanId)) {
        continue;
      }

      await deleteTrainingPlanCompletely(oldPlan.id);
    }

    /* ======================================================
       6.6 最终确认：

       同一个workout_number
       现在只能保留新计划
    ====================================================== */

    const remainingPlans = await getAllPlansByWorkoutNumber(
      finalPlan.workout_number,
    );

    const unexpectedPlans = remainingPlans.filter(
      (item) => String(item.id) !== String(newPlanId),
    );

    if (unexpectedPlans.length) {
      throw new Error(
        `第${finalPlan.workout_number}次训练仍存在旧训练计划。\n\n` +
          `当前共有 ${remainingPlans.length} 个计划。\n` +
          `新计划ID：${newPlanId}\n\n` +
          `请检查 training_plans DELETE RLS 权限。`,
      );
    }

    /* ======================================================
       7. 成功
    ====================================================== */

    alert(
      `第${finalPlan.workout_number}次训练计划已经成功导入！💪\n\n` +
        `共 ${actualCount} 个动作。`,
    );

    box.value = "";

    /* ======================================================
       8. 刷新页面数据
    ====================================================== */

    if (typeof loadCurrentPlan === "function") {
      await loadCurrentPlan();
    }

    if (typeof loadPlans === "function") {
      await loadPlans();
    }

    if (typeof loadTrainingPlans === "function") {
      await loadTrainingPlans();
    }

    /* ======================================================
       状态
    ====================================================== */

    if (typeof setStatus === "function") {
      setStatus("☁️ AI训练计划已同步", "ok");
    }

    console.log("AI训练计划导入成功：", {
      workout_number: finalPlan.workout_number,

      plan_id: newPlanId,

      exercise_count: actualCount,
    });
  } catch (error) {
    console.error("AI训练计划导入失败：", error);

    /* ======================================================
       如果新计划已经创建，

       但后续动作写入或验证失败，

       删除这个新计划。

       这样可以保证：

       旧计划还在
       +
       新失败计划被清理
    ====================================================== */

    if (newPlanId) {
      try {
        console.warn(`🧹 正在清理失败的新训练计划：${newPlanId}`);

        await deleteTrainingPlanCompletely(newPlanId);

        console.log("✅ 失败的新训练计划已经清理。");
      } catch (cleanupError) {
        console.error("❌ 清理失败的新训练计划时发生错误：", cleanupError);
      }
    }

    alert(
      "AI训练计划导入失败：\n\n" +
        (error.message || String(error)) +
        "\n\n" +
        "原有训练计划没有主动删除。",
    );
  }
}
