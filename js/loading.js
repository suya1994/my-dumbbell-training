/* ================================
   loading.js
   全局 Loading 覆盖层

   用法：

   showPageLoading("正在保存…")
   hidePageLoading()

   多个请求同时进行时自动计数：
   全部请求结束后才会隐藏。
=============================== */

let pageLoadingCount = 0;

let pageLoadingElement = null;

/* =========================================================
   确保 loading 元素存在
========================================================= */

function ensurePageLoadingElement() {
  if (pageLoadingElement && document.body.contains(pageLoadingElement)) {
    return;
  }

  /*
     如果 body 还没准备好：
     等待 DOM 加载后再创建。
  */

  if (!document.body) {
    document.addEventListener(
      "DOMContentLoaded",

      function () {
        ensurePageLoadingElement();
      },

      { once: true },
    );

    return;
  }

  const div = document.createElement("div");

  div.id = "pageLoadingOverlay";

  div.className = "page-loading-overlay hidden";

  div.innerHTML = `
      <div class="page-loading-box">

        <div class="page-loading-spinner"></div>

        <div class="page-loading-text">请稍候…</div>

      </div>
    `;

  document.body.appendChild(div);

  pageLoadingElement = div;
}

/* =========================================================
   打开 Loading

   可以传入文字：
   showPageLoading("正在保存…")
========================================================= */

function showPageLoading(text) {
  ensurePageLoadingElement();

  if (!pageLoadingElement) {
    return;
  }

  pageLoadingCount += 1;

  if (text) {
    const textEl = pageLoadingElement.querySelector(".page-loading-text");

    if (textEl) {
      textEl.textContent = text;
    }
  }

  pageLoadingElement.classList.remove("hidden");
}

/* =========================================================
   关闭 Loading

   只有请求计数归零后才真正隐藏。
========================================================= */

function hidePageLoading() {
  if (pageLoadingCount > 0) {
    pageLoadingCount -= 1;
  }

  if (pageLoadingCount > 0) {
    return;
  }

  if (pageLoadingElement) {
    pageLoadingElement.classList.add("hidden");
  }
}