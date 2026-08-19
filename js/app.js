/* ================================
   app.js
   页面状态、Tab切换、安全显示
================================ */


/* ================================
   状态
================================ */

function setStatus(
  text,
  type = ""
){

  const box =
    document.getElementById(
      "connectionStatus"
    );

  if(!box){
    return;
  }

  box.textContent =
    text;

  box.className =
    "status " +
    type;
}



/* ================================
   日期
================================ */

function todayString(){

  return new Date()
    .toISOString()
    .slice(0,10);

}


const todayBox =
  document.getElementById(
    "today"
  );


if(todayBox){

  todayBox.textContent =
    new Date()
      .toLocaleDateString(
        "zh-CN",
        {
          year:"numeric",
          month:"long",
          day:"numeric",
          weekday:"long"
        }
      );

}



/* ================================
   Tab 切换
================================ */

function showTab(
  id,
  button
){

  document
    .querySelectorAll(
      "#todayTab,#dailyTab,#weeklyTab,#monthlyTab,#trendTab,#historyTab,#metricsTab"
    )
    .forEach(
      section => {

        section.classList.add(
          "hidden"
        );

      }
    );


  const target =
    document.getElementById(
      id
    );


  if(target){

    target.classList.remove(
      "hidden"
    );

  }


  document
    .querySelectorAll(
      ".tab"
    )
    .forEach(
      tab => {

        tab.classList.remove(
          "active"
        );

      }
    );


  if(button){

    button.classList.add(
      "active"
    );

  }

}



/* ================================
   安全显示文字
================================ */

function escapeHtml(
  text
){

  const div =
    document.createElement(
      "div"
    );

  div.textContent =
    text || "";

  return div.innerHTML;

}



/* ================================
   页面启动
================================ */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    /*
      训练计划
    */

    if(
      typeof loadCurrentPlan ===
      "function"
    ){

      loadCurrentPlan();

    }


    /*
      训练历史
    */

    if(
      typeof loadHistory ===
      "function"
    ){

      loadHistory();

    }


    /*
      身体数据
    */

    if(
      typeof loadBodyMetrics ===
      "function"
    ){

      loadBodyMetrics();

    }

  }
);