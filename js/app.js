
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


