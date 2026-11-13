/*
 * history.js
 * 历史记录页：训练历史（workout_sessions）+ 身体数据
 */

const HISTORY_PAGE_SIZE = 15;
const HISTORY_FETCH_SIZE = HISTORY_PAGE_SIZE + 1;

let historySessions = [];
let historySessionOffset = 0;
let historyHasMoreSessions = false;

let historyBodyMetrics = [];
let historyBodyMetricOffset = 0;
let historyHasMoreBodyMetrics = false;

function historyEscapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function historyTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function updateHistoryToday() {
  const todayBox = document.getElementById("today");
  if (!todayBox) return;
  todayBox.textContent = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function showHistorySection(sectionId, button) {
  document.querySelectorAll(".history-section").forEach((section) => {
    section.classList.add("hidden");
  });
  const target = document.getElementById(sectionId);
  if (target) target.classList.remove("hidden");

  document.querySelectorAll(".history-nav button").forEach((item) => {
    item.classList.remove("active");
  });
  if (button) button.classList.add("active");
}

function historyPaginationQuery(baseQuery, offset) {
  return baseQuery + `&limit=${HISTORY_FETCH_SIZE}&offset=${offset}`;
}

/* ================= 训练历史（workout_sessions） ================= */

async function loadHistorySessions(reset = false) {
  try {
    if (reset) {
      historySessionOffset = 0;
      historySessions = [];
      historyHasMoreSessions = false;
    }
    if (!reset && historySessionOffset < 0) return;

    const query = historyPaginationQuery(
      "workout_sessions?select=id,session_no,workout_date,plan_id,plan_code,plan_name,total_items,done_items,completion_percent,created_at&order=workout_date.desc,session_no.desc,id.desc",
      historySessionOffset,
    );
    const data = await supabaseRequest(query);
    const records = Array.isArray(data) ? data : [];
    historyHasMoreSessions = records.length > HISTORY_PAGE_SIZE;
    const visible = records.slice(0, HISTORY_PAGE_SIZE);
    historySessions = historySessions.concat(visible);
    historySessionOffset += visible.length;
  } catch (error) {
    console.error("读取训练历史失败：", error);
    if (reset) {
      historySessions = [];
      historyHasMoreSessions = false;
    }
    const box = document.getElementById("historyList");
    if (box) {
      box.innerHTML = `<div class="muted">读取训练历史失败：${historyEscapeHtml(error?.message || String(error))}</div>`;
    }
  }
}

function renderWorkoutHistory() {
  const box = document.getElementById("historyList");
  if (!box) return;

  if (!historySessions.length) {
    box.innerHTML = `<div class="muted">目前还没有训练历史记录。</div>`;
    renderWorkoutLoadMoreButton();
    return;
  }

  box.innerHTML = historySessions
    .map((s) => {
      const id = String(s.id ?? "");
      const sessionNo = s.session_no != null ? `第 ${historyEscapeHtml(s.session_no)} 次训练` : "训练记录";
      const planLabel = [s.plan_code, s.plan_name].filter(Boolean).join("｜") || "未记录计划";
      const date = historyEscapeHtml(s.workout_date || "");
      const total = Number(s.total_items) || 0;
      const done = Number(s.done_items) || 0;
      const pct = Number.isFinite(Number(s.completion_percent))
        ? Number(s.completion_percent)
        : (total ? Math.round((done / total) * 100) : 0);

      return `
        <div class="history-item">
          <div class="history-title">${sessionNo}</div>
          <div class="muted">计划：${historyEscapeHtml(planLabel)}</div>
          <div class="muted">日期：${date || "—"}</div>
          <div class="muted">完成情况：${done} / ${total}（${pct}%）</div>
          <br>
          <button type="button" class="secondary-btn" onclick="toggleWorkoutDetail('${id}')">查看动作详情</button>
          <button type="button" class="secondary-btn" onclick="handleDeleteWorkoutFromHistory('${id}', '${historyEscapeHtml(s.session_no ?? "")}')">🗑 删除这次训练</button>
          <div id="workout-detail-${id}" class="hidden"></div>
        </div>
      `;
    })
    .join("");

  renderWorkoutLoadMoreButton();
}

function renderWorkoutLoadMoreButton() {
  const button = document.getElementById("loadMoreWorkoutsButton");
  if (!button) return;
  if (!historyHasMoreSessions) {
    button.classList.add("hidden");
    return;
  }
  button.classList.remove("hidden");
  button.disabled = false;
  button.textContent = "加载更多";
}

async function loadMoreWorkouts() {
  const button = document.getElementById("loadMoreWorkoutsButton");
  if (button) {
    button.disabled = true;
    button.textContent = "正在加载……";
  }
  await loadHistorySessions(false);
  renderWorkoutHistory();
}

async function loadWorkoutSessionItems(sessionId) {
  const data = await supabaseRequest(
    `workout_session_items?select=id,session_id,sort_order,exercise_id,exercise_name,group_code,equipment_label,sets,reps,duration_seconds,side,status&session_id=eq.${encodeURIComponent(sessionId)}&order=sort_order.asc,id.asc`,
  );
  return Array.isArray(data) ? data : [];
}

function formatItemDosage(item) {
  const sets = item?.sets;
  const reps = item?.reps;
  const seconds = item?.duration_seconds;
  const side = item?.side === "each_side" ? "每侧" : "双侧/不分侧";
  const repsText = reps != null ? `${reps}次${item?.side === "each_side" ? "/侧" : ""}` : null;
  const secText = seconds != null ? `${seconds}秒${item?.side === "each_side" ? "/侧" : ""}` : null;
  if (sets != null && (repsText || secText)) {
    return `${sets}组 × ${[repsText, secText].filter(Boolean).join(" + ")}（${side}）`;
  }
  const parts = [];
  if (sets != null) parts.push(`${sets}组`);
  if (repsText) parts.push(repsText);
  if (secText) parts.push(secText);
  return parts.length ? `${parts.join(" ")}（${side}）` : "未记录";
}

async function toggleWorkoutDetail(sessionId) {
  const box = document.getElementById("workout-detail-" + sessionId);
  if (!box) return;
  if (!box.classList.contains("hidden")) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = '<div class="muted">正在读取动作详情……</div>';

  try {
    const items = await loadWorkoutSessionItems(sessionId);
    if (!items.length) {
      box.innerHTML = '<div class="muted">暂无动作记录。</div>';
      return;
    }
    box.innerHTML = items
      .map((it, idx) => {
        const done = it.status === "done";
        return `
          <div class="exercise" style="margin-top:8px;">
            <div class="exercise-row">
              <div class="exercise-info">
                <div class="exercise-name">
                  ${idx + 1}. ${historyEscapeHtml(it.exercise_name || "未命名动作")}
                  <span class="tag ${done ? "tag-ok" : "tag-off"}">${done ? "完成" : "未完成"}</span>
                </div>
                <div class="exercise-detail">
                  分组：${historyEscapeHtml(it.group_code || "—")} · 器械：${historyEscapeHtml(it.equipment_label || "—")}
                </div>
                <div class="exercise-detail">目标：${historyEscapeHtml(formatItemDosage(it))}</div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (error) {
    console.error("读取训练详情失败：", error);
    box.innerHTML = `<div class="muted">读取动作详情失败：${historyEscapeHtml(error?.message || String(error))}</div>`;
  }
}

async function historySyncTrainingCounter() {
  try {
    const sessions = await supabaseRequest("workout_sessions?select=id");
    const count = Array.isArray(sessions) ? sessions.length : 0;
    await supabaseRequest("training_counter?id=eq.1", {
      method: "PATCH",
      body: { completed_count: count, updated_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
  } catch (e) {
    console.warn("同步训练次数失败：", e);
  }
}

async function handleDeleteWorkoutFromHistory(sessionId, sessionNo) {
  if (!sessionId) {
    alert("找不到这次训练记录。");
    return;
  }
  const label = sessionNo ? `第 ${sessionNo} 次训练` : "这次训练";
  if (!confirm(`确定要删除「${label}」吗？\n\n删除后该次训练记录及其动作明细将被移除，且无法恢复。`)) {
    return;
  }

  try {
    await supabaseRequest(`workout_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
    await historySyncTrainingCounter();
    await loadHistorySessions(true);
    renderWorkoutHistory();
    alert("训练记录已删除。");
  } catch (error) {
    console.error("删除训练失败：", error);
    alert("删除失败：" + (error?.message || String(error)));
  }
}

/* ================= 身体数据 ================= */

async function loadHistoryBodyMetrics(reset = false) {
  try {
    if (reset) {
      historyBodyMetricOffset = 0;
      historyBodyMetrics = [];
      historyHasMoreBodyMetrics = false;
    }
    if (!reset && historyBodyMetricOffset < 0) return;

    const query = historyPaginationQuery(
      "body_metrics?select=*&order=record_date.desc,id.desc",
      historyBodyMetricOffset,
    );
    const data = await supabaseRequest(query);
    const records = Array.isArray(data) ? data : [];
    historyHasMoreBodyMetrics = records.length > HISTORY_PAGE_SIZE;
    const visible = records.slice(0, HISTORY_PAGE_SIZE);
    historyBodyMetrics = historyBodyMetrics.concat(visible);
    historyBodyMetricOffset += visible.length;
  } catch (error) {
    console.error("身体数据历史读取失败：", error);
    if (reset) {
      historyBodyMetrics = [];
      historyHasMoreBodyMetrics = false;
    }
  }
}

function isHistoryBodyMetricValid(value) {
  if (value === null || value === undefined || value === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function renderBodyMetricsHistory() {
  const box = document.getElementById("bodyMetricsHistoryList");
  if (!box) return;
  if (!historyBodyMetrics.length) {
    box.innerHTML = `<div class="muted">目前还没有身体数据记录。</div>`;
    renderBodyMetricsLoadMoreButton();
    return;
  }
  box.innerHTML = historyBodyMetrics
    .map((record) => {
      const recordId = String(record.id ?? "");
      const date = record.record_date || "";
      const values = [];
      if (isHistoryBodyMetricValid(record.weight_kg)) values.push(`体重 ${record.weight_kg} kg`);
      if (isHistoryBodyMetricValid(record.waist_cm)) values.push(`腰围 ${record.waist_cm} cm`);
      if (isHistoryBodyMetricValid(record.hip_cm)) values.push(`臀围 ${record.hip_cm} cm`);
      return `
        <div class="history-item">
          <div class="history-title">📏 ${historyEscapeHtml(date)}</div>
          <div class="muted">${values.length ? values.join(" · ") : "当天没有有效身体数据"}</div>
          <br>
          <button type="button" class="secondary-btn" onclick="handleDeleteBodyMetricFromHistory('${historyEscapeHtml(recordId)}', '${historyEscapeHtml(date)}')">🗑 删除这条数据</button>
        </div>
      `;
    })
    .join("");
  renderBodyMetricsLoadMoreButton();
}

function renderBodyMetricsLoadMoreButton() {
  const button = document.getElementById("loadMoreBodyMetricsButton");
  if (!button) return;
  if (!historyHasMoreBodyMetrics) { button.classList.add("hidden"); return; }
  button.classList.remove("hidden");
  button.disabled = false;
  button.textContent = "加载更多";
}

async function loadMoreBodyMetrics() {
  const button = document.getElementById("loadMoreBodyMetricsButton");
  if (button) { button.disabled = true; button.textContent = "正在加载……"; }
  await loadHistoryBodyMetrics(false);
  renderBodyMetricsHistory();
}

async function handleDeleteBodyMetricFromHistory(metricId, recordDate) {
  if (!metricId) { alert("找不到这条身体数据的 ID。"); return; }
  const displayDate = recordDate ? `${recordDate} 的身体数据` : "这条身体数据";
  if (!confirm(`确定要删除「${displayDate}」吗？\n\n删除后对应的统计和图表会同步更新。\n此操作无法恢复。`)) return;
  try {
    await supabaseRequest(`body_metrics?id=eq.${encodeURIComponent(metricId)}`, { method: "DELETE" });
    await loadHistoryBodyMetrics(true);
    renderBodyMetricsHistory();
    alert("身体数据已删除。");
  } catch (error) {
    console.error("删除身体数据失败：", error);
    alert("删除失败，请检查数据库权限或网络连接。");
  }
}

async function loadHistoryPage() {
  historySessionOffset = 0; historySessions = []; historyHasMoreSessions = false;
  historyBodyMetricOffset = 0; historyBodyMetrics = []; historyHasMoreBodyMetrics = false;

  await Promise.all([
    loadHistorySessions(true),
    loadHistoryBodyMetrics(true),
  ]);

  renderWorkoutHistory();
  renderBodyMetricsHistory();
}

document.addEventListener("DOMContentLoaded", async function () {
  updateHistoryToday();
  const firstButton = document.querySelector(".history-nav button");
  if (firstButton) firstButton.classList.add("active");
  await loadHistoryPage();
});
