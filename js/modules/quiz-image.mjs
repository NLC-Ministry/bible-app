// 題目附圖（#449）：payload.image = { src, alt }，顯示在題幹下方，點一下全螢幕放大。
// 不是新題型——任何題型的 payload 都可以帶；目前只有雲柱測驗會用到。
// 圖片來源只接受兩種：站內 assets/ 底下的靜態檔，或後台上傳到本站 Supabase 公開 bucket
// quiz-images 的檔案（#585，檔名是隨機 UUID）。題目內容是管理員寫的，但仍不讓它變成
// 任意外部網址或 javascript: 連結。

const SAFE_IMAGE_SRC = /^assets\/[A-Za-z0-9_\-/]+\.(?:webp|png|jpe?g)$/;
export const QUIZ_IMAGES_BUCKET = "quiz-images";
const UPLOADED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:webp|png|jpe?g)$/;

// 本站 Supabase 的網址（config.js 的 SUPABASE_CONFIG.url）；沒有設定就不接受上傳的圖。
function supabaseOrigin() {
  const raw = globalThis.SUPABASE_CONFIG?.url;
  if (typeof raw !== "string" || !raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.origin : "";
  } catch (_) {
    return "";
  }
}

function uploadedPrefix() {
  const origin = supabaseOrigin();
  return origin ? `${origin}/storage/v1/object/public/${QUIZ_IMAGES_BUCKET}/` : "";
}

/** 上傳後拿到的檔名（<uuid>.webp）→ 公開網址；檔名不對或沒有設定回傳空字串。 */
export function quizImagePublicUrl(name) {
  const prefix = uploadedPrefix();
  return prefix && UPLOADED_NAME.test(String(name || "")) ? `${prefix}${name}` : "";
}

export function isUploadedQuizImageSrc(src) {
  const prefix = uploadedPrefix();
  return !!prefix && typeof src === "string" && src.startsWith(prefix) && UPLOADED_NAME.test(src.slice(prefix.length));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

/** payload.image 合法就回傳 { src, alt }，否則 null。 */
export function getQuestionImage(payload) {
  const image = payload && typeof payload === "object" ? payload.image : null;
  if (!image || typeof image !== "object") return null;
  const src = typeof image.src === "string" ? image.src.trim() : "";
  const safe = (SAFE_IMAGE_SRC.test(src) && !src.includes("..")) || isUploadedQuizImageSrc(src);
  if (!safe) return null;
  const alt = typeof image.alt === "string" && image.alt.trim() ? image.alt.trim() : "題目附圖";
  return { src, alt };
}

/** 題幹下方的圖片；沒有圖或網址不合法時回傳空字串。 */
export function questionImageHtml(payload) {
  const image = getQuestionImage(payload);
  if (!image) return "";
  return `<figure class="quiz-question-image">
    <button type="button" class="quiz-question-image__open" data-quiz-image-open aria-label="放大圖片">
      <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" loading="lazy" decoding="async">
    </button>
    <figcaption class="quiz-question-image__hint">點圖片可以放大</figcaption>
  </figure>`;
}

// ── 放大檢視 ────────────────────────────────────────────────────────────────
// 每次打開才建立一個新的全螢幕層、關掉就移除；不搬動既有的面板（#420 的教訓）。
// 手機上圖片至少 960px 寬，可以左右滑動看每一格。

function closeViewer(viewer) {
  if (!viewer?.isConnected) return;
  viewer.remove();
  viewer._opener?.focus?.({ preventScroll: true });
}

export function openQuizImageViewer(src, alt = "") {
  if (typeof document === "undefined" || !src) return null;
  document.querySelector(".quiz-image-viewer")?.remove();
  const viewer = document.createElement("div");
  viewer.className = "quiz-image-viewer";
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  viewer.setAttribute("aria-label", alt || "題目附圖");
  viewer.innerHTML = `
    <div class="quiz-image-viewer__bar">
      <span class="quiz-image-viewer__hint">可以左右滑動看每一格</span>
      <button type="button" class="quiz-image-viewer__close" data-quiz-image-close>關閉</button>
    </div>
    <div class="quiz-image-viewer__scroll"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></div>`;
  viewer._opener = document.activeElement;
  viewer.addEventListener("click", event => {
    if (event.target.closest("[data-quiz-image-close]") || event.target === viewer) closeViewer(viewer);
  });
  viewer.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.stopPropagation(); closeViewer(viewer); }
  });
  document.body.appendChild(viewer);
  viewer.querySelector("[data-quiz-image-close]")?.focus?.({ preventScroll: true });
  return viewer;
}

/** 掛一次全域的點擊委派：任何 [data-quiz-image-open] 被點就放大裡面的圖。重複呼叫無妨。 */
export function installQuizImageViewer() {
  if (typeof document === "undefined" || document.documentElement.dataset.quizImageViewer) return;
  document.documentElement.dataset.quizImageViewer = "true";
  document.addEventListener("click", event => {
    const trigger = event.target.closest?.("[data-quiz-image-open]");
    if (!trigger) return;
    event.preventDefault();
    const img = trigger.querySelector("img");
    if (img) openQuizImageViewer(img.getAttribute("src"), img.getAttribute("alt") || "");
  });
}
