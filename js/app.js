/* ================================
   app.js
   页面状态、Tab切换、安全显示
   + 训练动作历史读取
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


  /*
    点击总趋势时，
    重新生成动作进步分析
  */

  if(
    id === "trendTab" &&
    typeof updateExerciseProgressAnalysis ===
    "function"
  ){

    updateExerciseProgressAnalysis();

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
   动作历史数据
================================ */

let exerciseRecords = [];



async function loadExerciseRecords(){

  try{

    const data =
      await supabaseRequest(

        "exercises" +
        "?select=*" 

      );


    exerciseRecords =
      Array.isArray(data)
      ?
      data
      :
      [];


    console.log(
      "动作历史读取成功：",
      exerciseRecords.length,
      "条"
    );


    /*
      读取完成后，
      如果总趋势已经存在，
      立即刷新动作进步分析。
    */

    if(
      typeof updateExerciseProgressAnalysis ===
      "function"
    ){

      updateExerciseProgressAnalysis();

    }


  }catch(error){

    console.error(
      "动作历史读取失败：",
      error
    );


    exerciseRecords = [];

  }

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


    /*
      动作历史
    */

    if(
      typeof loadExerciseRecords ===
      "function"
    ){

      loadExerciseRecords();

    }

  }
);