/* ================================
   analysis.js
   每日 / 每周 / 每月 / 长期分析
   + 训练 × 身体数据综合分析
================================ */


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
      `目前完成度 ${percent}%。`
      +
      `先保证动作质量，不需要赶进度。`;

  }

  else if(percent < 100){

    text =
      `目前完成度 ${percent}%。`
      +
      `已经完成大部分训练，继续保持。`;

  }

  else{

    text =
      "🎉 今天全部动作完成！";

  }


  const box =
    document.getElementById(
      "dailyAnalysis"
    );


  if(box){

    box.textContent =
      text;

  }

}



/* ================================
   每周
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


  const count =
    list.length;


  const countBox =
    document.getElementById(
      "weekCount"
    );


  const averageBox =
    document.getElementById(
      "weekAverage"
    );


  const analysisBox =
    document.getElementById(
      "weeklyAnalysis"
    );


  if(countBox){

    countBox.textContent =
      count;

  }


  if(!count){

    if(averageBox){

      averageBox.textContent =
        "—";

    }


    if(analysisBox){

      analysisBox.textContent =
        "本周还没有训练记录。";

    }


    return;

  }


  const average =
    Math.round(

      list.reduce(
        (sum,r) =>
          sum +
          (r.completion_percent || 0),
        0
      )
      /
      count

    );


  if(averageBox){

    averageBox.textContent =
      average + "%";

  }


  if(analysisBox){

    analysisBox.textContent =

      `本周完成 ${count} 次训练，
      平均完成度 ${average}%。`;

  }

}



/* ================================
   每月
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
        (sum,r) =>
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
      (sum,r) =>
        sum +
        (r.duration_minutes || 0),
      0
    );


  const countBox =
    document.getElementById(
      "monthCount"
    );


  const averageBox =
    document.getElementById(
      "monthAverage"
    );


  const minutesBox =
    document.getElementById(
      "monthMinutes"
    );


  const analysisBox =
    document.getElementById(
      "monthlyAnalysis"
    );


  const highlightBox =
    document.getElementById(
      "monthlyHighlights"
    );


  if(countBox){

    countBox.textContent =
      count;

  }


  if(averageBox){

    averageBox.textContent =
      count
      ?
      average + "%"
      :
      "—";

  }


  if(minutesBox){

    minutesBox.textContent =
      minutes;

  }


  if(!count){

    if(analysisBox){

      analysisBox.textContent =
        "本月还没有训练记录。";

    }


    if(highlightBox){

      highlightBox.textContent =
        "等待更多训练数据……";

    }


    return;

  }


  if(analysisBox){

    analysisBox.textContent =

      `本月共完成 ${count} 次训练，
      累计约 ${minutes} 分钟，
      平均完成度 ${average}%。`;

  }


  const best =
    Math.max(
      ...list.map(
        r =>
          r.completion_percent || 0
      )
    );


  if(highlightBox){

    highlightBox.innerHTML =

      `本月最高完成度：
      <strong>${best}%</strong>`;

  }

}



/* ================================
   长期趋势
================================ */

function updateTrendAnalysis(){

  const total =
    records.length;


  const minutes =
    records.reduce(
      (sum,r) =>
        sum +
        (r.duration_minutes || 0),
      0
    );


  const average =
    total
    ?
    Math.round(

      records.reduce(
        (sum,r) =>
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


  setText(
    "totalWorkouts",
    total + " 次"
  );


  setText(
    "totalMinutes",
    minutes + " 分钟"
  );


  setText(
    "totalAverage",
    total
    ?
    average + "%"
    :
    "—"
  );


  setText(
    "bestCompletion",
    total
    ?
    best + "%"
    :
    "—"
  );


  const box =
    document.getElementById(
      "exerciseTrend"
    );


  if(box){

    if(total){

      box.innerHTML =

        `目前累计完成
        <strong>${total} 次</strong>训练，
        平均完成度
        <strong>${average}%</strong>。
        <br><br>
        随着训练次数增加，
        这里会逐渐形成你的长期力量与训练趋势。`;

    }

    else{

      box.textContent =
        "训练数据积累后，这里会显示动作进步。";

    }

  }


  updateTrainingBodyAnalysis();

}



/* ================================
   训练 × 身体数据
================================ */

function updateTrainingBodyAnalysis(){

  const box =
    document.getElementById(
      "trainingBodyAnalysis"
    );


  if(!box){

    return;

  }


  /*
    body_metrics
    由 metrics.js 负责读取

    使用全局变量：
    bodyMetricsRecords
  */

  const data =
    typeof bodyMetricsRecords !== "undefined"
    ?
    bodyMetricsRecords
    :
    [];


  if(!data.length){

    box.textContent =
      "开始记录身体数据后，
      这里会分析训练与身体变化的关系。";

    return;

  }


  if(data.length < 2){

    box.textContent =
      "目前只有1条身体数据记录。
      再记录一次后，就可以开始分析变化趋势。";

    return;

  }


  const first =
    data[data.length - 1];


  const latest =
    data[0];


  const lines = [];


  /*
    体重
  */

  if(
    first.weight_kg !== null &&
    latest.weight_kg !== null
  ){

    const change =
      latest.weight_kg -
      first.weight_kg;


    lines.push(
      `体重 ${
        formatChange(change)
      } kg`
    );

  }


  /*
    腰围
  */

  if(
    first.waist_cm !== null &&
    latest.waist_cm !== null
  ){

    const change =
      latest.waist_cm -
      first.waist_cm;


    lines.push(
      `腰围 ${
        formatChange(change)
      } cm`
    );

  }


  /*
    臀围
  */

  if(
    first.hip_cm !== null &&
    latest.hip_cm !== null
  ){

    const change =
      latest.hip_cm -
      first.hip_cm;


    lines.push(
      `臀围 ${
        formatChange(change)
      } cm`
    );

  }


  if(!lines.length){

    box.textContent =
      "目前没有足够的身体数据进行比较。";

    return;

  }


  box.innerHTML =

    `从第一次身体记录
    ${first.record_date}
    到最新记录
    ${latest.record_date}：

    <br><br>

    <strong>
    ${lines.join("，")}
    </strong>

    <br><br>

    继续保持每周 3–4 次力量训练，
    后续数据积累后会更容易判断塑形效果。`;

}



/* ================================
   工具
================================ */

function setText(
  id,
  text
){

  const element =
    document.getElementById(id);


  if(element){

    element.textContent =
      text;

  }

}
