/* ================================
   ai-plan.js
   ChatGPT AI训练计划中转模块
================================ */

/* ================================
   获取下一次训练编号
================================ */

function getNextWorkoutNumber() {
  if (typeof records === "undefined" || !Array.isArray(records)) {
    return 1;
  }

  const numbers = records
    .map((record) => Number(record.workout_number))
    .filter((number) => Number.isFinite(number));

  if (!numbers.length) {
    return 1;
  }

  return Math.max(...numbers) + 1;
}

/* ================================
   生成给 ChatGPT 的训练分析
================================ */

function generateAITrainingPrompt() {
  const nextNumber = getNextWorkoutNumber();

  const history = typeof records !== "undefined" ? records : [];

  const exercises =
    typeof exerciseRecords !== "undefined" ? exerciseRecords : [];

  const bodyData =
    typeof bodyMetricsRecords !== "undefined" ? bodyMetricsRecords : [];

  const recentWorkouts = history.slice(0, 10);

  const recentExercises = exercises.slice(0, 40);

  const recentBodyData = bodyData.slice(0, 10);

  const prompt = `

你现在是我的私人哑铃增肌/塑形教练。

请根据我过去的训练历史、动作完成情况、重量、次数、左右手差异、训练难度、身体感受以及身体数据，为我制定下一次训练计划。

【我的基本情况】

身高：162 cm
当前体重：52 kg

训练目标优先级：

1. 腰腹收紧、核心稳定
2. 臀部塑形
3. 手臂塑形
4. 背部训练

训练条件：

- 每周力量训练 3–4 次
- 每次约 20–25 分钟
- 两个 5 kg 哑铃
- 瑜伽垫
- 椅子
- 桌子

训练限制：

- 不安排深蹲
- 不安排半蹲
- 不安排罗马尼亚硬拉
- 目前不安排俯身哑铃划船
- 腰部容易疲劳，需要保护腰部
- 左手力量比右手弱
- 不要为了追求进步而强行增加训练量

我的下一次训练编号是：

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
你的任务
========================

请不要按照死板的固定规则安排训练。

请真正分析我的历史训练情况，包括：

1. 最近哪些动作已经连续训练
2. 哪些肌群最近训练量较高
3. 哪些肌群需要恢复
4. 哪些动作出现进步
5. 哪些动作停滞
6. 左右手是否存在差异
7. 最近训练完成度
8. 最近训练难度和身体感受
9. 是否应该增加、减少或者更换某些动作
10. 是否应该安排恢复性训练
11. 如何继续实现腰腹、臀部、手臂塑形目标

然后自主决定下一次训练。

不要为了“变化”而变化。

如果某个动作继续使用是合理的，可以继续使用。

如果某个动作需要调整重量、次数、组数，也请明确说明。

如果需要更换动作，请说明原因。

训练时间控制在 20–25 分钟左右。


========================
输出格式
========================

请严格只输出下面这种 JSON：

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
      "equipment": "哑铃/自重",
      "weight_kg": 5,
      "reps": "15",
      "sets": 3,
      "notes": "动作注意事项"
    }
  ]
}

注意：

- exercises 数量控制在 3–5 个
- 不要输出 JSON 以外的文字
- weight_kg 如果是自重动作，请填写 null
- reps 可以是 "10/侧"、"60秒" 等
- 必须根据我的实际历史训练情况决定，而不是随机生成
`;

  const box = document.getElementById("aiPrompt");

  if (box) {
    box.value = prompt.trim();
  }
}

/* ================================
   复制提示词
================================ */

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

    box.select();

    document.execCommand("copy");

    alert("已经复制好了。现在把它发给 ChatGPT。");
  }
}

/* ================================
   清理 ChatGPT 返回内容
================================ */

function cleanAIPlanText(text) {
  let result = String(text || "").trim();

  /*
    去掉 Markdown JSON 代码块
  */

  if (result.startsWith("```")) {
    result = result.replace(/^```(?:json)?/i, "");

    result = result.replace(/```$/, "");
  }

  return result.trim();
}

/* ================================
   导入 ChatGPT 训练计划
================================ */

/* ================================
   导入 ChatGPT 训练计划
================================ */

async function importAITrainingPlan() {
  const box = document.getElementById("aiPlanInput");

  if (!box || !box.value.trim()) {
    alert("请先把 ChatGPT 生成的训练计划粘贴进来。");
    return;
  }

  /*
    ========================================
    1. 从 ChatGPT 返回内容中提取 JSON
    支持：

    ① 纯 JSON
    ② ```json ... ```
    ③ ``` ... ```
    ④ JSON 前后有普通说明文字
    ========================================
  */

  /*
  ========================================
  从 ChatGPT 返回内容中提取 JSON
  ========================================
*/

  function extractJSON(text) {
    let source = String(text || "").trim();

    if (!source) {
      throw new Error("没有检测到任何内容。");
    }

    /*
    ========================================
    1. 修正常见的中文/全角标点

    JSON 必须使用英文半角双引号：
    "key": "value"

    ChatGPT 有时会输出：
    “key”: “value”

    这里自动修正。
    ========================================
  */

    source = source
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/：/g, ":")
      .replace(/，/g, ",")
      .trim();

    /*
    ========================================
    2. 直接尝试解析
    ========================================
  */

    try {
      return JSON.parse(source);
    } catch (e) {
      // 继续尝试
    }

    /*
    ========================================
    3. 去掉 Markdown JSON 代码块
    ========================================
  */

    source = source
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    /*
    ========================================
    4. 再次尝试解析
    ========================================
  */

    try {
      return JSON.parse(source);
    } catch (e) {
      // 继续提取 JSON
    }

    /*
    ========================================
    5. 从普通文字中寻找 JSON 对象
    ========================================
  */

    const firstBrace = source.indexOf("{");

    if (firstBrace === -1) {
      throw new Error("没有找到 JSON 对象。");
    }

    /*
    使用括号深度寻找完整 JSON。

    同时考虑字符串内部的：
    {
    }

    这些不能参与 JSON 括号计算。
  */

    let depth = 0;

    let inString = false;

    let escaped = false;

    let endIndex = -1;

    for (let i = firstBrace; i < source.length; i++) {
      const char = source[i];

      /*
      处理转义字符
    */

      if (char === "\\" && !escaped) {
        escaped = true;
        continue;
      }

      /*
      处理字符串中的双引号
    */

      if (char === '"' && !escaped) {
        inString = !inString;
      }

      escaped = false;

      /*
      JSON 字符串内部的括号不计算
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

    /*
    ========================================
    6. 提取真正的 JSON
    ========================================
  */

    const jsonText = source.slice(firstBrace, endIndex + 1);

    /*
    ========================================
    7. 最后一次解析
    ========================================
  */

    try {
      return JSON.parse(jsonText);
    } catch (error) {
      console.error("提取出的 JSON：", jsonText);

      throw new Error("找到了一段 JSON，但 JSON 格式仍然无法解析。");
    }
  }

  let plan;

  /*
    ========================================
    2. 解析 ChatGPT 返回内容
    ========================================
  */

  try {
    plan = extractJSON(box.value);
  } catch (error) {
    console.error("AI训练计划 JSON 解析失败：", error);

    alert(
      "无法识别 ChatGPT 返回的训练计划。\n\n" +
        "请把 ChatGPT 的完整回答直接复制过来，不需要自己修改。\n\n" +
        "支持：\n" +
        "• 纯 JSON\n" +
        "• ```json 代码块\n" +
        "• JSON 前后带说明文字",
    );

    return;
  }

  /*
    ========================================
    3. 基础格式检查
    ========================================
  */

  if (!plan || typeof plan !== "object") {
    alert("训练计划格式不正确。");
    return;
  }

  if (!Array.isArray(plan.exercises) || !plan.exercises.length) {
    alert("训练计划中没有找到 exercises 动作列表。");
    return;
  }

  /*
    ========================================
    4. 网站自己决定正确的下一次训练编号

    不再相信 ChatGPT 返回的 workout_number。

    例如：
    records 里最大编号 = 8
    那么本次一定导入 = 9
    ========================================
  */

  const nextNumber = getNextWorkoutNumber();

  /*
    ChatGPT 如果返回了其他编号，只做提示，
    不影响最终导入。
  */

  const aiNumber = Number(plan.workout_number);

  if (Number.isFinite(aiNumber) && aiNumber !== nextNumber) {
    console.warn(
      `ChatGPT 返回的训练编号为 ${aiNumber}，` +
        `但网站当前下一次训练应为 ${nextNumber}。` +
        `已自动使用 ${nextNumber}。`,
    );
  }

  /*
    ========================================
    5. 统一整理训练计划数据
    ========================================
  */

  const finalPlan = {
    workout_number: nextNumber,

    title: plan.title || `第${nextNumber}次训练`,

    focus: plan.focus || "",

    duration_minutes: Number(plan.duration_minutes) || 23,

    notes: plan.notes || "",

    exercises: plan.exercises,
  };

  /*
    ========================================
    6. 写入 Supabase
    ========================================
  */

  try {
    /*
      查询这个训练编号是否已经存在。

      正常情况下不会存在。

      但如果重复导入，
      我们保留你原来的“更新已有计划”能力。
    */

    const existing = await supabaseRequest(
      "training_plans" +
        "?select=*" +
        "&workout_number=eq." +
        finalPlan.workout_number +
        "&limit=1",
    );

    let planId;

    /*
      ========================================
      已存在
      → 更新训练计划
      → 删除旧动作
      → 重新写入动作
      ========================================
    */

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

      /*
        删除旧动作
      */

      await supabaseRequest(
        "training_plan_exercises" + "?plan_id=eq." + planId,
        {
          method: "DELETE",

          prefer: "return=minimal",
        },
      );
    } else {
      /*
      ========================================
      不存在
      → 创建新的 training_plans
      ========================================
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

      planId = created[0].id;
    }

    /*
      ========================================
      7. 写入 training_plan_exercises
      ========================================
    */

    for (let i = 0; i < finalPlan.exercises.length; i++) {
      const exercise = finalPlan.exercises[i];

      if (!exercise || !exercise.exercise_name) {
        console.warn(
          `第 ${i + 1} 个动作缺少 exercise_name，已跳过。`,
          exercise,
        );

        continue;
      }

      const weight =
        exercise.weight_kg === null ||
        exercise.weight_kg === undefined ||
        exercise.weight_kg === ""
          ? null
          : Number(exercise.weight_kg);

      const sets = Number(exercise.sets) || 1;

      await supabaseRequest("training_plan_exercises", {
        method: "POST",

        body: {
          plan_id: planId,

          exercise_order: Number(exercise.exercise_order) || i + 1,

          exercise_name: String(exercise.exercise_name).trim(),

          equipment: exercise.equipment || "自重",

          weight_kg: Number.isFinite(weight) ? weight : null,

          reps: String(exercise.reps || ""),

          sets: sets,

          notes: exercise.notes || "",
        },
      });
    }

    /*
      ========================================
      8. 导入成功
      ========================================
    */

    alert(`第${finalPlan.workout_number}次训练计划已经成功导入！💪`);

    /*
      清空 ChatGPT 输出输入框
    */

    box.value = "";

    /*
      ========================================
      9. 刷新当前训练计划
      ========================================
    */

    if (typeof loadCurrentPlan === "function") {
      await loadCurrentPlan();
    }

    /*
      如果网站存在常用的数据刷新函数，
      尝试同步刷新。

      不强制调用不存在的函数，
      所以不会因为某个函数不存在而报错。
    */

    if (typeof loadPlans === "function") {
      await loadPlans();
    }

    if (typeof loadTrainingPlans === "function") {
      await loadTrainingPlans();
    }

    /*
      更新状态提示
    */

    if (typeof setStatus === "function") {
      setStatus("☁️ AI训练计划已同步", "ok");
    }

    console.log("AI训练计划导入成功：", {
      workout_number: finalPlan.workout_number,

      plan_id: planId,

      exercise_count: finalPlan.exercises.length,
    });
  } catch (error) {
    console.error("AI训练计划导入失败：", error);

    alert("训练计划导入失败：\n\n" + (error.message || String(error)));
  }
}
