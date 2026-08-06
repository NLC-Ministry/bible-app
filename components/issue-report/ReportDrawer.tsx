// components/issue-report/ReportDrawer.tsx
import React from "react";
import { Loader2, CheckCircle, AlertCircle, X } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ReportPipeline, FetchMyReportsPipeline } from "./IssueReportBlocks.ts";
import {
  NativeSelect,
  NativeSelectOption,
} from "../ui/native-select.tsx";
import { Textarea } from "../ui/textarea.tsx";

export const reportSchema = z.object({
  category: z.enum(["bug", "ui", "data", "other"], {
    error: () => "請選擇有效的問題分類"
  }),
  description: z.string()
    .trim()
    .min(1, "請填寫問題描述")
    .max(500, "問題描述最多限制 500 字")
});

type ReportFormValues = z.infer<typeof reportSchema>;

export function descriptionCounterClassName(length: number): string {
  return length > 500 ? "text-xs text-destructive" : "text-xs text-muted-foreground";
}

const reportMessageClassName = "flex items-center gap-2 rounded-md border p-3 text-sm font-medium";
const reportFieldLabelClassName = "text-sm font-medium text-muted-foreground";
const reportErrorClassName = "mt-0.5 text-xs text-destructive";
const reportHelperClassName = "text-xs text-muted-foreground";

interface ReportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: "form" | "my-reports";
}

export const ReportDrawer: React.FC<ReportDrawerProps> = ({ isOpen, onClose, defaultTab = "form" }) => {
  const [activeTab, setActiveTab] = React.useState<"form" | "my-reports">(defaultTab);
  const [isLoading, setIsLoading] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);
  const [myReports, setMyReports] = React.useState<any[]>([]);
  const [isFetchingReports, setIsFetchingReports] = React.useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset
  } = useForm<ReportFormValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      category: "bug",
      description: ""
    }
  });

  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab);
      let isMounted = true;
      setIsFetchingReports(true);
      FetchMyReportsPipeline.execute().then(result => {
        if (isMounted) {
          setIsFetchingReports(false);
          if (result.success && Array.isArray(result.data)) {
            setMyReports(result.data);
          }
        }
      }).catch(() => {
        if (isMounted) setIsFetchingReports(false);
      });
      return () => { isMounted = false; };
    }
  }, [isOpen, defaultTab]);

  const watchDescription = watch("description", "") || "";

  const handleClose = () => {
    onClose();
    reset();
    setMessage(null);
  };

  const onSubmit = async (data: ReportFormValues) => {
    setIsLoading(true);
    setMessage(null);

    const result = await ReportPipeline.execute(data.category, data.description);
    setIsLoading(false);

    if (result.success) {
      const isOffline = result.source === "offline";
      setMessage({
        type: "success",
        text: isOffline ? "已保存至離線佇列，恢復連線後會自動上傳！" : "感謝回報！我們會盡快處理！"
      });
      setTimeout(() => {
        handleClose();
      }, 2000);
    } else {
      setMessage({
        type: "error",
        text: result.error || "回報提交失敗，請重試"
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-modal bg-background md:flex md:items-center md:justify-center md:bg-black/70 md:p-6">
      <section
        className="flex h-[100dvh] w-full flex-col bg-background md:h-auto md:max-h-[90dvh] md:max-w-lg md:rounded-lg md:border md:border-border md:shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-report-title"
        aria-describedby="issue-report-description"
      >
        <header className="shrink-0 border-b border-border p-4 text-center sm:text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1.5">
              <h2 id="issue-report-title" className="text-lg font-semibold leading-none tracking-tight text-foreground">
                問題與建議回報
              </h2>
              <p id="issue-report-description" className="text-sm text-muted-foreground">
                感謝您的建言，讓我們一起把讀經體驗變得更好。
              </p>
            </div>
            <button
              type="button"
              className="secondary-btn h-9 w-9 shrink-0 p-0"
              onClick={handleClose}
              aria-label="關閉問題回報"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3 flex border-b border-border">
            <button
              type="button"
              className={`flex-1 pb-2 text-center text-sm font-medium border-b-2 transition-colors ${
                activeTab === "form"
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              style={{ background: "transparent", boxShadow: "none" }}
              onClick={() => setActiveTab("form")}
            >
              📝 填寫回報
            </button>
            <button
              type="button"
              className={`flex-1 pb-2 text-center text-sm font-medium border-b-2 transition-colors ${
                activeTab === "my-reports"
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              style={{ background: "transparent", boxShadow: "none" }}
              onClick={() => {
                setActiveTab("my-reports");
                setIsFetchingReports(true);
                FetchMyReportsPipeline.execute().then(res => {
                  setIsFetchingReports(false);
                  if (res.success && Array.isArray(res.data)) {
                    setMyReports(res.data);
                  }
                }).catch(() => setIsFetchingReports(false));
              }}
            >
              💬 我的歷史與回覆
            </button>
          </div>
        </header>

        {activeTab === "form" ? (
          <form onSubmit={handleSubmit(onSubmit)} className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
            <div className="flex flex-col gap-4">
              {message && (
                <div
                  className={reportMessageClassName}
                  style={
                    message.type === "success"
                      ? {
                          backgroundColor: "var(--color-success-subtle)",
                          borderColor: "var(--color-success-border)",
                          color: "var(--color-success-foreground)",
                        }
                      : {
                          backgroundColor: "var(--color-danger-subtle)",
                          borderColor: "var(--color-danger)",
                          color: "var(--color-danger-foreground)",
                        }
                  }
                >
                  {message.type === "success" ? (
                    <CheckCircle className="h-4 w-4 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0" />
                  )}
                  <span>{message.text}</span>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="category" className={reportFieldLabelClassName}>
                  問題分類
                </label>
                <NativeSelect id="category" disabled={isLoading} {...register("category")}>
                  <NativeSelectOption value="bug">Bug 錯誤</NativeSelectOption>
                  <NativeSelectOption value="ui">UI 建議</NativeSelectOption>
                  <NativeSelectOption value="data">資料問題</NativeSelectOption>
                  <NativeSelectOption value="other">其他</NativeSelectOption>
                </NativeSelect>
                {errors.category && (
                  <span className={reportErrorClassName}>{errors.category.message}</span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="description" className={reportFieldLabelClassName}>
                    詳細描述
                  </label>
                  <span className={descriptionCounterClassName(watchDescription.length)}>
                    {watchDescription.length}/500
                  </span>
                </div>
                <Textarea
                  id="description"
                  rows={4}
                  placeholder="請詳細描述問題發生的情境或建議作法..."
                  disabled={isLoading}
                  {...register("description")}
                />
                {errors.description && (
                  <span className={reportErrorClassName}>{errors.description.message}</span>
                )}
                <span className={reportHelperClassName}>
                  送出時系統會自動包含當前的網頁 URL 與瀏覽器版本資訊。
                </span>
              </div>

              <button
                type="submit"
                disabled={isLoading || watchDescription.length < 1 || watchDescription.length > 500}
                className="primary-btn w-full mt-2 justify-center"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>處理中...</span>
                  </>
                ) : (
                  <span>提交報告</span>
                )}
              </button>
              <button type="button" className="secondary-btn w-full" onClick={handleClose}>
                取消
              </button>
            </div>
          </form>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {isFetchingReports ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-sm">正在載入您的歷史回報紀錄...</span>
              </div>
            ) : myReports.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                <span className="text-3xl mb-2">💬</span>
                <p className="text-sm font-medium text-foreground">尚無歷史回報紀錄</p>
                <p className="text-xs text-muted-foreground mt-1">若您在使用過程遇到問題，歡迎點選「填寫回報」告訴我們。</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {myReports.map((report) => {
                  const statusMap: Record<string, { label: string; bg: string; text: string }> = {
                    pending: { label: "待處理", bg: "rgba(234, 179, 8, 0.25)", text: "#fde047" },
                    processing: { label: "處理中", bg: "rgba(59, 130, 246, 0.25)", text: "#93c5fd" },
                    resolved: { label: "已解決", bg: "rgba(34, 197, 94, 0.25)", text: "#86efac" },
                    ignored: { label: "已存檔", bg: "rgba(148, 163, 184, 0.25)", text: "#cbd5e1" }
                  };
                  const st = statusMap[report.status] || statusMap.pending;
                  const replyText = report.metadata?.reply;
                  const repliedAt = report.metadata?.replied_at;

                  return (
                    <div key={report.id} className="rounded-lg border border-border bg-card p-3.5 shadow-sm transition-all hover:border-muted-foreground/30">
                      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2 mb-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full uppercase" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-card)" }}>
                          {report.category}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: st.bg, color: st.text }}>
                            {st.label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(report.created_at).toLocaleDateString("zh-TW")}
                          </span>
                        </div>
                      </div>

                      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                        {report.description}
                      </p>

                      {replyText && (
                        <div className="mt-3 rounded-md p-3" style={{ backgroundColor: "rgba(24, 119, 242, 0.06)", border: "1px solid rgba(24, 119, 242, 0.2)" }}>
                          <div className="flex items-center justify-between text-xs font-semibold text-primary mb-1">
                            <span>🛡️ 系統管理員回覆</span>
                            {repliedAt && (
                              <span className="text-muted-foreground font-normal text-[11px]">
                                {new Date(repliedAt).toLocaleString("zh-TW")}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed mt-1">
                            {replyText}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
