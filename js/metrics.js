/* ================================
   metrics.js
   独立身体数据页面

   负责：
   ① 保存今天身体数据
   ② 本月平均数据
   ③ 本月相比月初的变化
   ④ 本月变化柱状图
   ⑤ 月度身体数据趋势
   ⑥ 最近身体数据预览

   数据来源：
   Supabase → body_metrics

   v2
   - 删除身体备注功能
   - 空值 / 0 不参与平均
   - 月度指标切换器统一 UI
   - 每项指标独立判断有效数据
================================ */

/* =========================================================
   全局身体数据
========================================================= */

let bodyMetricsRecords = [];

/* =========================================================
   当前月度图表指标

   weight = 体重
   waist  = 腰围
   hip    = 臀围
========================================================= */

let currentMonthlyMetric = "weight";

/* =========================================================
   Chart.js 图表实例
========================================================= */

let monthlyChangeChart = null;

let monthlyTrendChart = null;

/* =========================================================
   页面日期
========================================================= */

function updateTodayDate() {
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
   安全显示文字
========================================================= */

function escapeHtml(text) {
  const div = document.createElement("div");

  div.textContent = text ?? "";

  return div.innerHTML;
}

/* =========================================================
   日期工具
========================================================= */

function getTodayDateString() {
  const now = new Date();

  const year = now.getFullYear();

  const month = String(now.getMonth() + 1).padStart(2, "0");

  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/* =========================================================
   YYYY-MM-DD → 本地日期
========================================================= */

function parseMetricDate(dateString) {
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
   判断身体数据是否有效

   规则：

   null      → 无效
   undefined → 无效
   ""        → 无效
   0         → 无效

   身体数据不应该出现 0，
   因此 0 不参与平均和变化计算。
========================================================= */

function isValidMetricValue(value) {
  if (value === null || value === undefined || value === "") {
    return false;
  }

  const number = Number(value);

  return Number.isFinite(number) && number > 0;
}

/* =========================================================
   保存身体数据
========================================================= */

async function saveBodyMetrics() {
  const weight = document.getElementById("metricWeight")?.value ?? "";

  const waist = document.getElementById("metricWaist")?.value ?? "";

  const hip = document.getElementById("metricHip")?.value ?? "";

  /*
     至少填写一项
  */

  if (weight === "" && waist === "" && hip === "") {
    alert("至少填写一项身体数据。");

    return;
  }

  /*
     防止输入 0 或负数
  */

  if (
    (weight !== "" && !isValidMetricValue(weight)) ||
    (waist !== "" && !isValidMetricValue(waist)) ||
    (hip !== "" && !isValidMetricValue(hip))
  ) {
    alert("身体数据必须大于 0。");

    return;
  }

  try {
    const today = getTodayDateString();

    /*
       注意：

       不再写入 body_note
    */

    const data = {
      record_date: today,

      weight_kg: weight !== "" ? Number(weight) : null,

      waist_cm: waist !== "" ? Number(waist) : null,

      hip_cm: hip !== "" ? Number(hip) : null,
    };

    /*
       检查今天是否已经记录
    */

    const existing = await supabaseRequest(
      "body_metrics" + "?select=*" + "&record_date=eq." + today + "&limit=1",
    );

    /*
       今天已有记录
       → 更新
    */

    if (existing.length) {
      await supabaseRequest(
        "body_metrics?id=eq." + existing[0].id,

        {
          method: "PATCH",

          body: data,
        },
      );
    } else {
      /*
       今天没有记录
       → 新建
    */
      await supabaseRequest(
        "body_metrics",

        {
          method: "POST",

          body: data,
        },
      );
    }

    alert("身体数据已保存。📊");

    /*
       清空输入框
    */

    const weightInput = document.getElementById("metricWeight");

    const waistInput = document.getElementById("metricWaist");

    const hipInput = document.getElementById("metricHip");

    if (weightInput) {
      weightInput.value = "";
    }

    if (waistInput) {
      waistInput.value = "";
    }

    if (hipInput) {
      hipInput.value = "";
    }

    /*
       重新读取
    */

    await loadBodyMetrics();
  } catch (error) {
    console.error(error);

    alert("身体数据保存失败：\n" + error.message);
  }
}

/* =========================================================
   读取身体数据
========================================================= */

async function loadBodyMetrics() {
  try {
    console.log("📏 正在读取身体数据……");

    const data = await supabaseRequest(
      "body_metrics" + "?select=*" + "&order=record_date.desc",
    );

    bodyMetricsRecords = Array.isArray(data) ? data : [];

    console.log("📏 身体数据读取完成：", bodyMetricsRecords.length);

    /*
       最近身体数据
    */

    renderBodyMetrics(bodyMetricsRecords);

    /*
       本月统计
    */

    updateMonthlySummary(bodyMetricsRecords);

    /*
       月度趋势
    */

    updateMonthlyTrendChart(bodyMetricsRecords);
  } catch (error) {
    console.error("❌ 身体数据读取失败：", error);

    const historyBox = document.getElementById("metricsHistory");

    if (historyBox) {
      historyBox.innerHTML = `

        <div class="muted">

          身体数据读取失败：
          ${escapeHtml(error.message)}

        </div>

      `;
    }
  }
}

/* =========================================================
   获取本月身体数据
========================================================= */

function getCurrentMonthRecords(data) {
  const now = new Date();

  const year = now.getFullYear();

  const month = now.getMonth();

  return (
    data

      .filter((item) => {
        const date = parseMetricDate(item.record_date);

        if (!date) {
          return false;
        }

        return date.getFullYear() === year && date.getMonth() === month;
      })

      /*
       从早到晚
    */

      .sort((a, b) => {
        return String(a.record_date).localeCompare(String(b.record_date));
      })
  );
}

/* =========================================================
   计算平均值

   非常重要：

   只统计真正填写的数据。

   例如：

   52
   null
   null
   52.5

   平均 = 52.25

   而不是除以 4。
========================================================= */

function calculateAverage(list, field) {
  const values = list

    .map((item) => {
      const value = Number(item[field]);

      if (!Number.isFinite(value) || value <= 0) {
        return null;
      }

      return value;
    })

    .filter((value) => value !== null);

  if (!values.length) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);

  return total / values.length;
}

/* =========================================================
   获取某项指标第一条有效记录
========================================================= */

function getFirstValidRecord(list, field) {
  return (
    list.find((item) => {
      return isValidMetricValue(item[field]);
    }) || null
  );
}

/* =========================================================
   获取某项指标最新有效记录
========================================================= */

function getLatestValidRecord(list, field) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (isValidMetricValue(list[i][field])) {
      return list[i];
    }
  }

  return null;
}

/* =========================================================
   数字格式
========================================================= */

function formatMetricNumber(value, decimals = 1) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return "—";
  }

  return Number(value).toFixed(decimals);
}
/* =========================================================
   身体数据变化格式

   直接显示实际变化值：
   +0.5
   -0.8
   0

   不使用百分比。
========================================================= */

function formatMetricChange(value) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return "—";
  }

  const number = Number(value);

  if (number === 0) {
    return "0";
  }

  return (number > 0 ? "+" : "") + number.toFixed(1);
}

/* =========================================================
   本月统计

   包含：

   ① 本月平均
   ② 相比月初

   重要：

   不再通过 innerHTML 重建「相比月初」UI。

   HTML 中已经存在：

   monthlyChangeWeight
   monthlyChangeWaist
   monthlyChangeHip

   JS 只负责修改数字。

   这样可以保证：
   数据加载前后 UI 结构完全一致。
========================================================= */

function updateMonthlySummary(data) {
  /* =====================================================
     获取页面元素
  ===================================================== */

  const averageWeight = document.getElementById("monthlyAverageWeight");

  const averageWaist = document.getElementById("monthlyAverageWaist");

  const averageHip = document.getElementById("monthlyAverageHip");

  const changeWeight = document.getElementById("monthlyChangeWeight");

  const changeWaist = document.getElementById("monthlyChangeWaist");

  const changeHip = document.getElementById("monthlyChangeHip");

  if (
    !averageWeight ||
    !averageWaist ||
    !averageHip ||
    !changeWeight ||
    !changeWaist ||
    !changeHip
  ) {
    console.warn("⚠️ 身体数据统计元素不存在。");

    return;
  }

  /* =====================================================
     获取本月记录

     已经按照：
     早 → 晚
  ===================================================== */

  const list = getCurrentMonthRecords(data);

  /* =====================================================
     本月没有任何记录
  ===================================================== */

  if (!list.length) {
    averageWeight.textContent = "—";

    averageWaist.textContent = "—";

    averageHip.textContent = "—";

    changeWeight.textContent = "—";

    changeWaist.textContent = "—";

    changeHip.textContent = "—";

    return;
  }

  /* =====================================================
     ① 本月平均

     每项指标独立计算。

     null / undefined / "" / 0
     都不会参与平均。
  ===================================================== */

  const weightAverage = calculateAverage(list, "weight_kg");

  const waistAverage = calculateAverage(list, "waist_cm");

  const hipAverage = calculateAverage(list, "hip_cm");

  averageWeight.textContent = formatMetricNumber(weightAverage);

  averageWaist.textContent = formatMetricNumber(waistAverage);

  averageHip.textContent = formatMetricNumber(hipAverage);

  /* =====================================================
     ② 获取每项指标：

     本月第一条有效记录
     ↓
     本月最新有效记录

     每项指标独立判断。

     例如：

     8月1日：
     体重 52
     腰围 —
     臀围 91

     8月10日：
     体重 —
     腰围 68
     臀围 —

     那么：

     体重从 52 开始
     腰围从 68 开始
     臀围从 91 开始
  ===================================================== */

  const firstWeight = getFirstValidRecord(list, "weight_kg");

  const latestWeight = getLatestValidRecord(list, "weight_kg");

  const firstWaist = getFirstValidRecord(list, "waist_cm");

  const latestWaist = getLatestValidRecord(list, "waist_cm");

  const firstHip = getFirstValidRecord(list, "hip_cm");

  const latestHip = getLatestValidRecord(list, "hip_cm");

  /* =====================================================
     ③ 计算相比月初的变化
  ===================================================== */

  let weightChange = null;

  let waistChange = null;

  let hipChange = null;

  if (firstWeight && latestWeight) {
    weightChange =
      Number(latestWeight.weight_kg) - Number(firstWeight.weight_kg);
  }

  if (firstWaist && latestWaist) {
    waistChange = Number(latestWaist.waist_cm) - Number(firstWaist.waist_cm);
  }

  if (firstHip && latestHip) {
    hipChange = Number(latestHip.hip_cm) - Number(firstHip.hip_cm);
  }

  /* =====================================================
     ④ 更新「相比月初」

     这里只修改数字。

     不修改 HTML 结构。

     所以：
     .metric-summary-item
     .metric-summary-number
     .metric-summary-unit

     都会保持不变。
  ===================================================== */

  changeWeight.textContent = formatMetricChange(weightChange);

  changeWaist.textContent = formatMetricChange(waistChange);

  changeHip.textContent = formatMetricChange(hipChange);
}

/* =========================================================
   获取所有月份
========================================================= */

function getAvailableMetricMonths(data) {
  const monthSet = new Set();

  data.forEach((item) => {
    if (!item.record_date) {
      return;
    }

    const value = String(item.record_date).slice(0, 7);

    if (/^\d{4}-\d{2}$/.test(value)) {
      monthSet.add(value);
    }
  });

  const months = Array.from(monthSet).sort();

  return months.map((monthKey) => {
    const parts = monthKey.split("-");

    const year = Number(parts[0]);

    const month = Number(parts[1]);

    return {
      key: monthKey,

      label: `${year}年${month}月`,

      year,

      month,
    };
  });
}

/* =========================================================
   计算某个月某项指标平均值
========================================================= */

function getMonthlyAverage(data, monthKey, field) {
  const list = data.filter((item) => {
    return item.record_date && String(item.record_date).startsWith(monthKey);
  });

  return calculateAverage(list, field);
}

/* =========================================================
   获取月度趋势数据
========================================================= */

function getMonthlyTrendData(data, field) {
  const months = getAvailableMetricMonths(data);

  const labels = months.map((item) => item.label);

  const values = months.map((item) => {
    return getMonthlyAverage(data, item.key, field);
  });

  return {
    labels,

    values,
  };
}

/* =========================================================
   月度指标配置
========================================================= */

function getMonthlyMetricConfig(metric) {
  if (metric === "waist") {
    return {
      field: "waist_cm",

      label: "腰围",

      unit: "cm",
    };
  }

  if (metric === "hip") {
    return {
      field: "hip_cm",

      label: "臀围",

      unit: "cm",
    };
  }

  return {
    field: "weight_kg",

    label: "体重",

    unit: "kg",
  };
}

/* =========================================================
   更新月度趋势图
========================================================= */

function updateMonthlyTrendChart(data) {
  const canvas = document.getElementById("monthlyTrendChart");

  if (!canvas || typeof Chart === "undefined") {
    return;
  }

  const config = getMonthlyMetricConfig(currentMonthlyMetric);

  const trend = getMonthlyTrendData(data, config.field);

  /*
     销毁旧图表
  */

  if (monthlyTrendChart) {
    monthlyTrendChart.destroy();

    monthlyTrendChart = null;
  }

  if (typeof Chart.getChart === "function") {
    const existing = Chart.getChart(canvas);

    if (existing) {
      existing.destroy();
    }
  }

  if (!trend.labels.length) {
    return;
  }

  /*
     创建折线图
  */

  monthlyTrendChart = new Chart(canvas, {
    type: "line",

    data: {
      labels: trend.labels,

      datasets: [
        {
          label: config.label,

          data: trend.values,

          borderWidth: 2,

          tension: 0.3,

          fill: false,

          pointRadius: 4,

          pointHoverRadius: 6,

          spanGaps: true,
        },
      ],
    },

    options: {
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
              const value = Number(context.parsed.y);

              if (!Number.isFinite(value)) {
                return config.label + "：暂无数据";
              }

              return config.label + "：" + value.toFixed(1) + " " + config.unit;
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
          title: {
            display: true,

            text: config.unit,
          },

          ticks: {
            callback: function (value) {
              return value;
            },
          },
        },
      },
    },
  });
}

/* =========================================================
   月度指标切换

========================================================= */

function switchMonthlyMetric(metric) {
  if (!["weight", "waist", "hip"].includes(metric)) {
    return;
  }

  currentMonthlyMetric = metric;

  const weightButton = document.getElementById("monthlyMetricWeightButton");

  const waistButton = document.getElementById("monthlyMetricWaistButton");

  const hipButton = document.getElementById("monthlyMetricHipButton");

  const buttons = [weightButton, waistButton, hipButton];

  /*
       先取消所有选中状态
    */

  buttons.forEach((button) => {
    if (button) {
      button.classList.remove("active");
    }
  });

  /*
       当前指标高亮
    */

  let activeButton = null;

  if (metric === "weight") {
    activeButton = weightButton;
  }

  if (metric === "waist") {
    activeButton = waistButton;
  }

  if (metric === "hip") {
    activeButton = hipButton;
  }

  if (activeButton) {
    activeButton.classList.add("active");
  }

  /*
       更新图表
    */

  updateMonthlyTrendChart(bodyMetricsRecords);
}

/* =========================================================
   最近身体数据
========================================================= */

function renderBodyMetrics(data) {
  const box = document.getElementById("metricsHistory");

  if (!box) {
    return;
  }

  /*
     没有数据
  */

  if (!data.length) {
    box.innerHTML = `

      <div class="muted">

        暂时还没有身体数据。

      </div>

    `;

    return;
  }

  /*
     最近 5 条
  */

  box.innerHTML = data

    .slice(0, 5)

    .map((item) => {
      const values = [];

      /*
           体重
        */

      if (isValidMetricValue(item.weight_kg)) {
        values.push(`体重 ${item.weight_kg} kg`);
      }

      /*
           腰围
        */

      if (isValidMetricValue(item.waist_cm)) {
        values.push(`腰围 ${item.waist_cm} cm`);
      }

      /*
           臀围
        */

      if (isValidMetricValue(item.hip_cm)) {
        values.push(`臀围 ${item.hip_cm} cm`);
      }

      return `

          <div class="history-item">

            <div class="history-title">

              ${escapeHtml(item.record_date)}

            </div>


            <div class="muted">

              ${values.length ? values.join(" · ") : "当天没有有效身体数据"}

            </div>

          </div>

        `;
    })

    .join("");
}

/* =========================================================
   页面初始化
========================================================= */

document.addEventListener("DOMContentLoaded", function () {
  console.log("📏 metrics.js 初始化");

  updateTodayDate();

  switchMonthlyMetric("weight");

  loadBodyMetrics();
});
