/* ================================
   plan.js
   AI训练计划读取与显示

   逻辑：
   1. 找到最近一次已经完成的训练
   2. 下一次 = 最近一次 + 1
   3. 尝试读取AI已经生成并导入的训练计划
   4. 如果没有：
      → 不报错
      → 提示等待AI生成下一次计划
   ================================ */

/* ================================
   读取当前/下一次训练计划
================================ */

async function loadCurrentPlan() {
  try {
    /* ================================
       读取训练历史
    ================================ */

    const workouts = await supabaseRequest(
      "workouts" +
        "?select=workout_number,workout_date,title,completion_percent" +
        "&order=workout_number.desc" +
        "&limit=1",
    );

    /* ================================
       计算下一次训练编号

       没有训练记录：
       → 第1次

       有训练记录：
       → 最近一次 + 1
    ================================ */

    let nextWorkoutNumber = 1;

    if (workouts.length) {
      nextWorkoutNumber = Number(workouts[0].workout_number || 0) + 1;
    }

    console.log(
      "最近一次训练：",
      workouts.length ? workouts[0].workout_number : "暂无",
    );

    console.log("下一次训练：", nextWorkoutNumber);

    /* ================================
       读取AI已经导入的下一次训练计划
    ================================ */

    const plans = await supabaseRequest(
      "training_plans" +
        "?select=*" +
        "&workout_number=eq." +
        nextWorkoutNumber +
        "&limit=1",
    );

    /* ================================
       没有下一次计划

       这是正常情况！

       因为下一次训练应该由ChatGPT生成，
       而不是网站自己生成。

       所以这里不能 throw Error。
    ================================ */

    if (!plans.length) {
      currentPlan = null;

      currentExercises = [];

      completed = [];

      showWaitingForAIPlan(nextWorkoutNumber);

      setStatus("☁️ 数据库已连接，等待AI生成下一次训练计划", "ok");

      return;
    }

    /* ================================
       找到了AI生成的训练计划
    ================================ */

    currentPlan = plans[0];

    /* ================================
       读取动作
    ================================ */

    const exercises = await supabaseRequest(
      "training_plan_exercises" +
        "?select=*" +
        "&plan_id=eq." +
        currentPlan.id +
        "&order=exercise_order.asc",
    );

    currentExercises = exercises;

    completed = new Array(currentExercises.length).fill(false);

    /* ================================
       渲染训练计划
    ================================ */

    renderCurrentPlan();

    /* ================================
       更新状态
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


          <!-- 实际训练记录 -->

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
