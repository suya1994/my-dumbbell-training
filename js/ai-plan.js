/* ================================
   ai-plan.js
   ChatGPT AI训练计划中转模块

   最终版

   核心逻辑：

   1. 下一次训练编号
      = workouts 中最近一次已保存训练 + 1

   2. 不依赖 records 是否已经加载。

   3. AI 只负责：
      分析历史
      → 制定下一次训练计划

   4. 网站负责：
      确定正确 workout_number
      → 写入 training_plans
      → 写入 training_plan_exercises

   5. 每个动作实际训练难度：
      easy
      normal
      hard
      incomplete

   6. 未完成：
      completed = false
      difficulty = null
================================ */

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

   与 plan.js 保持完全一致：

   最近一次训练 + 1

   例如：

   没有训练
   → 第1次

   已完成第5次
   → 第6次

   即使 training_plans 已经有第6、第7、第8次，
   下一次仍然是第6次。
============================================================ */

async function getNextWorkoutNumber() {
  const latestWorkoutNumber = await getLatestWorkoutNumberForAI();

  return latestWorkoutNumber + 1;
}

/* ============================================================
   生成给 ChatGPT 的训练分析
============================================================ */

async function generateAITrainingPrompt() {
  try {
    /* ========================================================
       1. 网站直接从数据库确定下一次训练编号
    ======================================================== */

    const nextNumber = await getNextWorkoutNumber();

    console.log("AI计划下一次训练编号：", nextNumber);

    /* ========================================================
       2. 获取已经加载好的历史数据

       records：
       整次训练历史

       exerciseRecords：
       每个动作历史

       bodyMetricsRecords：
       身体数据历史
    ======================================================== */

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

    /* ========================================================
       3. 只把最近的数据给 AI

       避免提示词无限增长。
    ======================================================== */

    const recentWorkouts = history.slice(0, 10);

    const recentExercises = exercises.slice(0, 40);

    const recentBodyData = bodyData.slice(0, 10);

    /* ========================================================
       4. 生成 Prompt
    ======================================================== */

    const prompt = `

你现在是我的私人哑铃增肌/塑形教练。

请根据我过去的训练历史、每个动作的完成情况、训练难度、重量、次数、训练频率、身体感受以及身体数据，为我制定下一次训练计划。

不要按照死板的固定规则安排。

请真正分析历史之后，再决定下一次训练。


========================
我的基本情况
========================

初始身高：162 cm
初始体重：52 kg

训练目标优先级：

1. 腰腹收紧、核心稳定
2. 臀部塑形
3. 手臂塑形
4. 背部训练


========================
训练条件
========================

- 两个 5 kg 哑铃
- 瑜伽垫
- 椅子
- 桌子


========================
训练限制
========================

- 深蹲-我暂时不会
- 罗马尼亚硬拉-暂时不会
- 俯身哑铃划船-暂时不会
- 腰部容易疲劳，需要保护腰部
- 左手力量比右手弱
- 不要为了追求进步而强行增加训练量
- 如果当前动作已经适合继续训练，不要为了“变化”而强行更换


========================
下一次训练
========================

网站根据实际训练数据库判断：

第 ${nextNumber} 次训练


========================
最近训练历史
========================

${JSON.stringify(recentWorkouts, null, 2)}


========================
最近动作训练数据
========================

${JSON.stringify(recentExercises, null, 2)}


========================
最近身体数据
========================

${JSON.stringify(recentBodyData, null, 2)}


========================
动作历史数据说明
========================

动作历史中可能包含：

completed：
true = 动作完成
false = 动作未完成

difficulty：
easy = 轻松
normal = 正常
hard = 吃力
null = 未完成

请特别关注：

- 哪些动作连续训练
- 哪些动作经常未完成
- 哪些动作长期感觉吃力
- 哪些动作已经比较轻松
- 是否存在左手明显弱于右手的情况
- 最近训练量是否过高
- 是否需要恢复
- 是否应该增加、减少或维持训练量


========================
你的分析任务
========================

请分析：

1. 最近哪些动作已经连续训练
2. 哪些肌群最近训练量较高
3. 哪些肌群需要恢复
4. 哪些动作出现进步
5. 哪些动作出现停滞
6. 左右手是否存在差异
7. 最近整体训练完成度
8. 最近各动作训练难度
9. 是否应该增加重量
10. 是否应该增加次数
11. 是否应该增加组数
12. 是否应该降低训练量
13. 是否应该更换某个动作
14. 是否应该安排恢复性训练
15. 如何继续实现：
   - 腰腹收紧
   - 核心稳定
   - 臀部塑形
   - 手臂塑形
   - 背部训练

不要为了“变化”而变化。

如果某个动作继续使用是合理的，可以继续使用。

如果某个动作需要调整重量、次数或组数，请明确调整。

如果需要更换动作，请根据历史表现说明原因。


========================
训练计划要求
========================

- 必须使用现有训练条件
- 注意保护腰部
- 不要一次增加过多训练量
- 对左手较弱的问题进行合理处理
- 如果使用单侧动作，可以根据左右手差异安排不同次数
- 训练计划必须具有实际可执行性
- 每个动作都必须有明确的重量、次数、组数
- 自重动作 weight_kg 必须为 null
- reps 可以使用：
  "10"
  "10/侧"
  "12/侧"
  "30秒"
  "60秒"
  等形式


========================
输出格式
========================

请严格只输出 JSON。

不要输出 Markdown。

不要输出 \`\`\`json。

不要输出任何解释文字。

JSON 格式必须严格如下：

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

只能输出 JSON。
`;

    /* ========================================================
       5. 写入页面
    ======================================================== */

    const box = document.getElementById("aiPrompt");

    if (box) {
      box.value = prompt.trim();
    }

    return prompt.trim();
  } catch (error) {
    console.error("生成 AI 训练提示词失败：", error);

    alert("生成 AI 训练提示词失败：\n\n" + (error.message || String(error)));

    return null;
  }
}

/* ============================================================
   复制提示词
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

  /*
    去掉 Markdown JSON 代码块
  */

  result = result.replace(/^```(?:json)?\s*/i, "");

  result = result.replace(/\s*```$/i, "");

  return result.trim();
}

/* ============================================================
   从 ChatGPT 返回内容中提取 JSON

   支持：

   ① 纯 JSON
   ② ```json ... ```
   ③ ``` ... ```
   ④ JSON 前后带普通文字
   ⑤ 中文全角标点
============================================================ */

function extractAIPlanJSON(text) {
  let source = String(text || "").trim();

  if (!source) {
    throw new Error("没有检测到任何内容。");
  }

  /* ========================================================
     1. 修正常见中文全角标点
  ======================================================== */

  source = source
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/：/g, ":")
    .replace(/，/g, ",")
    .trim();

  /* ========================================================
     2. 直接解析
  ======================================================== */

  try {
    return JSON.parse(source);
  } catch (error) {
    // 继续处理
  }

  /* ========================================================
     3. 去掉 Markdown 代码块
  ======================================================== */

  source = cleanAIPlanText(source);

  try {
    return JSON.parse(source);
  } catch (error) {
    // 继续提取 JSON
  }

  /* ========================================================
     4. 寻找 JSON 对象开头
  ======================================================== */

  const firstBrace = source.indexOf("{");

  if (firstBrace === -1) {
    throw new Error("没有找到 JSON 对象。");
  }

  /* ========================================================
     5. 使用括号深度寻找完整 JSON

     同时处理：

     {
     }

     出现在字符串内部的情况。
  ======================================================== */

  let depth = 0;

  let inString = false;

  let escaped = false;

  let endIndex = -1;

  for (let i = firstBrace; i < source.length; i++) {
    const char = source[i];

    /*
      转义字符
    */

    if (char === "\\" && !escaped) {
      escaped = true;

      continue;
    }

    /*
      双引号

      只有不在转义状态时才切换字符串状态。
    */

    if (char === '"' && !escaped) {
      inString = !inString;
    }

    escaped = false;

    /*
      字符串内部的括号不参与计算
    */

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
    throw new Error("找到了 JSON 开头，但没有找到完整的 JSON 结尾。");
  }

  /* ========================================================
     6. 提取 JSON
  ======================================================== */

  const jsonText = source.slice(firstBrace, endIndex + 1);

  /* ========================================================
     7. 最后解析
  ======================================================== */

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.error("提取出的 JSON：", jsonText);

    throw new Error("找到了一段 JSON，但 JSON 格式仍然无法解析。");
  }
}

/* ============================================================
   验证 AI 训练计划
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

  if (plan.exercises.length > 5) {
    throw new Error("AI生成的动作超过5个，请重新生成。");
  }

  if (plan.exercises.length < 3) {
    throw new Error("AI生成的动作少于3个，请重新生成。");
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
   导入 ChatGPT 训练计划
============================================================ */

async function importAITrainingPlan() {
  const box = document.getElementById("aiPlanInput");

  if (!box || !box.value.trim()) {
    alert("请先把 ChatGPT 生成的训练计划粘贴进来。");

    return;
  }

  /* ========================================================
     1. 解析 ChatGPT 返回内容
  ======================================================== */

  let plan;

  try {
    plan = extractAIPlanJSON(box.value);
  } catch (error) {
    console.error("AI训练计划 JSON 解析失败：", error);

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
     2. 验证训练计划
  ======================================================== */

  try {
    validateAITrainingPlan(plan);
  } catch (error) {
    console.error("AI训练计划格式验证失败：", error);

    alert("训练计划格式不正确：\n\n" + error.message);

    return;
  }

  /* ========================================================
     3. 网站自己确定正确的下一次训练编号

     不相信 ChatGPT 返回的 workout_number。

     例如：

     workouts 最大编号 = 5

     那么：

     本次导入 = 第6次
  ======================================================== */

  let nextNumber;

  try {
    nextNumber = await getNextWorkoutNumber();
  } catch (error) {
    alert("无法确定下一次训练编号。\n\n" + (error.message || String(error)));

    return;
  }

  /* ========================================================
     4. 检查 AI 返回的编号

     如果不同：

     只警告

     最终仍然使用数据库计算出的编号。
  ======================================================== */

  const aiNumber = Number(plan.workout_number);

  if (Number.isFinite(aiNumber) && aiNumber !== nextNumber) {
    console.warn(
      `ChatGPT 返回的训练编号为 ${aiNumber}，` +
        `但数据库判断下一次训练应为 ${nextNumber}。` +
        `已自动使用 ${nextNumber}。`,
    );
  }

  /* ========================================================
     5. 整理最终训练计划
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
     6. 写入 Supabase
  ======================================================== */

  try {
    /* ======================================================
       查询这个训练编号是否已经存在
    ====================================================== */

    const existing = await supabaseRequest(
      "training_plans" +
        "?select=*" +
        "&workout_number=eq." +
        finalPlan.workout_number +
        "&limit=1",
    );

    let planId;

    /* ======================================================
       情况 A：

       已经存在训练计划

       → 更新训练计划
       → 删除旧动作
       → 重新写入动作
    ====================================================== */

    if (existing && existing.length) {
      planId = existing[0].id;

      await supabaseRequest("training_plans?id=eq." + planId, {
        method: "PATCH",

        body: {
          workout_number: finalPlan.workout_number,

          plan_date: todayString(),

          title: finalPlan.title,

          focus: finalPlan.focus,

          duration_minutes: finalPlan.duration_minutes,

          notes: finalPlan.notes,
        },
      });

      /* ====================================================
         删除旧动作
      ==================================================== */

      await supabaseRequest(
        "training_plan_exercises" + "?plan_id=eq." + planId,
        {
          method: "DELETE",

          prefer: "return=minimal",
        },
      );
    } else {
      /* ======================================================
       情况 B：

       不存在

       → 创建新的训练计划
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

      planId = created[0].id;
    }

    /* ========================================================
       7. 写入 training_plan_exercises
    ======================================================== */

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

         null / 空字符串
         → null

         数字
         → Number
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

         允许：

         10
         10/侧
         30秒
         60秒
      ==================================================== */

      const reps =
        exercise.reps === null || exercise.reps === undefined
          ? ""
          : String(exercise.reps).trim();

      /* ====================================================
         写入动作
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
       8. 检查最终有没有真正写入动作
    ======================================================== */

    if (insertedExerciseCount === 0) {
      throw new Error("训练计划创建成功，但没有成功写入任何训练动作。");
    }

    /* ========================================================
       9. 导入成功
    ======================================================== */

    alert(
      `第${finalPlan.workout_number}次训练计划已经成功导入！💪\n\n` +
        `共 ${insertedExerciseCount} 个动作。`,
    );

    /* ========================================================
       清空 AI 输出输入框
    ======================================================== */

    box.value = "";

    /* ========================================================
       10. 刷新当前训练计划

       如果当前应该训练第6次：

       导入第6次
       → 首页显示第6次

       如果第6次已经完成：

       getCurrentWorkoutNumber()
       → 第7次
    ======================================================== */

    if (typeof loadCurrentPlan === "function") {
      await loadCurrentPlan();
    }

    /* ========================================================
       11. 刷新其他页面数据

       函数不存在也不会报错。
    ======================================================== */

    if (typeof loadPlans === "function") {
      await loadPlans();
    }

    if (typeof loadTrainingPlans === "function") {
      await loadTrainingPlans();
    }

    /* ========================================================
       12. 更新状态
    ======================================================== */

    if (typeof setStatus === "function") {
      setStatus("☁️ AI训练计划已同步", "ok");
    }

    /* ========================================================
       13. 控制台记录
    ======================================================== */

    console.log("AI训练计划导入成功：", {
      workout_number: finalPlan.workout_number,

      plan_id: planId,

      exercise_count: insertedExerciseCount,
    });
  } catch (error) {
    console.error("AI训练计划导入失败：", error);

    alert("训练计划导入失败：\n\n" + (error.message || String(error)));
  }
}
