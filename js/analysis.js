/* ================================
   analysis.js
   每周 / 每月 / 长期分析
   运动趋势图
   + 周 / 月 / 年概况
================================ */

/* =========================================================
   数据安全工具
========================================================= */

function getRecords() {
  return Array.isArray(records) ? records : [];
}

function getOtherActivities() {
  return typeof otherActivities !== "undefined" &&
    Array.isArray(otherActivities)
    ? otherActivities
    : [];
}

function getDailySteps() {
  return typeof dailySteps !== "undefined" && Array.isArray(dailySteps)
    ? dailySteps
    : [];
}

/* =========================================================
   DOM 工具
========================================================= */

function setText(id, text) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = text;
  }
}

/* =========================================================
   日期工具
========================================================= */

/**
 * 将 Date 转成 YYYY-MM-DD
 */
function getLocalDateString(date) {
  const year = date.getFullYear();

  const month = String(date.getMonth() + 1).padStart(2, "0");

  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * 将 YYYY-MM-DD 转成本地当天 00:00
 *
 * 不直接使用 new Date("YYYY-MM-DD")
 * 避免浏览器按 UTC 解析造成时区偏移。
 */
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

/**
 * 获取本周一
 */
function getCurrentMonday() {
  const now = new Date();

  const day = now.getDay();

  const diff = day === 0 ? -6 : 1 - day;

  const monday = new Date(now);

  monday.setDate(now.getDate() + diff);

  monday.setHours(0, 0, 0, 0);

  return monday;
}

/**
 * 获取本月第一天
 */
function getCurrentMonthStart() {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * 获取本月最后一天
 */
function getCurrentMonthEnd() {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

/* =========================================================
   每周记录
========================================================= */

function getWeekRecords() {
  const monday = getCurrentMonday();

  const now = new Date();

  return getRecords().filter((record) => {
    const date = parseLocalDate(record.workout_date);

    if (!date) {
      return false;
    }

    /*
       只统计：
       本周一 00:00
       →
       当前时间
    */
    return date >= monday && date <= now;
  });
}

/* =========================================================
   每周训练目标
========================================================= */

function getWeeklyGoalSettings() {
  const savedMin = localStorage.getItem("weekly_min_goal");

  const savedIdeal = localStorage.getItem("weekly_ideal_goal");

  return {
    min:
      savedMin !== null && Number.isFinite(Number(savedMin))
        ? Number(savedMin)
        : 3,

    ideal:
      savedIdeal !== null && Number.isFinite(Number(savedIdeal))
        ? Number(savedIdeal)
        : 4,
  };
}

/* =========================================================
   每月记录
========================================================= */

function getMonthRecords() {
  const now = new Date();

  const year = now.getFullYear();

  const month = now.getMonth();

  return getRecords().filter((record) => {
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

  /*
     其它运动
  */
  const otherList = getOtherActivities().filter((activity) => {
    const date = parseLocalDate(activity.activity_date);

    if (!date) {
      return false;
    }

    return date >= monday && date <= now;
  });

  /*
     步数
  */
  const stepList = getDailySteps().filter((record) => {
    const date = parseLocalDate(record.record_date);

    if (!date) {
      return false;
    }

    return date >= monday && date <= now;
  });

  const workoutCount = list.length;
  const weeklyGoal = getWeeklyGoalSettings();

  const remainingStrength = Math.max(0, weeklyGoal.min - workoutCount);

  const otherMinutes = otherList.reduce((sum, activity) => {
    return sum + (Number(activity.duration_minutes) || 0);
  }, 0);

  const strengthMinutes = list.reduce((sum, record) => {
    return sum + (Number(record.duration_minutes) || 0);
  }, 0);

  const averageSteps = stepList.length
    ? Math.round(
        stepList.reduce((sum, record) => {
          return sum + (Number(record.steps) || 0);
        }, 0) / stepList.length,
      )
    : 0;

  const averageCompletion = list.length
    ? Math.round(
        list.reduce((sum, record) => {
          return sum + Number(record.completion_percent || 0);
        }, 0) / list.length,
      )
    : 0;

  const bestCompletion = list.length
    ? Math.max(
        ...list.map((record) => {
          return Number(record.completion_percent || 0);
        }),
      )
    : 0;

  setText("weeklyOverviewWorkouts", `${workoutCount} 次`);
  setText("weeklyOverviewRemainingStrength", `${remainingStrength} 次`);

  setText("weeklyOverviewOtherMinutes", `${otherMinutes} 分钟`);

  setText(
    "weeklyOverviewAverageSteps",
    averageSteps ? averageSteps.toLocaleString() : "—",
  );

  setText("weeklyOverviewStrengthMinutes", `${strengthMinutes} 分钟`);

  setText(
    "weeklyOverviewAverageCompletion",
    list.length ? `${averageCompletion}%` : "—",
  );

  setText(
    "weeklyOverviewBestCompletion",
    list.length ? `${bestCompletion}%` : "—",
  );
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

  /*
     其它运动
  */
  const otherList = getOtherActivities().filter((activity) => {
    return (
      activity.activity_date &&
      String(activity.activity_date).startsWith(prefix)
    );
  });

  /*
     步数
  */
  const stepList = getDailySteps().filter((record) => {
    return record.record_date && String(record.record_date).startsWith(prefix);
  });

  const workoutCount = list.length;

  const otherMinutes = otherList.reduce((sum, activity) => {
    return sum + (Number(activity.duration_minutes) || 0);
  }, 0);

  const strengthMinutes = list.reduce((sum, record) => {
    return sum + (Number(record.duration_minutes) || 0);
  }, 0);

  const averageSteps = stepList.length
    ? Math.round(
        stepList.reduce((sum, record) => {
          return sum + (Number(record.steps) || 0);
        }, 0) / stepList.length,
      )
    : 0;

  const averageCompletion = list.length
    ? Math.round(
        list.reduce((sum, record) => {
          return sum + Number(record.completion_percent || 0);
        }, 0) / list.length,
      )
    : 0;

  const bestCompletion = list.length
    ? Math.max(
        ...list.map((record) => {
          return Number(record.completion_percent || 0);
        }),
      )
    : 0;

  setText("monthlyOverviewWorkouts", `${workoutCount} 次`);

  setText("monthlyOverviewOtherMinutes", `${otherMinutes} 分钟`);

  setText(
    "monthlyOverviewAverageSteps",
    averageSteps ? averageSteps.toLocaleString() : "—",
  );

  setText("monthlyOverviewStrengthMinutes", `${strengthMinutes} 分钟`);

  setText(
    "monthlyOverviewAverageCompletion",
    list.length ? `${averageCompletion}%` : "—",
  );

  setText(
    "monthlyOverviewBestCompletion",
    list.length ? `${bestCompletion}%` : "—",
  );
}

/* =========================================================
   每月分析入口
========================================================= */

function updateMonthlyAnalysis() {
  updateMonthlyOverview();

  updateMonthlyCharts();
}

/* =========================================================
   长期趋势入口
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
   每周日期
   周一 → 周日
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
   某一天力量训练次数
========================================================= */

function getStrengthCountByDate(dateString) {
  return getRecords().filter((record) => {
    return record.workout_date === dateString;
  }).length;
}

/* =========================================================
   某一天其它运动分钟
========================================================= */

function getOtherMinutesByDate(dateString) {
  return getOtherActivities()
    .filter((activity) => {
      return activity.activity_date === dateString;
    })
    .reduce((sum, activity) => {
      return sum + (Number(activity.duration_minutes) || 0);
    }, 0);
}

/* =========================================================
   某一天步数
========================================================= */

function getStepsByDate(dateString) {
  const record = getDailySteps().find((item) => {
    return item.record_date === dateString;
  });

  return record ? Number(record.steps) || 0 : 0;
}

/* =========================================================
   图表通用配置
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

            return `${tooltipLabel}：${value.toLocaleString()}`;
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

  /*
     销毁旧图表
  */
  if (oldChart) {
    try {
      oldChart.destroy();
    } catch (error) {
      console.warn(`图表 ${canvasId} 销毁失败：`, error);
    }
  }

  /*
     防止 canvas 上已经存在 Chart 实例
  */
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
    type,

    data: {
      labels,

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
  /*
     先更新顶部概况
  */
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

  /*
     力量训练
  */
  getRecords().forEach((record) => {
    if (record.workout_date) {
      const year = Number(String(record.workout_date).slice(0, 4));

      if (Number.isFinite(year)) {
        years.add(year);
      }
    }
  });

  /*
     其它运动
  */
  getOtherActivities().forEach((activity) => {
    if (activity.activity_date) {
      const year = Number(String(activity.activity_date).slice(0, 4));

      if (Number.isFinite(year)) {
        years.add(year);
      }
    }
  });

  /*
     步数
  */
  getDailySteps().forEach((record) => {
    if (record.record_date) {
      const year = Number(String(record.record_date).slice(0, 4));

      if (Number.isFinite(year)) {
        years.add(year);
      }
    }
  });

  /*
     始终加入当前年份
  */
  years.add(new Date().getFullYear());

  return Array.from(years)
    .filter((year) => {
      return Number.isFinite(year);
    })
    .sort((a, b) => b - a);
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

  const yearRecords = getRecords().filter((record) => {
    return (
      record.workout_date && String(record.workout_date).startsWith(yearPrefix)
    );
  });

  const yearOtherActivities = getOtherActivities().filter((activity) => {
    return (
      activity.activity_date &&
      String(activity.activity_date).startsWith(yearPrefix)
    );
  });

  const yearStepRecords = getDailySteps().filter((record) => {
    return (
      record.record_date && String(record.record_date).startsWith(yearPrefix)
    );
  });

  for (let month = 0; month < 12; month++) {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;

    /*
       力量训练
    */
    const monthStrength = yearRecords.filter((record) => {
      return String(record.workout_date).startsWith(prefix);
    }).length;

    /*
       其它运动
    */
    const monthOther = yearOtherActivities
      .filter((activity) => {
        return String(activity.activity_date).startsWith(prefix);
      })
      .reduce((sum, activity) => {
        return sum + (Number(activity.duration_minutes) || 0);
      }, 0);

    /*
       步数

       只统计有记录的日期。
       没有记录的日期不算 0。
    */
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
   年度图表
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

  /* =========================================================
     年度统计数字
  ========================================================= */

  const yearPrefix = String(year);

  /*
     力量训练
  */
  const yearRecords = getRecords().filter((record) => {
    return (
      record.workout_date && String(record.workout_date).startsWith(yearPrefix)
    );
  });

  /*
     其它运动
  */
  const yearOther = getOtherActivities().filter((activity) => {
    return (
      activity.activity_date &&
      String(activity.activity_date).startsWith(yearPrefix)
    );
  });

  /*
     步数
  */
  const yearSteps = getDailySteps().filter((record) => {
    return (
      record.record_date && String(record.record_date).startsWith(yearPrefix)
    );
  });

  /*
     力量训练次数
  */
  const totalWorkouts = yearRecords.length;

  /*
     力量训练分钟
  */
  const totalMinutes = yearRecords.reduce((sum, record) => {
    return sum + (Number(record.duration_minutes) || 0);
  }, 0);

  /*
     其它运动分钟
  */
  const otherMinutes = yearOther.reduce((sum, activity) => {
    return sum + (Number(activity.duration_minutes) || 0);
  }, 0);

  /*
     年平均每日步数

     只按照有步数记录的日期计算。
  */
  const averageSteps = yearSteps.length
    ? Math.round(
        yearSteps.reduce((sum, record) => {
          return sum + (Number(record.steps) || 0);
        }, 0) / yearSteps.length,
      )
    : 0;

  /*
     平均完成度
  */
  const averageCompletion = yearRecords.length
    ? Math.round(
        yearRecords.reduce((sum, record) => {
          return sum + Number(record.completion_percent || 0);
        }, 0) / yearRecords.length,
      )
    : 0;

  /*
     最高完成度
  */
  const bestCompletion = yearRecords.length
    ? Math.max(
        ...yearRecords.map((record) => {
          return Number(record.completion_percent || 0);
        }),
      )
    : 0;

  /*
     更新 DOM
  */
  setText("totalWorkouts", `${totalWorkouts} 次`);

  setText("totalMinutes", `${totalMinutes} 分钟`);

  setText("yearOtherMinutes", `${otherMinutes} 分钟`);

  setText(
    "yearAverageSteps",
    averageSteps ? averageSteps.toLocaleString() : "—",
  );

  setText("totalAverage", yearRecords.length ? `${averageCompletion}%` : "—");

  setText("bestCompletion", yearRecords.length ? `${bestCompletion}%` : "—");
}
