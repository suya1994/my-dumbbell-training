
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


