/*
 * js/v4-core.js
 * 第四版纯逻辑模块（无 DOM、无网络、无副作用）
 *
 * 页面与 Node 逻辑测试共用：
 * - 动作/设备解析
 * - 完成训练提交项组装（默认继承 / 用户修改）
 * - 单循环训练量（模板口径）
 * - 自然周训练量（历史快照口径）
 * - 备份合并计数器 / 重复 ID 检测
 *
 * 该文件同时兼容浏览器全局与 Node require。
 */
(function (root) {
  "use strict";

  const MUSCLE_GROUP_ORDER = [
    "胸部",
    "背部",
    "肩部前束",
    "肩部中束",
    "肩部后束",
    "肱二头肌",
    "肱三头肌",
    "腹部",
    "核心稳定",
    "臀大肌",
    "臀中肌",
    "大腿前侧",
    "大腿后侧",
    "小腿",
    "全身及辅助动作",
  ];

  const MUSCLE_LABELS = {
    胸部: "胸部",
    背部: "背部",
    肩部前束: "肩部前束",
    肩部中束: "肩部中束",
    肩部后束: "肩部后束",
    肱二头肌: "肱二头肌",
    肱三头肌: "肱三头肌",
    腹部: "腹部（直接）",
    核心稳定: "核心稳定",
    臀大肌: "臀大肌",
    臀中肌: "臀中肌",
    大腿前侧: "大腿前侧",
    大腿后侧: "大腿后侧",
    小腿: "小腿",
    全身及辅助动作: "全身及辅助",
    未分类: "未分类",
  };

  const BAND_WEIGHTS = [10, 15, 20];

  const BAND_KG = {
    10: 4.54,
    15: 6.8,
    20: 9.07,
  };

  const VALID_PHASES = ["warmup", "main", "cooldown"];

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeName(value) {
    return String(value ?? "")
      .trim()
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function resolveExerciseId(name, exercises, aliases) {
    const normalized = normalizeName(name);
    if (!normalized) {
      return null;
    }

    const exact = asArray(exercises).find(
      (exercise) => normalizeName(exercise.name) === normalized,
    );
    if (exact && exact.id != null) {
      return exact.id;
    }

    const alias = asArray(aliases).find(
      (item) => normalizeName(item.alias) === normalized,
    );
    return alias && alias.exercise_id != null ? alias.exercise_id : null;
  }

  function parseBandWeight(equipment) {
    const text = String(equipment ?? "");
    if (!/弹力/.test(text)) {
      return null;
    }
    const match = text.match(/(\d+(?:\.\d+)?)\s*磅/);
    return match ? Number(match[1]) : null;
  }

  function isBandEquipment(equipment) {
    return /弹力/.test(String(equipment ?? ""));
  }

  function validatePlanItems(items) {
    const errors = [];
    const list = asArray(items);

    if (!list.length) {
      errors.push("PLAN_EMPTY");
      return { ok: false, errors };
    }

    const seenOrders = new Set();

    list.forEach((item, index) => {
      const prefix = "第" + (index + 1) + "个动作";

      if (!item || typeof item !== "object") {
        errors.push(prefix + "格式不正确");
        return;
      }

      const name = String(item.exercise_name ?? "").trim();
      if (!name) {
        errors.push(prefix + "缺少动作名称");
      }

      const order = toNumber(item.exercise_order);
      if (order === null || order <= 0) {
        errors.push(prefix + "顺序必须为正整数");
      } else if (seenOrders.has(order)) {
        errors.push(prefix + "顺序重复：" + order);
      } else {
        seenOrders.add(order);
      }

      if (!String(item.reps ?? "").trim()) {
        errors.push(prefix + "缺少次数");
      }

      const sets = toNumber(item.sets);
      if (sets !== null && sets <= 0) {
        errors.push(prefix + "组数必须大于 0");
      }

      const weight = toNumber(item.weight_kg);
      if (weight !== null && weight < 0) {
        errors.push(prefix + "重量不能为负");
      }

      const phase = String(item.phase ?? "main").trim() || "main";
      if (!VALID_PHASES.includes(phase)) {
        errors.push(prefix + "阶段不合法：" + phase);
      }

      const equipment = String(item.equipment ?? "");
      let resistance = toNumber(item.resistance_lb);

      if (resistance === null && isBandEquipment(equipment)) {
        resistance = parseBandWeight(equipment);
        if (resistance === null) {
          resistance = 15;
        }
      }

      if (resistance !== null && !BAND_WEIGHTS.includes(resistance)) {
        errors.push(prefix + "弹力带阻力只能为 10 / 15 / 20 磅");
      }
    });

    return { ok: errors.length === 0, errors };
  }

  function getPlanDefaultActuals(planExercise) {
    return {
      weight_kg: toNumber(planExercise?.weight_kg),
      reps: planExercise?.reps ?? null,
      sets: toNumber(planExercise?.sets),
      duration_seconds: toNumber(planExercise?.duration_seconds),
      resistance_lb: toNumber(planExercise?.resistance_lb),
      resistance_kg: toNumber(planExercise?.resistance_kg),
    };
  }

  /*
   * 完成训练提交项：
   * - 默认全部完成，难度可空
   * - 未编辑动作 modified=false，由 RPC 写 plan_default
   * - 编辑过的动作 modified=true，由 RPC 写 user_confirmed
   */
  function buildWorkoutItems(
    planExercises,
    difficultyList,
    actualList,
    modifiedList,
  ) {
    return asArray(planExercises).map((planExercise, index) => {
      const difficulty = asArray(difficultyList)[index] || null;
      const completed = difficulty ? difficulty !== "incomplete" : true;
      const modified = completed && Boolean(asArray(modifiedList)[index]);
      const actual = modified ? asArray(actualList)[index] || {} : {};

      return {
        plan_exercise_id: planExercise.id,
        completed,
        difficulty: completed ? difficulty : "incomplete",
        modified,
        actual_weight_kg: modified ? toNumber(actual.weight_kg) : null,
        actual_reps: modified ? actual.reps ?? null : null,
        actual_sets: modified ? toNumber(actual.sets) : null,
        actual_duration_seconds: modified
          ? toNumber(actual.duration_seconds)
          : null,
        actual_resistance_lb: modified
          ? toNumber(actual.resistance_lb)
          : null,
        actual_resistance_kg: modified
          ? toNumber(actual.resistance_kg)
          : null,
        note: null,
      };
    });
  }

  function emptyMuscleBuckets() {
    const buckets = {};
    MUSCLE_GROUP_ORDER.forEach((muscle) => {
      buckets[muscle] = { direct: 0, indirect: 0 };
    });
    return buckets;
  }

  function addSets(buckets, muscle, role, sets) {
    const key = MUSCLE_LABELS[muscle] ? muscle : "未分类";
    if (!buckets[key]) {
      buckets[key] = { direct: 0, indirect: 0 };
    }
    if (role === "primary") {
      buckets[key].direct += sets;
    } else if (role === "secondary") {
      buckets[key].indirect += sets;
    }
  }

  function buildMuscleIndex(muscleGroups) {
    const index = new Map();
    asArray(muscleGroups).forEach((mapping) => {
      if (mapping.exercise_id == null) {
        return;
      }
      const key = String(mapping.exercise_id);
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key).push(mapping);
    });
    return index;
  }

  function summarizeCore(buckets) {
    const abdominalDirect = buckets["腹部"]?.direct || 0;
    const coreDirect = buckets["核心稳定"]?.direct || 0;
    const coreIndirect = buckets["核心稳定"]?.indirect || 0;

    return {
      abdominalDirect,
      coreDirect,
      coreIndirect,
      specialCoreTotal: abdominalDirect + coreDirect,
      coreTotal: coreDirect + coreIndirect,
    };
  }

  /*
   * 单循环训练量：当前启用模板 A+B+C+D 各一次。
   * 只计 phase='main'；primary=直接，secondary=间接。
   */
  function computeCycleStats(input) {
    const templates = asArray(input?.templates).filter(
      (template) => template && template.is_active !== false,
    );
    const templateExercises = asArray(input?.templateExercises);
    const muscleIndex = buildMuscleIndex(input?.muscleGroups);
    const buckets = emptyMuscleBuckets();

    let totalSets = 0;
    let exerciseCount = 0;

    templates.forEach((template) => {
      asArray(templateExercises)
        .filter((item) => String(item.template_id) === String(template.id))
        .filter((item) => (item.phase || "main") === "main")
        .forEach((item) => {
          const sets = toNumber(item.sets) || 0;
          if (sets <= 0) {
            return;
          }

          exerciseCount += 1;
          totalSets += sets;

          const mappings = muscleIndex.get(String(item.exercise_id)) || [];
          if (!mappings.length) {
            addSets(buckets, "未分类", "primary", sets);
            return;
          }

          mappings.forEach((mapping) => {
            addSets(buckets, mapping.muscle_group, mapping.role, sets);
          });
        });
    });

    return {
      buckets,
      core: summarizeCore(buckets),
      totalSets,
      exerciseCount,
      cycleCodes: templates.map((template) => template.code).filter(Boolean),
      templateCount: templates.length,
    };
  }

  function getWeekRange(dateInput) {
    const date = dateInput ? new Date(dateInput) : new Date();
    const day = date.getDay(); // 0=周日
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(date);
    monday.setDate(date.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    return { start: monday, end: sunday };
  }

  function toDateKey(dateInput) {
    const date = dateInput ? new Date(dateInput) : new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function isDateInRange(dateText, start, end) {
    const key = String(dateText ?? "").slice(0, 10);
    if (!key) {
      return false;
    }
    return key >= toDateKey(start) && key <= toDateKey(end);
  }

  /*
   * 自然周训练量：只统计该周真实存在的 workouts。
   * 组数取 coalesce(actual_sets, planned_sets, 0)，仅 completed=true。
   * 肌群通过 exercise_id_snapshot 映射；未映射归入“未分类”。
   */
  function computeWeeklyStats(input) {
    const records = asArray(input?.records);
    const workouts = asArray(input?.workouts);
    const muscleIndex = buildMuscleIndex(input?.muscleGroups);
    const buckets = emptyMuscleBuckets();

    const workoutIds = new Set(
      workouts.map((workout) => String(workout.id)),
    );
    const workoutById = new Map(
      workouts.map((workout) => [String(workout.id), workout]),
    );

    let totalSets = 0;
    let recordCount = 0;
    let unmappedCount = 0;

    records.forEach((record) => {
      if (!record || !record.completed) {
        return;
      }

      if (workoutIds.size && !workoutIds.has(String(record.workout_id))) {
        return;
      }

      if ((record.phase_snapshot || "main") !== "main") {
        return;
      }

      const sets =
        toNumber(record.actual_sets) ??
        toNumber(record.planned_sets) ??
        0;

      if (sets <= 0) {
        return;
      }

      recordCount += 1;
      totalSets += sets;

      const mappings =
        muscleIndex.get(String(record.exercise_id_snapshot)) || [];

      if (!mappings.length) {
        unmappedCount += 1;
        addSets(buckets, "未分类", "primary", sets);
        return;
      }

      mappings.forEach((mapping) => {
        addSets(buckets, mapping.muscle_group, mapping.role, sets);
      });
    });

    const cycleCodes = workouts
      .map((workout) => workout.cycle_code_snapshot || workout.cycle_code)
      .filter(Boolean);

    return {
      buckets,
      core: summarizeCore(buckets),
      totalSets,
      recordCount,
      unmappedCount,
      workoutCount: workouts.length,
      cycleCodes,
      workoutById,
    };
  }

  function mergeCounterValues(current, backup, maxWorkoutNumber) {
    return Math.max(
      Number(current) || 0,
      Number(backup) || 0,
      Number(maxWorkoutNumber) || 0,
    );
  }

  function findDuplicateIds(localRows, backupRows) {
    const localIds = new Set(
      asArray(localRows)
        .map((row) => row?.id)
        .filter((id) => id != null)
        .map(String),
    );

    return asArray(backupRows)
      .map((row) => row?.id)
      .filter((id) => id != null && localIds.has(String(id)));
  }

  function classifyActualSource(record) {
    if (!record || !record.completed) {
      return "未完成";
    }
    if (record.actual_source === "user_confirmed") {
      return "用户确认";
    }
    if (record.actual_source === "plan_default") {
      return "继承计划";
    }
    return "历史记录（未记录来源）";
  }

  const api = {
    MUSCLE_GROUP_ORDER,
    MUSCLE_LABELS,
    BAND_WEIGHTS,
    BAND_KG,
    VALID_PHASES,
    normalizeName,
    resolveExerciseId,
    parseBandWeight,
    isBandEquipment,
    validatePlanItems,
    getPlanDefaultActuals,
    buildWorkoutItems,
    computeCycleStats,
    computeWeeklyStats,
    getWeekRange,
    toDateKey,
    isDateInRange,
    mergeCounterValues,
    findDuplicateIds,
    classifyActualSource,
  };

  root.V4Core = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
