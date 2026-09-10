/* ================================
   history.js
   独立历史记录页面

   负责：
   ① 力量训练历史
   ② 其它运动历史

   =========================================================

   当前历史记录采用分页加载：

   第一次：
   → 显示 20 条

   每次点击「加载更多」：
   → 再增加 20 条

   数据库实际每次读取：

   limit = 21

   其中：

   前 20 条
   → 真正显示

   第 21 条
   → 只用于判断是否还有更多数据

   这样可以准确判断：

   20 条
   → 不显示「加载更多」

   21 条以上
   → 显示「加载更多」

   =========================================================

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

   历史页面不再读取动作记录。

================================ */

/* =========================================================
   分页设置
========================================================= */

/*
   页面每次真正显示 20 条。
*/

const HISTORY_PAGE_SIZE = 20;

/*
   数据库每次多读取 1 条。

   第 21 条只用于判断：
   是否还有下一页。
*/

const HISTORY_FETCH_SIZE = HISTORY_PAGE_SIZE + 1;

/* =========================================================
   全局数据
========================================================= */

let historyWorkouts = [];

let historyOtherActivities = [];

let historyBodyMetrics = [];

/* =========================================================
   当前分页位置
=============================== */

let historyWorkoutOffset = 0;

let historyOtherActivityOffset = 0;

let historyBodyMetricOffset = 0;

/* =========================================================
   是否还有更多数据
=============================== */

let historyHasMoreWorkouts = false;

let historyHasMoreOtherActivities = false;

let historyHasMoreBodyMetrics = false;

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
   创建分页查询参数
========================================================= */

function historyPaginationQuery(baseQuery, offset) {
  return baseQuery + `&limit=${HISTORY_FETCH_SIZE}` + `&offset=${offset}`;
}

/* =========================================================
   读取历史数据
========================================================= */

async function loadHistoryPage() {
  console.log("📚 开始读取历史数据……");

  /*
     第一次进入页面：

     三种历史全部从第 0 条开始。
  */

  historyWorkoutOffset = 0;

  historyOtherActivityOffset = 0;

  historyBodyMetricOffset = 0;

  /*
     重置数据。
  */

  historyWorkouts = [];

  historyOtherActivities = [];

  historyBodyMetrics = [];

  /*
     重置分页状态。
  */

  historyHasMoreWorkouts = false;

  historyHasMoreOtherActivities = false;

  historyHasMoreBodyMetrics = false;

  /*
     数据并行读取。
  */

  await Promise.all([
    loadHistoryWorkouts(true),

    loadHistoryOtherActivities(true),

    loadHistoryBodyMetrics(true),
  ]);

  /*
     数据全部完成之后统一渲染。
  */

  renderWorkoutHistory();

  renderOtherActivityHistory();

  renderBodyMetricsHistory();

  console.log("✅ History 页面第一次加载完成");
}

/* =========================================================
   ① 力量训练
========================================================= */

async function loadHistoryWorkouts(reset = false) {
  try {
    if (reset) {
      historyWorkoutOffset = 0;

      historyWorkouts = [];

      historyHasMoreWorkouts = false;
    }

    /*
       如果已经没有更多数据，
       不再请求数据库。
    */

    if (!reset && historyWorkoutOffset < 0) {
      return;
    }

    console.log(`🏋️ 正在读取力量训练：offset=${historyWorkoutOffset}`);

    const query = historyPaginationQuery(
      "workouts" + "?select=*" + "&order=workout_date.desc,workout_number.desc",
      historyWorkoutOffset,
    );

    const data = await supabaseRequest(query);

    const records = Array.isArray(data) ? data : [];

    /*
       判断是否还有下一页。

       如果数据库返回 21 条：

       前 20 条 → 显示

       第 21 条 → 说明后面还有数据
    */

    historyHasMoreWorkouts = records.length > HISTORY_PAGE_SIZE;

    /*
       真正加入页面的数据：

       只加入前 20 条。

       第 21 条不加入。
    */

    const visibleRecords = records.slice(0, HISTORY_PAGE_SIZE);

    historyWorkouts = historyWorkouts.concat(visibleRecords);

    /*
       offset 必须按照真正已经消耗的数据库记录数量移动。

       正常情况下：

       第一次：
       offset 0

       第二次：
       offset 20

       第三次：
       offset 40
    */

    historyWorkoutOffset += visibleRecords.length;

    console.log(
      "🏋️ 力量训练当前已加载：",
      historyWorkouts.length,
      "条",
      "，还有更多：",
      historyHasMoreWorkouts,
    );
  } catch (error) {
    console.error("❌ 力量训练历史读取失败：", error);

    if (reset) {
      historyWorkouts = [];

      historyHasMoreWorkouts = false;
    }
  }
}

/* =========================================================
   ② 其它运动
========================================================= */

async function loadHistoryOtherActivities(reset = false) {
  try {
    if (reset) {
      historyOtherActivityOffset = 0;

      historyOtherActivities = [];

      historyHasMoreOtherActivities = false;
    }

    if (!reset && historyOtherActivityOffset < 0) {
      return;
    }

    console.log(`🏃 正在读取其它运动：offset=${historyOtherActivityOffset}`);

    const query = historyPaginationQuery(
      "other_activities" + "?select=*" + "&order=activity_date.desc,id.desc",
      historyOtherActivityOffset,
    );

    const data = await supabaseRequest(query);

    const records = Array.isArray(data) ? data : [];

    /*
       21 条：

       → 前 20 条显示
       → 第 21 条说明还有下一页
    */

    historyHasMoreOtherActivities = records.length > HISTORY_PAGE_SIZE;

    const visibleRecords = records.slice(0, HISTORY_PAGE_SIZE);

    historyOtherActivities = historyOtherActivities.concat(visibleRecords);

    historyOtherActivityOffset += visibleRecords.length;

    console.log(
      "🏃 其它运动当前已加载：",
      historyOtherActivities.length,
      "条",
      "，还有更多：",
      historyHasMoreOtherActivities,
    );
} catch (error) {
    console.error("❌ 其它运动历史读取失败：", error);

    if (reset) {
      historyOtherActivities = [];

      historyHasMoreOtherActivities = false;
    }
  }
}

/* =========================================================
    ③ 身体数据
========================================================= */

async function loadHistoryBodyMetrics(reset = false) {
  try {
    if (reset) {
      historyBodyMetricOffset = 0;

      historyBodyMetrics = [];

      historyHasMoreBodyMetrics = false;
    }

    if (!reset && historyBodyMetricOffset < 0) {
      return;
    }

    console.log(`📏 正在读取身体数据：offset=${historyBodyMetricOffset}`);

    const query = historyPaginationQuery(
      "body_metrics" + "?select=*" + "&order=record_date.desc,id.desc",
      historyBodyMetricOffset,
    );

    const data = await supabaseRequest(query);

    const records = Array.isArray(data) ? data : [];

    /*
       21 条：

       → 前 20 条显示
       → 第 21 条说明还有下一页
    */

    historyHasMoreBodyMetrics = records.length > HISTORY_PAGE_SIZE;

    const visibleRecords = records.slice(0, HISTORY_PAGE_SIZE);

    historyBodyMetrics = historyBodyMetrics.concat(visibleRecords);

    historyBodyMetricOffset += visibleRecords.length;

    console.log(
      "📏 身体数据当前已加载：",
      historyBodyMetrics.length,
      "条",
      "，还有更多：",
      historyHasMoreBodyMetrics,
    );
  } catch (error) {
    console.error("❌ 身体数据历史读取失败：", error);

    if (reset) {
      historyBodyMetrics = [];

      historyHasMoreBodyMetrics = false;
    }
  }
}

/* =========================================================
    身体数据是否有效

    与 metrics.js 规则保持一致：

    null / undefined / "" / 0
    → 无效
========================================================= */

function isHistoryBodyMetricValid(value) {
  if (value === null || value === undefined || value === "") {
    return false;
  }

  const number = Number(value);

  return Number.isFinite(number) && number > 0;
}

/* =========================================================
    获取历史训练实际时间
========================================================= */

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
     没有实际时间：

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

    renderWorkoutLoadMoreButton();

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
           训练时间：

           actual_duration_minutes
           ↓
           duration_minutes
        */

      const durationInfo = getHistoryWorkoutDuration(record);

      let durationText = "—";

      if (durationInfo.minutes !== null) {
        if (durationInfo.isActual) {
          durationText = `${historyEscapeHtml(durationInfo.minutes)} 分钟`;
        } else {
          durationText = `${historyEscapeHtml(
            durationInfo.minutes,
          )} 分钟（计划）`;
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
              onclick="handleDeleteWorkoutFromHistory(
                '${historyEscapeHtml(workoutId)}',
                '${historyEscapeHtml(record.workout_number ?? "")}'
              )"
            >
              🗑 删除这次训练
            </button>

          </div>
        `;
    })
    .join("");

  renderWorkoutLoadMoreButton();
}

/* =========================================================
   力量训练：加载更多按钮
========================================================= */

function renderWorkoutLoadMoreButton() {
  const button = document.getElementById("loadMoreWorkoutsButton");

  if (!button) {
    return;
  }

  /*
     没有更多：

     隐藏按钮。
  */

  if (!historyHasMoreWorkouts) {
    button.classList.add("hidden");

    return;
  }

  button.classList.remove("hidden");

  button.disabled = false;

  button.textContent = "加载更多";
}

/* =========================================================
   加载更多力量训练
========================================================= */

async function loadMoreWorkouts() {
  const button = document.getElementById("loadMoreWorkoutsButton");

  if (button) {
    button.disabled = true;

    button.textContent = "正在加载……";
  }

  await loadHistoryWorkouts(false);

  renderWorkoutHistory();
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
       由数据库 ON DELETE CASCADE
       自动删除。
    */

    await supabaseRequest(`workouts?id=eq.${encodeURIComponent(workoutId)}`, {
      method: "DELETE",
    });

    /*
       删除成功后：

       不直接修改 offset。

       而是重新读取当前力量训练历史。

       这样可以避免：

       offset 错位
       ↓
       漏掉下一条记录
    */

    await loadHistoryWorkouts(true);

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

    renderOtherActivityLoadMoreButton();

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

  renderOtherActivityLoadMoreButton();
}

/* =========================================================
   其它运动：加载更多按钮
========================================================= */

function renderOtherActivityLoadMoreButton() {
  const button = document.getElementById("loadMoreOtherActivitiesButton");

  if (!button) {
    return;
  }

  if (!historyHasMoreOtherActivities) {
    button.classList.add("hidden");

    return;
  }

  button.classList.remove("hidden");

  button.disabled = false;

  button.textContent = "加载更多";
}

/* =========================================================
   加载更多其它运动
========================================================= */

async function loadMoreOtherActivities() {
  const button = document.getElementById("loadMoreOtherActivitiesButton");

  if (button) {
    button.disabled = true;

    button.textContent = "正在加载……";
  }

await loadHistoryOtherActivities(false);

  renderOtherActivityHistory();
}

/* =========================================================
    身体数据历史
========================================================= */

function renderBodyMetricsHistory() {
  const box = document.getElementById("bodyMetricsHistoryList");

  if (!box) {
    return;
  }

  if (!historyBodyMetrics.length) {
    box.innerHTML = `
      <div class="muted">
        目前还没有身体数据记录。
      </div>
    `;

    renderBodyMetricsLoadMoreButton();

    return;
  }

  box.innerHTML = historyBodyMetrics
    .map((record) => {
      const recordId = String(record.id ?? "");

      const date = record.record_date || "";

      const values = [];

      if (isHistoryBodyMetricValid(record.weight_kg)) {
        values.push(`体重 ${record.weight_kg} kg`);
      }

      if (isHistoryBodyMetricValid(record.waist_cm)) {
        values.push(`腰围 ${record.waist_cm} cm`);
      }

      if (isHistoryBodyMetricValid(record.hip_cm)) {
        values.push(`臀围 ${record.hip_cm} cm`);
      }

      return `
          <div class="history-item">

            <div class="history-title">
              📏 ${historyEscapeHtml(date)}
            </div>

            <div class="muted">
              ${values.length ? values.join(" · ") : "当天没有有效身体数据"}
            </div>

            <br>

            <button
              type="button"
              class="secondary-btn"
              onclick="handleDeleteBodyMetricFromHistory(
                '${historyEscapeHtml(recordId)}',
                '${historyEscapeHtml(date)}'
              )"
            >
              🗑 删除这条数据
            </button>

          </div>
        `;
    })
    .join("");

  renderBodyMetricsLoadMoreButton();
}

/* =========================================================
    身体数据：加载更多按钮
========================================================= */

function renderBodyMetricsLoadMoreButton() {
  const button = document.getElementById("loadMoreBodyMetricsButton");

  if (!button) {
    return;
  }

  if (!historyHasMoreBodyMetrics) {
    button.classList.add("hidden");

    return;
  }

  button.classList.remove("hidden");

  button.disabled = false;

  button.textContent = "加载更多";
}

/* =========================================================
    加载更多身体数据
========================================================= */

async function loadMoreBodyMetrics() {
  const button = document.getElementById("loadMoreBodyMetricsButton");

  if (button) {
    button.disabled = true;

    button.textContent = "正在加载……";
  }

  await loadHistoryBodyMetrics(false);

  renderBodyMetricsHistory();
}

/* =========================================================
    删除身体数据
========================================================= */

async function handleDeleteBodyMetricFromHistory(metricId, recordDate) {
  if (!metricId) {
    alert("找不到这条身体数据的 ID。");

    return;
  }

  const displayDate = recordDate
    ? `${recordDate} 的身体数据`
    : "这条身体数据";

  const confirmed = confirm(
    `确定要删除「${displayDate}」吗？\n\n` +
      `删除后对应的统计和图表会同步更新。\n` +
      `此操作无法恢复。`,
  );

  if (!confirmed) {
    return;
  }

  try {
    console.log("🗑 正在删除身体数据：", metricId);

    await supabaseRequest(
      `body_metrics?id=eq.${encodeURIComponent(metricId)}`,
      {
        method: "DELETE",
      },
    );

    await loadHistoryBodyMetrics(true);

    renderBodyMetricsHistory();

    alert("身体数据已删除。");
  } catch (error) {
    console.error("❌ 删除身体数据失败：", error);

    alert("删除失败，请检查数据库权限或网络连接。");
  }
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
       第一次加载：

       每个分类最多显示 20 条。
    */

  await loadHistoryPage();

  console.log("✅ History 页面初始化完成");
});
