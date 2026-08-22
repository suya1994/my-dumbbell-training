/* ================================
   基础请求
   Supabase REST API
================================ */

async function supabaseRequest(path, options = {}) {
  /* ========================================================
     1. 默认使用 Supabase anon key
  ======================================================== */

  let accessToken = SUPABASE_KEY;

  /* ========================================================
     2. 如果 Supabase Auth Session 存在
        使用当前登录用户的 access_token

        这样 RLS 才会识别为：

        authenticated
  ======================================================== */

  try {
    if (
      typeof supabase !== "undefined" &&
      supabase &&
      supabase.auth &&
      typeof supabase.auth.getSession === "function"
    ) {
      const { data, error } = await supabase.auth.getSession();

      if (!error && data?.session?.access_token) {
        accessToken = data.session.access_token;
      }
    }
  } catch (error) {
    console.warn("读取 Supabase 登录 Session 失败，继续使用 anon key：", error);
  }

  /* ========================================================
     3. 发起请求
  ======================================================== */

  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: options.method || "GET",

    headers: {
      apikey: SUPABASE_KEY,

      Authorization: "Bearer " + accessToken,

      "Content-Type": "application/json",

      Prefer: options.prefer || "return=representation",
    },

    body:
      options.body !== undefined && options.body !== null
        ? JSON.stringify(options.body)
        : undefined,
  });

  /* ========================================================
     4. Supabase 返回错误
  ======================================================== */

  if (!response.ok) {
    const text = await response.text();

    throw new Error("HTTP " + response.status + "：" + text);
  }

  /* ========================================================
     5. 读取返回内容
  ======================================================== */

  const text = await response.text();

  if (!text) {
    return [];
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error("Supabase 返回的数据不是有效 JSON：", text);

    throw new Error("Supabase 返回数据解析失败。");
  }
}
