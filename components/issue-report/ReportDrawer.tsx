// components/issue-report/ReportDrawer.tsx
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Drawer } from "vaul";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ReportPipeline, ValidateReportBlock } from "./IssueReportBlocks.ts";
import { Button } from "../ui/button.tsx";

// Define form validation schema using Zod with strict limits and XSS sanitization
export const reportSchema = z.object({
  category: z.enum(["bug", "ui", "data", "other"], {
    errorMap: () => ({ message: "請選擇有效的問題分類" })
  }),
  description: z.string()
    .min(1, "請填寫問題描述")
    .max(500, "問題描述最多限制 500 字")
    .transform((val) => ValidateReportBlock.sanitize(val.trim()))
});

type ReportFormValues = z.infer<typeof reportSchema>;

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

  // Watch description to display real-time word count
  const watchDescription = watch("description", "") || "";

  const handleClose = () => {
    onClose();
    reset();
    setMessage(null);
  };

  const onSubmit = async (data: ReportFormValues) => {
    setIsLoading(true);
    setMessage(null);

    // Call pipeline to process submission
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
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <Drawer.Portal>
        <Drawer.Overlay
          className="fixed inset-0 z-overlay bg-black/45"
          onClick={handleClose}
        />
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-sheet mx-auto flex max-w-lg flex-col rounded-t-lg border border-border bg-card p-6 pt-4 shadow-up-lg focus:outline-none"
          role="dialog"
          aria-labelledby="issue-report-title"
        >
          {/* Drag Handle indicator */}
          <div className="mx-auto mb-4 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />

          {/* Header — close uses standard shadcn Dialog absolute icon Button */}
          <div className="relative mb-3 border-b border-border pb-3 pr-12">
            <Drawer.Title
              id="issue-report-title"
              className="text-lg font-medium text-foreground"
              style={{ fontWeight: "var(--type-weight-strong)" }}
            >
              問題與建議回報
            </Drawer.Title>
            <Drawer.Description className="mt-0.5 text-xs text-muted-foreground">
              請詳細描述您遇到的問題，系統將自動附帶調試資訊。
            </Drawer.Description>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleClose}
              aria-label="關閉"
              className="absolute right-0 top-0"
            >
              <X />
            </Button>
          </div>

          {/* Message Alert Panel */}
          <AnimatePresence mode="wait">
            {message && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-4 flex items-center gap-2 rounded-md border p-3 text-sm font-medium"
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
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form Body */}
          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 flex flex-col gap-4">
            {/* Category Selector */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="category"
                className="text-sm text-muted-foreground"
                style={{ fontWeight: "var(--type-weight-strong)" }}
              >
                問題分類
              </label>
              <select
                id="category"
                disabled={isLoading}
                {...register("category")}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="bug">Bug 錯誤</option>
                <option value="ui">UI 建議</option>
                <option value="data">資料問題</option>
                <option value="other">其他</option>
              </select>
              {errors.category && (
                <span className="mt-0.5 text-xs text-destructive">{errors.category.message}</span>
              )}
            </div>

            {/* Description Textarea */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="description"
                  className="text-sm text-muted-foreground"
                  style={{ fontWeight: "var(--type-weight-strong)" }}
                >
                  問題描述
                </label>
                <span
                  className={`text-xs ${
                    watchDescription.length < 1 || watchDescription.length > 500
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {watchDescription.length} / 500 字
                </span>
              </div>
              <textarea
                id="description"
                disabled={isLoading}
                {...register("description")}
                rows={4}
                placeholder="請詳細描述您遇到的問題或建議，最少 1 個字，最多 500 個字..."
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
              {errors.description && (
                <span className="mt-0.5 text-xs text-destructive">{errors.description.message}</span>
              )}
              <p className="text-xs text-muted-foreground">
                * 系統將自動附帶當前 URL、瀏覽器與登入資訊，以加速除錯。
              </p>
            </div>

            {/* Submit Action Button */}
            <motion.button
              type="submit"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={isLoading || watchDescription.length < 1 || watchDescription.length > 500}
              className="issue-report-submit flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none disabled:opacity-50"
              style={{
                fontWeight: "var(--type-weight-strong)",
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  正在提交...
                </>
              ) : (
                "提交報告"
              )}
            </motion.button>
          </form>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
};
