/* ================================
   workout.js
   训练执行与保存模块

   当前数据结构：

   training_plans
       ↓
   training_plan_exercises
       ↓
   workouts
       ↓
   workout_exercise_records

   已彻底取消 exercises 表。

   exercises_backup：
   仅作为数据库备份存在，
   本文件不读取、不写入、不删除。

   ------------------------------------------------

   数据职责：

   training_plans
   = AI 生成的训练计划

   training_plan_exercises
   = 某个训练计划具体有哪些动作

   workouts
   = 用户实际完成过的某一次训练

   workout_exercise_records
   = 用户实际完成这次训练时，
     每个动作的完成情况和难度

   ------------------------------------------------

   时间字段：

   training_plans.duration_minutes
   = AI 计划建议训练时间

   workouts.duration_minutes
   = 保存当次训练时，对应的计划建议时间

   workouts.actual_duration_minutes
   = 用户实际完成这次训练所花费的时间

   ------------------------------------------------

   动作状态：

   easy
   normal
   hard
   incomplete

   easy / normal / hard
   = completed = true

   incomplete
   = completed = false
================================ */

/* =========================================================
   设置动作难度
========================================================= */

/*
   用户点击：

   轻松
   正常
   吃力
   未完成

   保存到：

   exerciseDifficulty[index]

   同时同步：

   completed[index]
*/

function setExerciseDifficulty(index, difficulty) {
  /* =====================================================
     1. 检查动作编号
  ===================================================== */

  if (
    !Array.isArray(currentExercises) ||
    index < 0 ||
    index >= currentExercises.length
  ) {
    return;
  }

  /* =====================================================
     2. 只允许4种状态
  ===================================================== */

  const allowed = ["easy", "normal", "hard", "incomplete"];

  if (!allowed.includes(difficulty)) {
    return;
  }

  /* =====================================================
     3. 保存难度
  ===================================================== */

  exerciseDifficulty[index] = difficulty;

  /* =====================================================
     4. 同步完成状态

     easy
     normal
     hard
     → 已完成

     incomplete
     → 未完成
  ===================================================== */

  completed[index] = difficulty !== "incomplete";

  /* =====================================================
     5. 重新渲染当前训练

     主要作用：
     让按钮显示 selected 状态。
  ===================================================== */

  if (typeof renderCurrentPlan === "function") {
    renderCurrentPlan();
  }

  /* =====================================================
     6. 更新训练进度
  ===================================================== */

  updateProgress();
}

/* =========================================================
   更新训练进度
========================================================= */

function updateProgress() {
  const total = Array.isArray(currentExercises) ? currentExercises.length : 0;

  const count = Array.isArray(completed) ? completed.filter(Boolean).length : 0;

  const percent = total ? Math.round((count / total) * 100) : 0;

  /* =====================================================
     进度条
  ===================================================== */

  const bar = document.getElementById("progressBar");

  if (bar) {
    bar.style.width = percent + "%";
  }

  /* =====================================================
     进度文字
  ===================================================== */

  const text = document.getElementById("progressText");

  if (text) {
    text.textContent = `${count} / ${total} 个动作完成`;
  }
}

/* =========================================================
   获取还没有记录难度的动作
========================================================= */

/*
   返回动作下标：

   [0, 2, 4]

   表示第1、3、5个动作还没有选择：

   轻松 / 正常 / 吃力 / 未完成
*/

function getUnrecordedExercises() {
  const result = [];

  if (!Array.isArray(currentExercises)) {
    return result;
  }

  for (let i = 0; i < currentExercises.length; i++) {
    if (!exerciseDifficulty[i]) {
      result.push(i);
    }
  }

  return result;
}

/* =========================================================
   输入实际训练时间
========================================================= */

/*
   duration_minutes
   = 计划建议时间

   actual_duration_minutes
   = 用户实际完成时间

   这里不自动计时。

   用户点击保存训练时，
   手动输入本次实际训练用了多少分钟。

   默认值：
   当前训练计划的 duration_minutes。

   例如：

   计划时间：45分钟

   弹窗默认：
   45

   如果实际训练用了58分钟，
   用户修改为：

   58

   点击取消：
   不保存训练。

   点击确定：
   返回实际训练分钟数。
*/

function getActualDurationMinutes() {
  const plannedDuration = Number(currentPlan?.duration_minutes);

  const defaultDuration =
    Number.isFinite(plannedDuration) && plannedDuration > 0
      ? Math.round(plannedDuration)
      : 25;

  while (true) {
    const input = window.prompt(
      `请输入本次实际训练时间（分钟）：\n\n` +
        `计划建议时间：${defaultDuration} 分钟\n\n` +
        `请输入你这次实际训练用了多少分钟。`,
      String(defaultDuration),
    );

    /* =====================================================
       用户点击取消
    ===================================================== */

    if (input === null) {
      return null;
    }

    const value = Number(String(input).trim());

    /* =====================================================
       必须是正整数
    ===================================================== */

    if (Number.isInteger(value) && value > 0) {
      return value;
    }

    alert("请输入有效的实际训练时间，例如：45、52、60。");
  }
}

/* =========================================================
   删除某次旧训练

   重要：

   现在不再手动删除
   workout_exercise_records。

   因为数据库已经设置：

   workout_exercise_records.workout_id
   ↓
   workouts.id
   ON DELETE CASCADE

   所以：

   删除 workouts
        ↓
   数据库自动删除
   workout_exercise_records

   不需要 JavaScript 再删除一次。
========================================================= */

async function deleteWorkout(workoutId) {
  if (!workoutId) {
    return;
  }

  await supabaseRequest(`workouts?id=eq.${workoutId}`, {
    method: "DELETE",
  });
}

/* =========================================================
   用户手动删除某次训练
========================================================= */

/*
   只删除：

   workouts

   数据库自动级联删除：

   workout_exercise_records

   不删除：

   training_plans
   training_plan_exercises

   因为训练计划属于“计划”，
   实际训练属于“历史记录”。

   删除一次实际训练，
   不应该把 AI 训练计划也删除。
*/

async function handleDeleteWorkout(workoutId, workoutNumber) {
  if (!workoutId) {
    return;
  }

  /* =====================================================
     确认删除
  ===================================================== */

  const confirmed = confirm(
    `确定要删除第${workoutNumber}次训练吗？\n\n` +
      `这会删除这次训练的实际完成记录，` +
      `但不会删除训练计划。`,
  );

  if (!confirmed) {
    return;
  }

  try {
    /* ===================================================
       1. 删除 workouts

       workout_exercise_records
       会由数据库 CASCADE 自动删除。
    =================================================== */

    await deleteWorkout(workoutId);

    /* ===================================================
       2. 确认 workouts 已经删除
    =================================================== */

    const remaining = await supabaseRequest(
      `workouts?id=eq.${workoutId}&select=id`,
      {
        method: "GET",
      },
    );

    if (remaining && remaining.length) {
      throw new Error("训练记录删除后仍然存在，请检查 Supabase DELETE 权限。");
    }

    /* ===================================================
       3. 刷新训练历史
    =================================================== */

    if (typeof loadHistory === "function") {
      await loadHistory();
    }

    /* ===================================================
       4. 重新读取动作历史

       如果 history.js 中存在这个函数，
       一并刷新。
    =================================================== */

    if (typeof loadExerciseRecords === "function") {
      await loadExerciseRecords();
    }

    /* ===================================================
       5. 重新计算首页当前训练

       例如：

       原来：

       第7次
       第8次
       第9次

       删除第9次

       ↓

       最新保存 = 第8次

       ↓

       首页重新显示第9次
    =================================================== */

    if (typeof loadCurrentPlan === "function") {
      await loadCurrentPlan();
    }

    /* ===================================================
       6. 提示
    =================================================== */

    alert(`第${workoutNumber}次训练已经删除。`);
  } catch (error) {
    console.error("删除训练失败：", error);

    alert(
      `第${workoutNumber}次训练删除失败：\n\n` +
        (error.message || String(error)),
    );
  }
}

/* =========================================================
   获取同一个训练编号的旧记录
========================================================= */

/*
   例如：

   workout_number = 8

   如果数据库中已经存在：

   第8次旧记录

   就返回。

   保存新第8次成功以后，
   再删除旧第8次。

   这样可以避免：

   先删旧数据
   ↓
   新数据保存失败
   ↓
   第8次训练彻底丢失

   现在采用：

   新建
   ↓
   保存动作
   ↓
   全部成功
   ↓
   删除旧版本
========================================================= */

async function getOldWorkouts(workoutNumber) {
  if (workoutNumber === null || workoutNumber === undefined) {
    return [];
  }

  const result = await supabaseRequest(
    "workouts" +
      `?workout_number=eq.${workoutNumber}` +
      "&select=id,workout_number,created_at" +
      "&order=created_at.desc",
    {
      method: "GET",
    },
  );

  return Array.isArray(result) ? result : [];
}

/* =========================================================
   保存训练
========================================================= */

async function finishWorkout() {
  /* =====================================================
     1. 检查当前训练计划
  ===================================================== */

  if (!currentPlan) {
    alert("训练计划还没有加载完成。");

    return;
  }

  /* =====================================================
     2. 检查动作
  ===================================================== */

  if (!Array.isArray(currentExercises) || currentExercises.length === 0) {
    alert("当前训练没有动作，无法保存。");

    return;
  }

  /* =====================================================
     3. 检查是否所有动作都已经记录
  ===================================================== */

  const unrecorded = getUnrecordedExercises();

  if (unrecorded.length > 0) {
    const names = unrecorded
      .map((index) => {
        const exercise = currentExercises[index];

        return `${index + 1}. ` + (exercise.exercise_name || "未知动作");
      })
      .join("\n");

    const confirmed = confirm(
      `还有 ${unrecorded.length} 个动作没有记录：\n\n` +
        names +
        `\n\n` +
        `点击“确定”将这些动作记为「未完成」。\n` +
        `点击“取消”返回继续记录。`,
    );

    if (!confirmed) {
      return;
    }

    /* ===================================================
       没有选择状态的动作：

       自动设置为 incomplete
    =================================================== */

    for (let i = 0; i < currentExercises.length; i++) {
      if (!exerciseDifficulty[i]) {
        exerciseDifficulty[i] = "incomplete";

        completed[i] = false;
      }
    }

    /* ===================================================
       更新页面
    =================================================== */

    if (typeof renderCurrentPlan === "function") {
      renderCurrentPlan();
    }

    updateProgress();
  }

  /* =====================================================
     4. 至少完成一个动作
  ===================================================== */

  const count = completed.filter(Boolean).length;

  if (count === 0) {
    alert("今天没有完成任何动作，暂时不保存这次训练。");

    return;
  }

  /* =====================================================
     5. 计算完成度
  ===================================================== */

  const percent = Math.round((count / currentExercises.length) * 100);

  /* =====================================================
     6. 读取训练感受
  ===================================================== */

  const note = document.getElementById("bodyNote")?.value.trim() || null;

  /* =====================================================
     7. 输入实际训练时间

     注意：

     这里使用 actual_duration_minutes。

     不再把计划时间直接当成实际训练时间。

     用户取消：
     → 整个保存流程停止。
  ===================================================== */

  const actualDurationMinutes = getActualDurationMinutes();

  if (actualDurationMinutes === null) {
    return;
  }

  /* =====================================================
     8. 禁用保存按钮
  ===================================================== */

  const button = document.getElementById("saveButton");

  if (button) {
    button.disabled = true;
    button.textContent = "正在同步……";
  }

  /* =====================================================
     9. 保存过程中记录新建的 workout ID

     如果后续动作保存失败，
     可以清理这个半成品。
  ===================================================== */

  let newWorkoutId = null;

  try {
    /* ===================================================
       10. 查询同一个训练编号的旧记录
    =================================================== */

    const oldWorkouts = await getOldWorkouts(currentPlan.workout_number);

    /* ===================================================
       11. 创建新的 workouts

       注意：

       duration_minutes
       = 计划建议时间

       actual_duration_minutes
       = 用户实际输入的训练时间

       两者不再混用。
    =================================================== */

    const plannedDuration = Number(currentPlan.duration_minutes);

    const workout = await supabaseRequest("workouts", {
      method: "POST",

      body: {
        workout_number: currentPlan.workout_number,

        workout_date: todayString(),

        title: currentPlan.title || "",

        focus: currentPlan.focus || "",

        duration_minutes:
          Number.isFinite(plannedDuration) && plannedDuration > 0
            ? Math.round(plannedDuration)
            : 25,

        actual_duration_minutes: actualDurationMinutes,

        completion_percent: percent,

        body_note: note,
      },
    });

    /* ===================================================
       12. 检查 workouts 创建结果
    =================================================== */

    if (!workout || !workout.length || !workout[0].id) {
      throw new Error("训练保存成功，但没有返回训练记录。");
    }

    newWorkoutId = workout[0].id;

    /* ===================================================
       13. 保存本次所有动作记录
    =================================================== */

    for (let i = 0; i < currentExercises.length; i++) {
      const exercise = currentExercises[i];

      const selectedDifficulty = exerciseDifficulty[i];

      /* =================================================
         最终安全校验

         incomplete
         → false

         easy / normal / hard
         → true
      ================================================= */

      if (
        !["easy", "normal", "hard", "incomplete"].includes(selectedDifficulty)
      ) {
        throw new Error(`第${i + 1}个动作的完成状态无效。`);
      }

      const isCompleted = selectedDifficulty !== "incomplete";

      /* =================================================
         这里只保存实际训练记录：

         workout_exercise_records

         plan_exercise_id
         指向：

         training_plan_exercises.id
      ================================================= */

      const exerciseRecord = {
        workout_id: newWorkoutId,

        workout_number: currentPlan.workout_number,

        plan_exercise_id: exercise.id,

        completed: isCompleted,

        difficulty: selectedDifficulty,
      };

      await supabaseRequest("workout_exercise_records", {
        method: "POST",

        body: exerciseRecord,
      });
    }

    /* ===================================================
       14. 新训练 + 所有动作都保存成功

       现在才删除旧版本。

       旧：

       workouts
       ↓
       workout_exercise_records

       删除 workouts 时：

       workout_exercise_records
       会由数据库 CASCADE 自动删除。
    =================================================== */

    for (const oldWorkout of oldWorkouts) {
      /* =================================================
         防止误删刚刚创建的新记录
      ================================================= */

      if (oldWorkout.id === newWorkoutId) {
        continue;
      }

      await deleteWorkout(oldWorkout.id);
    }

    /* ===================================================
       15. 保存成功
    =================================================== */

    alert(
      `今天的训练已经保存。💪\n\n` +
        `计划时间：${Number.isFinite(plannedDuration) && plannedDuration > 0 ? Math.round(plannedDuration) : 25} 分钟\n` +
        `实际时间：${actualDurationMinutes} 分钟`,
    );

    if (typeof setStatus === "function") {
      setStatus("☁️ 已同步到云端", "ok");
    }

    /* ===================================================
       16. 刷新训练历史
    =================================================== */

    if (typeof loadHistory === "function") {
      await loadHistory();
    }

    /* ===================================================
       17. 刷新动作历史
    =================================================== */

    if (typeof loadExerciseRecords === "function") {
      await loadExerciseRecords();
    }

    /* ===================================================
       18. 重新读取当前训练

       例如：

       第8次保存

       ↓

       getLatestSavedWorkoutNumber()
       = 8

       ↓

       getCurrentWorkoutNumber()
       = 9

       ↓

       首页进入第9次。
    =================================================== */

    if (typeof loadCurrentPlan === "function") {
      await loadCurrentPlan();
    }
  } catch (error) {
    /* ===================================================
       保存失败
    =================================================== */

    console.error("保存训练失败：", error);

    /* ===================================================
       如果已经创建 workouts，
       但后续动作保存失败：

       删除这个半成品 workouts。

       因为：

       workouts
       ↓
       workout_exercise_records

       CASCADE 会自动删除已经成功写进去的
       workout_exercise_records。
    =================================================== */

    if (newWorkoutId) {
      try {
        await deleteWorkout(newWorkoutId);
      } catch (cleanupError) {
        console.error("清理失败的训练记录时发生错误：", cleanupError);
      }
    }

    if (typeof setStatus === "function") {
      setStatus("⚠️ 保存失败：" + (error.message || String(error)), "error");
    }

    alert(
      "保存失败：\n" +
        (error.message || String(error)) +
        "\n\n" +
        "本次未完成的训练数据已尝试清理。",
    );
  }

  /* =====================================================
     19. 恢复保存按钮
  ===================================================== */

  if (button) {
    button.disabled = false;

    button.textContent = "保存今天训练";
  }
}
