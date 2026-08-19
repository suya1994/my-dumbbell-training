/* ================================
   metrics.js
   身体数据记录与趋势分析
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


  const note =
    document.getElementById(
      "metricNote"
    )?.value;


  if(
    weight === "" &&
    waist === "" &&
    hip === ""
  ){

    alert(
      "至少填写一项身体数据。"
    );

    return;

  }


  try{

    const data = {

      record_date:
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

      body_note:
        note || null

    };


    const existing =
      await supabaseRequest(

        "body_metrics" +
        "?select=*" +
        "&record_date=eq." +
        todayString() +
        "&limit=1"

      );


    if(existing.length){

      await supabaseRequest(

        "body_metrics?id=eq." +
        existing[0].id,

        {

          method:"PATCH",

          body:data

        }

      );

    }else{

      await supabaseRequest(

        "body_metrics",

        {

          method:"POST",

          body:data

        }

      );

    }


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
        "&order=record_date.desc"

      );


    renderBodyMetrics(
      data
    );


    updateBodyMetricsTrend(
      data
    );


    updateBodyMetricsMonthly(
      data
    );


    updateBodyMetricsLongTerm(
      data
    );


  }catch(error){

    console.error(error);


    const box =
      document.getElementById(
        "metricsTrend"
      );


    if(box){

      box.textContent =
        "身体数据读取失败：" +
        error.message;

    }

  }

}



/* ================================
   最近身体记录
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

              ${item.record_date}

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

            </div>


            ${
              item.body_note
              ?
              `<div class="muted">
                备注：
                ${escapeHtml(item.body_note)}
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
   最近两次变化
================================ */

function updateBodyMetricsTrend(
  data
){

  const box =
    document.getElementById(
      "metricsTrend"
    );


  if(!box){

    return;

  }


  if(!data.length){

    box.textContent =
      "记录身体数据后，这里会显示你的变化趋势。";

    return;

  }


  if(data.length < 2){

    box.textContent =
      "目前只有1条记录，继续记录后就可以看到变化趋势。";

    return;

  }


  const latest =
    data[0];


  const previous =
    data[1];


  const changes = [];


  if(
    latest.weight_kg !== null &&
    previous.weight_kg !== null
  ){

    changes.push(
      `体重 ${
        formatChange(
          latest.weight_kg -
          previous.weight_kg
        )
      } kg`
    );

  }


  if(
    latest.waist_cm !== null &&
    previous.waist_cm !== null
  ){

    changes.push(
      `腰围 ${
        formatChange(
          latest.waist_cm -
          previous.waist_cm
        )
      } cm`
    );

  }


  if(
    latest.hip_cm !== null &&
    previous.hip_cm !== null
  ){

    changes.push(
      `臀围 ${
        formatChange(
          latest.hip_cm -
          previous.hip_cm
        )
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



/* ================================
   本月身体数据
================================ */

function updateBodyMetricsMonthly(
  data
){

  const box =
    document.getElementById(
      "metricsMonthly"
    );


  if(!box){

    return;

  }


  const now =
    new Date();


  const list =
    data.filter(
      item => {

        const date =
          new Date(
            item.record_date
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


  if(list.length < 2){

    box.textContent =
      "本月记录还不够，继续记录后会显示月度变化。";

    return;

  }


  const latest =
    list[0];


  const earliest =
    list[list.length - 1];


  const changes = [];


  if(
    latest.weight_kg !== null &&
    earliest.weight_kg !== null
  ){

    changes.push(
      `体重 ${
        formatChange(
          latest.weight_kg -
          earliest.weight_kg
        )
      } kg`
    );

  }


  if(
    latest.waist_cm !== null &&
    earliest.waist_cm !== null
  ){

    changes.push(
      `腰围 ${
        formatChange(
          latest.waist_cm -
          earliest.waist_cm
        )
      } cm`
    );

  }


  if(
    latest.hip_cm !== null &&
    earliest.hip_cm !== null
  ){

    changes.push(
      `臀围 ${
        formatChange(
          latest.hip_cm -
          earliest.hip_cm
        )
      } cm`
    );

  }


  box.innerHTML =

    `本月从 ${earliest.record_date}
    到 ${latest.record_date}：
    <br><br>
    <strong>
    ${changes.join("，")}
    </strong>`;

}



/* ================================
   长期身体趋势
================================ */

function updateBodyMetricsLongTerm(
  data
){

  const box =
    document.getElementById(
      "metricsLongTerm"
    );


  if(!box){

    return;

  }


  if(data.length < 2){

    box.textContent =
      "身体数据积累后，这里会显示长期变化。";

    return;

  }


  const latest =
    data[0];


  const earliest =
    data[data.length - 1];


  const changes = [];


  if(
    latest.weight_kg !== null &&
    earliest.weight_kg !== null
  ){

    changes.push(
      `体重 ${
        formatChange(
          latest.weight_kg -
          earliest.weight_kg
        )
      } kg`
    );

  }


  if(
    latest.waist_cm !== null &&
    earliest.waist_cm !== null
  ){

    changes.push(
      `腰围 ${
        formatChange(
          latest.waist_cm -
          earliest.waist_cm
        )
      } cm`
    );

  }


  if(
    latest.hip_cm !== null &&
    earliest.hip_cm !== null
  ){

    changes.push(
      `臀围 ${
        formatChange(
          latest.hip_cm -
          earliest.hip_cm
        )
      } cm`
    );

  }


  box.innerHTML =

    `从第一条记录
    ${earliest.record_date}
    到最新记录
    ${latest.record_date}：
    <br><br>
    <strong>
    ${changes.join("，")}
    </strong>`;

}



/* ================================
   数字变化格式
================================ */

function formatChange(
  value
){

  const number =
    Number(value);


  if(number > 0){

    return "+" +
      number.toFixed(1);

  }


  return number.toFixed(1);

}
