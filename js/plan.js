/* ================================
   plan.js
   AI训练计划读取与显示

   核心逻辑：

   1. 首页当前应该训练哪一次？
      = 最近一次已经保存的训练 + 1

   2. training_plans 可以提前存在很多次，
      但首页只显示当前应该训练的编号。

   3. 当前训练未完成：
      首页始终显示当前训练。

   4. 当前训练完成：
      首页进入下一次训练。

   5. 每个动作只记录：
      轻松 / 正常 / 吃力 / 未完成

   6. 删除训练计划：
      删除第 N 次时，
      从第 N 次开始删除所有尚未产生 workouts
      历史的训练计划。

      一旦遇到已经产生 workouts 历史的训练，
      立即停止删除，保护训练历史。
================================ */

/* =========================================================
   获取最近一次已经保存的训练编号
========================================================= */

async function getLatestSavedWorkoutNumber() {
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
    console.error("读取最近已保存训练失败：", error);

    throw error;
  }
}

/* =========================================================
   获取当前应该训练的编号
========================================================= */

async function getCurrentWorkoutNumber() {
  const latestSaved = await getLatestSavedWorkoutNumber();

  return latestSaved + 1;
}

/* =========================================================
   检查某个训练编号是否已经产生训练历史
========================================================= */

async function hasWorkoutHistory(workoutNumber) {
  try {
    const workouts = await supabaseRequest(
      "workouts" +
        "?select=id,workout_number,workout_date" +
        "&workout_number=eq." +
        encodeURIComponent(workoutNumber) +
        "&limit=1",
    );

    return Array.isArray(workouts) && workouts.length > 0;
  } catch (error) {
    console.error("检查训练历史失败：", error);

    throw error;
  }
}

/* =========================================================
   读取当前训练计划
========================================================= */

async function loadCurrentPlan() {
  try {
    const currentWorkoutNumber = await getCurrentWorkoutNumber();

    console.log("当前应该训练：", currentWorkoutNumber);

    const plans = await supabaseRequest(
      "training_plans" +
        "?select=*" +
        "&workout_number=eq." +
        encodeURIComponent(currentWorkoutNumber) +
        "&limit=1",
    );

    /* =====================================================
       没有当前训练计划
    ===================================================== */

    if (!plans || !plans.length) {
      currentPlan = null;

      currentExercises = [];

      completed = [];

      exerciseDifficulty = [];

      showWaitingForAIPlan(currentWorkoutNumber);

      setTrainingPlanActions(false);

      setStatus("☁️ 数据库已连接，等待AI生成下一次训练计划", "ok");

      return;
    }

    /* =====================================================
       当前训练计划
    ===================================================== */

    currentPlan = plans[0];

    /* =====================================================
       读取训练动作
    ===================================================== */

    const exercises = await supabaseRequest(
      "training_plan_exercises" +
        "?select=*" +
        "&plan_id=eq." +
        encodeURIComponent(currentPlan.id) +
        "&order=exercise_order.asc",
    );

    currentExercises = Array.isArray(exercises) ? exercises : [];

    /* =====================================================
       初始化动作状态
    ===================================================== */

    completed = new Array(currentExercises.length).fill(false);

    exerciseDifficulty = new Array(currentExercises.length).fill(null);

    /* =====================================================
       显示训练计划
    ===================================================== */

    renderCurrentPlan();

    /* =====================================================
       显示删除按钮
    ===================================================== */

    setTrainingPlanActions(true);

    /* =====================================================
       更新连接状态
    ===================================================== */

    setStatus("☁️ 已连接训练数据库", "ok");

    const saveButton = document.getElementById("saveButton");

    if (saveButton) {
      saveButton.disabled = false;

      saveButton.textContent = "保存今天训练";
    }

    console.log(
      "当前训练计划：",
      currentPlan.workout_number,
      currentPlan.title,
    );
  } catch (error) {
    console.error("训练计划读取失败：", error);

    setTrainingPlanActions(false);

    setStatus("⚠️ 训练计划读取失败：" + error.message, "error");
  }
}

/* =========================================================
   控制删除按钮显示 / 隐藏

   删除按钮 UI 位于 index.html：

   #trainingPlanActions
========================================================= */

function setTrainingPlanActions(show) {
  const actions = document.getElementById("trainingPlanActions");

  if (!actions) {
    return;
  }

  actions.classList.toggle("hidden", !show);
}

/* =========================================================
   等待AI训练计划
========================================================= */

function showWaitingForAIPlan(workoutNumber) {
  const box = document.getElementById("todayPlan");

  if (!box) {
    return;
  }

  const content = document.getElementById("todayPlanContent") || box;

  content.innerHTML = `

    <h2>
      🤖 等待下一次训练计划
    </h2>

    <div class="muted">

      第 ${workoutNumber} 次训练
      还没有生成。

    </div>

    <br>

    <div class="analysis">

      你的下一次训练不会按照固定规则自动生成。

      <br><br>

      我会根据你之前的训练记录、
      每个动作的完成情况、
      每个动作的训练难度、
      训练频率、
      身体感受以及身体数据，

      <br><br>

      由 ChatGPT 分析后生成下一次训练计划。

    </div>

    <br>

    <div class="muted">

      💡 生成计划后，
      将计划导入网站即可开始下一次训练。

    </div>

  `;

  const saveButton = document.getElementById("saveButton");

  if (saveButton) {
    saveButton.disabled = true;

    saveButton.textContent = "等待下一次训练计划";
  }
}

/* =========================================================
   难度按钮
========================================================= */

function renderDifficultyButtons(index) {
  const difficulty = exerciseDifficulty[index];

  const options = [
    {
      value: "easy",
      label: "轻松",
    },

    {
      value: "normal",
      label: "正常",
    },

    {
      value: "hard",
      label: "吃力",
    },

    {
      value: "incomplete",
      label: "未完成",
    },
  ];

  return `
    <div
      class="difficulty-buttons"
      id="difficultyBox${index}">

      ${options
        .map((option) => {
          const selected = difficulty === option.value;

          return `
            <button
              type="button"
              class="
                difficulty-btn
                difficulty-${option.value}
                ${selected ? "selected" : ""}
              "
              onclick="setExerciseDifficulty(
                ${index},
                '${option.value}'
              )">

              ${option.label}

            </button>
          `;
        })
        .join("")}

    </div>
  `;
}

/* =========================================================
   显示训练计划
========================================================= */

function renderCurrentPlan() {
  const box = document.getElementById("todayPlan");

  if (!box || !currentPlan) {
    return;
  }

  const exercisesHTML = currentExercises
    .map(
      (exercise, index) => `

        <div
          class="exercise"
          id="exercise${index}">

          <div class="exercise-row">

            <div class="exercise-info">

              <div class="exercise-name">

                ${index + 1}️⃣
                ${escapeHtml(exercise.exercise_name)}

              </div>

              <div class="exercise-detail">

                ${
                  exercise.weight_kg !== null
                    ? exercise.weight_kg + "kg × "
                    : ""
                }

                ${escapeHtml(exercise.reps || "")}

                次 ×

                ${exercise.sets || 0}

                组

                ${
                  exercise.notes
                    ? `
                      <br>
                      ${escapeHtml(exercise.notes)}
                    `
                    : ""
                }

              </div>

            </div>

          </div>

          <div class="difficulty-label">

            完成情况

          </div>

          ${renderDifficultyButtons(index)}

        </div>

      `,
    )
    .join("");

  /* =====================================================
     当前训练计划
     
     删除按钮已经移到 index.html，
     这里不再生成删除按钮。
  ===================================================== */

  const content = document.getElementById("todayPlanContent");

  const target = content || box;

  target.innerHTML = `

    <h2>

      第
      ${currentPlan.workout_number}
      次训练

    </h2>

    <div class="muted">

      ${escapeHtml(currentPlan.title || "")}

    </div>

    <div class="muted">

      重点：

      ${escapeHtml(currentPlan.focus || "")}

    </div>

    <div class="muted">

      建议训练时间：

      ${currentPlan.duration_minutes || 25}

      分钟

    </div>

    <br>

    <div class="progress">

      <div
        id="progressBar"
        class="progress-bar">
      </div>

    </div>

    <div
      id="progressText"
      class="muted">

      0 /
      ${currentExercises.length}
      个动作完成

    </div>

    ${exercisesHTML}

  `;

  updateProgress();
}

/* =========================================================
   删除当前及以后所有尚未产生历史的训练计划

   规则：

   删除第 N 次时：

   第 N 次
   第 N+1 次
   第 N+2 次
   ...

   只要没有 workouts 历史：
   → 删除

   一旦发现某一次已经有 workouts：
   → 停止

   已经产生历史的训练计划以及之后的计划全部保留。

   不删除：

   - workouts
   - workout_exercise_records
========================================================= */

async function deleteCurrentTrainingPlan() {
  if (!currentPlan) {
    alert("目前没有可以删除的训练计划。");

    return;
  }

  const startNumber = Number(currentPlan.workout_number);

  if (!Number.isFinite(startNumber)) {
    alert("当前训练计划编号无效，无法删除。");

    return;
  }

  if (!currentPlan.id) {
    alert("当前训练计划缺少 plan_id，无法删除。");

    return;
  }

  /* =====================================================
     查找从当前训练开始的所有训练计划
  ===================================================== */

  let plansToCheck = [];

  try {
    plansToCheck = await supabaseRequest(
      "training_plans" +
        "?select=id,workout_number,title" +
        "&workout_number=gte." +
        encodeURIComponent(startNumber) +
        "&order=workout_number.asc",
    );
  } catch (error) {
    console.error("读取待删除训练计划失败：", error);

    alert("读取待删除训练计划失败：\n\n" + (error.message || String(error)));

    return;
  }

  if (!Array.isArray(plansToCheck)) {
    plansToCheck = [];
  }

  /* =====================================================
     第一次确认
  ===================================================== */

  const confirmed = window.confirm(
    `确定要删除第 ${startNumber} 次及之后尚未产生训练历史的训练计划吗？\n\n` +
      `系统会从第 ${startNumber} 次开始检查。\n\n` +
      `已经产生训练历史的训练计划不会删除。\n\n` +
      `此操作无法恢复。`,
  );

  if (!confirmed) {
    return;
  }

  try {
    const plansToDelete = [];

    /* =====================================================
       按训练编号从前往后检查

       一旦遇到已经有 workouts 的训练，
       就停止。

       这样可以保证：
       第8、9、10没有历史 → 删除
       第11有历史 → 停止
       第12以后 → 保留
    ===================================================== */

    for (const plan of plansToCheck) {
      const workoutNumber = Number(plan.workout_number);

      if (!Number.isFinite(workoutNumber)) {
        console.warn("发现无效训练编号，停止删除：", plan);

        break;
      }

      const hasHistory = await hasWorkoutHistory(workoutNumber);

      if (hasHistory) {
        console.log(`第${workoutNumber}次已有训练历史，停止继续删除。`);

        break;
      }

      plansToDelete.push(plan);
    }

    /* =====================================================
       没有任何可以删除的计划
    ===================================================== */

    if (!plansToDelete.length) {
      alert(
        `第 ${startNumber} 次训练已经存在训练历史。\n\n` +
          `为了保护你的训练记录，系统没有删除任何训练计划。`,
      );

      return;
    }

    console.log("准备删除训练计划：", plansToDelete);

    /* =====================================================
       最终确认

       显示实际准备删除的范围
    ===================================================== */

    const firstNumber = Number(plansToDelete[0].workout_number);

    const lastNumber = Number(
      plansToDelete[plansToDelete.length - 1].workout_number,
    );

    const rangeText =
      firstNumber === lastNumber
        ? `第 ${firstNumber} 次`
        : `第 ${firstNumber}～${lastNumber} 次`;

    const finalConfirmed = window.confirm(
      `确认删除 ${rangeText}训练计划？\n\n` +
        `共 ${plansToDelete.length} 次训练计划。\n\n` +
        `这些训练计划都没有产生训练历史。\n\n` +
        `已有训练历史的计划不会删除。`,
    );

    if (!finalConfirmed) {
      return;
    }

    /* =====================================================
       逐个删除

       每个计划：

       ① 再检查一次 workouts
       ② 删除 training_plan_exercises
       ③ 再检查一次 workouts
       ④ 删除 training_plans

       双重保护。
    ===================================================== */

    let deletedCount = 0;

    for (const plan of plansToDelete) {
      const workoutNumber = Number(plan.workout_number);

      const planId = plan.id;

      /* ===================================================
         删除前再次检查历史
      =================================================== */

      const historyBeforeDelete = await hasWorkoutHistory(workoutNumber);

      if (historyBeforeDelete) {
        console.warn(`第${workoutNumber}次在删除前产生了训练历史，停止删除。`);

        break;
      }

      /* ===================================================
         删除动作
      =================================================== */

      await supabaseRequest(
        "training_plan_exercises" + "?plan_id=eq." + encodeURIComponent(planId),
        {
          method: "DELETE",
        },
      );

      console.log(`🗑 第${workoutNumber}次训练动作删除完成`);

      /* ===================================================
         删除前再次检查历史
      =================================================== */

      const historyAfterExercises = await hasWorkoutHistory(workoutNumber);

      if (historyAfterExercises) {
        console.warn(
          `第${workoutNumber}次删除动作后产生训练历史，停止删除训练计划。`,
        );

        break;
      }

      /* ===================================================
         删除训练计划
      =================================================== */

      await supabaseRequest(
        "training_plans" + "?id=eq." + encodeURIComponent(planId),
        {
          method: "DELETE",
        },
      );

      deletedCount++;

      console.log(`🗑 第${workoutNumber}次训练计划删除完成`);
    }

    /* =====================================================
       清空当前页面状态
    ===================================================== */

    currentPlan = null;

    currentExercises = [];

    completed = [];

    exerciseDifficulty = [];

    setTrainingPlanActions(false);

    /* =====================================================
       重新读取当前训练

       因为当前训练计划已经删除，
       首页会重新显示：

       最近完成训练 + 1
    ===================================================== */

    await loadCurrentPlan();

    /* =====================================================
       成功提示
    ===================================================== */

    if (deletedCount > 0) {
      setStatus(`☁️ 已删除 ${deletedCount} 次训练计划`, "ok");

      alert(
        `删除完成！\n\n` +
          `共删除 ${deletedCount} 次训练计划。\n\n` +
          `已经产生训练历史的训练不会被删除。`,
      );
    }
  } catch (error) {
    console.error("❌ 删除训练计划失败：", error);

    alert(
      "删除训练计划失败：\n\n" +
        (error.message || String(error)) +
        "\n\n" +
        "请检查 Supabase 数据库权限或表关联设置。",
    );
  }
}

/* ============================================================
   复制最新训练计划

   核心规则：

   1. 不看“当前应该训练哪一次”
   2. 直接寻找 training_plans 中最新的一次训练计划
   3. 将最新计划完整复制
   4. 新计划编号 = 最新计划编号 + 1

   例如：

   第8次已完成
   第9次尚未生成

   点击“复制此次训练计划”：

   第8次 → 第9次

   如果：

   第8次已完成
   第9次 AI计划已经存在

   点击：

   第9次 → 第10次
============================================================ */

async function copyLastTrainingPlan() {
  try {
    /* =====================================================
       ① 查找数据库中最新的训练计划

       注意：

       这里不能使用 getCurrentWorkoutNumber()。

       getCurrentWorkoutNumber() 得到的是：

       最近完成训练 + 1

       而我们需要的是：

       training_plans 中最新的一次计划。
    ===================================================== */

    const latestPlans = await supabaseRequest(
      "training_plans" +
        "?select=*" +
        "&order=workout_number.desc" +
        "&limit=1",
    );

    /* =====================================================
       没有任何训练计划
    ===================================================== */

    if (!latestPlans || !latestPlans.length) {
      alert("目前还没有任何训练计划。\n\n" + "请先让 AI 生成第一次训练计划。");

      return;
    }

    const sourcePlan = latestPlans[0];

    const sourceWorkoutNumber = Number(sourcePlan.workout_number);

    if (!Number.isFinite(sourceWorkoutNumber)) {
      throw new Error("最新训练计划的 workout_number 无效。");
    }

    /* =====================================================
       ② 新训练编号

       最新计划 + 1

       例如：

       第8次 → 第9次
       第9次 → 第10次
    ===================================================== */

    const newWorkoutNumber = sourceWorkoutNumber + 1;

    /* =====================================================
       ③ 检查新编号是否已经存在

       正常情况下不应该存在。

       但如果数据库出现重复或并发操作，
       这里可以防止重复创建。
    ===================================================== */

    const existingPlans = await supabaseRequest(
      "training_plans" +
        "?select=id,workout_number,title" +
        "&workout_number=eq." +
        encodeURIComponent(newWorkoutNumber) +
        "&limit=1",
    );

    if (existingPlans && existingPlans.length) {
      alert(`第${newWorkoutNumber}次训练计划已经存在。\n\n` + `不会重复创建。`);

      return;
    }

    /* =====================================================
       ④ 读取最新训练计划的动作

       先读取，确认原计划确实有动作，
       再创建新的训练计划。

       避免产生一个空的训练计划。
    ===================================================== */

    const sourceExercises = await supabaseRequest(
      "training_plan_exercises" +
        "?select=*" +
        "&plan_id=eq." +
        encodeURIComponent(sourcePlan.id) +
        "&order=exercise_order.asc",
    );

    if (!Array.isArray(sourceExercises) || !sourceExercises.length) {
      alert(
        `第${sourceWorkoutNumber}次训练计划没有训练动作。\n\n` +
          `无法复制空训练计划。`,
      );

      return;
    }

    /* =====================================================
       ⑤ 创建新的训练计划
    ===================================================== */

    const created = await supabaseRequest("training_plans", {
      method: "POST",

      body: {
        workout_number: newWorkoutNumber,

        plan_date: todayString(),

        title: `第${newWorkoutNumber}次训练`,

        focus: sourcePlan.focus || "",

        duration_minutes: sourcePlan.duration_minutes || 25,

        notes: sourcePlan.notes || "",
      },
    });

    if (!created || !created.length || !created[0].id) {
      throw new Error("复制训练计划后没有返回新的 plan_id。");
    }

    const newPlanId = created[0].id;

    /* =====================================================
       ⑥ 复制所有训练动作

       完整复制：

       - 动作顺序
       - 动作名称
       - 器械
       - 重量
       - 次数
       - 组数
       - 动作备注
    ===================================================== */

    for (let i = 0; i < sourceExercises.length; i++) {
      const exercise = sourceExercises[i];

      await supabaseRequest("training_plan_exercises", {
        method: "POST",

        body: {
          plan_id: newPlanId,

          exercise_order: Number(exercise.exercise_order) || i + 1,

          exercise_name: exercise.exercise_name,

          equipment: exercise.equipment || "自重",

          weight_kg:
            exercise.weight_kg === null || exercise.weight_kg === undefined
              ? null
              : Number(exercise.weight_kg),

          reps: exercise.reps || "",

          sets: Number(exercise.sets) || 1,

          notes: exercise.notes || "",
        },
      });
    }

    /* =====================================================
       ⑦ 成功提示
    ===================================================== */

    alert(
      `已经成功复制！💪\n\n` +
        `第${sourceWorkoutNumber}次训练计划` +
        ` → 第${newWorkoutNumber}次训练计划\n\n` +
        `首页现在可以开始第${newWorkoutNumber}次训练。`,
    );

    /* =====================================================
       ⑧ 重新读取首页训练计划

       如果源计划已经完成：

       第8次已完成
       ↓
       新建第9次
       ↓
       getCurrentWorkoutNumber()
       ↓
       第9次
       ↓
       首页显示第9次
    ===================================================== */

    await loadCurrentPlan();

    if (typeof setStatus === "function") {
      setStatus(
        `☁️ 已复制第${sourceWorkoutNumber}次训练计划 → 第${newWorkoutNumber}次`,
        "ok",
      );
    }
  } catch (error) {
    console.error("复制训练计划失败：", error);

    alert("复制训练计划失败：\n\n" + (error.message || String(error)));
  }
}
