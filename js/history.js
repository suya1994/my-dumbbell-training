/* ================================
   history.js
   独立历史记录页面

   负责：
   ① 力量训练历史
   ② 力量训练动作详情
   ③ 其它运动历史
   ④ 每日步数历史

   本文件完全独立于：
   app.js
   analysis.js
   workout.js
   plan.js
   metrics.js
   ai-plan.js

   唯一依赖：
   config.js
   api.js
================================ */

/* =========================================================
   全局数据
========================================================= */

let historyWorkouts = [];

let historyExerciseRecords = [];

let historyOtherActivities = [];

let historyDailySteps = [];

/* =========================================================
   DOM 工具
========================================================= */

function historySetText(id, text) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = text;
  }
}

/* =========================================================
   安全显示 HTML
========================================================= */

function historyEscapeHtml(text) {
  const div = document.createElement("div");

  div.textContent = text ?? "";

  return div.innerHTML;
}

/* =========================================================
   日期
========================================================= */

function historyTodayString() {
  const now = new Date();

  const year = now.getFullYear();

  const month = String(now.getMonth() + 1).padStart(2, "0");

  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/* =========================================================
   页面顶部日期
========================================================= */

function updateHistoryToday() {
  const todayBox = document.getElementById("today");

  if (!todayBox) {
    return;
  }

  todayBox.textContent = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

/* =========================================================
   History 分类切换
========================================================= */

function showHistorySection(sectionId, button) {
  const sections = document.querySelectorAll(".history-section");

  sections.forEach((section) => {
    section.classList.add("hidden");
  });

  const target = document.getElementById(sectionId);

  if (target) {
    target.classList.remove("hidden");
  }

  const buttons = document.querySelectorAll(".history-nav button");

  buttons.forEach((item) => {
    item.classList.remove("active");
  });

  if (button) {
    button.classList.add("active");
  }
}

/* =========================================================
   读取全部历史数据
========================================================= */

async function loadHistoryPage() {
  console.log("📚 开始读取历史数据……");

  /*
     三类数据并行读取。
  */

  await Promise.all([
    loadHistoryWorkouts(),
    loadHistoryExerciseRecords(),
    loadHistoryOtherActivities(),
    loadHistoryDailySteps(),
  ]);

  /*
     数据全部完成之后统一渲染。
  */

  renderWorkoutHistory();

  renderOtherActivityHistory();

  renderDailyStepsHistory();

  console.log("✅ 历史页面数据读取完成");
}

/* =========================================================
   ① 力量训练
========================================================= */

async function loadHistoryWorkouts() {
  try {
    const data = await supabaseRequest(
      "workouts" + "?select=*" + "&order=workout_date.desc,workout_number.desc",
    );

    historyWorkouts = Array.isArray(data) ? data : [];

    console.log("🏋️ 力量训练历史读取成功：", historyWorkouts.length, "条");
  } catch (error) {
    console.error("❌ 力量训练历史读取失败：", error);

    historyWorkouts = [];
  }
}

/* =========================================================
   ② 动作历史
========================================================= */

async function loadHistoryExerciseRecords() {
  try {
    /*
       这里读取每个训练中的动作完成记录。

       同时通过 workouts 关联获取：
       workout_number
       workout_date
    */

    const data = await supabaseRequest(
      "workout_exercise_records" +
        "?select=*,workouts(workout_number,workout_date)" +
        "&order=id.asc",
    );

    historyExerciseRecords = Array.isArray(data)
      ? data.map((exercise) => {
          return {
            ...exercise,

            workout_number: exercise.workouts?.workout_number ?? null,

            workout_date: exercise.workouts?.workout_date ?? null,
          };
        })
      : [];

    console.log("💪 动作历史读取成功：", historyExerciseRecords.length, "条");
  } catch (error) {
    console.error("❌ 动作历史读取失败：", error);

    historyExerciseRecords = [];
  }
}

/* =========================================================
   ③ 其它运动
========================================================= */

async function loadHistoryOtherActivities() {
  try {
    const data = await supabaseRequest(
      "other_activities" + "?select=*" + "&order=activity_date.desc,id.desc",
    );

    historyOtherActivities = Array.isArray(data) ? data : [];

    console.log(
      "🏃 其它运动历史读取成功：",
      historyOtherActivities.length,
      "条",
    );
  } catch (error) {
    console.error("❌ 其它运动历史读取失败：", error);

    historyOtherActivities = [];
  }
}

/* =========================================================
   ④ 每日步数
========================================================= */

async function loadHistoryDailySteps() {
  try {
    const data = await supabaseRequest(
      "daily_steps" + "?select=*" + "&order=record_date.desc",
    );

    historyDailySteps = Array.isArray(data) ? data : [];

    console.log("👟 步数历史读取成功：", historyDailySteps.length, "条");
  } catch (error) {
    console.error("❌ 步数历史读取失败：", error);

    historyDailySteps = [];
  }
}

/* =========================================================
   力量训练历史
========================================================= */

function renderWorkoutHistory() {
  const historyBox = document.getElementById("historyList");

  if (!historyBox) {
    return;
  }

  if (!historyWorkouts.length) {
    historyBox.innerHTML = `
      <div class="muted">
        目前还没有力量训练记录。
      </div>
    `;

    return;
  }

  historyBox.innerHTML = historyWorkouts
    .map((record) => {
      const workoutId = String(record.id ?? "");

      const workoutNumber =
        record.workout_number !== null && record.workout_number !== undefined
          ? `第 ${historyEscapeHtml(record.workout_number)} 次训练`
          : "力量训练";

      const title = historyEscapeHtml(record.title || "哑铃力量训练");

      const date = historyEscapeHtml(record.workout_date || "");

      const completion =
        record.completion_percent !== null &&
        record.completion_percent !== undefined
          ? `${historyEscapeHtml(record.completion_percent)}%`
          : "—";

      const duration =
        record.duration_minutes !== null &&
        record.duration_minutes !== undefined &&
        record.duration_minutes !== ""
          ? `${historyEscapeHtml(record.duration_minutes)} 分钟`
          : "—";

      /*
         判断这次训练是否有动作记录。
      */

      const exerciseCount = historyExerciseRecords.filter((exercise) => {
        return String(exercise.workout_id) === workoutId;
      }).length;

      return `
        <div class="history-item">

          <div class="history-title">
            ${title}
          </div>

          <div class="muted">
            ${workoutNumber}
          </div>

          <div class="muted">
            📅 ${date}
          </div>

          <div class="muted">
            完成度：${completion}
          </div>

          <div class="muted">
            训练时间：${duration}
          </div>

          <div class="muted">
            动作记录：${exerciseCount} 个
          </div>

          <br>

          <button
            type="button"
            class="secondary-btn"
            onclick="toggleWorkoutDetails('${historyEscapeHtml(workoutId)}')"
          >
            📋 查看动作详情
          </button>

          <button
            type="button"
            class="secondary-btn"
            onclick="handleDeleteWorkoutFromHistory('${historyEscapeHtml(workoutId)}','${historyEscapeHtml(record.workout_number ?? "")}')"
          >
            🗑 删除这次训练
          </button>

          <div
            id="workoutDetails-${historyEscapeHtml(workoutId)}"
            class="history-details hidden"
          ></div>

        </div>
      `;
    })
    .join("");
}

/* =========================================================
   查看 / 隐藏某次训练的动作详情
========================================================= */

function toggleWorkoutDetails(workoutId) {
  const box = document.getElementById(`workoutDetails-${workoutId}`);

  if (!box) {
    return;
  }

  /*
     如果已经显示，则隐藏。
  */

  if (!box.classList.contains("hidden")) {
    box.classList.add("hidden");

    return;
  }

  /*
     找到该训练的动作记录。
  */

  const exercises = historyExerciseRecords.filter((exercise) => {
    return String(exercise.workout_id) === String(workoutId);
  });

  if (!exercises.length) {
    box.innerHTML = `
      <div class="analysis">
        <div class="muted">
          这次训练没有动作详细记录。
        </div>
      </div>
    `;

    box.classList.remove("hidden");

    return;
  }

  box.innerHTML = `
    <div class="analysis">

      <strong>
        💪 本次训练动作
      </strong>

      <br>
      <br>

      ${exercises
        .map((exercise, index) => {
          return renderExerciseHistoryItem(exercise, index);
        })
        .join("")}

    </div>
  `;

  box.classList.remove("hidden");
}

/* =========================================================
   单个动作历史
========================================================= */

function renderExerciseHistoryItem(exercise, index) {
  /*
     不假定数据库一定存在某一个固定字段。

     根据目前系统常见字段依次尝试：

     exercise_name
     name
     title

     训练感受：

     difficulty
     feeling
     training_feel

     完成：

     completed
     completion_percent

     其它字段统一作为补充信息。
  */

  const name =
    exercise.exercise_name ||
    exercise.name ||
    exercise.title ||
    `动作 ${index + 1}`;

  const difficulty =
    exercise.difficulty ||
    exercise.feeling ||
    exercise.training_feel ||
    exercise.training_difficulty ||
    "";

  let completedText = "";

  if (exercise.completed === true) {
    completedText = "已完成";
  } else if (exercise.completed === false) {
    completedText = "未完成";
  } else if (
    exercise.completion_percent !== null &&
    exercise.completion_percent !== undefined
  ) {
    completedText = `完成度：${exercise.completion_percent}%`;
  }

  /*
     尝试显示训练次数 / 组数。
  */

  const reps = exercise.reps ?? exercise.completed_reps ?? null;

  const sets = exercise.sets ?? exercise.completed_sets ?? null;

  const weight = exercise.weight ?? exercise.weight_kg ?? null;

  const details = [];

  if (sets !== null && sets !== "") {
    details.push(`${sets} 组`);
  }

  if (reps !== null && reps !== "") {
    details.push(`${reps} 次`);
  }

  if (weight !== null && weight !== "") {
    details.push(`${weight} kg`);
  }

  return `
    <div
      style="
        padding:12px 0;
        border-bottom:1px solid rgba(0,0,0,0.06);
      "
    >

      <strong>
        ${historyEscapeHtml(name)}
      </strong>

      ${
        details.length
          ? `
            <div class="muted">
              ${details.map((item) => historyEscapeHtml(item)).join(" × ")}
            </div>
          `
          : ""
      }

      ${
        completedText
          ? `
            <div class="muted">
              ${historyEscapeHtml(completedText)}
            </div>
          `
          : ""
      }

      ${
        difficulty
          ? `
            <div class="muted">
              训练难度：
              ${historyEscapeHtml(difficulty)}
            </div>
          `
          : ""
      }

      ${
        exercise.note
          ? `
            <div class="muted">
              备注：
              ${historyEscapeHtml(exercise.note)}
            </div>
          `
          : ""
      }

    </div>
  `;
}

/* =========================================================
   删除训练
========================================================= */

async function handleDeleteWorkoutFromHistory(workoutId, workoutNumber) {
  if (!workoutId) {
    alert("找不到这次训练的 ID。");

    return;
  }

  const displayNumber = workoutNumber
    ? `第 ${workoutNumber} 次训练`
    : "这次训练";

  const confirmed = confirm(
    `确定要删除「${displayNumber}」吗？\n\n这会删除这次训练及其动作记录。`,
  );

  if (!confirmed) {
    return;
  }

  try {
    console.log("🗑 正在删除训练：", workoutId);

    /*
       先删除动作记录。

       如果数据库已经设置 ON DELETE CASCADE，
       即使这里没有记录也不会影响。
    */

    try {
      await supabaseRequest(
        `workout_exercise_records?workout_id=eq.${encodeURIComponent(
          workoutId,
        )}`,
        {
          method: "DELETE",
        },
      );
    } catch (exerciseError) {
      console.warn("⚠️ 删除动作记录失败：", exerciseError);
    }

    /*
       再删除 workouts。
    */

    await supabaseRequest(`workouts?id=eq.${encodeURIComponent(workoutId)}`, {
      method: "DELETE",
    });

    /*
       更新本地数据。
    */

    historyWorkouts = historyWorkouts.filter(
      (record) => String(record.id) !== String(workoutId),
    );

    historyExerciseRecords = historyExerciseRecords.filter(
      (exercise) => String(exercise.workout_id) !== String(workoutId),
    );

    /*
       重新渲染。
    */

    renderWorkoutHistory();

    alert("训练记录已删除。");
  } catch (error) {
    console.error("❌ 删除训练失败：", error);

    alert("删除失败，请检查数据库权限或网络连接。");
  }
}

/* =========================================================
   其它运动历史
========================================================= */

function renderOtherActivityHistory() {
  const box = document.getElementById("otherActivityList");

  if (!box) {
    return;
  }

  if (!historyOtherActivities.length) {
    box.innerHTML = `
      <div class="muted">
        目前还没有其它运动记录。
      </div>
    `;

    return;
  }

  box.innerHTML = historyOtherActivities
    .map((activity) => {
      const date = activity.activity_date || "";

      const type = activity.activity_type || activity.type || "其它";

      const minutes = Number(activity.duration_minutes) || 0;

      return `
          <div class="history-item">

            <div class="history-title">
              🏃 ${historyEscapeHtml(type)}
            </div>

            <div class="muted">
              📅 ${historyEscapeHtml(date)}
            </div>

            <div class="muted">
              运动时间：
              ${minutes} 分钟
            </div>

          </div>
        `;
    })
    .join("");
}

/* =========================================================
   步数历史
========================================================= */

function renderDailyStepsHistory() {
  const box = document.getElementById("dailyStepsHistory");

  if (!box) {
    return;
  }

  if (!historyDailySteps.length) {
    box.innerHTML = `
      <div class="muted">
        目前还没有步数记录。
      </div>
    `;

    return;
  }

  box.innerHTML = historyDailySteps
    .map((record) => {
      const date = record.record_date || "";

      const steps = Number(record.steps) || 0;

      return `
          <div class="history-item">

            <div class="history-title">
              👟 ${steps.toLocaleString()} 步
            </div>

            <div class="muted">
              📅 ${historyEscapeHtml(date)}
            </div>

          </div>
        `;
    })
    .join("");
}

/* =========================================================
   页面初始化
========================================================= */

document.addEventListener("DOMContentLoaded", async function () {
  console.log("📚 History 页面初始化……");

  updateHistoryToday();

  /*
       默认显示力量训练。
    */

  const firstButton = document.querySelector(".history-nav button");

  if (firstButton) {
    firstButton.classList.add("active");
  }

  /*
       加载全部历史数据。
    */

  await loadHistoryPage();

  console.log("✅ History 页面初始化完成");
});
