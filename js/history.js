/* ================================
   history.js
   独立历史记录页面

   负责：
   ① 力量训练历史
   ② 其它运动历史
   ③ 每日步数历史

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

   =========================================================

   重要：

   workouts 表：

   duration_minutes
   = 计划训练时间

   actual_duration_minutes
   = 实际完成训练时间

   历史页面显示训练时间时：

   优先显示 actual_duration_minutes
   如果旧数据没有 actual_duration_minutes，
   再回退显示 duration_minutes。

   =========================================================

   已彻底取消：

   workout_exercise_records
   的读取

   历史页面不再提供：

   - 查看动作详情
   - 查看动作完成情况
   - 查看动作难度
   - 查看动作组数 / 次数 / 重量
   - 动作记录数量

   删除 workouts 时：

   workouts
       ↓
   workout_exercise_records

   由数据库 ON DELETE CASCADE
   自动删除动作记录。

================================ */

/* =========================================================
   全局数据
========================================================= */

let historyWorkouts = [];

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
     现在只读取三类数据：

     ① 力量训练
     ② 其它运动
     ③ 每日步数

     不再读取：

     workout_exercise_records
  */

  await Promise.all([
    loadHistoryWorkouts(),
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
    /*
       直接读取 workouts 全部字段。

       其中包括：

       duration_minutes
       actual_duration_minutes

       历史页面会优先使用实际训练时间。
    */

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
   ② 其它运动
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
   ③ 每日步数
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
   获取历史训练实际时间
========================================================= */

/*
   时间显示规则：

   ① 有 actual_duration_minutes
      → 显示实际训练时间

   ② 没有实际训练时间
      → 回退到 duration_minutes

   这样可以兼容以前已经保存的训练记录。
*/

function getHistoryWorkoutDuration(record) {
  if (!record || typeof record !== "object") {
    return {
      minutes: null,
      isActual: false,
    };
  }

  /*
     优先读取实际训练时间。
  */

  const actual = Number(record.actual_duration_minutes);

  if (Number.isFinite(actual) && actual > 0) {
    return {
      minutes: actual,
      isActual: true,
    };
  }

  /*
     如果没有实际时间，
     回退到计划时间。
  */

  const planned = Number(record.duration_minutes);

  if (Number.isFinite(planned) && planned > 0) {
    return {
      minutes: planned,
      isActual: false,
    };
  }

  return {
    minutes: null,
    isActual: false,
  };
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

      /*
         =====================================================
         训练时间

         actual_duration_minutes
         ↓
         duration_minutes

         优先显示实际训练时间。
         =====================================================
      */

      const durationInfo = getHistoryWorkoutDuration(record);

      let durationText = "—";

      if (durationInfo.minutes !== null) {
        if (durationInfo.isActual) {
          durationText = `${historyEscapeHtml(durationInfo.minutes)} 分钟`;
        } else {
          /*
             旧记录没有实际训练时间，
             明确标记为计划时间。
          */

          durationText = `${historyEscapeHtml(durationInfo.minutes)} 分钟（计划）`;
        }
      }

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
            训练时间：${durationText}
          </div>

          <br>

          <button
            type="button"
            class="secondary-btn"
            onclick="handleDeleteWorkoutFromHistory('${historyEscapeHtml(
              workoutId,
            )}','${historyEscapeHtml(record.workout_number ?? "")}')"
          >
            🗑 删除这次训练
          </button>

        </div>
      `;
    })
    .join("");
}

/* =========================================================
   删除训练
========================================================= */

/*
   现在只删除：

   workouts

   数据库负责：

   workouts
       ↓
   workout_exercise_records

   ON DELETE CASCADE
   ↓
   自动删除动作记录

   因此这里不再：

   - 手动删除 workout_exercise_records
   - 查询 workout_exercise_records
   - 修改 historyExerciseRecords
*/

async function handleDeleteWorkoutFromHistory(workoutId, workoutNumber) {
  if (!workoutId) {
    alert("找不到这次训练的 ID。");

    return;
  }

  const displayNumber = workoutNumber
    ? `第 ${workoutNumber} 次训练`
    : "这次训练";

  const confirmed = confirm(
    `确定要删除「${displayNumber}」吗？\n\n` +
      `这会删除这次训练的实际记录。\n` +
      `对应的动作记录也会由数据库自动删除。\n\n` +
      `不会删除训练计划。`,
  );

  if (!confirmed) {
    return;
  }

  try {
    console.log("🗑 正在删除训练：", workoutId);

    /*
       只删除 workouts。

       workout_exercise_records
       由数据库 ON DELETE CASCADE 自动删除。
    */

    await supabaseRequest(`workouts?id=eq.${encodeURIComponent(workoutId)}`, {
      method: "DELETE",
    });

    /*
       更新本地力量训练数据。
    */

    historyWorkouts = historyWorkouts.filter(
      (record) => String(record.id) !== String(workoutId),
    );

    /*
       重新渲染力量训练历史。
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
