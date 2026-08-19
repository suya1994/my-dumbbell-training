/* ================================
   读取当前训练计划
================================ */

async function loadCurrentPlan(){

try{

const plans =
await supabaseRequest(

"training_plans" +
"?select=*" +
"&order=workout_number.desc" +
"&limit=1"

);


if(
!plans.length
){

throw new Error(
"数据库中没有训练计划"
);

}


currentPlan =
plans[0];


const exercises =
await supabaseRequest(

"training_plan_exercises" +
"?select=*" +
"&plan_id=eq." +
currentPlan.id +
"&order=exercise_order.asc"

);


currentExercises =
exercises;


completed =
new Array(
currentExercises.length
).fill(false);


renderCurrentPlan();


setStatus(
"☁️ 已连接训练数据库",
"ok"
);


document.getElementById(
"saveButton"
).disabled =
false;


document.getElementById(
"saveButton"
).textContent =
"保存今天训练";


}catch(error){

console.error(error);


setStatus(
"⚠️ 训练计划读取失败：" +
error.message,
"error"
);

}

}



/* ================================
   显示训练计划
================================ */

function renderCurrentPlan(){

  const box =
    document.getElementById("todayPlan");

  const exercisesHTML =
    currentExercises
      .map((exercise, index) => `

        <div class="exercise">

          <div class="exercise-row">

            <div class="exercise-info">

              <div class="exercise-name">
                ${index + 1}️⃣
                ${escapeHtml(exercise.exercise_name)}
              </div>

              <div class="exercise-detail">

                ${
                  exercise.weight_kg !== null
                    ? exercise.weight_kg + "kg × "
                    : ""
                }

                ${escapeHtml(exercise.reps || "")}
                次 ×
                ${exercise.sets || 0}
                组

                <br>

                ${escapeHtml(exercise.notes || "")}

              </div>

            </div>

            <button
              class="complete-btn"
              onclick="toggleExercise(${index})"
              id="exerciseBtn${index}">

              ✓

            </button>

          </div>


          <!-- 实际训练记录 -->

          <div
            id="actualBox${index}"
            class="hidden"
            style="margin-top:12px;">

            <div class="muted">
              实际完成情况
            </div>


            <input
              id="actualSets${index}"
              class="note"
              type="number"
              min="0"
              max="20"
              placeholder="实际完成几组，例如 3">


            <input
              id="actualReps${index}"
              class="note"
              type="text"
              placeholder="实际次数，例如 7/7/6">


            <input
              id="actualWeight${index}"
              class="note"
              type="number"
              min="0"
              step="0.5"
              placeholder="实际重量 kg，例如 5">


            ${
              exercise.exercise_name.includes("单臂")
              ||
              exercise.exercise_name.includes("单手")
              ?
              `

              <input
                id="leftReps${index}"
                class="note"
                type="text"
                placeholder="左手次数，例如 7/7/6">


              <input
                id="rightReps${index}"
                class="note"
                type="text"
                placeholder="右手次数，例如 7/7/7">

              `
              :
              ""
            }

          </div>

        </div>

      `)
      .join("");


  box.innerHTML = `

    <h2>

      第
      ${currentPlan.workout_number}
      次训练

    </h2>


    <div class="muted">

      ${escapeHtml(currentPlan.title)}

    </div>


    <div class="muted">

      重点：
      ${escapeHtml(currentPlan.focus || "")}

    </div>


    <div class="muted">

      建议训练时间：
      ${currentPlan.duration_minutes || 25}
      分钟

    </div>


    <div class="progress">

      <div
        id="progressBar"
        class="progress-bar">
      </div>

    </div>


    <div
      id="progressText"
      class="muted">

      0 /
      ${currentExercises.length}
      个动作完成

    </div>


    ${exercisesHTML}

  `;


  updateProgress();

}
