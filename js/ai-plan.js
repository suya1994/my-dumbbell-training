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


   ============================================================
   AI读取训练历史的规则
   ============================================================

   AI不再读取：

   ❌ 最近N次完整训练计划

   而是分成两个部分：

   ① 最近一次训练及完成情况

   = 最近一次已保存训练
   = 当次完整训练计划
   + 当次实际完成情况

   ② 历史动作表现

   = 按动作名称统计历史表现
   = 查看这个动作最近几次训练中的：
       - 重量
       - 次数
       - 组数
       - 完成情况
       - difficulty
       - 实际次数
       - 实际组数
       - 实际备注

   目的：

   AI应该根据“动作本身的长期表现”决定是否进阶，
   而不是机械地根据“最近N次训练”判断。


   ============================================================
   同名动作重复记录规则
   ============================================================

   如果同一次训练中出现两个相同动作：

   例如：

   第7次：
   死虫
   死虫

   AI只使用最后一次记录。

   不重复统计。

   判断优先使用：

   created_at

   如果created_at不存在，
   使用数据库返回顺序，
   后出现的记录覆盖前面的记录。


   ============================================================
   动作难度
   ============================================================

   easy
   normal
   hard
   incomplete

   easy / normal / hard
   = completed = true

   incomplete
   = completed = false


   ============================================================
   时间字段
   ============================================================

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

    const expectedDuration = Number(settings.expected_duration_minutes);

    console.log("🤖 AI读取到的训练设置原始数据：", settings);

    console.log(
      "🤖 expected_duration_minutes =",
      settings.expected_duration_minutes,
    );

    return {
      weekly_strength_target: Number.isFinite(weeklyTarget)
        ? weeklyTarget
        : null,

      expected_duration_minutes: Number.isFinite(expectedDuration)
        ? expectedDuration
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
        "?select=workout_number,workout_date,duration_minutes,actual_duration_minutes,body_note,created_at" +
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
   ③ 获取AI需要的身体数据

   逻辑：

   1. 最新一次
      每个指标独立寻找最近一次有效记录

   2. 相比上周
      每个指标：
      最新有效数据
      ↓
      上一个自然周的最近一次有效数据

   3. 相比上月
      每个指标：
      最新有效数据
      ↓
      上一个自然月的最近一次有效数据

   不要求体重、腰围、臀围在同一天记录。
============================================================ */

async function getBodyDataForAI() {
  try {
    console.log("📏 正在读取AI身体数据……");

    const data = await supabaseRequest(
      "body_metrics" + "?select=*" + "&order=record_date.asc",
    );

    const records = getSafeArray(data);

    if (!records.length) {
      return {
        latest: null,
        week_change: null,
        month_change: null,
      };
    }

    /* ========================================================
       工具函数
    ======================================================== */

    function getNumber(record, field) {
      if (
        !record ||
        record[field] === null ||
        record[field] === undefined ||
        record[field] === ""
      ) {
        return null;
      }

      const value = Number(record[field]);

      return Number.isFinite(value) ? value : null;
    }

    function round(value, decimals = 2) {
      if (value === null || value === undefined) {
        return null;
      }

      const factor = Math.pow(10, decimals);

      return Math.round(value * factor) / factor;
    }

    function formatChange(value) {
      if (value === null || value === undefined) {
        return null;
      }

      const rounded = round(value, 2);

      if (rounded > 0) {
        return `+${rounded}`;
      }

      return String(rounded);
    }

    function getDate(record) {
      if (!record?.record_date) {
        return null;
      }

      const dateString = String(record.record_date).slice(0, 10);

      const [year, month, day] = dateString.split("-").map(Number);

      if (!year || !month || !day) {
        return null;
      }

      return new Date(year, month - 1, day);
    }

    function dateKey(date) {
      if (!date) {
        return null;
      }

      const year = date.getFullYear();

      const month = String(date.getMonth() + 1).padStart(2, "0");

      const day = String(date.getDate()).padStart(2, "0");

      return `${year}-${month}-${day}`;
    }

    /* ========================================================
       整理有效数据
    ======================================================== */

    const validRecords = records
      .map((record) => ({
        ...record,
        _date: getDate(record),
      }))
      .filter((record) => record._date)
      .sort((a, b) => a._date - b._date);

    if (!validRecords.length) {
      return {
        latest: null,
        week_change: null,
        month_change: null,
      };
    }

    /* ========================================================
       每个指标分别寻找最新有效数据
    ======================================================== */

    function getLatestMetric(field) {
      for (let i = validRecords.length - 1; i >= 0; i--) {
        const record = validRecords[i];

        const value = getNumber(record, field);

        if (value !== null) {
          return {
            value,

            date: record._date,

            record_date: dateKey(record._date),
          };
        }
      }

      return null;
    }

    const latestWeight = getLatestMetric("weight_kg");

    const latestWaist = getLatestMetric("waist_cm");

    const latestHip = getLatestMetric("hip_cm");

    const latestHeight = getLatestMetric("height_cm");

    /* ========================================================
       最新一次身体数据
    ======================================================== */

    const latest = {
      height_cm: latestHeight?.value ?? null,

      weight_kg: latestWeight?.value ?? null,

      waist_cm: latestWaist?.value ?? null,

      hip_cm: latestHip?.value ?? null,

      weight_date: latestWeight?.record_date ?? null,

      waist_date: latestWaist?.record_date ?? null,

      hip_date: latestHip?.record_date ?? null,

      height_date: latestHeight?.record_date ?? null,
    };

    /* ========================================================
       参考日期

       使用所有身体数据中最新的日期。
    ======================================================== */

    const referenceDate = validRecords[validRecords.length - 1]._date;

    function getMetricAverageInRange(field, startDate, endDate) {
      const values = [];

      validRecords.forEach((record) => {
        if (record._date < startDate) {
          return;
        }

        if (record._date > endDate) {
          return;
        }

        const value = getNumber(record, field);

        if (value !== null) {
          values.push(value);
        }
      });

      if (!values.length) {
        return null;
      }

      const sum = values.reduce((total, value) => total + value, 0);

      const average = sum / values.length;

      return {
        value: round(average, 2),

        count: values.length,

        start_date: dateKey(startDate),

        end_date: dateKey(endDate),
      };
    }

    /* ========================================================
       获取自然周
       周一～周日
    ======================================================== */

    function getWeekStart(date) {
      const result = new Date(date);

      const day = result.getDay();

      const diff = day === 0 ? 6 : day - 1;

      result.setDate(result.getDate() - diff);

      result.setHours(0, 0, 0, 0);

      return result;
    }

    function getPreviousWeekRange(date) {
      const currentWeekStart = getWeekStart(date);

      const previousWeekStart = new Date(currentWeekStart);

      previousWeekStart.setDate(previousWeekStart.getDate() - 7);

      const previousWeekEnd = new Date(currentWeekStart);

      previousWeekEnd.setDate(previousWeekEnd.getDate() - 1);

      return {
        start: previousWeekStart,

        end: previousWeekEnd,
      };
    }

    /* ========================================================
       获取上一个自然月
    ======================================================== */

    function getPreviousMonthRange(date) {
      const year = date.getFullYear();

      const month = date.getMonth();

      const previousMonthEnd = new Date(year, month, 0);

      previousMonthEnd.setHours(0, 0, 0, 0);

      const previousMonthStart = new Date(
        previousMonthEnd.getFullYear(),
        previousMonthEnd.getMonth(),
        1,
      );

      previousMonthStart.setHours(0, 0, 0, 0);

      return {
        start: previousMonthStart,

        end: previousMonthEnd,
      };
    }

    const previousWeek = getPreviousWeekRange(referenceDate);

    const previousMonth = getPreviousMonthRange(referenceDate);

    console.log("📅 身体数据比较范围：", {
      referenceDate: dateKey(referenceDate),

      previousWeek: {
        start: dateKey(previousWeek.start),

        end: dateKey(previousWeek.end),
      },

      previousMonth: {
        start: dateKey(previousMonth.start),

        end: dateKey(previousMonth.end),
      },
    });

    /* ========================================================
       计算变化
    ======================================================== */

    function calculateChange(field, latestMetric, range) {
      if (!latestMetric || !range) {
        return null;
      }

      const previous = getMetricAverageInRange(field, range.start, range.end);

      if (!previous) {
        return null;
      }

      return {
        change: formatChange(latestMetric.value - previous.value),

        latest_value: latestMetric.value,

        previous_value: previous.value,

        previous_average: previous.value,

        previous_count: previous.count,

        latest_date: latestMetric.record_date,

        previous_start_date: previous.start_date,

        previous_end_date: previous.end_date,
      };
    }

    const weekChange = {
      weight: calculateChange("weight_kg", latestWeight, previousWeek),

      waist: calculateChange("waist_cm", latestWaist, previousWeek),

      hip: calculateChange("hip_cm", latestHip, previousWeek),
    };

    const monthChange = {
      weight: calculateChange("weight_kg", latestWeight, previousMonth),

      waist: calculateChange("waist_cm", latestWaist, previousMonth),

      hip: calculateChange("hip_cm", latestHip, previousMonth),
    };

    const result = {
      latest,

      week_change: weekChange,

      month_change: monthChange,
    };

    console.log("📏 AI身体数据整理完成：", result);

    return result;
  } catch (error) {
    console.error("读取身体数据失败：", error);

    return {
      latest: null,

      week_change: null,

      month_change: null,
    };
  }
}

/* ============================================================
   ④ 工具：根据workout_number选择最新workout
============================================================ */

function buildLatestWorkoutMap(workouts) {
  const map = new Map();

  getSafeArray(workouts).forEach((workout) => {
    if (!workout) {
      return;
    }

    const number = Number(workout.workout_number);

    if (!Number.isFinite(number)) {
      return;
    }

    const existing = map.get(number);

    if (!existing) {
      map.set(number, workout);

      return;
    }

    /*
       如果同一个workout_number存在多个版本，
       优先created_at较新的记录。
    */

    const existingCreated = new Date(existing.created_at || 0).getTime();

    const currentCreated = new Date(workout.created_at || 0).getTime();

    if (currentCreated >= existingCreated) {
      map.set(number, workout);
    }
  });

  return map;
}

/* ============================================================
   ⑤ 工具：建立实际动作记录索引

   重要：

   一个训练中如果出现相同动作：

   死虫
   死虫

   这里只保留最后一条。

   优先使用created_at判断“最后一次”。

   如果没有created_at，
   后出现的记录覆盖前面的记录。
============================================================ */

function buildLatestActualExerciseMap(actualExerciseRecords) {
  const map = new Map();

  getSafeArray(actualExerciseRecords).forEach((exercise, index) => {
    if (
      !exercise ||
      exercise.plan_exercise_id === undefined ||
      exercise.plan_exercise_id === null
    ) {
      return;
    }

    const key = String(exercise.plan_exercise_id);

    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        record: exercise,

        index,
      });

      return;
    }

    const existingCreated = new Date(existing.record.created_at || 0).getTime();

    const currentCreated = new Date(exercise.created_at || 0).getTime();

    /*
         有明确created_at：
         新时间覆盖旧时间。

         没有created_at：
         后返回的记录覆盖前面的记录。
      */

    if (
      currentCreated > existingCreated ||
      (currentCreated === existingCreated && index > existing.index)
    ) {
      map.set(key, {
        record: exercise,

        index,
      });
    }
  });

  return new Map(
    Array.from(map.entries()).map(([key, value]) => [key, value.record]),
  );
}

/* ============================================================
   ⑥ 工具：标准化difficulty
============================================================ */

function normalizeDifficulty(value) {
  const difficulty = String(value || "")
    .trim()
    .toLowerCase();

  if (["easy", "normal", "hard", "incomplete"].includes(difficulty)) {
    return difficulty;
  }

  return "";
}

/* ============================================================
   ⑦ 工具：创建实际动作记录对象
============================================================ */

function buildActualExerciseResult(actualExercise) {
  if (!actualExercise) {
    return {
      status: "未记录",

      difficulty: "",
    };
  }

  const completedValue = actualExercise.completed;

  let status = "未完成";

  if (completedValue === true) {
    status = "已完成";
  }

  let difficulty = normalizeDifficulty(actualExercise.difficulty);

  /*
     incomplete明确代表未完成。
  */

  if (difficulty === "incomplete") {
    status = "未完成";
  }

  return {
    status,

    difficulty,
  };
}

/* ============================================================
   ⑧ 工具：获取计划动作
============================================================ */

function sortPlanExercises(list) {
  return getSafeArray(list)
    .slice()
    .sort((a, b) => {
      return Number(a.exercise_order || 0) - Number(b.exercise_order || 0);
    });
}

/* ============================================================
   ⑨ 获取“最近一次训练及完成情况”

   注意：

   这里不是最近N次。

   只获取最近一次已保存训练。
============================================================ */

async function getLatestTrainingWithResultsForAI() {
  try {
    console.log("🏋️ 正在读取最近一次训练及完成情况……");

    /* ========================================================
       1. 获取最近一次workout
    ======================================================== */

    const workouts = await supabaseRequest(
      "workouts" + "?select=*" + "&order=workout_number.desc" + "&limit=1",
    );

    const workoutList = getSafeArray(workouts);

    if (!workoutList.length) {
      return null;
    }

    const workout = workoutList[0];

    const workoutNumber = Number(workout.workout_number);

    if (!Number.isFinite(workoutNumber)) {
      return null;
    }

    /* ========================================================
       2. 获取这个训练编号对应的计划

       正常情况下应该只有一个。

       如果有多个：
       使用created_at最新的。
    ======================================================== */

    const plans = await supabaseRequest(
      "training_plans" +
        "?select=*" +
        "&workout_number=eq." +
        workoutNumber +
        "&order=id.desc",
    );

    const planList = getSafeArray(plans);

    let plan = planList.length ? planList[0] : null;

    if (planList.length > 1) {
      const sortedPlans = planList.slice().sort((a, b) => {
        const aTime = new Date(a.created_at || 0).getTime();

        const bTime = new Date(b.created_at || 0).getTime();

        return bTime - aTime;
      });

      plan = sortedPlans[0];
    }

    /* ========================================================
       3. 获取这个计划的动作
    ======================================================== */

    let planExercises = [];

    if (plan?.id) {
      const data = await supabaseRequest(
        "training_plan_exercises" +
          "?select=*" +
          "&plan_id=eq." +
          plan.id +
          "&order=exercise_order.asc",
      );

      planExercises = sortPlanExercises(data);
    }

    /* ========================================================
       4. 获取实际动作记录

       只获取本次计划对应的动作。

       这样不会把其它训练的记录混进来。
    ======================================================== */

    let actualExerciseRecords = [];

    if (planExercises.length) {
      const ids = planExercises
        .map((item) => item.id)
        .filter((id) => id !== undefined && id !== null);

      if (ids.length) {
        const idList = ids.join(",");

        const data = await supabaseRequest(
          "workout_exercise_records" +
            "?select=*" +
            "&plan_exercise_id=in.(" +
            idList +
            ")",
        );

        actualExerciseRecords = getSafeArray(data);
      }
    }

    /*
       同一个plan_exercise_id如果有重复，
       只保留最后一条。
    */

    const actualExerciseMap = buildLatestActualExerciseMap(
      actualExerciseRecords,
    );

    /* ========================================================
       5. 组合动作

    ======================================================== */

    const exercises = planExercises
      .map((planExercise) => {
        const exerciseName = String(
          planExercise.exercise_name || "未知动作",
        ).trim();

        const actualExercise = actualExerciseMap.get(String(planExercise.id));

        const actual = buildActualExerciseResult(actualExercise);

        return {
          exercise_order: planExercise.exercise_order ?? null,

          exercise_name: exerciseName,

          equipment: planExercise.equipment || "自重",

          weight_kg: planExercise.weight_kg ?? null,

          reps:
            planExercise.reps !== undefined && planExercise.reps !== null
              ? String(planExercise.reps)
              : "",

          sets: planExercise.sets ?? null,

          notes: String(planExercise.notes || "").trim(),

          status: actual.status,

          difficulty: actual.difficulty,
        };
      })
      .sort(
        (a, b) => Number(a.exercise_order || 0) - Number(b.exercise_order || 0),
      );

    /* ========================================================
       6. 汇总
    ======================================================== */

    const completed = [];

    const notCompleted = [];

    const easy = [];

    const normal = [];

    const difficult = [];

    exercises.forEach((exercise) => {
      if (exercise.status === "已完成") {
        completed.push(exercise.exercise_name);
      }

      if (exercise.status === "未完成") {
        notCompleted.push(exercise.exercise_name);
      }

      if (exercise.difficulty === "easy") {
        easy.push(exercise.exercise_name);
      }

      if (exercise.difficulty === "normal") {
        normal.push(exercise.exercise_name);
      }

      if (exercise.difficulty === "hard") {
        difficult.push(exercise.exercise_name);
      }

      if (exercise.difficulty === "incomplete") {
        if (!notCompleted.includes(exercise.exercise_name)) {
          notCompleted.push(exercise.exercise_name);
        }
      }
    });

    /* ========================================================
       7. 时间
    ======================================================== */

    const plannedDuration =
      workout.duration_minutes ?? plan?.duration_minutes ?? null;

    const actualDuration = workout.actual_duration_minutes ?? null;

    /* ========================================================
       8. 最终结果
    ======================================================== */

    const result = {
      workout_number: workoutNumber,

      workout_date: workout.workout_date || plan?.plan_date || null,

      title: plan?.title || `第${workoutNumber}次训练`,

      focus: plan?.focus || "",

      duration_minutes: plannedDuration,

      actual_duration_minutes: actualDuration,

      body_note: workout.body_note || "",

      plan_notes: plan?.notes || "",

      exercises,

      completed,

      not_completed: notCompleted,

      easy,

      normal,

      difficult,
    };

    console.log("✅ 最近一次训练读取完成：", result);

    return result;
  } catch (error) {
    console.error("读取最近一次训练失败：", error);

    throw new Error(
      "无法读取最近一次训练及完成情况。\n\n" + (error.message || String(error)),
    );
  }
}

/* ============================================================
   ⑩ 获取历史动作表现

   核心规则：

   不再：

   ❌ 最近3次训练
   ❌ 最近8次训练

   而是：

   所有历史训练
   ↓
   找到对应计划动作
   ↓
   按动作名称归类
   ↓
   每次训练保留这个动作最后一次结果
   ↓
   每个动作保留最近若干次历史表现

   这里保留最近6次该动作表现。

   不是“最近6次训练”。

   而是：

   “这个动作最近6次出现时的表现”。
============================================================ */

async function getExercisePerformanceHistoryForAI(perExerciseLimit = 6) {
  try {
    const safeLimit =
      Number.isFinite(Number(perExerciseLimit)) && Number(perExerciseLimit) > 0
        ? Number(perExerciseLimit)
        : 6;

    console.log(`📊 正在读取历史动作表现（每个动作最近${safeLimit}次）……`);

    /* ========================================================
       1. 获取所有训练计划
    ======================================================== */
    const plans = await supabaseRequest(
      "training_plans" + "?select=*" + "&order=workout_number.desc",
    );

    let planList = getSafeArray(plans);

    if (!planList.length) {
      return [];
    }

    /* ========================================================
   获取已经实际保存的训练

   重要：

   training_plans 代表“生成过训练计划”。

   workouts 代表“实际存在过一次训练记录”。

   历史动作表现只能使用真正存在于 workouts
   的训练。

   因此：
   只有 training_plans，没有 workouts
   的训练，不进入历史。
======================================================== */

    const workouts = await supabaseRequest(
      "workouts" +
        "?select=workout_number,workout_date,created_at" +
        "&order=workout_number.desc",
    );

    const workoutList = getSafeArray(workouts);

    /* ========================================================
   建立已经实际保存训练的 workout_number 集合
======================================================== */

    const completedWorkoutNumbers = new Set();

    workoutList.forEach((workout) => {
      if (!workout) {
        return;
      }

      const workoutNumber = Number(workout.workout_number);

      if (!Number.isFinite(workoutNumber)) {
        return;
      }

      completedWorkoutNumbers.add(workoutNumber);
    });

    /* ========================================================
   只保留真正存在 workouts 的训练计划
======================================================== */

    planList = planList.filter((plan) => {
      const workoutNumber = Number(plan?.workout_number);

      return (
        Number.isFinite(workoutNumber) &&
        completedWorkoutNumbers.has(workoutNumber)
      );
    });

    if (!planList.length) {
      return [];
    }

    /* ========================================================
       2. 获取所有计划动作
    ======================================================== */

    const planExercises = await supabaseRequest(
      "training_plan_exercises?select=*",
    );

    const planExerciseList = getSafeArray(planExercises);

    /* ========================================================
       3. 获取所有实际动作记录
    ======================================================== */

    const actualRecords = await supabaseRequest(
      "workout_exercise_records?select=*",
    );

    const actualRecordList = getSafeArray(actualRecords);

    /* ========================================================
       4. 先按plan_exercise_id保留最后一条

       这是非常重要的一层去重。

       同一个计划动作如果数据库有两条实际记录：

       旧记录
       新记录

       只使用新记录。
    ======================================================== */

    const actualMap = buildLatestActualExerciseMap(actualRecordList);

    /* ========================================================
       5. 建立plan_id → plan exercises
    ======================================================== */

    const planExerciseMap = new Map();

    planExerciseList.forEach((planExercise) => {
      if (
        !planExercise ||
        planExercise.plan_id === undefined ||
        planExercise.plan_id === null
      ) {
        return;
      }

      const key = String(planExercise.plan_id);

      if (!planExerciseMap.has(key)) {
        planExerciseMap.set(key, []);
      }

      planExerciseMap.get(key).push(planExercise);
    });

    /* ========================================================
       6. 逐个训练计划建立动作表现

       先处理：

       同一个训练里同名动作重复。

       只保留最后一个。
    ======================================================== */

    const exerciseHistoryMap = new Map();

    planList.forEach((plan) => {
      if (!plan?.id) {
        return;
      }

      const workoutNumber = Number(plan.workout_number);

      if (!Number.isFinite(workoutNumber)) {
        return;
      }

      const exercises = sortPlanExercises(
        planExerciseMap.get(String(plan.id)) || [],
      );

      /*
         当前训练内部：

         exercise_name → 最后一次出现
      */

      const currentWorkoutMap = new Map();

      exercises.forEach((planExercise) => {
        const exerciseName = String(
          planExercise.exercise_name || "未知动作",
        ).trim();

        if (!exerciseName) {
          return;
        }

        const actual = buildActualExerciseResult(
          actualMap.get(String(planExercise.id)),
        );

        const historyItem = {
          workout_number: workoutNumber,

          workout_date: plan.plan_date || null,

          exercise_name: exerciseName,

          equipment: planExercise.equipment || "自重",

          weight_kg: planExercise.weight_kg ?? null,

          reps:
            planExercise.reps !== undefined && planExercise.reps !== null
              ? String(planExercise.reps)
              : "",

          sets: planExercise.sets ?? null,

          notes: String(planExercise.notes || "").trim(),

          status: actual.status,

          difficulty: actual.difficulty,
        };

        /*
             同一个训练中同名动作：

             后面的覆盖前面的。
          */

        currentWorkoutMap.set(exerciseName, historyItem);
      });

      /* ======================================================
         把本次训练最终动作表现加入历史
      ====================================================== */

      currentWorkoutMap.forEach((item, exerciseName) => {
        if (!exerciseHistoryMap.has(exerciseName)) {
          exerciseHistoryMap.set(exerciseName, []);
        }

        exerciseHistoryMap.get(exerciseName).push(item);
      });
    });

    /* ========================================================
       7. 每个动作按训练编号倒序

       并限制最近6次“这个动作”的表现。
    ======================================================== */

    const result = [];

    exerciseHistoryMap.forEach((history, exerciseName) => {
      history.sort(
        (a, b) => Number(b.workout_number) - Number(a.workout_number),
      );

      const limited = history.slice(0, safeLimit);

      result.push({
        exercise_name: exerciseName,

        appearances: limited.length,

        history: limited,
      });
    });

    /*
       按最近一次出现的workout_number排序。
    */

    result.sort((a, b) => {
      const aLatest = Number(a.history?.[0]?.workout_number || 0);

      const bLatest = Number(b.history?.[0]?.workout_number || 0);

      return bLatest - aLatest;
    });

    console.log("✅ 历史动作表现读取完成：", result);

    return result;
  } catch (error) {
    console.error("读取历史动作表现失败：", error);

    throw new Error(
      "无法读取历史动作表现。\n\n" + (error.message || String(error)),
    );
  }
}

/* ============================================================
   ⑪ 生成AI设置文本
============================================================ */

function formatAISettingsForPrompt(trainingSettings) {
  if (!trainingSettings || typeof trainingSettings !== "object") {
    return "当前没有提供AI训练设置。";
  }

  const weeklyTargetText =
    trainingSettings.weekly_strength_target !== null
      ? `${trainingSettings.weekly_strength_target} 次`
      : "未设置";

  const expectedDurationText =
    trainingSettings.expected_duration_minutes !== null
      ? `${trainingSettings.expected_duration_minutes} 分钟`
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

期望每次训练时间：
${expectedDurationText}

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
   ⑫ 生成身体数据Prompt
============================================================ */

function formatBodyDataForPrompt(bodyData) {
  if (!bodyData || typeof bodyData !== "object") {
    return "【身体数据】暂无记录。";
  }

  const latest = bodyData.latest || {};

  const week = bodyData.week_change || {};

  const month = bodyData.month_change || {};

  function formatLatest(value, unit = "") {
    if (value === null || value === undefined || value === "") {
      return "暂无";
    }

    return `${value}${unit}`;
  }

  function formatChange(data, unit = "") {
    if (!data || data.change === null || data.change === undefined) {
      return "暂无对比数据";
    }

    return `${data.change}${unit}`;
  }

  return `
【身体数据】

身高：162cm

最新一次：
体重：${formatLatest(latest.weight_kg, " kg")}
腰围：${formatLatest(latest.waist_cm, " cm")}
臀围：${formatLatest(latest.hip_cm, " cm")}

相比上周身体变化：
体重：${formatChange(week.weight, " kg")}
腰围：${formatChange(week.waist, " cm")}
臀围：${formatChange(week.hip, " cm")}

相比上月身体变化：
体重：${formatChange(month.weight, " kg")}
腰围：${formatChange(month.waist, " cm")}
臀围：${formatChange(month.hip, " cm")}

说明：
- 最新一次数据中，每个指标分别寻找最近一次有效记录。
- 体重、腰围、臀围不要求在同一天记录。
- “相比上周”是与上一个自然周（周一至周日）中平均数据比较。
- “相比上月”是与上一个自然月平均数据比较。
- 正数表示增加，负数表示减少。
`.trim();
}

/* ============================================================
   ⑬ 格式化最近一次训练
============================================================ */

function formatLatestTrainingForPrompt(latestTraining) {
  if (!latestTraining || typeof latestTraining !== "object") {
    return `
【最近一次力量训练及完成情况】

目前没有训练记录。
`.trim();
  }

  return `
【最近一次力量训练及完成情况】

这是数据库中最近一次已经保存的实际训练。

训练日期：
${latestTraining.workout_date || "暂无"}

训练标题：
${latestTraining.title || "暂无"}

训练重点：
${latestTraining.focus || "暂无"}

计划预计训练时间：
${latestTraining.duration_minutes ?? "暂无"} 分钟

实际训练时间：
${latestTraining.actual_duration_minutes ?? "暂无"} 分钟


训练后身体感受：
${latestTraining.body_note || "暂无"}



动作表现：

${JSON.stringify(latestTraining.exercises || [], null, 2)}

汇总：

已完成：
${latestTraining.completed?.length ? latestTraining.completed.join("、") : "无"}

未完成：
${
  latestTraining.not_completed?.length
    ? latestTraining.not_completed.join("、")
    : "无"
}

轻松：
${latestTraining.easy?.length ? latestTraining.easy.join("、") : "无"}

正常：
${latestTraining.normal?.length ? latestTraining.normal.join("、") : "无"}

吃力：
${latestTraining.difficult?.length ? latestTraining.difficult.join("、") : "无"}

特别规则：
- difficulty 是用户实际训练时选择的难度。
- easy = 轻松。
- normal = 正常。
- hard = 吃力。
- incomplete = 未完成。
- actual_duration_minutes 是用户实际训练花费时间。
`.trim();
}

/* ============================================================
   ⑭ 格式化历史动作表现
============================================================ */

function formatExercisePerformanceHistoryForPrompt(history) {
  const data = getSafeArray(history);

  if (!data.length) {
    return `
【历史动作表现】

目前没有足够的历史动作数据。
`.trim();
  }

  const lines = [];

  lines.push(
    "【历史动作表现】【每个动作最多显示最近6次的运动情况，难度为我完成运动后的感受】",
  );

  data.forEach((exercise) => {
    lines.push(`【${exercise.exercise_name}】`);

    lines.push(`历史出现次数：${exercise.appearances}`);

    const historyList = getSafeArray(exercise.history);

    historyList.forEach((item) => {
      const weight =
        item.weight_kg === null ||
        item.weight_kg === undefined ||
        item.weight_kg === ""
          ? "自重"
          : `${item.weight_kg}kg`;

      const difficulty = item.difficulty || "未记录";

      const reps =
        item.reps !== null &&
        item.reps !== undefined &&
        String(item.reps).trim()
          ? String(item.reps).trim()
          : "未记录";

      const sets =
        item.sets !== null && item.sets !== undefined && item.sets !== ""
          ? String(item.sets).trim()
          : "未记录";

      lines.push(
        `- 第${item.workout_number}次（${item.workout_date || "日期未知"}）：` +
          `${weight}，计划${reps} × ${sets}组，` +
          `结果${item.status}，难度${difficulty}`,
      );
    });

    lines.push("");
  });

  return lines.join("\n").trim();
}

/* ============================================================
   ⑮ AI训练Prompt
============================================================ */

async function generateAITrainingPrompt() {
  try {
    console.log("🤖 开始生成AI训练提示词……");
    /* ========================================================

       数据读取

       每次生成Prompt都使用完整的AI训练上下文：

       ① 当前训练状态

       ② 身体数据

       ③ 最近一次训练

       ④ 历史动作表现

       ⑤ 当前AI训练设置

    ======================================================== */

    const [
      trainingSettings,

      currentState,

      bodyData,

      latestTraining,

      exerciseHistory,
    ] = await Promise.all([
      getTrainingSettingsForAI(),

      getCurrentStateForAI(),

      getBodyDataForAI(),

      getLatestTrainingWithResultsForAI(),

      getExercisePerformanceHistoryForAI(6),
    ]);

    const nextNumber = currentState.next_workout_number;

    /* ========================================================
       Prompt头部
    ======================================================== */

    const promptHeader = `你是我的私人哑铃训练教练。`;

    /* ========================================================
   AI设置
======================================================== */

    const settingsSection = formatAISettingsForPrompt(trainingSettings);

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

    const bodyDataSection = formatBodyDataForPrompt(bodyData);

    /* ========================================================
       最近一次训练
    ======================================================== */

    const latestTrainingSection = formatLatestTrainingForPrompt(latestTraining);

    /* ========================================================
       历史动作表现
    ======================================================== */

    const exerciseHistorySection =
      formatExercisePerformanceHistoryForPrompt(exerciseHistory);

    /* ========================================================
   最近7天其它运动
======================================================== */

    const recent7DayActivity = getRecent7DayOtherExerciseForAI();

    const recent7DayActivityText = recent7DayActivity
      .map((day) => {
        return `${day.date}：其它运动：${day.otherExercise}`;
      })
      .join("\n");

    const recent7DayActivitySection = `
【最近7天其它活动情况】

以下数据用于帮助AI判断最近的整体活动量，
尤其用于判断力量训练安排是否需要考虑近期活动量和恢复情况。

${recent7DayActivityText}

说明：
- 应结合最近一次力量训练、历史动作表现、身体数据和训练目标综合判断。
`.trim();

    /* =========================================================
   最近 7 天其它运动
========================================================= */

    /* ========================================================
       动作输出格式
    ======================================================== */

    const outputRules = `
【下一次训练动作格式】

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
猫牛式
8-10次 × 2组
不要把：
“8-10次 × 2组”
只写在notes里。

必须：
reps = 次数或时间
sets = 组数
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

严格只输出JSON。不要输出Markdown。不要使用代码块。不要输出解释文字。不要在JSON前后添加任何说明。

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

      latestTrainingSection,

      exerciseHistorySection,
      recent7DayActivitySection,

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
      latestTraining: latestTraining ? latestTraining.workout_number : null,

      exerciseHistoryCount: getSafeArray(exerciseHistory).length,

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
   ⑯ 复制Prompt
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
   ⑰ 清理ChatGPT返回内容
============================================================ */

function cleanAIPlanText(text) {
  let result = String(text || "").trim();

  if (!result) {
    return "";
  }

  result = result.replace(/^```(?:json)?\s*/i, "");

  result = result.replace(/\s*```$/, "");

  return result.trim();
}

/* ============================================================
   ⑱ 从ChatGPT返回内容提取JSON
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
   ⑲ 验证AI训练计划
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
   ⑳ 获取某个训练编号的全部旧计划
============================================================ */

async function getAllPlansByWorkoutNumber(workoutNumber) {
  const number = Number(workoutNumber);

  if (!Number.isFinite(number)) {
    throw new Error("无效的 workout_number。");
  }

  const plans = await supabaseRequest(
    "training_plans" +
      "?select=id,workout_number,plan_date,title,created_at" +
      "&workout_number=eq." +
      number +
      "&order=id.asc",
  );

  return getSafeArray(plans);
}

/* ============================================================
   ㉑ 获取某个计划的动作数量
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
   ㉒ 删除某个计划的全部动作
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
   ㉓ 删除某个训练计划
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
   ㉔ 删除某个训练计划及其动作
============================================================ */

async function deleteTrainingPlanCompletely(planId) {
  if (!planId) {
    return;
  }

  await deleteAllExercisesForPlan(planId);

  await deleteTrainingPlanById(planId);
}

/* ============================================================
   ㉕ 清理某个workout_number的全部旧计划
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
   ㉖ 验证最终计划动作数量
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
   ㉗ 导入ChatGPT训练计划
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

  const durationMinutes = Number(plan.duration_minutes);

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error("AI训练计划缺少有效的 duration_minutes。");
  }

  const finalPlan = {
    workout_number: nextNumber,

    title: String(plan.title || `第${nextNumber}次训练`).trim(),

    focus: String(plan.focus || "").trim(),

    duration_minutes: durationMinutes,

    notes: String(plan.notes || "").trim(),

    exercises: plan.exercises,
  };

  /* ========================================================
     6. 写入Supabase

     创建新计划
     ↓
     写入全部动作
     ↓
     验证成功
     ↓
     删除旧计划

     防止新计划导入失败时，
     原计划也被删除。
  ======================================================== */

  let newPlanId = null;

  try {
    console.log(
      `🚀 准备导入第${finalPlan.workout_number}次训练，` +
        `共 ${finalPlan.exercises.length} 个动作。`,
    );

    /* ======================================================
       6.1 创建training_plans
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
         写入
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
      if (String(oldPlan.id) === String(newPlanId)) {
        continue;
      }

      await deleteTrainingPlanCompletely(oldPlan.id);
    }

    /* ======================================================
       6.6 最终确认
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
       清理失败的新计划
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

/* =========================================================
   获取最近 7 天其它运动
   提供给 AI 教练参考
========================================================= */

function getRecent7DayOtherExerciseForAI() {
  const result = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);

    date.setDate(today.getDate() - i);

    const dateString =
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0");

    /* ================================
       其它运动
    ================================ */

    const dayOtherActivities = Array.isArray(otherActivities)
      ? otherActivities.filter(
          (activity) => activity.activity_date === dateString,
        )
      : [];

    let otherExerciseText = "无";

    if (dayOtherActivities.length) {
      otherExerciseText = dayOtherActivities
        .map((activity) => {
          const type = activity.activity_type || "其它运动";

          const duration = Number(activity.duration_minutes) || 0;

          return `${type} ${duration} 分钟`;
        })
        .join("、");
    }

    result.push({
      date: dateString,
      otherExercise: otherExerciseText,
    });
  }

  return result;
}
