let otherActivities = [];

/* ================================
   读取其他运动
================================ */

async function loadOtherActivities() {
  try {
    const data = await supabaseRequest(
      "other_activities" + "?select=*" + "&order=activity_date.desc,id.desc",
    );

    otherActivities = Array.isArray(data) ? data : [];

    renderOtherActivities();

    updateOtherActivityStats();
  } catch (error) {
    console.error("其他运动读取失败：", error);

    otherActivities = [];
  }
}

/* ================================
   新增其他运动
================================ */

async function addOtherActivity() {
  const dateBox = document.getElementById("activityDate");

  const typeBox = document.getElementById("activityType");

  const durationBox = document.getElementById("activityDuration");

  const noteBox = document.getElementById("activityNote");

  if (!typeBox || !durationBox) {
    return;
  }

  const activityType = typeBox.value.trim();

  const duration = Number(durationBox.value);

  const date = dateBox?.value || todayString();

  const note = noteBox?.value.trim() || "";

  if (!activityType) {
    alert("请输入运动类型。");
    return;
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    alert("请输入正确的运动时间。");
    return;
  }

  try {
    await supabaseRequest("other_activities", {
      method: "POST",

      body: {
        activity_date: date,
        activity_type: activityType,
        duration_minutes: duration,
        note: note,
      },
    });

    if (dateBox) {
      dateBox.value = todayString();
    }

    typeBox.value = "";

    durationBox.value = "";

    if (noteBox) {
      noteBox.value = "";
    }

    await loadOtherActivities();

    alert("其他运动记录已保存。");
  } catch (error) {
    console.error("保存其他运动失败：", error);

    alert("保存失败：\n\n" + (error.message || String(error)));
  }
}
