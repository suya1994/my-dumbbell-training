/*
 * v1.1
 * Supabase 数据库 API
 *
 * 注意：
 * SUPABASE_URL 和 SUPABASE_KEY
 * 暂时仍由 app.js 提供。
 */

async function supabaseRequest(
  endpoint,
  options = {}
) {

  const response =
    await fetch(
      SUPABASE_URL +
      "/rest/v1/" +
      endpoint,
      {

        ...options,

        headers: {

          "apikey":
          SUPABASE_KEY,

          "Authorization":
          "Bearer " +
          SUPABASE_KEY,

          "Content-Type":
          "application/json",

          "Prefer":
          options.method === "POST"
            ? "return=representation"
            : "return=minimal",

          ...(options.headers || {})

        }

      }
    );


  if (!response.ok) {

    const text =
      await response.text();

    throw new Error(
      "HTTP " +
      response.status +
      "：" +
      text
    );

  }


  const text =
    await response.text();


  return text
    ? JSON.parse(text)
    : [];

}
