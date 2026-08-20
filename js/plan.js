/* ================================
   plan.js
   AI训练计划读取与显示

   核心逻辑：

   1. 首页当前应该训练哪一次？
      = 最近一次已经完成的训练 + 1

   2. training_plans 可以提前存在很多次，
      但首页只显示当前应该训练的编号。

   3. 当前训练未完成：
      首页始终显示当前训练。

   4. 当前训练完成：
      首页进入下一次训练。

   5. 每个动作只记录：
      轻松 / 正常 / 吃力 / 未完成
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
    const currentWorkoutNumber = await getCurrentWorkoutNumber();

    console.log("当前应该训练：", currentWorkoutNumber);

    /* ================================
       查找当前训练计划
    ================================= */

    const plans = await supabaseRequest(
      "training_plans" +
        "?select=*" +
        "&workout_number=eq." +
        currentWorkoutNumber +
        "&limit=1",
    );

    /* ================================
       没有当前训练计划
    ================================= */

    if (!plans || !plans.length) {
      currentPlan = null;

      currentExercises = [];

      completed = [];

      exerciseDifficulty = [];

      showWaitingForAIPlan(currentWorkoutNumber);

      setStatus("☁️ 数据库已连接，等待AI生成下一次训练计划", "ok");

      return;
    }

    /* ================================
       当前训练计划
    ================================= */

    currentPlan = plans[0];

    /* ================================
       读取训练动作
    ================================= */

    const exercises = await supabaseRequest(
      "training_plan_exercises" +
        "?select=*" +
        "&plan_id=eq." +
        currentPlan.id +
        "&order=exercise_order.asc",
    );

    currentExercises = exercises || [];

    /* ================================
       初始化动作状态
    ================================= */

    completed = new Array(currentExercises.length).fill(false);

    exerciseDifficulty = new Array(currentExercises.length).fill(null);

    /* ================================
       显示训练计划
    ================================= */

    renderCurrentPlan();

    /* ================================
       更新连接状态
    ================================= */

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

/* ================================
   难度按钮
================================ */

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
   复制当前训练计划
============================================================ */

async function copyLastTrainingPlan() {
  try {
    const currentNumber = await getCurrentWorkoutNumber();

    /* ================================
       查找当前训练计划
    ================================= */

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
       新训练编号
    ================================= */

    const newWorkoutNumber = currentNumber + 1;

    /* ================================
       检查是否已经存在
    ================================= */

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
       创建新的训练计划
    ================================= */

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
       读取原训练动作
    ================================= */

    const sourceExercises = await supabaseRequest(
      "training_plan_exercises" +
        "?select=*" +
        "&plan_id=eq." +
        sourcePlan.id +
        "&order=exercise_order.asc",
    );

    /* ================================
       复制动作
    ================================= */

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
       成功提示
    ================================= */

    alert(
      `已经成功复制！💪\n\n` +
        `第${currentNumber}次训练计划` +
        ` → 第${newWorkoutNumber}次训练计划\n\n` +
        `当前首页仍然显示第${currentNumber}次训练，` +
        `完成后才会进入第${newWorkoutNumber}次。`,
    );

    /* ================================
       刷新当前训练
    ================================= */

    await loadCurrentPlan();

    if (typeof setStatus === "function") {
      setStatus("☁️ 已复制下一次训练计划", "ok");
    }
  } catch (error) {
    console.error("复制训练计划失败：", error);

    alert("复制训练计划失败：\n\n" + (error.message || String(error)));
  }
}
