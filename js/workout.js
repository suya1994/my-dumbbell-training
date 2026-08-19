/* ================================
   workout.js
   训练执行与保存模块
================================ */

/* ================================
   完成动作
================================ */

function toggleExercise(index) {
  completed[index] = !completed[index];

  const button = document.getElementById("exerciseBtn" + index);

  const actualBox = document.getElementById("actualBox" + index);

  if (button) {
    button.classList.toggle("done", completed[index]);
  }

  if (actualBox) {
    actualBox.classList.toggle("hidden", !completed[index]);
  }

  updateProgress();

  updateDailyAnalysis();
}

/* ================================
   训练进度
================================ */

function updateProgress() {
  const total = currentExercises.length;

  const count = completed.filter(Boolean).length;

  const percent = total ? Math.round((count / total) * 100) : 0;

  const bar = document.getElementById("progressBar");

  if (bar) {
    bar.style.width = percent + "%";
  }

  const text = document.getElementById("progressText");

  if (text) {
    text.textContent = `${count} / ${total} 个动作完成`;
  }
}

/* ================================
   保存训练
================================ */
/* ================================
   保存训练
================================ */

async function finishWorkout() {
  if (!currentPlan) {
    alert("训练计划还没有加载完成。");

    return;
  }

  const count = completed.filter(Boolean).length;

  if (count === 0) {
    alert("至少完成一个动作后再保存训练。");

    return;
  }

  const percent = Math.round((count / currentExercises.length) * 100);

  const difficulty = document.getElementById("difficulty").value;

  const note = document.getElementById("bodyNote").value;

  const button = document.getElementById("saveButton");

  button.disabled = true;

  button.textContent = "正在同步……";

  try {
    /* ================================
       保存本次训练
       
       当前首页是什么训练编号，
       就保存什么训练编号。
       
       不再覆盖今天已有的训练。
    ================================ */

    const workout = await supabaseRequest(
      "workouts",

      {
        method: "POST",

        body: {
          workout_number: currentPlan.workout_number,

          workout_date: todayString(),

          title: currentPlan.title,

          focus: currentPlan.focus,

          duration_minutes: currentPlan.duration_minutes,

          completion_percent: percent,

          difficulty: difficulty || null,

          body_note: note || null,
        },
      },
    );

    if (!workout || !workout.length) {
      throw new Error("训练保存成功，但没有返回训练记录。");
    }

    const workoutId = workout[0].id;

    /* ================================
       保存每个动作
    ================================ */

    for (let i = 0; i < currentExercises.length; i++) {
      const exercise = currentExercises[i];

      const actualSetsInput = document.getElementById("actualSets" + i);

      const actualRepsInput = document.getElementById("actualReps" + i);

      const actualWeightInput = document.getElementById("actualWeight" + i);

      const leftRepsInput = document.getElementById("leftReps" + i);

      const rightRepsInput = document.getElementById("rightReps" + i);

      /* ================================
         实际数据
      ================================ */

      const actualSets =
        actualSetsInput && actualSetsInput.value !== ""
          ? Number(actualSetsInput.value)
          : exercise.sets;

      const actualReps =
        actualRepsInput && actualRepsInput.value.trim() !== ""
          ? actualRepsInput.value.trim()
          : exercise.reps;

      const actualWeight =
        actualWeightInput && actualWeightInput.value !== ""
          ? Number(actualWeightInput.value)
          : exercise.weight_kg;

      const leftReps =
        leftRepsInput && leftRepsInput.value.trim() !== ""
          ? leftRepsInput.value.trim()
          : null;

      const rightReps =
        rightRepsInput && rightRepsInput.value.trim() !== ""
          ? rightRepsInput.value.trim()
          : null;

      /* ================================
         动作数据
      ================================ */

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

        actual_sets: actualSets,

        actual_reps: actualReps,

        actual_weight_kg: actualWeight,

        left_reps: leftReps,

        right_reps: rightReps,
      };

      await supabaseRequest(
        "exercises",

        {
          method: "POST",

          body: exerciseData,
        },
      );
    }

    /* ================================
       每日分析
       
       这里保留每日分析记录，
       但统计页面会直接根据 workouts
       重新计算。
    ================================ */

    const summary = generateDailySummary(percent);

    const existingAnalysis = await supabaseRequest(
      "daily_analysis" +
        "?select=*" +
        "&analysis_date=eq." +
        todayString() +
        "&limit=1",
    );

    if (existingAnalysis.length) {
      await supabaseRequest(
        "daily_analysis?id=eq." + existingAnalysis[0].id,

        {
          method: "PATCH",

          body: {
            completion_percent: percent,

            summary: summary,
          },
        },
      );
    } else {
      await supabaseRequest(
        "daily_analysis",

        {
          method: "POST",

          body: {
            analysis_date: todayString(),

            completion_percent: percent,

            summary: summary,
          },
        },
      );
    }

    /* ================================
       保存成功
    ================================ */

    alert("今天的训练已经保存。💪");

    setStatus("☁️ 已同步到云端", "ok");

    /* ================================
       重新读取历史
       
       这一步会刷新：
       每日
       每周
       每月
       总趋势
       历史
    ================================ */

    if (typeof loadHistory === "function") {
      await loadHistory();
    }

    /* ================================
       重新读取动作历史
    ================================ */

    if (typeof loadExerciseRecords === "function") {
      await loadExerciseRecords();
    }

    /* ================================
       加载下一次训练
       
       第7次保存成功
       → 首页变第8次
    ================================ */

    if (typeof loadCurrentPlan === "function") {
      await loadCurrentPlan();
    }
  } catch (error) {
    console.error(error);

    setStatus("⚠️ 保存失败：" + error.message, "error");

    alert("保存失败：\n" + error.message);
  }

  button.disabled = false;

  button.textContent = "保存今天训练";
}

/* ================================
   每日总结
================================ */

function generateDailySummary(percent) {
  if (percent === 100) {
    return "今日训练全部完成，完成度很好。";
  }

  if (percent >= 75) {
    return "今日大部分训练完成，继续优先保证动作质量。";
  }

  if (percent >= 50) {
    return "今日完成了一半以上训练，可以逐步提高完成度。";
  }

  return "今日训练完成度较低，暂时不要增加训练量。";
}

/* ================================
   每日总结
================================ */

function generateDailySummary(percent) {
  if (percent === 100) {
    return "今日训练全部完成，完成度很好。";
  }

  if (percent >= 75) {
    return "今日大部分训练完成，继续优先保证动作质量。";
  }

  if (percent >= 50) {
    return "今日完成了一半以上训练，可以逐步提高完成度。";
  }

  return "今日训练完成度较低，暂时不要增加训练量。";
}
