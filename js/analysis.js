/* ================================
   analysis.js
   每周 / 每月 / 年度分析
   运动趋势图
   独立从 Supabase 读取统计数据

   第4步-B 修正版

   重要：

   每周力量训练目标不再使用 localStorage。

   唯一来源：

   Supabase
   user_settings.weekly_strength_target

   例如：

   weekly_strength_target = 5

   本周已完成 1 次

   → 本周还需力量训练 = 4 次
================================ */

/* =========================================================
   全局统计数据
========================================================= */

let analysisRecords = [];

let analysisOtherActivities = [];

let analysisDailySteps = [];

/* =========================================================
   每周力量训练目标

   唯一来源：

   Supabase user_settings.weekly_strength_target

   默认值只作为数据库读取失败时的兜底，
   不作为正常情况下的实际设置。
========================================================= */

let analysisWeeklyStrengthTarget = 3;

/* =========================================================
   日期工具
========================================================= */

function getLocalDateString(date) {
  const year = date.getFullYear();

  const month = String(date.getMonth() + 1).padStart(2, "0");

  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/* =========================================================
   YYYY-MM-DD → 本地日期
========================================================= */

function parseLocalDate(dateString) {
  if (!dateString) {
    return null;
  }

  const parts = String(dateString).split("-");

  if (parts.length !== 3) {
    return null;
  }

  const year = Number(parts[0]);

  const month = Number(parts[1]);

  const day = Number(parts[2]);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }

  return new Date(year, month - 1, day);
}

/* =========================================================
   当前周一
========================================================= */

function getCurrentMonday() {
  const now = new Date();

  const day = now.getDay();

  const diff = day === 0 ? -6 : 1 - day;

  const monday = new Date(now);

  monday.setDate(now.getDate() + diff);

  monday.setHours(0, 0, 0, 0);

  return monday;
}

/* =========================================================
   当前月份
========================================================= */

function getCurrentMonthStart() {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

/* =========================================================
   获取每周目标

   ★ 第4步-B 修正

   以前这里读取：

   localStorage.weekly_min_goal

   现在已经完全取消。

   analysisWeeklyStrengthTarget
   就是从 Supabase 读取的最新值。
========================================================= */

function getWeeklyStrengthTarget() {
  const value = Number(analysisWeeklyStrengthTarget);

  if (Number.isFinite(value) && value >= 1 && value <= 7) {
    return value;
  }

  return 3;
}

/* =========================================================
   从 Supabase 读取最新每周力量训练目标
========================================================= */

async function loadWeeklyStrengthTarget() {
  try {
    console.log("🎯 正在读取每周力量训练目标……");

    const result = await supabaseRequest(
      "user_settings" +
        "?select=weekly_strength_target" +
        "&order=id.asc" +
        "&limit=1",
    );

    if (
      result &&
      result.length &&
      result[0].weekly_strength_target !== null &&
      result[0].weekly_strength_target !== undefined
    ) {
      const value = Number(result[0].weekly_strength_target);

      if (Number.isFinite(value) && value >= 1 && value <= 7) {
        analysisWeeklyStrengthTarget = value;

        console.log("🎯 当前每周力量训练目标：", analysisWeeklyStrengthTarget);

        return analysisWeeklyStrengthTarget;
      }
    }

    console.warn(
      "⚠️ user_settings 中没有有效的 weekly_strength_target，使用默认值 3。",
    );

    analysisWeeklyStrengthTarget = 3;

    return analysisWeeklyStrengthTarget;
  } catch (error) {
    console.error("❌ 读取每周力量训练目标失败：", error);

    /*
       数据库读取失败时使用兜底值。

       注意：
       这只是异常情况下的保护，
       正常情况下不会走这里。
    */

    analysisWeeklyStrengthTarget = 3;

    return analysisWeeklyStrengthTarget;
  }
}

/* =========================================================
   从 Supabase 读取统计数据
========================================================= */

async function loadAnalysisData() {
  try {
    console.log("📊 正在读取统计数据……");

    /* =====================================================
       ① 先读取最新每周力量训练目标
    ===================================================== */

    await loadWeeklyStrengthTarget();

    /* =====================================================
       ② 力量训练
    ===================================================== */

    const workouts = await supabaseRequest(
      "workouts" + "?select=*" + "&order=workout_date.desc,workout_number.desc",
    );

    analysisRecords = Array.isArray(workouts) ? workouts : [];

    console.log("📊 力量训练读取完成：", analysisRecords.length);

    /* =====================================================
       ③ 其它运动
    ===================================================== */

    const otherActivities = await supabaseRequest(
      "other_activities" + "?select=*" + "&order=activity_date.desc,id.desc",
    );

    analysisOtherActivities = Array.isArray(otherActivities)
      ? otherActivities
      : [];

    console.log("🏃 其它运动读取完成：", analysisOtherActivities.length);

    /* =====================================================
       ④ 每日步数
    ===================================================== */

    const dailySteps = await supabaseRequest(
      "daily_steps" + "?select=*" + "&order=record_date.desc",
    );

    analysisDailySteps = Array.isArray(dailySteps) ? dailySteps : [];

    console.log("👟 步数读取完成：", analysisDailySteps.length);

    /* =====================================================
       数据全部读取完成之后再更新页面
    ===================================================== */

    updateWeeklyOverview();

    updateMonthlyOverview();

    updateYearSelector();

    updateYearlyCharts();

    /*
       默认显示每周
    */

    if (typeof updateWeeklyCharts === "function") {
      updateWeeklyCharts();
    }

    console.log("✅ 统计页面数据更新完成");
  } catch (error) {
    console.error("❌ 统计数据读取失败：", error);
  }
}

/* =========================================================
   每周记录
========================================================= */

function getWeekRecords() {
  const monday = getCurrentMonday();

  const now = new Date();

  return analysisRecords.filter((record) => {
    const date = parseLocalDate(record.workout_date);

    if (!date) {
      return false;
    }

    return date >= monday && date <= now;
  });
}

/* =========================================================
   每月记录
========================================================= */

function getMonthRecords() {
  const now = new Date();

  const year = now.getFullYear();

  const month = now.getMonth();

  return analysisRecords.filter((record) => {
    const date = parseLocalDate(record.workout_date);

    if (!date) {
      return false;
    }

    return date.getFullYear() === year && date.getMonth() === month;
  });
}

/* =========================================================
   每周概况
========================================================= */

function updateWeeklyOverview() {
  const list = getWeekRecords();

  const monday = getCurrentMonday();

  const now = new Date();

  /* =====================================================
       其它运动
  ===================================================== */

  const otherList = analysisOtherActivities.filter((activity) => {
    const date = parseLocalDate(activity.activity_date);

    if (!date) {
      return false;
    }

    return date >= monday && date <= now;
  });

  /* =====================================================
       步数
  ===================================================== */

  const stepList = analysisDailySteps.filter((record) => {
    const date = parseLocalDate(record.record_date);

    if (!date) {
      return false;
    }

    return date >= monday && date <= now;
  });

  /* =====================================================
       基础统计
  ===================================================== */

  const workoutCount = list.length;

  /* =====================================================
       ★ 使用 Supabase 最新目标

       不再读取 localStorage
  ===================================================== */

  const weeklyGoal = getWeeklyStrengthTarget();

  const remainingStrength = Math.max(0, weeklyGoal - workoutCount);

  const otherMinutes = otherList.reduce((sum, activity) => {
    return sum + (Number(activity.duration_minutes) || 0);
  }, 0);

  const strengthMinutes = list.reduce((sum, record) => {
    return sum + (Number(record.duration_minutes) || 0);
  }, 0);

  /* =====================================================
       平均步数
  ===================================================== */

  const averageSteps = stepList.length
    ? Math.round(
        stepList.reduce((sum, record) => {
          return sum + (Number(record.steps) || 0);
        }, 0) / stepList.length,
      )
    : 0;

  /* =====================================================
       平均完成度
  ===================================================== */

  const completionValues = list
    .map((record) => {
      const value = Number(record.completion_percent);

      return Number.isFinite(value) ? value : null;
    })
    .filter((value) => value !== null);

  const averageCompletion = completionValues.length
    ? Math.round(
        completionValues.reduce((sum, value) => {
          return sum + value;
        }, 0) / completionValues.length,
      )
    : null;

  /* =====================================================
       最高完成度
  ===================================================== */

  const bestCompletion = completionValues.length
    ? Math.max(...completionValues)
    : null;

  /* =====================================================
       更新页面
  ===================================================== */

  setText("weeklyOverviewWorkouts", `${workoutCount} 次`);

  setText("weeklyOverviewRemainingStrength", `${remainingStrength} 次`);

  setText("weeklyOverviewStrengthMinutes", `${strengthMinutes} 分钟`);

  setText("weeklyOverviewOtherMinutes", `${otherMinutes} 分钟`);

  setText(
    "weeklyOverviewAverageSteps",
    averageSteps ? averageSteps.toLocaleString() : "—",
  );

  setText(
    "weeklyOverviewAverageCompletion",
    averageCompletion !== null ? `${averageCompletion}%` : "—",
  );

  setText(
    "weeklyOverviewBestCompletion",
    bestCompletion !== null ? `${bestCompletion}%` : "—",
  );

  /* =====================================================
       控制台调试

       以后如果数字不对，可以直接看这里：
       
       每周目标
       本周已完成
       本周剩余
  ===================================================== */

  console.log("📊 本周力量训练统计：", {
    weeklyTarget: weeklyGoal,
    workoutCount: workoutCount,
    remainingStrength: remainingStrength,
  });
}

/* =========================================================
   每月概况
========================================================= */

function updateMonthlyOverview() {
  const list = getMonthRecords();

  const now = new Date();

  const year = now.getFullYear();

  const month = now.getMonth();

  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  /* =====================================================
       其它运动
  ===================================================== */

  const otherList = analysisOtherActivities.filter((activity) => {
    return (
      activity.activity_date &&
      String(activity.activity_date).startsWith(prefix)
    );
  });

  /* =====================================================
       步数
  ===================================================== */

  const stepList = analysisDailySteps.filter((record) => {
    return record.record_date && String(record.record_date).startsWith(prefix);
  });

  const workoutCount = list.length;

  const otherMinutes = otherList.reduce((sum, activity) => {
    return sum + (Number(activity.duration_minutes) || 0);
  }, 0);

  const strengthMinutes = list.reduce((sum, record) => {
    return sum + (Number(record.duration_minutes) || 0);
  }, 0);

  /* =====================================================
       平均步数
  ===================================================== */

  const averageSteps = stepList.length
    ? Math.round(
        stepList.reduce((sum, record) => {
          return sum + (Number(record.steps) || 0);
        }, 0) / stepList.length,
      )
    : 0;

  /* =====================================================
       完成度
  ===================================================== */

  const completionValues = list
    .map((record) => {
      const value = Number(record.completion_percent);

      return Number.isFinite(value) ? value : null;
    })
    .filter((value) => value !== null);

  const averageCompletion = completionValues.length
    ? Math.round(
        completionValues.reduce((sum, value) => {
          return sum + value;
        }, 0) / completionValues.length,
      )
    : null;

  const bestCompletion = completionValues.length
    ? Math.max(...completionValues)
    : null;

  /* =====================================================
       更新页面
  ===================================================== */

  setText("monthlyOverviewWorkouts", `${workoutCount} 次`);

  setText("monthlyOverviewStrengthMinutes", `${strengthMinutes} 分钟`);

  setText("monthlyOverviewOtherMinutes", `${otherMinutes} 分钟`);

  setText(
    "monthlyOverviewAverageSteps",
    averageSteps ? averageSteps.toLocaleString() : "—",
  );

  setText(
    "monthlyOverviewAverageCompletion",
    averageCompletion !== null ? `${averageCompletion}%` : "—",
  );

  setText(
    "monthlyOverviewBestCompletion",
    bestCompletion !== null ? `${bestCompletion}%` : "—",
  );
}

/* =========================================================
   每月分析
========================================================= */

function updateMonthlyAnalysis() {
  updateMonthlyOverview();

  updateMonthlyCharts();
}

/* =========================================================
   年度入口
========================================================= */

function updateTrendAnalysis() {
  updateYearlyCharts();
}

/* =========================================================
   图表实例
========================================================= */

let weeklyStrengthChart = null;

let weeklyOtherChart = null;

let weeklyStepsChart = null;

let monthlyStrengthChart = null;

let monthlyOtherChart = null;

let monthlyStepsChart = null;

let yearlyStrengthChart = null;

let yearlyOtherChart = null;

let yearlyStepsChart = null;

/* =========================================================
   本周日期
========================================================= */

function getCurrentWeekDates() {
  const monday = getCurrentMonday();

  const dates = [];

  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);

    date.setDate(monday.getDate() + i);

    dates.push(getLocalDateString(date));
  }

  return dates;
}

/* =========================================================
   当前月份日期
========================================================= */

function getCurrentMonthDates() {
  const now = new Date();

  const year = now.getFullYear();

  const month = now.getMonth();

  const lastDay = new Date(year, month + 1, 0).getDate();

  const dates = [];

  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(year, month, day);

    dates.push(getLocalDateString(date));
  }

  return dates;
}

/* =========================================================
   某天力量训练次数
========================================================= */

function getStrengthCountByDate(dateString) {
  return analysisRecords.filter((record) => {
    return String(record.workout_date) === dateString;
  }).length;
}

/* =========================================================
   某天其它运动分钟
========================================================= */

function getOtherMinutesByDate(dateString) {
  return analysisOtherActivities
    .filter((activity) => {
      return String(activity.activity_date) === dateString;
    })
    .reduce((sum, activity) => {
      return sum + (Number(activity.duration_minutes) || 0);
    }, 0);
}

/* =========================================================
   某天步数
========================================================= */

function getStepsByDate(dateString) {
  const record = analysisDailySteps.find((item) => {
    return String(item.record_date) === dateString;
  });

  return record ? Number(record.steps) || 0 : 0;
}

/* =========================================================
   图表配置
========================================================= */

function getChartOptions(yTitle, tooltipLabel) {
  return {
    responsive: true,

    maintainAspectRatio: false,

    interaction: {
      intersect: false,

      mode: "index",
    },

    plugins: {
      legend: {
        display: false,
      },

      tooltip: {
        callbacks: {
          label: function (context) {
            const value = Number(context.parsed.y) || 0;

            return `${tooltipLabel}：` + value.toLocaleString();
          },
        },
      },
    },

    scales: {
      x: {
        grid: {
          display: false,
        },

        ticks: {
          maxRotation: 0,
        },
      },

      y: {
        beginAtZero: true,

        title: {
          display: true,

          text: yTitle,
        },

        ticks: {
          precision: 0,
        },
      },
    },
  };
}

/* =========================================================
   创建 / 更新图表
========================================================= */

function createTrendChart(
  canvasId,
  oldChart,
  type,
  labels,
  values,
  yTitle,
  tooltipLabel,
) {
  const canvas = document.getElementById(canvasId);

  if (!canvas || typeof Chart === "undefined") {
    return oldChart;
  }

  /* =====================================================
       销毁旧图表
  ===================================================== */

  if (oldChart) {
    try {
      oldChart.destroy();
    } catch (error) {
      console.warn(`图表 ${canvasId} 销毁失败：`, error);
    }
  }

  /* =====================================================
       防止 Chart.js 已经存在实例
  ===================================================== */

  const existingChart =
    typeof Chart.getChart === "function" ? Chart.getChart(canvas) : null;

  if (existingChart) {
    try {
      existingChart.destroy();
    } catch (error) {
      console.warn(`图表 ${canvasId} 已存在实例销毁失败：`, error);
    }
  }

  return new Chart(canvas, {
    type: type,

    data: {
      labels: labels,

      datasets: [
        {
          data: values,

          borderWidth: 2,

          borderRadius: type === "bar" ? 5 : 0,

          tension: type === "line" ? 0.3 : 0,

          fill: false,

          pointRadius: type === "line" ? 3 : 0,

          pointHoverRadius: type === "line" ? 5 : 0,
        },
      ],
    },

    options: getChartOptions(yTitle, tooltipLabel),
  });
}

/* =========================================================
   每周图表
========================================================= */

function updateWeeklyCharts() {
  updateWeeklyOverview();

  const dates = getCurrentWeekDates();

  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  const strengthData = dates.map((date) => {
    return getStrengthCountByDate(date);
  });

  const otherData = dates.map((date) => {
    return getOtherMinutesByDate(date);
  });

  const stepsData = dates.map((date) => {
    return getStepsByDate(date);
  });

  weeklyStrengthChart = createTrendChart(
    "weeklyStrengthChart",
    weeklyStrengthChart,
    "bar",
    labels,
    strengthData,
    "次数",
    "力量训练",
  );

  weeklyOtherChart = createTrendChart(
    "weeklyOtherChart",
    weeklyOtherChart,
    "bar",
    labels,
    otherData,
    "分钟",
    "其它运动",
  );

  weeklyStepsChart = createTrendChart(
    "weeklyStepsChart",
    weeklyStepsChart,
    "bar",
    labels,
    stepsData,
    "步数",
    "步数",
  );
}

/* =========================================================
   每月图表
========================================================= */

function updateMonthlyCharts() {
  updateMonthlyOverview();

  const dates = getCurrentMonthDates();

  const labels = dates.map((date) => {
    return Number(date.slice(-2));
  });

  const strengthData = dates.map((date) => {
    return getStrengthCountByDate(date);
  });

  const otherData = dates.map((date) => {
    return getOtherMinutesByDate(date);
  });

  const stepsData = dates.map((date) => {
    return getStepsByDate(date);
  });

  monthlyStrengthChart = createTrendChart(
    "monthlyStrengthChart",
    monthlyStrengthChart,
    "bar",
    labels,
    strengthData,
    "次数",
    "力量训练",
  );

  monthlyOtherChart = createTrendChart(
    "monthlyOtherChart",
    monthlyOtherChart,
    "bar",
    labels,
    otherData,
    "分钟",
    "其它运动",
  );

  monthlyStepsChart = createTrendChart(
    "monthlyStepsChart",
    monthlyStepsChart,
    "bar",
    labels,
    stepsData,
    "步数",
    "步数",
  );
}

/* =========================================================
   获取可用年份
========================================================= */

function getAvailableYears() {
  const years = new Set();

  analysisRecords.forEach((record) => {
    if (record.workout_date) {
      const year = Number(String(record.workout_date).slice(0, 4));

      if (Number.isFinite(year)) {
        years.add(year);
      }
    }
  });

  analysisOtherActivities.forEach((activity) => {
    if (activity.activity_date) {
      const year = Number(String(activity.activity_date).slice(0, 4));

      if (Number.isFinite(year)) {
        years.add(year);
      }
    }
  });

  analysisDailySteps.forEach((record) => {
    if (record.record_date) {
      const year = Number(String(record.record_date).slice(0, 4));

      if (Number.isFinite(year)) {
        years.add(year);
      }
    }
  });

  years.add(new Date().getFullYear());

  return Array.from(years).sort((a, b) => b - a);
}

/* =========================================================
   年份选择器
========================================================= */

function updateYearSelector() {
  const select = document.getElementById("trendYearSelect");

  if (!select) {
    return;
  }

  const years = getAvailableYears();

  if (!years.length) {
    return;
  }

  const currentValue = Number(select.value) || new Date().getFullYear();

  select.innerHTML = years
    .map((year) => {
      return `
          <option value="${year}">
            ${year} 年
          </option>
        `;
    })
    .join("");

  if (years.includes(currentValue)) {
    select.value = String(currentValue);
  } else {
    select.value = String(years[0]);
  }
}

/* =========================================================
   获取某一年每个月的数据
========================================================= */

function getYearlyData(year) {
  const strength = [];

  const other = [];

  const steps = [];

  const yearPrefix = String(year);

  const yearRecords = analysisRecords.filter((record) => {
    return (
      record.workout_date && String(record.workout_date).startsWith(yearPrefix)
    );
  });

  const yearOtherActivities = analysisOtherActivities.filter((activity) => {
    return (
      activity.activity_date &&
      String(activity.activity_date).startsWith(yearPrefix)
    );
  });

  const yearStepRecords = analysisDailySteps.filter((record) => {
    return (
      record.record_date && String(record.record_date).startsWith(yearPrefix)
    );
  });

  for (let month = 0; month < 12; month++) {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;

    /* 力量训练 */

    const monthStrength = yearRecords.filter((record) => {
      return String(record.workout_date).startsWith(prefix);
    }).length;

    /* 其它运动 */

    const monthOther = yearOtherActivities
      .filter((activity) => {
        return String(activity.activity_date).startsWith(prefix);
      })
      .reduce((sum, activity) => {
        return sum + (Number(activity.duration_minutes) || 0);
      }, 0);

    /* 步数 */

    const monthStepRecords = yearStepRecords.filter((record) => {
      return String(record.record_date).startsWith(prefix);
    });

    const stepTotal = monthStepRecords.reduce((sum, record) => {
      return sum + (Number(record.steps) || 0);
    }, 0);

    const averageSteps = monthStepRecords.length
      ? Math.round(stepTotal / monthStepRecords.length)
      : 0;

    strength.push(monthStrength);

    other.push(monthOther);

    steps.push(averageSteps);
  }

  return {
    strength,

    other,

    steps,
  };
}

/* =========================================================
   年度图表 + 年度统计
========================================================= */

function updateYearlyCharts() {
  updateYearSelector();

  const select = document.getElementById("trendYearSelect");

  const year = select ? Number(select.value) : new Date().getFullYear();

  const data = getYearlyData(year);

  const labels = [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ];

  /* =====================================================
       年度图表
  ===================================================== */

  yearlyStrengthChart = createTrendChart(
    "yearlyStrengthChart",
    yearlyStrengthChart,
    "line",
    labels,
    data.strength,
    "次数",
    "力量训练",
  );

  yearlyOtherChart = createTrendChart(
    "yearlyOtherChart",
    yearlyOtherChart,
    "line",
    labels,
    data.other,
    "分钟",
    "其它运动",
  );

  yearlyStepsChart = createTrendChart(
    "yearlyStepsChart",
    yearlyStepsChart,
    "line",
    labels,
    data.steps,
    "平均步数",
    "平均每日步数",
  );

  /* =====================================================
       年度统计数据
  ===================================================== */

  const yearPrefix = String(year);

  const yearRecords = analysisRecords.filter((record) => {
    return (
      record.workout_date && String(record.workout_date).startsWith(yearPrefix)
    );
  });

  const yearOther = analysisOtherActivities.filter((activity) => {
    return (
      activity.activity_date &&
      String(activity.activity_date).startsWith(yearPrefix)
    );
  });

  const yearSteps = analysisDailySteps.filter((record) => {
    return (
      record.record_date && String(record.record_date).startsWith(yearPrefix)
    );
  });

  const totalWorkouts = yearRecords.length;

  const totalMinutes = yearRecords.reduce((sum, record) => {
    return sum + (Number(record.duration_minutes) || 0);
  }, 0);

  const otherMinutes = yearOther.reduce((sum, activity) => {
    return sum + (Number(activity.duration_minutes) || 0);
  }, 0);

  const averageSteps = yearSteps.length
    ? Math.round(
        yearSteps.reduce((sum, record) => {
          return sum + (Number(record.steps) || 0);
        }, 0) / yearSteps.length,
      )
    : 0;

  /* =====================================================
       年度完成度
  ===================================================== */

  const completionValues = yearRecords
    .map((record) => {
      const value = Number(record.completion_percent);

      return Number.isFinite(value) ? value : null;
    })
    .filter((value) => value !== null);

  const averageCompletion = completionValues.length
    ? Math.round(
        completionValues.reduce((sum, value) => {
          return sum + value;
        }, 0) / completionValues.length,
      )
    : null;

  const bestCompletion = completionValues.length
    ? Math.max(...completionValues)
    : null;

  /* =====================================================
       更新页面
  ===================================================== */

  setText("totalWorkouts", `${totalWorkouts} 次`);

  setText("totalMinutes", `${totalMinutes} 分钟`);

  setText("yearOtherMinutes", `${otherMinutes} 分钟`);

  setText(
    "yearAverageSteps",
    averageSteps ? averageSteps.toLocaleString() : "—",
  );

  setText(
    "totalAverage",
    averageCompletion !== null ? `${averageCompletion}%` : "—",
  );

  setText(
    "bestCompletion",
    bestCompletion !== null ? `${bestCompletion}%` : "—",
  );
}

/* =========================================================
   页面初始化
========================================================= */

document.addEventListener("DOMContentLoaded", function () {
  /*
       analysis.html 打开后：

       1. 读取 user_settings
          → 获取最新每周训练目标

       2. 读取 workouts

       3. 读取其它运动

       4. 读取步数

       5. 全部完成后更新统计
    */

  loadAnalysisData();
});
