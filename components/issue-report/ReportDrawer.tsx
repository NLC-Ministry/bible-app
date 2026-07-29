// components/issue-report/ReportDrawer.tsx
import React from "react";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ReportPipeline } from "./IssueReportBlocks.ts";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer.tsx";
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

  const handleReportFieldFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const reportFormBody = event.currentTarget;
    const target = event.target;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!reportFormBody.contains(target)) return;
        target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      });
    });
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

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DrawerContent className="mx-auto max-w-lg">
        <DrawerHeader className="shrink-0">
          <DrawerTitle>問題與建議回報</DrawerTitle>
          <DrawerDescription>
            請詳細描述您遇到的問題，系統將自動附帶調試資訊。
          </DrawerDescription>
        </DrawerHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scroll-pb-32 px-4 pb-2 overscroll-contain"
            onFocus={handleReportFieldFocus}
          >
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
          </div>

          <DrawerFooter className="shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
            <DrawerClose asChild>
              <button type="button" className="secondary-btn w-full">
                取消
              </button>
            </DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
};
