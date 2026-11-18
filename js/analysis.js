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

/* =========================================================
   每周力量训练目标

   唯一来源：

   Supabase user_settings.weekly_strength_target

   默认值只作为数据库读取失败时的兜底，
   不作为正常情况下的实际设置。
========================================================= */

let analysisWeeklyStrengthTarget = 0;

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

  /*
     Supabase 可能返回：

     2026-08-24
     或
     2026-08-24T00:00:00+00:00

     这里只取前 10 位 YYYY-MM-DD，
     避免时间部分影响日期判断。
  */

  const datePart = String(dateString).slice(0, 10);

  const parts = datePart.split("-");

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

  const date = new Date(year, month - 1, day);

  /*
     防止非法日期
  */

  if (isNaN(date.getTime())) {
    return null;
  }

  date.setHours(0, 0, 0, 0);

  return date;
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
   每周力量训练目标相关逻辑已移除（统计概况仅显示次数）
========================================================= */

function getWeeklyStrengthTarget() {
  return 0;
}

async function loadWeeklyStrengthTarget() {
  analysisWeeklyStrengthTarget = 0;
  return 0;
}

/* =========================================================
   从 Supabase 读取统计数据
========================================================= */

async function loadAnalysisData() {
  try {
    console.log("📊 正在读取统计数据……");

    // 每周目标逻辑已移除，概况仅统计次数
    await loadWeeklyStrengthTarget();

    /* =====================================================
       ② 力量训练（适配新结构：workout_sessions）
    ===================================================== */

    let workouts = [];
    try {
      workouts = await supabaseRequest(
        "workout_sessions?select=id,session_no,workout_date,completion_percent,total_items,done_items&order=workout_date.desc,session_no.desc,id.desc",
      );
    } catch (e) {
      console.warn("读取 workout_sessions 失败，尝试兼容旧表 workouts：", e);
      try {
        workouts = await supabaseRequest(
          "workouts?select=*&order=workout_date.desc,workout_number.desc",
        );
      } catch (_) {
        workouts = [];
      }
    }

    analysisRecords = Array.isArray(workouts) ? workouts : [];

    console.log("📊 力量训练读取完成：", analysisRecords.length);

    /* =====================================================
       数据全部读取完成之后再更新页面
    ===================================================== */

    updateWeeklyOverview();

    updateMonthlyOverview();

    updateYearSelector();

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
  setText("weeklyOverviewWorkouts", `${list.length} 次`);
}

/* =========================================================
   每月概况
========================================================= */

function updateMonthlyOverview() {
  const list = getMonthRecords();
  setText("monthlyOverviewWorkouts", `${list.length} 次`);
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
let monthlyStrengthChart = null;
let yearlyStrengthChart = null;



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
    // 兼容 YYYY-MM-DD 与带时间部分的返回值
    return String(record.workout_date || "").slice(0, 10) === dateString;
  }).length;
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
  const strengthData = dates.map((date) => getStrengthCountByDate(date));

  weeklyStrengthChart = createTrendChart(
    "weeklyStrengthChart",
    weeklyStrengthChart,
    "bar",
    labels,
    strengthData,
    "次数",
    "力量训练",
  );
}

/* =========================================================
   每月图表
========================================================= */

function updateMonthlyCharts() {
  updateMonthlyOverview();

  const dates = getCurrentMonthDates();
  const labels = dates.map((date) => Number(date.slice(-2)));
  const strengthData = dates.map((date) => getStrengthCountByDate(date));

  monthlyStrengthChart = createTrendChart(
    "monthlyStrengthChart",
    monthlyStrengthChart,
    "bar",
    labels,
    strengthData,
    "次数",
    "力量训练",
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
      if (Number.isFinite(year)) years.add(year);
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
  const yearPrefix = String(year);
  const yearRecords = analysisRecords.filter((record) => {
    return record.workout_date && String(record.workout_date).startsWith(yearPrefix);
  });

  for (let month = 0; month < 12; month++) {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const monthStrength = yearRecords.filter((record) => {
      return String(record.workout_date).startsWith(prefix);
    }).length;
    strength.push(monthStrength);
  }
  return { strength };
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

  yearlyStrengthChart = createTrendChart(
    "yearlyStrengthChart",
    yearlyStrengthChart,
    "line",
    labels,
    data.strength,
    "次数",
    "力量训练",
  );

  /* =====================================================
       年度统计数据（概况仅次数）
  ===================================================== */

  const yearPrefix = String(year);
  const yearRecords = analysisRecords.filter((record) => {
    return record.workout_date && String(record.workout_date).startsWith(yearPrefix);
  });

  setText("totalWorkouts", `${yearRecords.length} 次`);
}

/* =========================================================
   页面初始化
========================================================= */

document.addEventListener("DOMContentLoaded", async function () {
  const weeklyButton = document.querySelector(".analysis-nav button");

  if (weeklyButton) {
    weeklyButton.classList.add("active");
  }

  await loadAnalysisData();

  updateWeeklyOverview();

  updateWeeklyCharts();
});
