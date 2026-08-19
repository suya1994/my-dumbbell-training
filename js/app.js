/* ================================
   app.js
   页面状态、Tab切换、安全显示
   + 训练历史读取
   + 动作历史读取
================================ */

/* ================================
   状态
================================ */

function setStatus(text, type = "") {
  const box = document.getElementById("connectionStatus");

  if (!box) {
    return;
  }

  box.textContent = text;

  box.className = "status " + type;
}

/* ================================
   日期
================================ */

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

const todayBox = document.getElementById("today");

if (todayBox) {
  todayBox.textContent = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

/* ================================
   Tab 切换
================================ */
function showTab(id, button) {
  console.log("正在切换 Tab：", id);

  /* ========================================
     隐藏所有页面
     
     注意：
     现在已经包含 AI Tab
  ======================================== */

  document
    .querySelectorAll(
      "#todayTab,#dailyTab,#weeklyTab,#monthlyTab,#trendTab,#historyTab,#metricsTab,#aiTab",
    )
    .forEach((section) => {
      section.classList.add("hidden");
    });

  /* ========================================
     显示目标页面
  ======================================== */

  const target = document.getElementById(id);

  if (!target) {
    console.error("找不到 Tab 页面：", id);
    return;
  }

  target.classList.remove("hidden");

  /* ========================================
     更新按钮状态
  ======================================== */

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.remove("active");
  });

  if (button) {
    button.classList.add("active");
  }

  /* ========================================
     每日
  ======================================== */

  if (id === "dailyTab") {
    if (typeof updateTodayStats === "function") {
      updateTodayStats();
    }

    if (typeof updateDailyAnalysis === "function") {
      updateDailyAnalysis();
    }
  }

  /* ========================================
     每周
  ======================================== */

  if (id === "weeklyTab") {
    if (typeof updateWeeklyAnalysis === "function") {
      updateWeeklyAnalysis();
    }
  }

  /* ========================================
     每月
  ======================================== */

  if (id === "monthlyTab") {
    if (typeof updateMonthlyAnalysis === "function") {
      updateMonthlyAnalysis();
    }
  }

  /* ========================================
     总趋势
  ======================================== */

  if (id === "trendTab") {
    if (typeof updateTrendAnalysis === "function") {
      updateTrendAnalysis();
    }

    if (typeof updateExerciseProgressAnalysis === "function") {
      updateExerciseProgressAnalysis();
    }
  }

  /* ========================================
     AI教练
     
     目前不需要额外执行任何函数。
     AI功能由 ai-plan.js 中的按钮控制。
  ======================================== */

  if (id === "aiTab") {
    console.log("已进入 AI私人教练 Tab");
  }

  console.log("Tab 切换完成：", id);
}

/* ================================
   安全显示文字
================================ */

function escapeHtml(text) {
  const div = document.createElement("div");

  div.textContent = text || "";

  return div.innerHTML;
}

/* ================================
   今日统计
   从数据库训练历史计算
================================ */

function updateTodayStats() {
  const today = todayString();

  const todayRecords = records.filter(
    (record) => record.workout_date === today,
  );

  if (!todayRecords.length) {
    const completionBox = document.getElementById("dailyCompletion");

    const minutesBox = document.getElementById("dailyMinutes");

    const exercisesBox = document.getElementById("dailyExercises");

    if (completionBox) {
      completionBox.textContent = "0%";
    }

    if (minutesBox) {
      minutesBox.textContent = "0";
    }

    if (exercisesBox) {
      exercisesBox.textContent = "0";
    }

    return;
  }

  /* ================================
     今日平均完成度
  ================================ */

  const completion = Math.round(
    todayRecords.reduce(
      (sum, record) => sum + Number(record.completion_percent || 0),
      0,
    ) / todayRecords.length,
  );

  /* ================================
     今日训练时间
  ================================ */

  const minutes = todayRecords.reduce(
    (sum, record) => sum + Number(record.duration_minutes || 0),
    0,
  );

  /* ================================
     更新完成度
  ================================ */

  const completionBox = document.getElementById("dailyCompletion");

  if (completionBox) {
    completionBox.textContent = completion + "%";
  }

  /* ================================
     更新训练分钟
  ================================ */

  const minutesBox = document.getElementById("dailyMinutes");

  if (minutesBox) {
    minutesBox.textContent = minutes;
  }

  /* ================================
     更新完成动作
     
     这里暂时使用动作历史数据
  ================================ */

  const exercisesBox = document.getElementById("dailyExercises");

  if (exercisesBox && typeof exerciseRecords !== "undefined") {
    const todayExerciseCount = exerciseRecords.filter((exercise) => {
      if (exercise.completed !== true) {
        return false;
      }

      return todayRecords.some(
        (record) => String(record.id) === String(exercise.workout_id),
      );
    }).length;

    exercisesBox.textContent = todayExerciseCount;
  }
}

/* ================================
   训练历史数据
================================ */

let records = [];

async function loadHistory() {
  try {
    const data = await supabaseRequest(
      "workouts" + "?select=*" + "&order=workout_date.desc",
    );

    records = Array.isArray(data) ? data : [];

    console.log("训练历史读取成功：", records.length, "条");

    updateTodayStats();

    /* ================================
       显示训练历史
    ================================ */

    const historyBox = document.getElementById("historyList");

    if (historyBox) {
      if (!records.length) {
        historyBox.innerHTML = `
          <div class="muted">
            目前还没有训练记录。
          </div>
          `;
      } else {
        historyBox.innerHTML = records
          .map((record) => {
            return `

                  <div class="history-item">

                    <div class="history-title">
                      ${escapeHtml(record.title || "训练")}
                    </div>

                    <div class="muted">
                      ${record.workout_date || ""}
                    </div>

                    <div class="muted">
                      完成度：
                      ${record.completion_percent ?? 0}%
                    </div>

                    ${
                      record.duration_minutes
                        ? `
                      <div class="muted">
                        训练时间：
                        ${record.duration_minutes} 分钟
                      </div>
                      `
                        : ""
                    }

                  </div>

                `;
          })
          .join("");
      }
    }

    /* ================================
   刷新每日分析
    ================================ */

    if (typeof updateDailyAnalysis === "function") {
      updateDailyAnalysis();
    }

    /* ================================
       刷新每周分析
    ================================ */

    if (typeof updateWeeklyAnalysis === "function") {
      updateWeeklyAnalysis();
    }

    /* ================================
       刷新每月分析
    ================================ */

    if (typeof updateMonthlyAnalysis === "function") {
      updateMonthlyAnalysis();
    }

    /* ================================
       刷新长期趋势
    ================================ */

    if (typeof updateTrendAnalysis === "function") {
      updateTrendAnalysis();
    }
  } catch (error) {
    console.error("训练历史读取失败：", error);

    records = [];

    const historyBox = document.getElementById("historyList");

    if (historyBox) {
      historyBox.innerHTML = `
        <div class="muted">
          ⚠️ 训练历史读取失败
        </div>
        `;
    }
  }
}

/* ================================
   动作历史数据
================================ */

let exerciseRecords = [];

async function loadExerciseRecords() {
  try {
    const data = await supabaseRequest("exercises" + "?select=*");

    exerciseRecords = Array.isArray(data) ? data : [];

    console.log("动作历史读取成功：", exerciseRecords.length, "条");

    updateTodayStats();

    /*
      读取完成后，
      刷新动作进步分析
    */

    if (typeof updateExerciseProgressAnalysis === "function") {
      updateExerciseProgressAnalysis();
    }
  } catch (error) {
    console.error("动作历史读取失败：", error);

    exerciseRecords = [];
  }
}

/* ================================
   页面启动
================================ */

document.addEventListener("DOMContentLoaded", () => {
  /*
      训练计划
    */

  if (typeof loadCurrentPlan === "function") {
    loadCurrentPlan();
  }

  /*
      训练历史
    */

  if (typeof loadHistory === "function") {
    loadHistory();
  }

  /*
      身体数据
    */

  if (typeof loadBodyMetrics === "function") {
    loadBodyMetrics();
  }

  /*
      动作历史
    */

  if (typeof loadExerciseRecords === "function") {
    loadExerciseRecords();
  }
});
