/* =========================================================
   app.js
   公共工具
========================================================= */

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
  const box = document.getElementById("connectionStatus");

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

  const year = now.getFullYear();

  const month = String(now.getMonth() + 1).padStart(2, "0");

  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/* =========================================================
   页面顶部日期
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
   Tab
   只有存在 Tab 的页面才使用
========================================================= */

function showTab(id, button) {
  const target = document.getElementById(id);

  if (!target) {
    return;
  }

  document
    .querySelectorAll(
      "#todayTab,#otherActivitiesTab,#weeklyTab,#monthlyTab,#trendTab,#historyTab,#metricsTab,#aiTab",
    )
    .forEach((section) => {
      section.classList.add("hidden");
    });

  target.classList.remove("hidden");

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.remove("active");
  });

  if (button) {
    button.classList.add("active");
  }
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
   注意：
   这里故意没有 DOMContentLoaded

   不在这里：
   ❌ loadCurrentPlan()
   ❌ loadBodyMetrics()
   ❌ setOtherActivityToday()
   ❌ updateMonthlyAnalysis()
   ❌ updateTrendAnalysis()

   每个独立页面自己负责初始化。
========================================================= */

console.log("app.js loaded — safe mode");
