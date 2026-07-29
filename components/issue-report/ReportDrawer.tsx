// components/issue-report/ReportDrawer.tsx
import React from "react";
import { Loader2, CheckCircle, AlertCircle, X } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ReportPipeline } from "./IssueReportBlocks.ts";
import {
  NativeSelect,
  NativeSelectOption,
} from "../ui/native-select.tsx";
import { Textarea } from "../ui/textarea.tsx";

// Zod v4 renamed the enum error-customization key from `errorMap` to `error`.
// The schema only validates shape here — sanitization happens exactly once at
// the storage boundary (ReportPipeline -> ValidateReportBlock), so we must not
// also transform/sanitize here or descriptions get double HTML-escaped.
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

/** Counter stays muted until the 500-char upper bound is exceeded. */
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
}

export const ReportDrawer: React.FC<ReportDrawerProps> = ({ isOpen, onClose }) => {
  const [isLoading, setIsLoading] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

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
                請詳細描述您遇到的問題，系統將自動附帶調試資訊。
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
        </header>

        <form onSubmit={handleSubmit(onSubmit)} className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <div className="flex flex-col gap-4">
            <p className="sr-only">
            請詳細描述您遇到的問題，系統將自動附帶調試資訊。
            </p>
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
              <label
                htmlFor="category"
                className={reportFieldLabelClassName}
              >
                問題分類
              </label>
              <NativeSelect
                id="category"
                disabled={isLoading}
                {...register("category")}
              >
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
                <label
                  htmlFor="description"
                  className={reportFieldLabelClassName}
                >
                  問題描述
                </label>
                <span className={descriptionCounterClassName(watchDescription.length)}>
                  {watchDescription.length} / 500 字
                </span>
              </div>
              <Textarea
                id="description"
                disabled={isLoading}
                {...register("description")}
                rows={4}
                placeholder="請詳細描述您遇到的問題或建議，最少 1 個字，最多 500 個字..."
                className="text-foreground"
              />
              {errors.description && (
                <span className={reportErrorClassName}>{errors.description.message}</span>
              )}
              <p className={reportHelperClassName}>
                * 系統將自動附帶當前 URL、瀏覽器與登入資訊，以加速除錯。
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="submit"
                disabled={isLoading || watchDescription.length < 1 || watchDescription.length > 500}
                className="primary-btn w-full"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在提交...
                  </>
                ) : (
                  "提交報告"
                )}
              </button>
              <button type="button" className="secondary-btn w-full" onClick={handleClose}>
                取消
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
};
