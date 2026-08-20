/* ================================
   workout.js
   训练执行与保存模块
================================ */

/* ================================
   设置动作难度

   由 plan.js 调用

   easy
   normal
   hard
   incomplete
================================ */

function setExerciseDifficulty(index, difficulty) {
  /* ================================
     检查动作编号
  ================================= */

  if (index < 0 || index >= currentExercises.length) {
    return;
  }

  /* ================================
     只允许这4种状态
  ================================= */

  const allowed = ["easy", "normal", "hard", "incomplete"];

  if (!allowed.includes(difficulty)) {
    return;
  }

  /* ================================
     保存动作难度
  ================================= */

  exerciseDifficulty[index] = difficulty;

  /* ================================
     更新完成状态

     轻松 / 正常 / 吃力
     = 动作完成

     未完成
     = 动作没有完成
  ================================= */

  if (difficulty === "incomplete") {
    completed[index] = false;
  } else {
    completed[index] = true;
  }

  /* ================================
     重新渲染

     让按钮立即显示选中状态
  ================================= */

  renderCurrentPlan();

  /* ================================
     更新训练进度
  ================================= */

  updateProgress();
}

/* ================================
   训练进度
================================ */

function updateProgress() {
  const total = currentExercises.length;

  const count = completed.filter(Boolean).length;

  const percent = total ? Math.round((count / total) * 100) : 0;

  /* ================================
     更新进度条
  ================================= */

  const bar = document.getElementById("progressBar");

  if (bar) {
    bar.style.width = percent + "%";
  }

  /* ================================
     更新进度文字
  ================================= */

  const text = document.getElementById("progressText");

  if (text) {
    text.textContent = `${count} / ${total} 个动作完成`;
  }
}

/* ================================
   检查是否还有动作没有记录
================================ */

function getUnrecordedExercises() {
  const result = [];

  for (let i = 0; i < currentExercises.length; i++) {
    if (!exerciseDifficulty[i]) {
      result.push(i);
    }
  }

  return result;
}

/* ================================
   保存训练
================================ */

async function finishWorkout() {
  /* ================================
     检查训练计划
  ================================= */

  if (!currentPlan) {
    alert("训练计划还没有加载完成。");

    return;
  }

  /* ================================
     检查动作是否全部有记录
  ================================= */

  const unrecorded = getUnrecordedExercises();

  if (unrecorded.length > 0) {
    const names = unrecorded
      .map((index) => `${index + 1}. ${currentExercises[index].exercise_name}`)
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

    /* ================================
       未选择的动作
       自动记为未完成
    ================================= */

    for (let i = 0; i < currentExercises.length; i++) {
      if (!exerciseDifficulty[i]) {
        exerciseDifficulty[i] = "incomplete";

        completed[i] = false;
      }
    }

    renderCurrentPlan();

    updateProgress();
  }

  /* ================================
     至少完成一个动作

     如果所有动作都是
     「未完成」，
     不保存本次训练。
  ================================= */

  const count = completed.filter(Boolean).length;

  if (count === 0) {
    alert("今天没有完成任何动作，暂时不保存这次训练。");

    return;
  }

  /* ================================
     计算完成度
  ================================= */

  const percent = Math.round((count / currentExercises.length) * 100);

  /* ================================
     读取训练感受
  ================================= */

  const note = document.getElementById("bodyNote")?.value.trim() || null;

  /* ================================
     保存按钮
  ================================= */

  const button = document.getElementById("saveButton");

  if (button) {
    button.disabled = true;

    button.textContent = "正在同步……";
  }

  try {
    /* ================================
       保存本次训练
    ================================= */

    const workout = await supabaseRequest("workouts", {
      method: "POST",

      body: {
        workout_number: currentPlan.workout_number,

        workout_date: todayString(),

        title: currentPlan.title,

        focus: currentPlan.focus,

        duration_minutes: currentPlan.duration_minutes,

        completion_percent: percent,

        /*
              不再保存整体 difficulty。

              难度现在按动作记录，
              保存在 exercises.difficulty。
            */

        body_note: note,
      },
    });

    if (!workout || !workout.length) {
      throw new Error("训练保存成功，但没有返回训练记录。");
    }

    const workoutId = workout[0].id;

    /* ================================
       保存每个动作
    ================================= */

    for (let i = 0; i < currentExercises.length; i++) {
      const exercise = currentExercises[i];

      const selectedDifficulty = exerciseDifficulty[i];

      /* ================================
         动作数据

         difficulty：

         easy
         normal
         hard
         incomplete
      ================================= */

      const exerciseData = {
        workout_id: workoutId,

        plan_exercise_id: exercise.id,

        exercise_order: exercise.exercise_order,

        exercise_name: exercise.exercise_name,

        equipment: exercise.equipment,

        weight_kg: exercise.weight_kg,

        reps: exercise.reps,

        sets: exercise.sets,

        notes: exercise.notes,

        completed: completed[i],

        difficulty: selectedDifficulty,
      };

      await supabaseRequest("exercises", {
        method: "POST",

        body: exerciseData,
      });
    }

    /* ================================
       保存成功
    ================================= */

    alert("今天的训练已经保存。💪");

    setStatus("☁️ 已同步到云端", "ok");

    /* ================================
       重新读取训练历史
    ================================= */

    if (typeof loadHistory === "function") {
      await loadHistory();
    }

    /* ================================
       重新读取动作历史
    ================================= */

    if (typeof loadExerciseRecords === "function") {
      await loadExerciseRecords();
    }

    /* ================================
       加载下一次训练

       例如：

       第6次完成
       ↓
       首页进入第7次
    ================================= */

    if (typeof loadCurrentPlan === "function") {
      await loadCurrentPlan();
    }
  } catch (error) {
    console.error(error);

    setStatus("⚠️ 保存失败：" + error.message, "error");

    alert("保存失败：\n" + error.message);
  }

  /* ================================
     恢复保存按钮
  ================================= */

  if (button) {
    button.disabled = false;

    button.textContent = "保存今天训练";
  }
}
