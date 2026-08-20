/* ================================
   other-activities.js
   其它运动记录

   独立于哑铃训练系统

   记录：
   - 日期
   - 运动类型
   - 运动时间

   不记录备注
   不计入哑铃训练次数
================================ */

/* ================================
   全局数据
================================ */

let otherActivities = [];

/* ================================
   读取其它运动
================================ */

async function loadOtherActivities() {
  try {
    const data = await supabaseRequest(
      "other_activities" + "?select=*" + "&order=activity_date.desc,id.desc",
    );

    otherActivities = Array.isArray(data) ? data : [];

    renderOtherActivities();

    updateOtherActivityStats();
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

/* ================================
   保存其它运动
================================ */

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
  ================================ */

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
    ================================ */

    const created = await supabaseRequest("other_activities", {
      method: "POST",

      body: {
        activity_date: activityDate,

        activity_type: activityType,

        duration_minutes: duration,
      },
    });

    /* ================================
       检查是否真的创建成功
    ================================ */

    if (!created || !created.length) {
      throw new Error("数据库没有返回新增记录。");
    }

    alert("其它运动已经记录成功！💪");

    /* ================================
       清空时间输入
    ================================ */

    durationInput.value = "";

    /* ================================
       重新读取
    ================================ */

    await loadOtherActivities();
  } catch (error) {
    console.error("其它运动保存失败：", error);

    alert("其它运动保存失败：\n\n" + error.message);
  }
}

/* ================================
   删除其它运动
================================ */

async function deleteOtherActivity(id) {
  if (!id) {
    return;
  }

  const confirmed = confirm("确定要删除这条其它运动记录吗？");

  if (!confirmed) {
    return;
  }

  try {
    /* ================================
       删除

       return=representation

       这样可以确认到底有没有删除
    ================================ */

    const deleted = await supabaseRequest(
      "other_activities" + "?id=eq." + encodeURIComponent(id),
      {
        method: "DELETE",

        prefer: "return=representation",
      },
    );

    /* ================================
       真正检查删除结果
    ================================ */

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

/* ================================
   显示其它运动历史
================================ */

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

/* ================================
   获取本周其它运动
================================ */

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

/* ================================
   更新其它运动统计
================================ */

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

/* ================================
   设置今天日期
================================ */

function setOtherActivityToday() {
  const input = document.getElementById("otherActivityDate");

  if (!input) {
    return;
  }

  if (!input.value) {
    input.value = todayString();
  }
}

/* ================================
   页面初始化
================================ */

function initOtherActivities() {
  setOtherActivityToday();

  loadOtherActivities();
}

/* ================================

   页面加载

================================ */
document.addEventListener("DOMContentLoaded", function () {
  initOtherActivities();
});
