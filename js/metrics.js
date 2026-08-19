/* ================================
   metrics.js
   身体数据记录与趋势
================================ */


/* ================================
   保存身体数据
================================ */

async function saveBodyMetrics(){

  const weight =
    document.getElementById(
      "metricWeight"
    )?.value;


  const waist =
    document.getElementById(
      "metricWaist"
    )?.value;


  const hip =
    document.getElementById(
      "metricHip"
    )?.value;


  const arm =
    document.getElementById(
      "metricArm"
    )?.value;


  const note =
    document.getElementById(
      "metricNote"
    )?.value;


  if(
    !weight &&
    !waist &&
    !hip &&
    !arm
  ){

    alert(
      "至少填写一项身体数据。"
    );

    return;

  }


  try{

    const data = {

      metric_date:
        todayString(),

      weight_kg:
        weight !== ""
        ?
        Number(weight)
        :
        null,

      waist_cm:
        waist !== ""
        ?
        Number(waist)
        :
        null,

      hip_cm:
        hip !== ""
        ?
        Number(hip)
        :
        null,

      arm_cm:
        arm !== ""
        ?
        Number(arm)
        :
        null,

      note:
        note || null

    };


    await supabaseRequest(

      "body_metrics",

      {

        method:"POST",

        body:data

      }

    );


    alert(
      "身体数据已保存。📊"
    );


    await loadBodyMetrics();


  }catch(error){

    console.error(error);


    alert(
      "身体数据保存失败：\n" +
      error.message
    );

  }

}



/* ================================
   读取身体数据
================================ */

async function loadBodyMetrics(){

  try{

    const data =
      await supabaseRequest(

        "body_metrics" +
        "?select=*" +
        "&order=metric_date.desc"

      );


    renderBodyMetrics(
      data
    );


    updateBodyMetricsTrend(
      data
    );


  }catch(error){

    console.error(error);

  }

}



/* ================================
   显示最近数据
================================ */

function renderBodyMetrics(
  data
){

  const box =
    document.getElementById(
      "metricsHistory"
    );


  if(!box){

    return;

  }


  if(!data.length){

    box.innerHTML =
      '<div class="muted">暂时还没有身体数据。</div>';

    return;

  }


  box.innerHTML =

    data
      .slice(0,10)
      .map(
        item => `

          <div class="history-item">

            <div class="history-title">

              ${item.metric_date}

            </div>


            <div class="muted">

              ${
                item.weight_kg !== null
                ?
                `体重 ${item.weight_kg} kg`
                :
                ""
              }

              ${
                item.waist_cm !== null
                ?
                ` · 腰围 ${item.waist_cm} cm`
                :
                ""
              }

              ${
                item.hip_cm !== null
                ?
                ` · 臀围 ${item.hip_cm} cm`
                :
                ""
              }

              ${
                item.arm_cm !== null
                ?
                ` · 手臂 ${item.arm_cm} cm`
                :
                ""
              }

            </div>


            ${
              item.note
              ?
              `<div class="muted">
                ${escapeHtml(item.note)}
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
   身体数据趋势
================================ */

function updateBodyMetricsTrend(
  data
){

  if(!data.length){

    return;

  }


  const latest =
    data[0];


  const previous =
    data[1];


  const box =
    document.getElementById(
      "metricsTrend"
    );


  if(!box){

    return;

  }


  if(!previous){

    box.textContent =
      "这是你的第一条身体数据，继续记录后就能看到变化趋势。";

    return;

  }


  const changes = [];


  if(
    latest.weight_kg !== null &&
    previous.weight_kg !== null
  ){

    changes.push(
      `体重 ${
        (
          latest.weight_kg -
          previous.weight_kg
        ).toFixed(1)
      } kg`
    );

  }


  if(
    latest.waist_cm !== null &&
    previous.waist_cm !== null
  ){

    changes.push(
      `腰围 ${
        (
          latest.waist_cm -
          previous.waist_cm
        ).toFixed(1)
      } cm`
    );

  }


  if(
    latest.hip_cm !== null &&
    previous.hip_cm !== null
  ){

    changes.push(
      `臀围 ${
        (
          latest.hip_cm -
          previous.hip_cm
        ).toFixed(1)
      } cm`
    );

  }


  if(
    latest.arm_cm !== null &&
    previous.arm_cm !== null
  ){

    changes.push(
      `手臂 ${
        (
          latest.arm_cm -
          previous.arm_cm
        ).toFixed(1)
      } cm`
    );

  }


  if(!changes.length){

    box.textContent =
      "目前没有足够的数据进行比较。";

    return;

  }


  box.innerHTML =

    `最近一次记录与上一次相比：
    <strong>${changes.join("，")}</strong>。`;

}
