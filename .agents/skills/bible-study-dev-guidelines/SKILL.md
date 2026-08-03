---
name: bible-study-dev-guidelines
description: 聖經速讀計畫專案架構規範、開發經驗與常犯 BUG 避坑指南 (Bible Study Development Guidelines & Anti-Bug Patterns)
---

# 📖 聖經速讀計畫專案開發規範與避坑指南

本技能包歸納總結自開發過程中的實戰經驗與架構設計心法，旨在避免重複犯錯、確保多人/AI pair-programming 時架構設計風格不衝突、體驗不混亂。

---

## 🛡️ 1. 安全與多租戶防禦 (Security & Multi-Tenant Defense)

* **數據過濾隔離 (Forced Scope)**：所有 Edge Function (`supabase/functions/nlc-data`) 與 DB Trigger/RPC，對寫入、更新與刪除操作必須具備硬性 `user_id` 與 `plan_id` 權限過濾限制（例如 `applyForcedScope`）。
* **嚴禁跨帳號越權**：重置個人進度或切換遍數時，絕對不能使用無過濾條件的全表操作，防止誤刪他人資料。

---

## 🔄 2. UI 狀態與滾動記憶 (Scroll State Preservation)

* **容器重繪記憶 (Scrolltop Preservation)**：
  - 當調用重繪 DOM 容器（例如 `renderHorizontalDateStrip()`，即 `innerHTML = ""`）前，**必須先記錄 `.calendar-scroll-container` 的 `scrollTop` 與 `scrollLeft`**。
  - DOM 重新渲染完成後，立即還原原滾動位置，確保使用者打卡無縫不跳動。
* **平滑滾動取代視窗大跳**：
  - 避免直接呼叫會造成整頁大跳的原生 `scrollIntoView()`。
  - 滾動至目標天數或經文時，優先以 `requestAnimationFrame` 配合容器內區域平滑置中。

---

## 🔒 3. 非同步競態條件與 Session 序號鎖 (Async Race-Condition & Session Counter)

* **瀏覽器 API 鬼影事件 (Cancel Event Ghosting)**：
  - 在 Web Speech API / TTS 語音播放中，呼叫 `window.speechSynthesis.cancel()` 停止播放時，瀏覽器仍會延遲非同步觸發上一會話的 `onend` 或 `onerror` 事件。
* **世代序號鎖 (Generation Counter)**：
  - 引入全域 `currentAudioSessionId`！
  - 每次停止或開啟新播報時將 `currentAudioSessionId` 遞增。
  - 在所有非同步回調 (`onend`, `onerror`, `setTimeout`) 中，檢查 `if (sessionId !== currentAudioSessionId) return;` 強制銷毀過期事件，達到**隨點隨停、不狂刷**。

---

## 🎙️ 4. 真人高質感音質與多譯本聯動 (Natural Neural Speech & Multi-Lang)

* **消除 AI 機械感 (Natural Neural Voice Selector)**：
  - `selectPreferredVoice(voices, lang)` 權重比對中，優先指派含有 `Natural` (自然), `Neural` (神經網路音色), `Online`, `Ting-Ting`, `Samantha`, `HsiaoChen`, `YunJhe` 等真人高品質標籤。
  - 排除 `compact`, `espeak` 等單薄傳統機械聲。
* **譯本語言自動聯動**：
  - 切換至中文譯本 (`CUNP`, `RCUV`, `CUV`) 時，TTS 自動指派 `zh-TW` 真人聲。
  - 切換至英文譯本 (`ESV`, `NIV`, `NLT`) 時，TTS 自動切換至 `en-US` / `en-GB` 英文真人聲。

---

## 🎨 5. 人性化 UI/UX 互動規範 (User-First Design Rules)

* **彈窗選單優於循序迴圈 (Picker Modal over Toggle Loop)**：
  - 當可選選項超過 3 個（如 6 大聖經譯本）時，不應使用一直按按鈕的循環切換。
  - 應彈出直覺彈窗選購 Modal (`#bible-version-picker-modal`)，並高亮當前選項（帶 Checkmark `✓`）。
* **動態隱藏無效選項與高亮主要動作 (Smart Prompt Actions)**：
  - 當使用者進度正常或超前時，**絕對不要顯示無效的「補讀未完成進度」按鈕**。
  - 動態將真正的目標動作（如「超前閱讀第 N 天進度」）提升為**藍色高亮主要按鈕 (Primary Button)**，避免主次顛倒與誤解。
* **安靜自動打卡 (Silent Auto-Read)**：
  - 滑到底部自動已讀時，保持靜默打卡，不彈出干擾閱讀視覺的 Toast 與確認彈窗對話框。
* **記憶體與 UI 即時同步 (Instant State Reactivity)**：
  - 打卡日誌更新時，同步更新記憶體中 `state.activePlan` 物件屬性 (`ch.isRead`, `ch.isReadR1` 等)。
  - 返回進度頁面時觸發 `calculatePlanProgress()` 與 DOM 重繪，**無需手動重新整理/更新頁面，即時呈現勾選已讀**。
