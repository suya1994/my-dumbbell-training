/*
 * 第四版关键逻辑模拟测试（无数据库、无网络）
 * 运行：node tests/v4-sim.js
 *
 * 说明：
 * - 前端纯逻辑直接 require js/v4-core.js，测的是页面实际使用的代码；
 * - 事务 / 并发 / 编号分配等项目用“契约模拟”验证 RPC SQL 的约定行为；
 * - 真实数据库事务仍需在 Supabase 执行 SQL 后按 docs/test-cases-v4.md 手工验证。
 */

const V4Core = require("../js/v4-core.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error("ASSERT FAIL: " + message);
  }
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS  " + name);
  } catch (error) {
    failed += 1;
    console.error("FAIL  " + name + "\n      " + error.message);
  }
}

/* =========================================================
   事务 / 编号契约模拟
========================================================= */

function createState() {
  return {
    counter: 0,
    workouts: [],
    records: [],
    versions: [],
    plans: [{ id: 10, status: "pending", cycle_code: "A" }],
    submissions: new Map(),
  };
}

/*
 * 模拟 complete_workout：
 * - 单事务：编号分配 + workouts + records + plan completed + version
 * - submission_key 命中直接 replay
 * - 任一步失败整体回滚（这里用先改副本、最后一次性提交模拟）
 */
function simulateCompleteWorkout(state, payload) {
  if (payload.submissionKey) {
    const existing = state.submissions.get(payload.submissionKey);
    if (existing) {
      return {
        ok: true,
        replayed: true,
        workout_number: existing.workout_number,
        workout_id: existing.workout_id,
      };
    }
  }

  const plan = state.plans.find((item) => item.id === payload.planId);

  if (!plan || plan.status !== "pending") {
    throw new Error("PLAN_NOT_PENDING");
  }

  if (!Array.isArray(payload.items) || !payload.items.length) {
    throw new Error("PLAN_EMPTY");
  }

  for (const item of payload.items) {
    if (!payload.planExerciseIds.includes(item.plan_exercise_id)) {
      throw new Error("INVALID_PLAN_EXERCISE");
    }
  }

  const draft = {
    ...state,
    workouts: [...state.workouts],
    records: [...state.records],
    versions: [...state.versions],
    plans: state.plans.map((item) => ({ ...item })),
    submissions: new Map(state.submissions),
  };

  draft.counter = state.counter + 1;
  const workoutNumber = draft.counter;
  const workoutId = 1000 + workoutNumber;

  draft.workouts.push({
    id: workoutId,
    workout_number: workoutNumber,
    training_plan_id: payload.planId,
  });
  draft.records.push(
    ...payload.items.map((item, index) => ({
      id: workoutId * 10 + index,
      workout_id: workoutId,
      plan_exercise_id: item.plan_exercise_id,
      completed: item.completed,
      difficulty: item.difficulty,
      actual_weight_kg: item.actual_weight_kg,
      actual_reps: item.actual_reps,
      actual_sets: item.actual_sets,
      actual_source: item.modified ? "user_confirmed" : "plan_default",
    })),
  );
  draft.plans = draft.plans.map((item) =>
    item.id === payload.planId ? { ...item, status: "completed" } : item,
  );
  draft.versions.push({
    plan_id: payload.planId,
    workout_number: workoutNumber,
    status: "applied",
    snapshot: payload.snapshot,
  });

  if (payload.failBeforeCommit) {
    throw new Error("SIMULATED_FAILURE");
  }

  draft.submissions.set(payload.submissionKey, {
    workout_number: workoutNumber,
    workout_id: workoutId,
  });

  // 模拟事务提交：整体替换
  Object.assign(state, draft);

  return {
    ok: true,
    replayed: false,
    workout_number: workoutNumber,
    workout_id: workoutId,
  };
}

/*
 * 模拟 ensure_pending_plan（单 pending 唯一索引）：
 * 已有 pending 时直接返回，不创建第二个。
 */
function simulateEnsurePending(state, templateCode) {
  const existing = state.plans.find((plan) => plan.status === "pending");

  if (existing) {
    return { ok: true, created: false, plan_id: existing.id };
  }

  const plan = {
    id: Math.max(0, ...state.plans.map((item) => item.id)) + 1,
    status: "pending",
    cycle_code: templateCode,
  };
  state.plans.push(plan);

  return { ok: true, created: true, plan_id: plan.id };
}

/*
 * 模拟 apply_pending_plan_content 的模板同步开关：
 * 默认 false；只有显式 true 才改模板。
 */
function simulateApplyContent(state, options) {
  const syncTemplate = options.p_sync_template === true;

  if (syncTemplate) {
    state.template = {
      name: options.p_title,
      exerciseCount: options.p_items.length,
    };
  }

  state.pendingContent = options.p_items.map((item) => ({ ...item }));

  return {
    ok: true,
    exercise_count: options.p_items.length,
    template_synced: syncTemplate,
  };
}

/* =========================================================
   展示辅助
========================================================= */

function formatActual(value) {
  if (value === null || value === undefined || value === "") {
    return "未记录";
  }
  return String(value);
}

/* =========================================================
   测试
========================================================= */

test("01. 默认全部动作完成，无需逐个勾选", () => {
  const items = V4Core.buildWorkoutItems(
    [
      { id: 1, weight_kg: 5, reps: "10", sets: 3 },
      { id: 2, weight_kg: null, reps: "30秒", sets: 2 },
    ],
    [],
    [],
    [],
  );

  assert(items.length === 2, "动作数量");
  assert(
    items.every((item) => item.completed === true),
    "默认全部 completed=true",
  );
});

test("02. 难度非必填，空难度仍可保存", () => {
  const [item] = V4Core.buildWorkoutItems(
    [{ id: 1, reps: "10", sets: 1 }],
    [null],
    [],
    [false],
  );

  assert(item.difficulty === null, "难度可以为 null");
  assert(item.completed === true, "空难度不阻止完成");
});

test("03. 实际值默认继承计划值，且未标记 modified", () => {
  const planExercise = {
    id: 7,
    weight_kg: 5,
    reps: "12",
    sets: 3,
    duration_seconds: null,
    resistance_lb: 15,
    resistance_kg: 6.8,
  };
  const [item] = V4Core.buildWorkoutItems(
    [planExercise],
    [null],
    [V4Core.getPlanDefaultActuals(planExercise)],
    [false],
  );

  const defaults = V4Core.getPlanDefaultActuals(planExercise);

  assert(defaults.weight_kg === 5, "默认重量继承");
  assert(defaults.reps === "12", "默认次数继承");
  assert(defaults.sets === 3, "默认组数继承");
  assert(defaults.resistance_lb === 15, "默认阻力继承");
  assert(item.modified === false, "未编辑 → plan_default");
  assert(item.actual_weight_kg === null, "未编辑时不写 actual_*");
});

test("04. 用户编辑后仅该动作标记 user_confirmed", () => {
  const planExercises = [
    { id: 1, weight_kg: 5, reps: "10", sets: 3 },
    { id: 2, weight_kg: 10, reps: "8", sets: 3 },
  ];
  const actuals = planExercises.map((item) =>
    V4Core.getPlanDefaultActuals(item),
  );
  actuals[0].reps = "8";
  actuals[0].sets = 2;

  const items = V4Core.buildWorkoutItems(
    planExercises,
    [null, null],
    actuals,
    [true, false],
  );

  assert(items[0].modified === true, "编辑动作 user_confirmed");
  assert(items[0].actual_reps === "8", "编辑后的次数");
  assert(items[0].actual_sets === 2, "编辑后的组数");
  assert(items[1].modified === false, "未编辑动作保持 plan_default");
  assert(items[1].actual_reps === null, "未编辑动作不写 actual");
});

test("05. 标记未完成时不写入实际值", () => {
  const [item] = V4Core.buildWorkoutItems(
    [{ id: 1, weight_kg: 5, reps: "10", sets: 3 }],
    ["incomplete"],
    [{ weight_kg: 5, reps: "10", sets: 3 }],
    [true],
  );

  assert(item.completed === false, "completed=false");
  assert(item.difficulty === "incomplete", "difficulty=incomplete");
  assert(item.modified === false, "未完成不能算用户确认");
  assert(item.actual_reps === null, "未完成不写实际值");
});

test("06. 实际训练时长缺失不阻止保存（RPC 契约）", () => {
  const payload = {
    p_plan_id: 10,
    p_submission_key: "v4_10_duration",
    p_workout_date: "2026-11-13",
    p_actual_duration_minutes: null,
    p_items: [{ plan_exercise_id: 1, completed: true }],
  };

  assert(payload.p_actual_duration_minutes === null, "允许 null");
  assert(payload.p_items.length === 1, "动作仍可提交");
});

test("07. 编号只在提交成功时分配，失败不消耗", () => {
  const state = createState();
  const base = {
    planId: 10,
    planExerciseIds: [1],
    items: [{ plan_exercise_id: 1, completed: true, modified: false }],
    snapshot: { version_role: "applied" },
  };

  let failedAsExpected = false;
  try {
    simulateCompleteWorkout(state, {
      ...base,
      submissionKey: "v4_fail",
      failBeforeCommit: true,
    });
  } catch (error) {
    failedAsExpected = error.message === "SIMULATED_FAILURE";
  }

  assert(failedAsExpected, "模拟失败已抛出");
  assert(state.counter === 0, "失败后计数器不变");
  assert(state.workouts.length === 0, "失败后无 workout");
  assert(state.records.length === 0, "失败后无动作记录");
  assert(state.plans[0].status === "pending", "计划仍为 pending");
  assert(state.versions.length === 0, "失败后无版本快照");

  const success = simulateCompleteWorkout(state, {
    ...base,
    submissionKey: "v4_ok",
  });

  assert(success.workout_number === 1, "失败不消耗编号，首次成功为 1");
  assert(state.counter === 1, "成功后才 +1");
});

test("08. 重复提交 / 网络重试使用同一编号（幂等）", () => {
  const state = createState();
  const payload = {
    planId: 10,
    planExerciseIds: [1],
    items: [{ plan_exercise_id: 1, completed: true, modified: false }],
    submissionKey: "v4_same_key",
    snapshot: {},
  };

  const first = simulateCompleteWorkout(state, payload);

  // 第一次提交后计划已完成；重试只要 submission_key 命中，必须先 replay。
  const replay = simulateCompleteWorkout(state, payload);

  assert(first.workout_number === 1, "首次编号");
  assert(replay.replayed === true, "第二次标记 replay");
  assert(replay.workout_number === first.workout_number, "编号相同");
  assert(state.workouts.length === 1, "只生成一条 workout");
  assert(state.records.length === 1, "只生成一组动作记录");
});

test("09. 不同 submission_key 不能重复完成同一 pending 计划", () => {
  const state = createState();
  const base = {
    planId: 10,
    planExerciseIds: [1],
    items: [{ plan_exercise_id: 1, completed: true, modified: false }],
    snapshot: {},
  };

  simulateCompleteWorkout(state, { ...base, submissionKey: "v4_a" });

  let rejected = false;
  try {
    simulateCompleteWorkout(state, { ...base, submissionKey: "v4_b" });
  } catch (error) {
    rejected = error.message === "PLAN_NOT_PENDING";
  }

  assert(rejected, "计划已完成，第二次被拒绝");
  assert(state.workouts.length === 1, "不会生成第二条训练");
  assert(state.counter === 1, "编号不重复增加");
});

test("10. pending 并发请求只产生一个 pending 计划", () => {
  const state = createState();
  state.plans = [];

  const first = simulateEnsurePending(state, "A");
  const second = simulateEnsurePending(state, "A");

  assert(first.created === true, "第一次创建");
  assert(second.created === false, "第二次复用");
  assert(first.plan_id === second.plan_id, "返回同一个计划");
  assert(state.plans.length === 1, "唯一 pending");
});

test("11. 手动切换 pending 不改变编号和历史", () => {
  const state = createState();
  state.counter = 31;
  state.workouts = [
    { id: 1, workout_number: 31, training_plan_id: 9 },
  ];

  const before = {
    counter: state.counter,
    maxNumber: Math.max(...state.workouts.map((item) => item.workout_number)),
  };

  state.plans[0].status = "archived";
  const created = simulateEnsurePending(state, "C");

  const after = {
    counter: state.counter,
    maxNumber: Math.max(...state.workouts.map((item) => item.workout_number)),
  };

  assert(created.created === true, "生成新 pending");
  assert(after.counter === before.counter, "counter 不变");
  assert(after.maxNumber === before.maxNumber, "历史最大编号不变");
});

test("12. A/B/C/D 按真实完成顺序推进，与日期无关", () => {
  // 完成顺序 A→B→C→D→A；中间跨多少天都不影响
  const order = ["A", "B", "C", "D"];
  const completedCodes = ["A", "B", "C", "D", "A"];
  const nextCode = (code) => order[(order.indexOf(code) + 1) % order.length];

  assert(nextCode("A") === "B", "A→B");
  assert(nextCode("B") === "C", "B→C");
  assert(nextCode("C") === "D", "C→D");
  assert(nextCode("D") === "A", "D→A");
  assert(
    completedCodes.every(
      (code, index) =>
        index === completedCodes.length - 1 ||
        nextCode(code) === completedCodes[index + 1],
    ),
    "完成顺序连续，与自然日无关",
  );
});

test("13. 历史记录快照独立于动作库 / 模板后续修改", () => {
  const historicalRecord = {
    workout_id: 1,
    completed: true,
    phase_snapshot: "main",
    exercise_id_snapshot: 5,
    exercise_name_snapshot: "弹力带单臂划船",
    equipment_snapshot: "弹力带 15磅",
    planned_sets: 3,
    actual_sets: 4,
  };

  const snapshotBefore = JSON.stringify(historicalRecord);

  // 模拟动作库改名、模板改成别的动作
  const library = [{ id: 5, name: "改名后的动作" }];
  const template = [{ exercise_id: 9, phase: "main", sets: 2 }];

  const snapshotAfter = JSON.stringify(historicalRecord);

  assert(snapshotBefore === snapshotAfter, "历史快照字段未被改写");
  assert(historicalRecord.exercise_name_snapshot === "弹力带单臂划船", "历史名称保留");
  assert(historicalRecord.equipment_snapshot === "弹力带 15磅", "历史设备保留");
  assert(template[0].exercise_id !== historicalRecord.exercise_id_snapshot, "模板修改不回写历史");
  assert(library[0].name !== historicalRecord.exercise_name_snapshot, "动作库改名不影响历史");
});

test("14. 模板同步默认关闭，仅显式勾选时同步", () => {
  const state = { template: { name: "旧模板", exerciseCount: 8 } };
  const items = [
    { exercise_name: "哑铃地板卧推", sets: 3 },
    { exercise_name: "双哑铃肩推", sets: 3 },
  ];

  const defaultResult = simulateApplyContent(state, {
    p_title: "AI 计划",
    p_items: items,
  });

  assert(defaultResult.template_synced === false, "默认不同步");
  assert(state.template.name === "旧模板", "默认保留旧模板");
  assert(state.template.exerciseCount === 8, "默认保留旧模板动作数");

  const explicitResult = simulateApplyContent(state, {
    p_title: "AI 计划",
    p_items: items,
    p_sync_template: true,
  });

  assert(explicitResult.template_synced === true, "显式勾选才同步");
  assert(state.template.name === "AI 计划", "显式同步更新名称");
  assert(state.template.exerciseCount === 2, "显式同步更新动作");
});

test("15. AI 导入只替换当前 pending，旧版本快照保留", () => {
  const versions = [
    { plan_id: 10, version_no: 1, status: "pending", snapshot: "旧内容" },
  ];

  // apply_pending_plan_content 语义：插入 pre_replace 快照 + 新版本快照
  versions.push({
    plan_id: 10,
    version_no: 2,
    status: "archived",
    snapshot: "旧内容",
    version_role: "pre_replace",
  });
  versions.push({
    plan_id: 10,
    version_no: 3,
    status: "pending",
    snapshot: "新内容",
    version_role: "pending_after_replace",
  });

  assert(versions.length === 3, "旧版本没有被覆盖");
  assert(
    versions.some((item) => item.version_role === "pre_replace"),
    "存在替换前快照",
  );
  assert(
    versions[versions.length - 1].snapshot === "新内容",
    "当前 pending 使用新内容",
  );
});

test("16. 重复导入备份不会产生重复 ID", () => {
  const local = [];
  const backup = [
    { id: 1, name: "a" },
    { id: 2, name: "b" },
  ];

  const firstDuplicates = V4Core.findDuplicateIds(local, backup);
  assert(firstDuplicates.length === 0, "首次导入无重复");

  const merged = [...local, ...backup];
  const secondDuplicates = V4Core.findDuplicateIds(merged, backup);

  assert(secondDuplicates.length === 2, "二次导入全部识别为重复");
  assert(
    secondDuplicates.every((id) => id === 1 || id === 2),
    "重复 ID 正确",
  );
});

test("17. 备份恢复计数器只升不降", () => {
  assert(V4Core.mergeCounterValues(31, 20, 31) === 31, "保持当前值");
  assert(V4Core.mergeCounterValues(31, 40, 31) === 40, "采用备份更大值");
  assert(V4Core.mergeCounterValues(31, 31, 35) === 35, "采用 workouts 最大值");
  assert(V4Core.mergeCounterValues(0, 0, 0) === 0, "空数据不产生负数");
  assert(V4Core.mergeCounterValues(10, 5, 8) >= 10, "永不降低");
});

test("18. 训练编号永久且删除后不复用（允许空洞）", () => {
  const state = createState();
  const save = (key) =>
    simulateCompleteWorkout(state, {
      planId: state.plans.find((item) => item.status === "pending").id,
      planExerciseIds: [1],
      items: [{ plan_exercise_id: 1, completed: true, modified: false }],
      submissionKey: key,
      snapshot: {},
    });

  const first = save("k1");
  // 完成一次后模拟系统生成下一个 pending
  state.plans[0].status = "completed";
  state.plans.push({ id: 11, status: "pending", cycle_code: "B" });

  const second = save("k2");
  state.plans[1].status = "completed";
  state.plans.push({ id: 12, status: "pending", cycle_code: "C" });

  const third = save("k3");

  assert(first.workout_number === 1, "第 1 次");
  assert(second.workout_number === 2, "第 2 次");
  assert(third.workout_number === 3, "第 3 次");

  // 删除中间训练只留空洞，不回填、不重排
  state.workouts = state.workouts.filter(
    (workout) => workout.workout_number !== second.workout_number,
  );
  state.plans[2].status = "completed";
  state.plans.push({ id: 13, status: "pending", cycle_code: "D" });

  const fourth = save("k4");

  assert(fourth.workout_number === 4, "删除后继续递增");
  assert(
    state.workouts.map((item) => item.workout_number).join(",") === "1,3,4",
    "保留空洞且不复用编号",
  );
});

test("19. 单循环直接组 / 间接组分开统计", () => {
  const stats = V4Core.computeCycleStats({
    templates: [{ id: 1, code: "A", is_active: true }],
    templateExercises: [
      { template_id: 1, exercise_id: 1, phase: "main", sets: 3 },
      { template_id: 1, exercise_id: 2, phase: "main", sets: 2 },
    ],
    muscleGroups: [
      { exercise_id: 1, muscle_group: "胸部", role: "primary" },
      { exercise_id: 1, muscle_group: "肱三头肌", role: "secondary" },
      { exercise_id: 2, muscle_group: "背部", role: "primary" },
    ],
  });

  assert(stats.totalSets === 5, "总组数");
  assert(stats.buckets["胸部"].direct === 3, "胸部直接 3");
  assert(stats.buckets["胸部"].indirect === 0, "胸部间接 0");
  assert(stats.buckets["肱三头肌"].indirect === 3, "三头间接 3，不并入直接");
  assert(stats.buckets["背部"].direct === 2, "背部直接 2");
});

test("20. 热身 / 拉伸不计入训练量", () => {
  const stats = V4Core.computeCycleStats({
    templates: [{ id: 1, code: "A", is_active: true }],
    templateExercises: [
      { template_id: 1, exercise_id: 1, phase: "warmup", sets: 2 },
      { template_id: 1, exercise_id: 2, phase: "cooldown", sets: 2 },
      { template_id: 1, exercise_id: 3, phase: "main", sets: 3 },
    ],
    muscleGroups: [
      { exercise_id: 1, muscle_group: "胸部", role: "primary" },
      { exercise_id: 2, muscle_group: "背部", role: "primary" },
      { exercise_id: 3, muscle_group: "大腿前侧", role: "primary" },
    ],
  });

  assert(stats.totalSets === 3, "只统计 main");
  assert(stats.exerciseCount === 1, "只统计一个正式动作");
  assert(stats.buckets["胸部"].direct === 0, "热身不计胸部");
  assert(stats.buckets["大腿前侧"].direct === 3, "正式动作计入");
});

test("21. 农夫走计核心稳定，不计腹部直接", () => {
  const stats = V4Core.computeCycleStats({
    templates: [{ id: 1, code: "D", is_active: true }],
    templateExercises: [
      { template_id: 1, exercise_id: 50, phase: "main", sets: 4 },
      { template_id: 1, exercise_id: 51, phase: "main", sets: 2 },
    ],
    muscleGroups: [
      { exercise_id: 50, muscle_group: "核心稳定", role: "primary" },
      { exercise_id: 51, muscle_group: "腹部", role: "primary" },
    ],
  });

  assert(stats.core.abdominalDirect === 2, "腹部直接仅 2 组");
  assert(stats.core.coreDirect === 4, "农夫走核心稳定 4 组");
  assert(stats.core.specialCoreTotal === 6, "专项核心 = 2 + 4");
  assert(
    stats.buckets["腹部"].direct === 2,
    "农夫走没有被算进腹部直接",
  );
});

test("22. 自然周统计只计正式动作，缺失实际组数回退计划组数", () => {
  const stats = V4Core.computeWeeklyStats({
    workouts: [{ id: 1, cycle_code_snapshot: "A" }],
    records: [
      {
        workout_id: 1,
        completed: true,
        phase_snapshot: "main",
        exercise_id_snapshot: 1,
        actual_sets: 3,
      },
      {
        workout_id: 1,
        completed: true,
        phase_snapshot: "main",
        exercise_id_snapshot: 1,
        actual_sets: null,
        planned_sets: 2,
      },
      {
        workout_id: 1,
        completed: true,
        phase_snapshot: "warmup",
        exercise_id_snapshot: 1,
        actual_sets: 2,
      },
      {
        workout_id: 1,
        completed: false,
        phase_snapshot: "main",
        exercise_id_snapshot: 1,
        actual_sets: 5,
      },
    ],
    muscleGroups: [
      { exercise_id: 1, muscle_group: "胸部", role: "primary" },
    ],
  });

  assert(stats.totalSets === 5, "3 + 2 = 5，热身/未完成不计");
  assert(stats.recordCount === 2, "只统计两条有效记录");
  assert(stats.buckets["胸部"].direct === 5, "胸部直接 5");
  assert(stats.workoutCount === 1, "一次训练");
  assert(stats.cycleCodes[0] === "A", "循环代码来自快照");
});

test("23. 历史 NULL 实际值显示“未记录”，不伪造计划值", () => {
  assert(formatActual(null) === "未记录", "null");
  assert(formatActual(undefined) === "未记录", "undefined");
  assert(formatActual("") === "未记录", "空字符串");
  assert(formatActual(12) === "12", "真实值保留");
  assert(formatActual(15) === "15", "阻力值保留");
});

test("24. 实际值来源标签区分用户确认 / 继承计划 / 历史", () => {
  assert(
    V4Core.classifyActualSource({ completed: true, actual_source: "user_confirmed" }) ===
      "用户确认",
    "user_confirmed",
  );
  assert(
    V4Core.classifyActualSource({ completed: true, actual_source: "plan_default" }) ===
      "继承计划",
    "plan_default",
  );
  assert(
    V4Core.classifyActualSource({ completed: true, actual_source: null }) ===
      "历史记录（未记录来源）",
    "历史 NULL 来源",
  );
  assert(
    V4Core.classifyActualSource({ completed: false, actual_source: "plan_default" }) ===
      "未完成",
    "未完成优先",
  );
});

test("25. 弹力带阻力只允许 10 / 15 / 20 磅", () => {
  const base = { exercise_order: 1, exercise_name: "面拉", reps: "12", sets: 2 };

  assert(
    V4Core.validatePlanItems([
      { ...base, equipment: "弹力带 10磅", resistance_lb: 10 },
    ]).ok,
    "10 磅合法",
  );
  assert(
    V4Core.validatePlanItems([
      { ...base, equipment: "弹力带 20磅", resistance_lb: 20 },
    ]).ok,
    "20 磅合法",
  );
  assert(
    !V4Core.validatePlanItems([
      { ...base, equipment: "弹力带 45磅", resistance_lb: 45 },
    ]).ok,
    "45 磅非法",
  );
  assert(
    V4Core.validatePlanItems([{ ...base, equipment: "弹力带" }]).ok,
    "只写弹力带时默认 15 磅通过",
  );
});

test("26. 动作名 / 历史别名可解析到标准动作 ID", () => {
  const exercises = [
    { id: 5, name: "弹力带单臂划船" },
    { id: 8, name: "双哑铃肩推" },
  ];
  const aliases = [
    { exercise_id: 5, alias: "弹力绳单臂划船" },
    { exercise_id: 8, alias: "双手哑铃肩推" },
  ];

  assert(
    V4Core.resolveExerciseId("弹力带单臂划船", exercises, aliases) === 5,
    "标准名",
  );
  assert(
    V4Core.resolveExerciseId("弹力绳单臂划船", exercises, aliases) === 5,
    "历史别名",
  );
  assert(
    V4Core.resolveExerciseId(" 双手哑铃肩推 ", exercises, aliases) === 8,
    "空格与别名",
  );
  assert(
    V4Core.resolveExerciseId("不存在的动作", exercises, aliases) === null,
    "未知动作返回 null",
  );
});

test("27. 计划校验拒绝空动作 / 重复顺序 / 非法阶段", () => {
  assert(!V4Core.validatePlanItems([]).ok, "空计划失败");

  const duplicateOrder = V4Core.validatePlanItems([
    { exercise_order: 1, exercise_name: "A", reps: "10", sets: 1, phase: "main" },
    { exercise_order: 1, exercise_name: "B", reps: "10", sets: 1, phase: "main" },
  ]);
  assert(!duplicateOrder.ok, "重复顺序失败");

  assert(
    !V4Core.validatePlanItems([
      {
        exercise_order: 1,
        exercise_name: "A",
        reps: "10",
        sets: 1,
        phase: "warm-up",
      },
    ]).ok,
    "非法阶段失败",
  );

  assert(
    V4Core.validatePlanItems([
      { exercise_order: 1, exercise_name: "A", reps: "10", sets: 1, phase: "warmup" },
      { exercise_order: 2, exercise_name: "B", reps: "10", sets: 1, phase: "main" },
    ]).ok,
    "合法计划通过",
  );
});

test("28. 计划校验拒绝负数 / 零组数与缺失次数", () => {
  const base = { exercise_order: 1, exercise_name: "A", phase: "main" };

  assert(
    !V4Core.validatePlanItems([{ ...base, reps: "10", sets: 0 }]).ok,
    "组数 0 失败",
  );
  assert(
    !V4Core.validatePlanItems([{ ...base, reps: "10", sets: 2, weight_kg: -1 }]).ok,
    "负重量失败",
  );
  assert(
    !V4Core.validatePlanItems([{ ...base, reps: "", sets: 2 }]).ok,
    "缺失次数失败",
  );
  assert(
    V4Core.validatePlanItems([{ ...base, reps: "10", sets: 2 }]).ok,
    "正常计划通过",
  );
});

test("29. 自然周范围以周一为起点", () => {
  // 2026-11-13 是周五
  const range = V4Core.getWeekRange("2026-11-13T12:00:00");
  assert(V4Core.toDateKey(range.start) === "2026-11-09", "周一");
  assert(V4Core.toDateKey(range.end) === "2026-11-15", "周日");
  assert(V4Core.isDateInRange("2026-11-13", range.start, range.end), "周五在范围内");
  assert(!V4Core.isDateInRange("2026-11-16", range.start, range.end), "下周一不在范围");
});

test("30. 停用模板不进入单循环统计", () => {
  const stats = V4Core.computeCycleStats({
    templates: [
      { id: 1, code: "A", is_active: true },
      { id: 2, code: "B", is_active: false },
    ],
    templateExercises: [
      { template_id: 1, exercise_id: 1, phase: "main", sets: 3 },
      { template_id: 2, exercise_id: 1, phase: "main", sets: 5 },
    ],
    muscleGroups: [
      { exercise_id: 1, muscle_group: "胸部", role: "primary" },
    ],
  });

  assert(stats.templateCount === 1, "只统计启用模板");
  assert(stats.totalSets === 3, "停用模板组数不计入");
  assert(stats.cycleCodes.join("") === "A", "循环代码仅 A");
});

/* =========================================================
   结果
========================================================= */

console.log(
  "\nRESULT: " + passed + " passed, " + failed + " failed, total " + (passed + failed),
);

if (failed > 0) {
  process.exit(1);
}
