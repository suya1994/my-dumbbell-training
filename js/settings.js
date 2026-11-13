/*
 * settings.js
 * 设置页相关逻辑已移除（保留空实现以避免其他页面引用时报错）
 */

function getAISettings() {
  return {
    weekly_strength_target: 3,
    expected_duration_minutes: 30,
    behavior: "",
  };
}

async function loadAISettings() {
  return getAISettings();
}

async function saveAISettings() {
  return;
}
