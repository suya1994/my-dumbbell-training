/* ================================
   other-activities.js
   其它运动 + 每日步数

   其它运动：
   - 日期
   - 运动类型
   - 运动时间

   每日步数：
   - 每天一条记录
   - 同一天再次保存 = 更新
   - 不计入哑铃训练次数
   - 不计入其它运动次数
================================ */

/* =========================================================
   全局数据
========================================================= */

let otherActivities = [];

let dailySteps = [];

/* =========================================================
   读取其它运动
========================================================= */

async function loadOtherActivities() {
  try {
    const data = await supabaseRequest(
      "other_activities" + "?select=*" + "&order=activity_date.desc,id.desc",
    );

    otherActivities = Array.isArray(data) ? data : [];

    renderOtherActivities();

    updateOtherActivityStats();

    /* 刷新趋势图 */
    if (typeof updateWeeklyCharts === "function") {
      updateWeeklyCharts();
    }

    if (typeof updateMonthlyCharts === "function") {
      updateMonthlyCharts();
    }

    if (typeof updateYearlyCharts === "function") {
      updateYearlyCharts();
    }
  } catch (error) {
    console.error("其它运动读取失败：", error);

    const list = document.getElementById("otherActivityList");

    if (list) {
      list.innerHTML = `
        <div class="muted">
          其它运动读取失败：
          ${escapeHtml(error.message)}
        </div>
      `;
    }
  }
}

/* =========================================================
   保存其它运动
========================================================= */

async function saveOtherActivity() {
  const dateInput = document.getElementById("otherActivityDate");

  const typeInput = document.getElementById("otherActivityType");

  const durationInput = document.getElementById("otherActivityDuration");

  if (!dateInput || !typeInput || !durationInput) {
    return;
  }

  const activityDate = dateInput.value;

  const activityType = typeInput.value.trim();

  const duration = Number(durationInput.value);

  /* ================================
     基础检查
  ================================= */

  if (!activityDate) {
    alert("请选择运动日期。");
    return;
  }

  if (!activityType) {
    alert("请选择运动类型。");
    return;
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    alert("请输入正确的运动时间。");
    return;
  }

  if (duration > 1440) {
    alert("运动时间不能超过 1440 分钟。");
    return;
  }

  try {
    /* ================================
       写入数据库
    ================================= */

    const created = await supabaseRequest("other_activities", {
      method: "POST",

      body: {
        activity_date: activityDate,

        activity_type: activityType,

        duration_minutes: duration,
      },
    });

    /* ================================
       检查是否创建成功
    ================================= */

    if (!created || !created.length) {
      throw new Error("数据库没有返回新增记录。");
    }

    alert("其它运动已经记录成功！💪");

    durationInput.value = "";

    await loadOtherActivities();
  } catch (error) {
    console.error("其它运动保存失败：", error);

    alert("其它运动保存失败：\n\n" + error.message);
  }
}

/* =========================================================
   删除其它运动
========================================================= */

async function deleteOtherActivity(id) {
  if (!id) {
    return;
  }

  const confirmed = confirm("确定要删除这条其它运动记录吗？");

  if (!confirmed) {
    return;
  }

  try {
    const deleted = await supabaseRequest(
      "other_activities" + "?id=eq." + encodeURIComponent(id),

      {
        method: "DELETE",

        prefer: "return=representation",
      },
    );

    if (!Array.isArray(deleted) || deleted.length === 0) {
      throw new Error("数据库没有删除任何记录，请检查权限或记录是否存在。");
    }

    alert("已经删除。");

    await loadOtherActivities();
  } catch (error) {
    console.error("其它运动删除失败：", error);

    alert("其它运动删除失败：\n\n" + error.message);
  }
}

/* =========================================================
   显示其它运动历史
========================================================= */

function renderOtherActivities() {
  const list = document.getElementById("otherActivityList");

  if (!list) {
    return;
  }

  if (!otherActivities.length) {
    list.innerHTML = `
      <div class="muted">
        还没有其它运动记录。
      </div>
    `;

    return;
  }

  const html = otherActivities
    .map((activity) => {
      const date = escapeHtml(activity.activity_date || "");

      const type = escapeHtml(activity.activity_type || "");

      const duration = Number(activity.duration_minutes) || 0;

      return `

        <div class="history-item">

          <div class="history-title">
            ${type}
          </div>

          <div class="muted">
            ${date}
            ·
            ${duration} 分钟
          </div>

          <button
            type="button"
            class="secondary-btn"
            onclick="deleteOtherActivity(${activity.id})"
            style="margin-top:8px;">

            删除

          </button>

        </div>

      `;
    })
    .join("");

  list.innerHTML = html;
}

/* =========================================================
   获取本周其它运动
========================================================= */

function getThisWeekOtherActivities() {
  const now = new Date();

  const day = now.getDay();

  /*
    周一作为一周开始
  */

  const diff = day === 0 ? -6 : 1 - day;

  const monday = new Date(now);

  monday.setDate(now.getDate() + diff);

  monday.setHours(0, 0, 0, 0);

  return otherActivities.filter((activity) => {
    if (!activity.activity_date) {
      return false;
    }

    const date = new Date(activity.activity_date + "T00:00:00");

    return date >= monday;
  });
}

/* =========================================================
   更新其它运动统计
========================================================= */

function updateOtherActivityStats() {
  const weekList = getThisWeekOtherActivities();

  const weekCount = weekList.length;

  const weekMinutes = weekList.reduce(
    (sum, activity) => sum + (Number(activity.duration_minutes) || 0),
    0,
  );

  const totalCount = otherActivities.length;

  const totalMinutes = otherActivities.reduce(
    (sum, activity) => sum + (Number(activity.duration_minutes) || 0),
    0,
  );

  setText("otherWeekCount", String(weekCount));

  setText("otherWeekMinutes", String(weekMinutes));

  setText("otherTotalCount", String(totalCount));

  setText("otherTotalMinutes", String(totalMinutes));
}

/* =========================================================
   每日步数
========================================================= */

/* ================================
   读取每日步数
================================ */

async function loadDailySteps() {
  try {
    const data = await supabaseRequest(
      "daily_steps" + "?select=*" + "&order=record_date.desc",
    );

    dailySteps = Array.isArray(data) ? data : [];

    renderDailySteps();

    updateDailyStepStats();

    /* 刷新趋势图 */
    if (typeof updateWeeklyCharts === "function") {
      updateWeeklyCharts();
    }

    if (typeof updateMonthlyCharts === "function") {
      updateMonthlyCharts();
    }

    if (typeof updateYearlyCharts === "function") {
      updateYearlyCharts();
    }
  } catch (error) {
    console.error("每日步数读取失败：", error);

    const history = document.getElementById("dailyStepsHistory");

    if (history) {
      history.innerHTML = `
        <div class="muted">
          每日步数读取失败：
          ${escapeHtml(error.message)}
        </div>
      `;
    }
  }
}

/* =========================================================
   保存每日步数
========================================================= */

async function saveDailySteps() {
  const dateInput = document.getElementById("dailyStepsDate");

  const stepsInput = document.getElementById("dailyStepsInput");

  if (!dateInput || !stepsInput) {
    return;
  }

  const recordDate = dateInput.value;

  const steps = Number(stepsInput.value);

  /* ================================
     基础检查
  ================================= */

  if (!recordDate) {
    alert("请选择日期。");

    return;
  }

  if (!Number.isFinite(steps) || steps < 0 || !Number.isInteger(steps)) {
    alert("请输入正确的步数。");

    return;
  }

  if (steps > 200000) {
    alert("步数超过合理范围，请检查是否输入错误。");

    return;
  }

  try {
    /* ================================
       查询当天是否已有记录
    ================================= */

    const existing = await supabaseRequest(
      "daily_steps" +
        "?select=*" +
        "&record_date=eq." +
        encodeURIComponent(recordDate) +
        "&limit=1",
    );

    let result;

    /* ================================
       已存在 → 更新
    ================================= */

    if (Array.isArray(existing) && existing.length) {
      const id = existing[0].id;

      result = await supabaseRequest(
        "daily_steps" + "?id=eq." + encodeURIComponent(id),

        {
          method: "PATCH",

          body: {
            steps: steps,
          },

          prefer: "return=representation",
        },
      );

      alert("当天步数已经更新。👟");
    } else {
      /* ================================
       不存在 → 新增
    ================================= */
      result = await supabaseRequest("daily_steps", {
        method: "POST",

        body: {
          record_date: recordDate,

          steps: steps,
        },
      });

      alert("今日步数已经保存。👟");
    }

    if (!result || !result.length) {
      throw new Error("数据库没有返回保存结果。");
    }

    stepsInput.value = "";

    await loadDailySteps();
  } catch (error) {
    console.error("每日步数保存失败：", error);

    alert("每日步数保存失败：\n\n" + error.message);
  }
}

/* =========================================================
   删除每日步数
========================================================= */

async function deleteDailySteps(id) {
  if (!id) {
    return;
  }

  const confirmed = confirm("确定要删除这一天的步数记录吗？");

  if (!confirmed) {
    return;
  }

  try {
    const deleted = await supabaseRequest(
      "daily_steps" + "?id=eq." + encodeURIComponent(id),

      {
        method: "DELETE",

        prefer: "return=representation",
      },
    );

    if (!Array.isArray(deleted) || deleted.length === 0) {
      throw new Error("数据库没有删除任何记录，请检查权限或记录是否存在。");
    }

    alert("步数记录已经删除。");

    await loadDailySteps();
  } catch (error) {
    console.error("每日步数删除失败：", error);

    alert("每日步数删除失败：\n\n" + error.message);
  }
}

/* =========================================================
   获取本周步数
========================================================= */

function getThisWeekDailySteps() {
  const now = new Date();

  const day = now.getDay();

  /*
    周一作为一周开始
  */

  const diff = day === 0 ? -6 : 1 - day;

  const monday = new Date(now);

  monday.setDate(now.getDate() + diff);

  monday.setHours(0, 0, 0, 0);

  return dailySteps.filter((record) => {
    if (!record.record_date) {
      return false;
    }

    const date = new Date(record.record_date + "T00:00:00");

    return date >= monday;
  });
}

/* =========================================================
   更新每日步数统计
========================================================= */

function updateDailyStepStats() {
  const weekSteps = getThisWeekDailySteps();

  const totalSteps = weekSteps.reduce(
    (sum, record) => sum + (Number(record.steps) || 0),
    0,
  );

  const averageSteps = weekSteps.length
    ? Math.round(totalSteps / weekSteps.length)
    : 0;

  /*
    最近 7 天
  */

  const now = new Date();

  const sevenDaysAgo = new Date(now);

  sevenDaysAgo.setDate(now.getDate() - 6);

  sevenDaysAgo.setHours(0, 0, 0, 0);

  const recentSteps = dailySteps.filter((record) => {
    if (!record.record_date) {
      return false;
    }

    const date = new Date(record.record_date + "T00:00:00");

    return date >= sevenDaysAgo;
  });

  const recentTotal = recentSteps.reduce(
    (sum, record) => sum + (Number(record.steps) || 0),
    0,
  );

  const recentAverage = recentSteps.length
    ? Math.round(recentTotal / recentSteps.length)
    : 0;

  setText("weekSteps", totalSteps.toLocaleString());

  setText(
    "weekAverageSteps",
    averageSteps ? averageSteps.toLocaleString() : "—",
  );

  setText(
    "recent7DaySteps",
    recentAverage ? recentAverage.toLocaleString() : "—",
  );
}

/* =========================================================
   显示每日步数历史
========================================================= */

function renderDailySteps() {
  const list = document.getElementById("dailyStepsHistory");

  if (!list) {
    return;
  }

  if (!dailySteps.length) {
    list.innerHTML = `
      <div class="muted">
        还没有步数记录。
      </div>
    `;

    return;
  }

  const html = dailySteps
    .slice(0, 30)
    .map((record) => {
      const date = escapeHtml(record.record_date || "");

      const steps = Number(record.steps) || 0;

      return `

          <div class="history-item">

            <div class="history-title">

              👟 ${date}

            </div>


            <div class="muted">

              ${steps.toLocaleString()}
              步

            </div>


            <button
              type="button"
              class="secondary-btn"
              onclick="deleteDailySteps(${record.id})"
              style="margin-top:8px;">

              删除

            </button>

          </div>

        `;
    })
    .join("");

  list.innerHTML = html;
}

/* =========================================================
   设置其它运动今天日期
========================================================= */

function setOtherActivityToday() {
  const input = document.getElementById("otherActivityDate");

  if (!input) {
    return;
  }

  if (!input.value) {
    input.value = todayString();
  }
}

/* =========================================================
   设置每日步数今天日期
========================================================= */

function setDailyStepsToday() {
  const input = document.getElementById("dailyStepsDate");

  if (!input) {
    return;
  }

  if (!input.value) {
    input.value = todayString();
  }
}

/* =========================================================
   页面初始化
========================================================= */

function initOtherActivities() {
  setOtherActivityToday();

  setDailyStepsToday();

  loadOtherActivities();

  loadDailySteps();
}

/* =========================================================
   页面加载
========================================================= */

document.addEventListener("DOMContentLoaded", function () {
  initOtherActivities();
});
