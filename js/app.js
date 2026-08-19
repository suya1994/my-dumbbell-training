
/* ================================
   Supabase
================================ */

const SUPABASE_URL =
"https://wqcxdnitppkaccbzwbjj.supabase.co";


const SUPABASE_KEY =
"sb_publishable_G7NvaEI9mkuim_0QHkphSQ_EtNgvHYC";



/* ================================
   全局状态
================================ */

let currentPlan = null;

let currentExercises = [];

let completed = [];

let records = [];




/* ================================
   状态
================================ */

function setStatus(
text,
type=""
){

const box =
document.getElementById(
"connectionStatus"
);

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


document.getElementById(
"today"
).textContent =

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


/* ================================
   完成动作
================================ */

function toggleExercise(index){

  completed[index] =
    !completed[index];


  const button =
    document.getElementById(
      "exerciseBtn" + index
    );


  const actualBox =
    document.getElementById(
      "actualBox" + index
    );


  if(button){

    button.classList.toggle(
      "done",
      completed[index]
    );

  }


  if(actualBox){

    actualBox.classList.toggle(
      "hidden",
      !completed[index]
    );

  }


  updateProgress();

  updateDailyAnalysis();

}



/* ================================
   进度
================================ */

function updateProgress(){

const total =
currentExercises.length;

const count =
completed.filter(Boolean).length;


const percent =
total
?
Math.round(
count / total * 100
)
:
0;


const bar =
document.getElementById(
"progressBar"
);


if(bar){

bar.style.width =
percent + "%";

}


const text =
document.getElementById(
"progressText"
);


if(text){

text.textContent =

`${count} / ${total} 个动作完成`;

}


const daily =
document.getElementById(
"dailyCompletion"
);


if(daily){

daily.textContent =
percent + "%";

}


const dailyExercises =
document.getElementById(
"dailyExercises"
);


if(dailyExercises){

dailyExercises.textContent =
count;

}

}



/* ================================
   每日分析
================================ */

function updateDailyAnalysis(){

const total =
currentExercises.length;

const count =
completed.filter(Boolean).length;


const percent =
total
?
Math.round(
count / total * 100
)
:
0;


let text;


if(count === 0){

text =
"今天还没有完成训练。";

}
else if(percent < 50){

text =
`目前完成度 ${percent}%。
先保证动作质量，不需要赶进度。`;

}
else if(percent < 100){

text =
`目前完成度 ${percent}%。
已经完成大部分训练，继续保持。`;

}
else{

text =
"🎉 今天全部动作完成！";

}


document.getElementById(
"dailyAnalysis"
).textContent =
text;

}



/* ================================
   保存训练
================================ */

async function finishWorkout(){

  if(!currentPlan){

    alert("训练计划还没有加载完成。");

    return;

  }


  const count =
    completed.filter(Boolean).length;


  if(count === 0){

    alert("至少完成一个动作后再保存训练。");

    return;

  }


  const percent =
    Math.round(
      count /
      currentExercises.length *
      100
    );


  const difficulty =
    document.getElementById(
      "difficulty"
    ).value;


  const note =
    document.getElementById(
      "bodyNote"
    ).value;


  const button =
    document.getElementById(
      "saveButton"
    );


  button.disabled = true;

  button.textContent =
    "正在同步……";


  try{

    /*
      先检查今天是否已经保存过
    */

    const existing =
      await supabaseRequest(

        "workouts" +
        "?select=*" +
        "&workout_number=eq." +
        currentPlan.workout_number +
        "&workout_date=eq." +
        todayString() +
        "&limit=1"

      );


    let workout;

    let workoutId;


    /*
      如果今天已经保存过
      就更新，不重复创建
    */

    if(existing.length){

      workout =
        await supabaseRequest(

          "workouts?id=eq." +
          existing[0].id,

          {

            method:"PATCH",

            body:{

              title:
              currentPlan.title,

              focus:
              currentPlan.focus,

              duration_minutes:
              currentPlan.duration_minutes,

              completion_percent:
              percent,

              difficulty:
              difficulty || null,

              body_note:
              note || null

            }

          }

        );


      workoutId =
        existing[0].id;


    }else{


      /*
        第一次保存
      */

      workout =
        await supabaseRequest(

          "workouts",

          {

            method:"POST",

            body:{

              workout_number:
              currentPlan.workout_number,

              workout_date:
              todayString(),

              title:
              currentPlan.title,

              focus:
              currentPlan.focus,

              duration_minutes:
              currentPlan.duration_minutes,

              completion_percent:
              percent,

              difficulty:
              difficulty || null,

              body_note:
              note || null

            }

          }

        );


      workoutId =
        workout[0].id;

    }





/*
  保存每个动作
  如果今天已经保存过：
  → 更新原来的动作
  不再重复 INSERT
*/

for(
  let i = 0;
  i < currentExercises.length;
  i++
){

  const exercise =
    currentExercises[i];


  /*
    找出这个训练记录中
    是否已经存在同一个计划动作
  */

  const existingExercises =
    await supabaseRequest(

      "exercises" +
      "?select=*" +
      "&workout_id=eq." +
      workoutId +
      "&plan_exercise_id=eq." +
      exercise.id +
      "&limit=1"

    );


  /*
    如果没有填写实际数据
    自动采用计划数据
  */

  const actualSetsInput =
    document.getElementById(
      "actualSets" + i
    );


  const actualRepsInput =
    document.getElementById(
      "actualReps" + i
    );


  const actualWeightInput =
    document.getElementById(
      "actualWeight" + i
    );


  const leftRepsInput =
    document.getElementById(
      "leftReps" + i
    );


  const rightRepsInput =
    document.getElementById(
      "rightReps" + i
    );


  const actualSets =
    actualSetsInput &&
    actualSetsInput.value !== ""
    ?
    Number(
      actualSetsInput.value
    )
    :
    exercise.sets;


  const actualReps =
    actualRepsInput &&
    actualRepsInput.value.trim() !== ""
    ?
    actualRepsInput.value.trim()
    :
    exercise.reps;


  const actualWeight =
    actualWeightInput &&
    actualWeightInput.value !== ""
    ?
    Number(
      actualWeightInput.value
    )
    :
    exercise.weight_kg;


  const leftReps =
    leftRepsInput &&
    leftRepsInput.value.trim() !== ""
    ?
    leftRepsInput.value.trim()
    :
    null;


  const rightReps =
    rightRepsInput &&
    rightRepsInput.value.trim() !== ""
    ?
    rightRepsInput.value.trim()
    :
    null;


  const exerciseData = {

    workout_id:
    workoutId,

    plan_exercise_id:
    exercise.id,

    exercise_order:
    exercise.exercise_order,

    exercise_name:
    exercise.exercise_name,

    equipment:
    exercise.equipment,

    weight_kg:
    exercise.weight_kg,

    reps:
    exercise.reps,

    sets:
    exercise.sets,

    notes:
    exercise.notes,

    completed:
    completed[i],

    actual_sets:
    actualSets,

    actual_reps:
    actualReps,

    actual_weight_kg:
    actualWeight,

    left_reps:
    leftReps,

    right_reps:
    rightReps

  };


  /*
    已经存在 → 更新
  */

  if(existingExercises.length){

    await supabaseRequest(

      "exercises?id=eq." +
      existingExercises[0].id,

      {

        method:"PATCH",

        body:exerciseData

      }

    );

  }


  /*
    不存在 → 新建
  */

  else{

    await supabaseRequest(

      "exercises",

      {

        method:"POST",

        body:exerciseData

      }

    );

  }

}



    /*
      保存每日分析
    */

    const summary =
      generateDailySummary(
        percent
      );


    const existingAnalysis =
      await supabaseRequest(

        "daily_analysis" +
        "?select=*" +
        "&analysis_date=eq." +
        todayString() +
        "&limit=1"

      );


    if(existingAnalysis.length){

      await supabaseRequest(

        "daily_analysis?id=eq." +
        existingAnalysis[0].id,

        {

          method:"PATCH",

          body:{

            completion_percent:
            percent,

            summary:
            summary

          }

        }

      );

    }else{

      await supabaseRequest(

        "daily_analysis",

        {

          method:"POST",

          body:{

            analysis_date:
            todayString(),

            completion_percent:
            percent,

            summary:
            summary

          }

        }

      );

    }



    alert(
      "今天的训练已经保存。💪"
    );


    setStatus(
      "☁️ 已同步到云端",
      "ok"
    );


    await loadHistory();


  }catch(error){

    console.error(error);


    setStatus(
      "⚠️ 保存失败：" +
      error.message,
      "error"
    );


    alert(
      "保存失败：\n" +
      error.message
    );

  }


  button.disabled = false;

  button.textContent =
    "保存今天训练";

}



/* ================================
   每日总结
================================ */

function generateDailySummary(
percent
){

if(percent === 100){

return "今日训练全部完成，完成度很好。";

}

if(percent >= 75){

return "今日大部分训练完成，继续优先保证动作质量。";

}

if(percent >= 50){

return "今日完成了一半以上训练，可以逐步提高完成度。";

}

return "今日训练完成度较低，暂时不要增加训练量。";

}



/* ================================
   历史记录
================================ */

async function loadHistory(){

try{

records =
await supabaseRequest(
"workouts?select=*&order=workout_date.desc,created_at.desc"
);


renderHistory();

updateWeeklyAnalysis();

updateMonthlyAnalysis();

updateTrendAnalysis();


}catch(error){

console.error(error);


setStatus(
"⚠️ 数据库读取失败：" +
error.message,
"error"
);

}

}



/* ================================
   本周
================================ */

function getWeekRecords(){

const now =
new Date();


const day =
now.getDay();


const diff =
day === 0
?
-6
:
1 - day;


const monday =
new Date(now);


monday.setDate(
now.getDate() + diff
);


monday.setHours(
0,0,0,0
);


return records.filter(
record => {

const date =
new Date(
record.workout_date
);

return date >= monday;

}
);

}



function updateWeeklyAnalysis(){

const list =
getWeekRecords();


document.getElementById(
"weekCount"
).textContent =
list.length;


if(!list.length){

document.getElementById(
"weekAverage"
).textContent =
"—";


document.getElementById(
"weeklyAnalysis"
).textContent =
"本周还没有训练记录。";

return;

}


const average =
Math.round(

list.reduce(
(sum,r)=>
sum +
(r.completion_percent || 0),
0
)
/
list.length

);


document.getElementById(
"weekAverage"
).textContent =
average + "%";


document.getElementById(
"weeklyAnalysis"
).textContent =

`本周完成 ${list.length} 次训练，
平均完成度 ${average}%。`;

}



/* ================================
   本月
================================ */

function getMonthRecords(){

const now =
new Date();


return records.filter(
record => {

const date =
new Date(
record.workout_date
);


return (

date.getFullYear()
===
now.getFullYear()

&&

date.getMonth()
===
now.getMonth()

);

}
);

}



function updateMonthlyAnalysis(){

const list =
getMonthRecords();


const count =
list.length;


const average =
count
?
Math.round(

list.reduce(
(sum,r)=>
sum +
(r.completion_percent || 0),
0
)
/
count

)
:
0;


const minutes =
list.reduce(
(sum,r)=>
sum +
(r.duration_minutes || 0),
0
);


document.getElementById(
"monthCount"
).textContent =
count;


document.getElementById(
"monthAverage"
).textContent =
count
?
average + "%"
:
"—";


document.getElementById(
"monthMinutes"
).textContent =
minutes;


if(!count){

document.getElementById(
"monthlyAnalysis"
).textContent =
"本月还没有训练记录。";

return;

}


document.getElementById(
"monthlyAnalysis"
).textContent =

`本月共完成 ${count} 次训练，
累计约 ${minutes} 分钟，
平均完成度 ${average}%。`;


document.getElementById(
"monthlyHighlights"
).innerHTML =

`本月最高完成度：
<strong>${Math.max(
...list.map(
r => r.completion_percent || 0
)
)}%</strong>`;

}



/* ================================
   长期趋势
================================ */

function updateTrendAnalysis(){

const total =
records.length;


const minutes =
records.reduce(
(sum,r)=>
sum +
(r.duration_minutes || 0),
0
);


const average =
total
?
Math.round(

records.reduce(
(sum,r)=>
sum +
(r.completion_percent || 0),
0
)
/
total

)
:
0;


const best =
total
?
Math.max(
...records.map(
r =>
r.completion_percent || 0
)
)
:
0;


document.getElementById(
"totalWorkouts"
).textContent =
total + " 次";


document.getElementById(
"totalMinutes"
).textContent =
minutes + " 分钟";


document.getElementById(
"totalAverage"
).textContent =
total
?
average + "%"
:
"—";


document.getElementById(
"bestCompletion"
).textContent =
total
?
best + "%"
:
"—";


if(total){

document.getElementById(
"exerciseTrend"
).innerHTML =

`目前累计完成
<strong>${total} 次</strong>训练，
平均完成度
<strong>${average}%</strong>。
<br><br>
随着训练次数增加，
这里会逐渐形成你的长期力量与训练趋势。`;

}

}



/* ================================
   历史显示
================================ */

function renderHistory(){

const box =
document.getElementById(
"historyList"
);


if(!records.length){

box.innerHTML =
'<div class="muted">暂时还没有训练记录。</div>';

return;

}


box.innerHTML =

records.map(
record => `

<div class="history-item">

<div class="history-title">

第
${record.workout_number}
次训练

<span class="badge">

${record.completion_percent || 0}%

</span>

</div>


<div class="muted">

${record.workout_date}

·

${record.duration_minutes || 0}
分钟

</div>


${
record.body_note
?
`<div class="muted">
感受：
${escapeHtml(
record.body_note
)}
</div>`
:
""
}

</div>

`
)
.join("");

}



/* ================================
   标签切换
================================ */

function showTab(
id,
button
){

document
.querySelectorAll(
"#todayTab,#dailyTab,#weeklyTab,#monthlyTab,#trendTab,#historyTab"
)
.forEach(
section =>
section.classList.add(
"hidden"
)
);


document
.getElementById(id)
.classList.remove(
"hidden"
);


document
.querySelectorAll(".tab")
.forEach(
tab =>
tab.classList.remove(
"active"
)
);


button.classList.add(
"active"
);

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
   启动
================================ */

loadCurrentPlan();

loadHistory();


