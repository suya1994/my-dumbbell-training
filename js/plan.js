/* ================================
   plan.js
   AI训练计划读取与显示

   核心逻辑：

   1. 首页当前应该训练哪一次？
      = 最近一次已经完成的训练 + 1

   2. training_plans 可以提前存在很多次：
      第6次、第7次、第8次……

      但首页只显示：
      最近完成次数 + 1

   3. 例如：

      已完成：第1～5次
      已有计划：第6、第7次

      首页：
      → 第6次

      完成第6次后：

      已完成：第1～6次
      已有计划：第6、第7次

      首页：
      → 第7次

   4. “复制上次训练计划”：
      当前训练计划 → 复制成下一次计划

      例如：
      当前第6次
      ↓
      复制
      ↓
      第7次

      首页仍然显示第6次，
      直到第6次真正完成。
================================ */

/* ================================
   获取最近一次已经完成的训练编号
================================ */

async function getLatestCompletedWorkoutNumber() {
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
    console.error("读取最近完成训练失败：", error);

    throw error;
  }
}

/* ================================
   获取当前应该训练的编号

   例如：

   没有完成过训练
   → 第1次

   已完成第5次
   → 第6次

   即使数据库已经存在第7、第8次计划，
   这里仍然只返回第6次。
================================ */

async function getCurrentWorkoutNumber() {
  const latestCompleted = await getLatestCompletedWorkoutNumber();

  return latestCompleted + 1;
}

/* ================================
   读取当前训练计划
================================ */

async function loadCurrentPlan() {
  try {
    /* ================================
       1. 找到当前应该训练的编号
    ================================ */

    const currentWorkoutNumber = await getCurrentWorkoutNumber();

    console.log("当前应该训练：", currentWorkoutNumber);

    /* ================================
       2. 查找这个编号对应的训练计划
    ================================ */

    const plans = await supabaseRequest(
      "training_plans" +
        "?select=*" +
        "&workout_number=eq." +
        currentWorkoutNumber +
        "&limit=1",
    );

    /* ================================
       3. 没有当前训练计划

       这是正常情况。

       例如：
       第5次已经完成
       第6次还没有让AI生成

       → 等待AI生成第6次
    ================================ */

    if (!plans || !plans.length) {
      currentPlan = null;

      currentExercises = [];

      completed = [];

      showWaitingForAIPlan(currentWorkoutNumber);

      setStatus("☁️ 数据库已连接，等待AI生成下一次训练计划", "ok");

      return;
    }

    /* ================================
       4. 找到了当前训练计划
    ================================ */

    currentPlan = plans[0];

    /* ================================
       5. 读取训练动作
    ================================ */

    const exercises = await supabaseRequest(
      "training_plan_exercises" +
        "?select=*" +
        "&plan_id=eq." +
        currentPlan.id +
        "&order=exercise_order.asc",
    );

    currentExercises = exercises || [];

    /* ================================
       6. 初始化动作完成状态
    ================================ */

    completed = new Array(currentExercises.length).fill(false);

    /* ================================
       7. 显示训练计划
    ================================ */

    renderCurrentPlan();

    /* ================================
       8. 更新状态
    ================================ */

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

    setStatus("⚠️ 训练计划读取失败：" + error.message, "error");
  }
}

/* ================================
   等待AI训练计划
================================ */

function showWaitingForAIPlan(workoutNumber) {
  const box = document.getElementById("todayPlan");

  if (!box) {
    return;
  }

  box.innerHTML = `

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
      动作完成情况、重量、次数、
      左右手差异、训练频率、
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

/* ================================
   显示训练计划
================================ */

function renderCurrentPlan() {
  const box = document.getElementById("todayPlan");

  if (!box || !currentPlan) {
    return;
  }

  const exercisesHTML = currentExercises
    .map(
      (exercise, index) => `

        <div class="exercise">

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

                <br>

                ${escapeHtml(exercise.notes || "")}

              </div>

            </div>


            <button
              class="complete-btn"
              onclick="toggleExercise(${index})"
              id="exerciseBtn${index}">

              ✓

            </button>

          </div>


          <!-- ================================
               实际训练记录
          ================================ -->

          <div
            id="actualBox${index}"
            class="hidden"
            style="margin-top:12px;">

            <div class="muted">

              实际完成情况

            </div>


            <input
              id="actualSets${index}"
              class="note"
              type="number"
              min="0"
              max="20"
              placeholder="实际完成几组，例如 3">


            <input
              id="actualReps${index}"
              class="note"
              type="text"
              placeholder="实际次数，例如 7/7/6">


            <input
              id="actualWeight${index}"
              class="note"
              type="number"
              min="0"
              step="0.5"
              placeholder="实际重量 kg，例如 5">


            ${
              exercise.exercise_name.includes("单臂") ||
              exercise.exercise_name.includes("单手")
                ? `

              <input
                id="leftReps${index}"
                class="note"
                type="text"
                placeholder="左手次数，例如 7/7/6">


              <input
                id="rightReps${index}"
                class="note"
                type="text"
                placeholder="右手次数，例如 7/7/7">

              `
                : ""
            }

          </div>

        </div>

      `,
    )
    .join("");

  box.innerHTML = `

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

/* ============================================================
   复制当前 / 上一次训练计划
   ============================================================

   这里的“上次训练计划”定义为：

   当前首页正在显示的训练计划。

   例如：

   最近完成：第5次
   当前首页：第6次

   点击复制：

   第6次 → 第7次

   但首页仍然显示：

   第6次

   因为第6次还没有完成。

   ============================================================ */

async function copyLastTrainingPlan() {
  try {
    /* ================================
       1. 找到当前应该训练的编号
    ================================ */

    const currentNumber = await getCurrentWorkoutNumber();

    /* ================================
       2. 找当前训练计划

       例如：
       当前应该训练第6次

       就找第6次计划。

       而不是直接找数据库最大的计划编号。
    ================================ */

    const plans = await supabaseRequest(
      "training_plans" +
        "?select=*" +
        "&workout_number=eq." +
        currentNumber +
        "&limit=1",
    );

    if (!plans || !plans.length) {
      alert(
        `目前没有第${currentNumber}次训练计划，\n\n` +
          `请先生成第${currentNumber}次训练计划。`,
      );

      return;
    }

    const sourcePlan = plans[0];

    /* ================================
       3. 目标编号

       当前第6次
       → 复制为第7次
    ================================ */

    const newWorkoutNumber = currentNumber + 1;

    /* ================================
       4. 检查第7次是否已经存在

       防止重复点击复制按钮，
       导致同一个编号出现多个计划。
    ================================ */

    const existingPlans = await supabaseRequest(
      "training_plans" +
        "?select=id,workout_number,title" +
        "&workout_number=eq." +
        newWorkoutNumber +
        "&limit=1",
    );

    if (existingPlans && existingPlans.length) {
      alert(`第${newWorkoutNumber}次训练计划已经存在。\n\n` + `不会重复创建。`);

      return;
    }

    /* ================================
       5. 创建新的训练计划
    ================================ */

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

    /* ================================
       6. 读取原训练动作
    ================================ */

    const sourceExercises = await supabaseRequest(
      "training_plan_exercises" +
        "?select=*" +
        "&plan_id=eq." +
        sourcePlan.id +
        "&order=exercise_order.asc",
    );

    /* ================================
       7. 复制所有动作
    ================================ */

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

    /* ================================
       8. 成功

       注意：

       这里不要重新让首页显示第7次。

       loadCurrentPlan() 会重新计算：

       最近完成 = 第5次
       → 当前 = 第6次

       所以首页仍然是第6次。
    ================================ */

    alert(
      `已经成功复制！💪\n\n` +
        `第${currentNumber}次训练计划` +
        ` → 第${newWorkoutNumber}次训练计划\n\n` +
        `当前首页仍然显示第${currentNumber}次训练，` +
        `完成后才会进入第${newWorkoutNumber}次。`,
    );

    /* ================================
       9. 刷新当前训练

       仍然显示第6次。
    ================================ */

    await loadCurrentPlan();

    if (typeof setStatus === "function") {
      setStatus("☁️ 已复制下一次训练计划", "ok");
    }

    console.log("训练计划复制成功：", {
      from: currentNumber,

      to: newWorkoutNumber,

      source_plan_id: sourcePlan.id,

      new_plan_id: newPlanId,
    });
  } catch (error) {
    console.error("复制训练计划失败：", error);

    alert("复制训练计划失败：\n\n" + (error.message || String(error)));
  }
}
