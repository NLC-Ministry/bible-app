// 教會進度比對的共用原語已搬到 supabase/functions/_shared/progress/（#564）：伺服器（admin-api、nlc-data）
// 和會友 App 執行同一份程式。這裡只轉出，舊的 import 路徑照用。
export * from "../../supabase/functions/_shared/progress/schedule-progress.mjs";
