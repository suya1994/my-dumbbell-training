/* ================================
   analysis.js
   每日 / 每周 / 每月 / 长期分析
   + 训练 × 身体数据
   + 动作进步分析
================================ */

/* ================================
   每日分析
================================ */

function updateDailyAnalysis() {
  const box = document.getElementById("dailyAnalysis");

  if (!box) {
    return;
  }

  /*
    每日分析以数据库中的 records 为准，
    不再使用当前训练页面的 completed 状态。
  */

  const today = todayString();

  const todayRecords =
    typeof records !== "undefined"
      ? records.filter((record) => record.workout_date === today)
      : [];

  /* ================================
     今天没有保存训练
  ================================ */

  if (!todayRecords.length) {
    box.textContent = "今天还没有完成训练。";

    return;
  }

  /* ================================
     今天训练次数
  ================================ */

  const count = todayRecords.length;

  /* ================================
     平均完成度
  ================================ */

  const average = Math.round(
    todayRecords.reduce(
      (sum, record) => sum + Number(record.completion_percent || 0),
      0,
    ) / count,
  );

  /* ================================
     根据完成度生成分析
  ================================ */

  if (average === 100) {
    box.textContent =
      `今天完成 ${count} 次训练，` +
      `平均完成度 ${average}%。` +
      "全部完成，今天训练执行得非常好，继续保持。";
  } else if (average >= 75) {
    box.textContent =
      `今天完成 ${count} 次训练，` +
      `平均完成度 ${average}%。` +
      "整体完成得很好，继续保持。";
  } else if (average >= 50) {
    box.textContent =
      `今天完成 ${count} 次训练，` +
      `平均完成度 ${average}%。` +
      "已经完成一半以上，先保证动作质量。";
  } else {
    box.textContent =
      `今天完成 ${count} 次训练，` +
      `平均完成度 ${average}%。` +
      "今天完成度偏低，不需要急着增加训练量。";
  }
}

/* ================================
   每周记录
================================ */

function getWeekRecords() {
  const now = new Date();

  const day = now.getDay();

  const diff = day === 0 ? -6 : 1 - day;

  const monday = new Date(now);

  monday.setDate(now.getDate() + diff);

  monday.setHours(0, 0, 0, 0);

  return records.filter((record) => {
    const date = new Date(record.workout_date);

    return date >= monday;
  });
}

/* ================================
   读取每周训练目标
================================ */

function getWeeklyGoalSettings() {
  const savedMin = localStorage.getItem("weekly_min_goal");

  const savedIdeal = localStorage.getItem("weekly_ideal_goal");

  return {
    min: savedMin !== null ? Number(savedMin) : 3,

    ideal: savedIdeal !== null ? Number(savedIdeal) : 4,
  };
}

/* ================================
   每周分析
================================ */

function updateWeeklyAnalysis() {
  const list = getWeekRecords();

  const count = list.length;

  const goals = getWeeklyGoalSettings();

  const minimumGoal = goals.min;

  const idealGoal = goals.ideal;

  /* ================================
     基础元素
  ================================ */

  const countBox = document.getElementById("weekCount");

  const remainingBox = document.getElementById("weekRemaining");

  const goalDisplayBox = document.getElementById("weeklyGoalDisplay");

  const goalBox = document.getElementById("weeklyGoal");

  const averageBox = document.getElementById("weekAverage");

  const minutesBox = document.getElementById("weekMinutes");

  const bestBox = document.getElementById("weekBest");

  const analysisBox = document.getElementById("weeklyAnalysis");

  /* ================================
     显示目标次数
  ================================ */

  if (goalDisplayBox) {
    goalDisplayBox.textContent = `${minimumGoal}–${idealGoal}`;
  }

  /* ================================
     已完成次数
  ================================ */

  if (countBox) {
    countBox.textContent = count;
  }

  /* ================================
     距离最低目标还差几次
  ================================ */

  const remaining = Math.max(minimumGoal - count, 0);

  if (remainingBox) {
    remainingBox.textContent = remaining;
  }

  /* ================================
     还没有训练
  ================================ */

  if (!count) {
    if (remainingBox) {
      remainingBox.textContent = minimumGoal;
    }

    if (averageBox) {
      averageBox.textContent = "—";
    }

    if (minutesBox) {
      minutesBox.textContent = "0";
    }

    if (bestBox) {
      bestBox.textContent = "—";
    }

    if (goalBox) {
      goalBox.innerHTML = `本周还没有训练。<br><br>
         🎯 最低目标：
         <strong>${minimumGoal} 次</strong><br>
         💪 理想目标：
         <strong>${idealGoal} 次</strong>`;
    }

    if (analysisBox) {
      analysisBox.textContent = "完成第一次训练后，这里会开始统计本周表现。";
    }

    return;
  }

  /* ================================
     平均完成度
  ================================ */

  const average = Math.round(
    list.reduce((sum, r) => sum + Number(r.completion_percent || 0), 0) / count,
  );

  /* ================================
     累计训练时间
  ================================ */

  const minutes = list.reduce(
    (sum, r) => sum + Number(r.duration_minutes || 0),
    0,
  );

  /* ================================
     最高完成度
  ================================ */

  const best = Math.max(...list.map((r) => Number(r.completion_percent || 0)));

  if (averageBox) {
    averageBox.textContent = average + "%";
  }

  if (minutesBox) {
    minutesBox.textContent = minutes;
  }

  if (bestBox) {
    bestBox.textContent = best + "%";
  }

  /* ================================
     本周目标状态
  ================================ */

  if (goalBox) {
    if (count < minimumGoal) {
      const left = minimumGoal - count;

      goalBox.innerHTML = `本周已经完成
         <strong>${count} 次</strong>训练。<br><br>
         再完成
         <strong>${left} 次</strong>，
         就达到本周最低目标。<br><br>
         🎯 理想目标：
         <strong>${idealGoal} 次</strong>`;
    } else if (count < idealGoal) {
      const left = idealGoal - count;

      goalBox.innerHTML = `🎉 本周已经完成
         <strong>${count} 次</strong>训练，
         已达到最低目标！<br><br>
         如果状态良好，再完成
         <strong>${left} 次</strong>，
         就达到理想目标。`;
    } else {
      goalBox.innerHTML = `🔥 本周已经完成
         <strong>${count} 次</strong>训练，
         已达到理想目标！<br><br>
         当前训练频率很好，
         注意给身体足够恢复时间。`;
    }
  }

  /* ================================
     每周分析
  ================================ */

  if (analysisBox) {
    if (average >= 90) {
      analysisBox.textContent = `本周完成 ${count} 次训练，
         平均完成度 ${average}%。
         训练执行得很好，继续保持。`;
    } else if (average >= 70) {
      analysisBox.textContent = `本周完成 ${count} 次训练，
         平均完成度 ${average}%。
         整体不错，继续优先保证动作质量。`;
    } else {
      analysisBox.textContent = `本周完成 ${count} 次训练，
         平均完成度 ${average}%。
         不需要急着增加训练量，
         先把动作完成质量做好。`;
    }
  }
}

/* ================================
   每月
================================ */

function getMonthRecords() {
  const now = new Date();

  return records.filter((record) => {
    const date = new Date(record.workout_date);

    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth()
    );
  });
}

function updateMonthlyAnalysis() {
  const list = getMonthRecords();

  const count = list.length;

  const average = count
    ? Math.round(
        list.reduce((sum, r) => sum + Number(r.completion_percent || 0), 0) /
          count,
      )
    : 0;

  const minutes = list.reduce(
    (sum, r) => sum + Number(r.duration_minutes || 0),
    0,
  );

  const countBox = document.getElementById("monthCount");

  const averageBox = document.getElementById("monthAverage");

  const minutesBox = document.getElementById("monthMinutes");

  const analysisBox = document.getElementById("monthlyAnalysis");

  const highlightBox = document.getElementById("monthlyHighlights");

  if (countBox) {
    countBox.textContent = count;
  }

  if (averageBox) {
    averageBox.textContent = count ? average + "%" : "—";
  }

  if (minutesBox) {
    minutesBox.textContent = minutes;
  }

  if (!count) {
    if (analysisBox) {
      analysisBox.textContent = "本月还没有训练记录。";
    }

    if (highlightBox) {
      highlightBox.textContent = "等待更多训练数据……";
    }

    return;
  }

  if (analysisBox) {
    analysisBox.textContent = `本月共完成 ${count} 次训练，累计约 ${minutes} 分钟，平均完成度 ${average}%。`;
  }

  const best = Math.max(...list.map((r) => Number(r.completion_percent || 0)));

  if (highlightBox) {
    highlightBox.innerHTML = `本月最高完成度：
       <strong>${best}%</strong>`;
  }
}

/* ================================
   长期趋势
================================ */

function updateTrendAnalysis() {
  const total = records.length;

  const minutes = records.reduce(
    (sum, r) => sum + Number(r.duration_minutes || 0),
    0,
  );

  const average = total
    ? Math.round(
        records.reduce((sum, r) => sum + Number(r.completion_percent || 0), 0) /
          total,
      )
    : 0;

  const best = total
    ? Math.max(...records.map((r) => Number(r.completion_percent || 0)))
    : 0;

  setText("totalWorkouts", total + " 次");

  setText("totalMinutes", minutes + " 分钟");

  setText("totalAverage", total ? average + "%" : "—");

  setText("bestCompletion", total ? best + "%" : "—");

  /*
    动作进步
  */

  updateExerciseProgressAnalysis();

  /*
    训练 × 身体数据
  */

  updateTrainingBodyAnalysis();
}

/* ================================
   动作进步分析
================================ */

function updateExerciseProgressAnalysis() {
  const box = document.getElementById("exerciseTrend");

  if (!box) {
    return;
  }

  const data = typeof exerciseRecords !== "undefined" ? exerciseRecords : [];

  if (!data.length) {
    box.textContent = "完成几次训练并保存后，这里会开始显示动作进步。";

    return;
  }

  /* ================================
     按动作名称分组
  ================================ */

  const groups = {};

  data.forEach((item) => {
    if (!item.exercise_name) {
      return;
    }

    if (item.completed === false) {
      return;
    }

    const name = item.exercise_name;

    if (!groups[name]) {
      groups[name] = [];
    }

    groups[name].push(item);
  });

  const names = Object.keys(groups);

  if (!names.length) {
    box.textContent = "目前还没有已完成动作的数据。";

    return;
  }

  /* ================================
     动作分析
  ================================ */

  const html = names
    .slice(0, 8)
    .map((name) => {
      const list = groups[name];

      const latest = list[list.length - 1];

      /*
          第一次训练
        */

      const first = list[0];

      /*
          上一次训练
        */

      const previous = list.length >= 2 ? list[list.length - 2] : null;

      /* ================================
           当前数据
        ================================ */

      const latestWeight = Number(
        latest.actual_weight_kg ?? latest.weight_kg ?? 0,
      );

      const latestReps = parseFirstNumber(latest.actual_reps ?? latest.reps);

      /* ================================
           只有一次记录
        ================================ */

      if (!previous) {
        let detail = `已训练 1 次`;

        if (latestWeight > 0) {
          detail += ` · 当前 ${latestWeight} kg`;
        }

        if (latestReps > 0) {
          detail += ` × ${latestReps}次`;
        }

        return `

            <div class="history-item">

              <div class="history-title">
                ${escapeHtml(name)}
              </div>

              <div class="muted">
                ${detail}
              </div>

              <div class="muted">
                🆕 首次记录
              </div>

              <div class="muted">
                暂无历史数据，下一次训练后开始比较。
              </div>

            </div>

          `;
      }

      /* ================================
           上一次数据
        ================================ */

      const previousWeight = Number(
        previous.actual_weight_kg ?? previous.weight_kg ?? 0,
      );

      const previousReps = parseFirstNumber(
        previous.actual_reps ?? previous.reps,
      );

      const weightChange = latestWeight - previousWeight;

      const repsChange = latestReps - previousReps;

      /* ================================
           判断状态
        ================================ */

      let progressText = "➡️ 保持稳定";

      let changeText = "本次训练与上次基本一致。";

      if (weightChange > 0 || repsChange > 0) {
        progressText = "📈 有进步";

        const changes = [];

        if (repsChange > 0) {
          changes.push(`次数 +${repsChange}`);
        }

        if (weightChange > 0) {
          changes.push(`重量 +${weightChange.toFixed(1)} kg`);
        }

        changeText = changes.join("，");
      } else if (weightChange < 0 || repsChange < 0) {
        progressText = "↔️ 本次略低";

        const changes = [];

        if (repsChange < 0) {
          changes.push(`次数 ${repsChange}`);
        }

        if (weightChange < 0) {
          changes.push(`重量 ${weightChange.toFixed(1)} kg`);
        }

        changeText =
          changes.join("，") + "。先保证动作质量，不需要强行追赶上一次。";
      }

      /* ================================
           左右手
        ================================ */

      const left = parseFirstNumber(latest.left_reps);

      const right = parseFirstNumber(latest.right_reps);

      let sideText = "";

      if (left > 0 && right > 0) {
        const difference = Math.abs(left - right);

        if (difference === 0) {
          sideText = `左右手：${left} / ${right} 次 · 很平衡`;
        } else {
          const weaker = left < right ? "左手" : "右手";

          sideText = `左右手：${left} / ${right} 次 · ${weaker}少 ${difference} 次`;
        }
      }

      /* ================================
           当前状态
        ================================ */

      let detail = `已训练 ${list.length} 次`;

      if (latestWeight > 0) {
        detail += ` · 当前 ${latestWeight} kg`;
      }

      if (latestReps > 0) {
        detail += ` × ${latestReps}次`;
      }

      return `

          <div class="history-item">

            <div class="history-title">
              ${escapeHtml(name)}
            </div>

            <div class="muted">
              ${detail}
            </div>

            <div class="muted">
              ${progressText}
            </div>

            <div class="muted">
              ${escapeHtml(changeText)}
            </div>

            ${
              sideText
                ? `
                  <div class="muted">
                    ${escapeHtml(sideText)}
                  </div>
                `
                : ""
            }

          </div>

        `;
    })
    .join("");

  box.innerHTML = `

    <div class="muted">

      已记录 ${data.length} 条动作数据，
      当前追踪 ${names.length} 个动作。

    </div>

    <br>

    ${html}

  `;
}

/* ================================
   提取次数中的第一个数字
================================ */

function parseFirstNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  const match = String(value).match(/[\d.]+/);

  if (!match) {
    return 0;
  }

  return Number(match[0]) || 0;
}

/* ================================
   训练 × 身体数据
================================ */

function updateTrainingBodyAnalysis() {
  const box = document.getElementById("trainingBodyAnalysis");

  if (!box) {
    return;
  }

  const data =
    typeof bodyMetricsRecords !== "undefined" ? bodyMetricsRecords : [];

  if (!data.length) {
    box.textContent = "开始记录身体数据后，这里会分析训练与身体变化的关系。";

    return;
  }

  if (data.length < 2) {
    box.textContent =
      "目前只有1条身体数据记录。再记录一次后，就可以开始分析变化趋势。";

    return;
  }

  const first = data[data.length - 1];

  const latest = data[0];

  const lines = [];

  if (first.weight_kg !== null && latest.weight_kg !== null) {
    lines.push(`体重 ${formatChange(latest.weight_kg - first.weight_kg)} kg`);
  }

  if (first.waist_cm !== null && latest.waist_cm !== null) {
    lines.push(`腰围 ${formatChange(latest.waist_cm - first.waist_cm)} cm`);
  }

  if (first.hip_cm !== null && latest.hip_cm !== null) {
    lines.push(`臀围 ${formatChange(latest.hip_cm - first.hip_cm)} cm`);
  }

  if (!lines.length) {
    box.textContent = "目前没有足够的身体数据进行比较。";

    return;
  }

  box.innerHTML = `从第一次身体记录 ${first.record_date} 到最新记录 ${latest.record_date}：<br><br>
    <strong>${lines.join("，")}</strong>
    <br><br>
    继续保持每周力量训练，后续数据积累后会更容易判断塑形效果。`;
}

/* ================================
   工具
================================ */

function setText(id, text) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = text;
  }
}
