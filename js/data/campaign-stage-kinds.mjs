// 教會階段計畫的 plan_kind 判斷已搬到 supabase/functions/_shared/progress/（#566）：伺服器（admin-api 的隊伍除錯）
// 和會友 App 執行同一份程式。這裡只轉出，舊的 import 路徑照用。
export * from "../../supabase/functions/_shared/progress/campaign-stage-kinds.mjs";
