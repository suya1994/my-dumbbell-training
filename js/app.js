/* ================================
   app.js

   首页公共逻辑：

   1. 首页日期
   2. Tab 切换
   3. 安全显示文字

   本文件不负责：

   ❌ 历史记录
   ❌ 动作历史
   ❌ 今日统计
   ❌ 每周训练目标
   ❌ 训练统计数据读取

   历史记录：
   → history.js

   训练统计：
   → analysis.js

   身体数据：
   → metrics.js

   其它运动：
   → other-activities.js

   AI 教练：
   → ai-plan.js
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


/* =========================================================
   数据库连接状态
========================================================= */

function setStatus(text, type = "") {

  const box =
    document.getElementById("connectionStatus");

  if (!box) {

    return;

  }

  box.textContent = text;

  box.className = "status " + type;

}


/* =========================================================
   日期
========================================================= */

function todayString() {

  const now = new Date();

  const year =
    now.getFullYear();

  const month =
    String(now.getMonth() + 1).padStart(2, "0");

  const day =
    String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;

}


/* =========================================================
   首页顶部日期
========================================================= */

function updateTodayDate() {

  const todayBox =
    document.getElementById("today");

  if (!todayBox) {

    return;

  }

  todayBox.textContent =
    new Date().toLocaleDateString(
      "zh-CN",
      {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      }
    );

}


/* =========================================================
   Tab 切换
========================================================= */

function showTab(id, button) {

  console.log("正在切换 Tab：", id);


  /* =====================================================
     隐藏所有首页 Tab
  ===================================================== */

  document
    .querySelectorAll(
      "#todayTab,#otherActivitiesTab,#weeklyTab,#monthlyTab,#trendTab,#historyTab,#metricsTab,#aiTab"
    )
    .forEach((section) => {

      section.classList.add("hidden");

    });


  /* =====================================================
     找到目标 Tab
  ===================================================== */

  const target =
    document.getElementById(id);

  if (!target) {

    console.error(
      "找不到 Tab 页面：",
      id
    );

    return;

  }


  /* =====================================================
     显示目标 Tab
  ===================================================== */

  target.classList.remove("hidden");


  /* =====================================================
     更新 Tab 按钮状态
  ===================================================== */

  document
    .querySelectorAll(".tab")
    .forEach((tab) => {

      tab.classList.remove("active");

    });


  if (button) {

    button.classList.add("active");

  }


  /* =====================================================
     其它运动
  ===================================================== */

  if (id === "otherActivitiesTab") {

    if (
      typeof setOtherActivityToday ===
      "function"
    ) {

      setOtherActivityToday();

    }


    if (
      typeof loadOtherActivities ===
      "function"
    ) {

      loadOtherActivities();

    }

  }


  /* =====================================================
     每月统计
  ===================================================== */

  if (id === "monthlyTab") {

    if (
      typeof updateMonthlyAnalysis ===
      "function"
    ) {

      updateMonthlyAnalysis();

    }

  }


  /* =====================================================
     年度统计
  ===================================================== */

  if (id === "trendTab") {

    if (
      typeof updateTrendAnalysis ===
      "function"
    ) {

      updateTrendAnalysis();

    }

  }


  /* =====================================================
     AI 教练
  ===================================================== */

  if (id === "aiTab") {

    console.log(
      "已进入 AI私人教练 Tab"
    );

  }


  console.log(
    "Tab 切换完成：",
    id
  );

}


/* =========================================================
   安全显示文字
========================================================= */

function escapeHtml(text) {

  const div =
    document.createElement("div");

  div.textContent =
    text ?? "";

  return div.innerHTML;

}


/* =========================================================
   页面初始化
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  function () {

    console.log(
      "🏋️ 首页 app.js 初始化"
    );


    /* =====================================================
       首页顶部日期
    ===================================================== */

    updateTodayDate();


    /* =====================================================
       当前训练计划
    ===================================================== */

    if (
      typeof loadCurrentPlan ===
      "function"
    ) {

      loadCurrentPlan();

    }


    /* =====================================================
       身体数据
    ===================================================== */

    if (
      typeof loadBodyMetrics ===
      "function"
    ) {

      loadBodyMetrics();

    }


    /* =====================================================
       其它运动默认日期
    ===================================================== */

    if (
      typeof setOtherActivityToday ===
      "function"
    ) {

      setOtherActivityToday();

    }


    console.log(
      "✅ 首页 app.js 初始化完成"
    );

  }
);