// js/modules/utils.js
// 共通工具函數模組 (大掃除收納)

export function isLocalhost() {
  return window.location.hostname === "localhost" ||
         window.location.hostname === "127.0.0.1" ||
         window.location.hostname === "::1" ||
         window.location.hostname.startsWith("192.168.");
}

export function isLocalhostGoogleLoginAllowed() {
  return window.location.hostname === "localhost" ||
         window.location.hostname === "127.0.0.1" ||
         window.location.hostname === "::1";
}

export function formatDate(date) {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  if (dateStr.includes("/")) {
    const parts = dateStr.split("/");
    const month = parseInt(parts[0], 10) - 1;
    const day = parseInt(parts[1], 10);
    const d = new Date();
    d.setMonth(month, day);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function showToast(message, duration = 3000) {
  if (typeof window.showToast === "function") {
    window.showToast(message, duration);
  } else {
    console.log(`[Toast Fallback] ${message}`);
  }
}
