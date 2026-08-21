/* ================================
   app.js
   页面状态、Tab切换、安全显示
   + 训练历史读取
   + 动作历史读取
================================ */

/* =========================================================
   全局 DOM 工具
========================================================= */

function setText(id, text) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = text;
  }
}

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
   每周训练目标设置
================================ */

function getWeeklyGoalSettings() {
  const savedMin = localStorage.getItem("weekly_min_goal");

  const savedIdeal = localStorage.getItem("weekly_ideal_goal");

  return {
    min: savedMin !== null ? Number(savedMin) : 3,

    ideal: savedIdeal !== null ? Number(savedIdeal) : 4,
  };
}

/* ================================
   打开每周目标编辑器
================================ */

function toggleWeeklyGoalEditor() {
  const editor = document.getElementById("weeklyGoalEditor");

  if (!editor) {
    return;
  }

  const goals = getWeeklyGoalSettings();

  const minInput = document.getElementById("weeklyMinGoal");

  const idealInput = document.getElementById("weeklyIdealGoal");

  if (minInput) {
    minInput.value = goals.min;
  }

  if (idealInput) {
    idealInput.value = goals.ideal;
  }

  editor.style.display = editor.style.display === "none" ? "block" : "none";
}

/* ================================
   保存每周训练目标
================================ */

function saveWeeklyGoal() {
  const minInput = document.getElementById("weeklyMinGoal");

  const idealInput = document.getElementById("weeklyIdealGoal");

  if (!minInput || !idealInput) {
    return;
  }

  const min = Number(minInput.value);

  const ideal = Number(idealInput.value);

  /* ================================
     只判断是不是数字
     
     不限制大小关系
  ================================ */

  if (
    minInput.value === "" ||
    idealInput.value === "" ||
    Number.isNaN(min) ||
    Number.isNaN(ideal)
  ) {
    alert("请输入有效的训练目标次数。");

    return;
  }

  /* ================================
     保存到浏览器
  ================================ */

  localStorage.setItem("weekly_min_goal", String(min));

  localStorage.setItem("weekly_ideal_goal", String(ideal));

  /* ================================
     关闭编辑器
  ================================ */

  const editor = document.getElementById("weeklyGoalEditor");

  if (editor) {
    editor.style.display = "none";
  }
}

/* ================================
   取消修改
================================ */

function cancelWeeklyGoalEdit() {
  const editor = document.getElementById("weeklyGoalEditor");

  if (editor) {
    editor.style.display = "none";
  }
}

/* ================================
   Tab 切换
================================ */

function showTab(id, button) {
  console.log("正在切换 Tab：", id);

  /* ========================================
     隐藏所有页面
     
     注意：
     包含其它运动 Tab
     也包含 AI Tab
  ======================================== */

  document
    .querySelectorAll(
      "#todayTab,#otherActivitiesTab,#weeklyTab,#monthlyTab,#trendTab,#historyTab,#metricsTab,#aiTab",
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
     其它运动
  ======================================== */

  if (id === "otherActivitiesTab") {
    if (typeof setOtherActivityToday === "function") {
      setOtherActivityToday();
    }

    if (typeof loadOtherActivities === "function") {
      loadOtherActivities();
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
  }

  /* ========================================
     AI教练
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

                <br>

                <button
                  class="secondary-btn"
                  onclick="deleteWorkout('${record.id}')"
                >
                  🗑 删除这次训练
                </button>

              </div>

            `;
          })
          .join("");
      }
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
   删除训练历史
================================ */

async function deleteWorkout(workoutId) {
  if (!workoutId) {
    alert("找不到这次训练的 ID，无法删除。");
    return;
  }

  const record = records.find((item) => String(item.id) === String(workoutId));

  const title = record?.title || "这次训练";
  const date = record?.workout_date || "";

  const confirmed = confirm(
    `确定删除${title}${date ? `（${date}）` : ""}吗？\n\n` +
      "这次训练以及对应的动作完成记录都会被删除，且无法恢复。",
  );

  if (!confirmed) {
    return;
  }

  try {
    /* ================================
       1. 删除对应动作记录
       
       return=representation
       要求 Supabase 返回实际删除的记录
    ================================ */

    const deletedExercises = await supabaseRequest(
      "exercises?workout_id=eq." + encodeURIComponent(workoutId),
      {
        method: "DELETE",
        prefer: "return=representation",
      },
    );

    console.log(
      "删除动作记录：",
      Array.isArray(deletedExercises) ? deletedExercises.length : 0,
      "条",
    );

    /* ================================
       2. 删除训练记录
       
       同样要求返回实际删除的记录
    ================================ */

    const deletedWorkouts = await supabaseRequest(
      "workouts?id=eq." + encodeURIComponent(workoutId),
      {
        method: "DELETE",
        prefer: "return=representation",
      },
    );

    /* ================================
       3. 检查是否真的删除成功
    ================================ */

    if (!Array.isArray(deletedWorkouts) || deletedWorkouts.length === 0) {
      console.error("删除请求返回成功，但没有实际删除 workouts 记录。", {
        workoutId,
        deletedWorkouts,
      });

      alert(
        "删除失败：数据库没有删除这条训练记录。\n\n" +
          "请检查 Supabase 的 DELETE 权限或 RLS Policy。",
      );

      return;
    }

    console.log("训练记录删除成功：", deletedWorkouts.length, "条");

    /* ================================
       4. 重新读取训练历史
       
       会刷新：
       - 历史
       - 今日
       - 每周
       - 每月
       - 总趋势
    ================================ */

    await loadHistory();

    /* ================================
       5. 重新读取动作历史
       
       因为 exercises 也被删除了
    ================================ */

    if (typeof loadExerciseRecords === "function") {
      await loadExerciseRecords();
    }

    /* ================================
       6. 重新读取当前训练计划
    ================================ */

    if (typeof loadCurrentPlan === "function") {
      await loadCurrentPlan();
    }

    /* ================================
       7. 最后才提示删除成功
    ================================ */

    alert("训练记录已成功删除。");
  } catch (error) {
    console.error("删除训练失败：", error);

    alert("删除训练失败。\n\n" + error.message);
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
