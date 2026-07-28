// components/issue-report/ReportDrawer.tsx
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Drawer } from "vaul";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ReportPipeline, ValidateReportBlock } from "./IssueReportBlocks.ts";

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
        {/* Dark theme styled backdrop blur */}
        <Drawer.Overlay 
          className="fixed inset-0 z-[9998] bg-background/80 backdrop-blur-sm"
          onClick={handleClose}
        />
        <Drawer.Content 
          className="fixed inset-x-0 bottom-0 z-[9999] mx-auto flex max-w-lg flex-col rounded-t-2xl border border-border/50 bg-card/95 p-6 shadow-2xl backdrop-blur-md focus:outline-none"
          role="dialog"
          aria-labelledby="issue-report-title"
        >
          {/* Drag Handle indicator */}
          <div className="mx-auto mb-4 h-1.5 w-12 shrink-0 rounded-full bg-muted" />

          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/50 pb-3">
            <div>
              <Drawer.Title id="issue-report-title" className="text-lg font-bold text-foreground">
                問題與建議回報
              </Drawer.Title>
              <Drawer.Description className="text-xs text-muted-foreground mt-0.5">
                請詳細描述您遇到的問題，系統將自動附帶調試資訊。
              </Drawer.Description>
            </div>
            <button
              onClick={handleClose}
              className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              aria-label="關閉"
              type="button"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Message Alert Panel */}
          <AnimatePresence mode="wait">
            {message && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`mt-4 rounded-lg border p-3 text-sm font-semibold flex items-center gap-2 ${
                  message.type === "success" 
                    ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-400" 
                    : "bg-destructive/10 border-destructive/30 text-destructive"
                }`}
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
                className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
              >
                問題分類
              </label>
              <select
                id="category"
                disabled={isLoading}
                {...register("category")}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="bug">Bug 錯誤</option>
                <option value="ui">UI 建議</option>
                <option value="data">資料問題</option>
                <option value="other">其他</option>
              </select>
              {errors.category && (
                <span className="text-xs text-destructive mt-0.5">{errors.category.message}</span>
              )}
            </div>

            {/* Description Textarea */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="description"
                  className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
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
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
              {errors.description && (
                <span className="text-xs text-destructive mt-0.5">{errors.description.message}</span>
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
              className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
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
