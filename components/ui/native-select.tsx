import * as React from "react"
import { ChevronDown } from "lucide-react"

import { FORM_CONTROL_TEXT_CLASS } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// Must forward the ref to the underlying <select> so form libraries
// (e.g. react-hook-form's register) can read/control the selected value.
// Under React 18 a plain function component silently drops the ref, which
// leaves the registered value undefined and breaks validation on submit.
const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  Omit<React.ComponentProps<"select">, "size"> & {
    size?: "sm" | "default"
  }
>(({ className, size = "default", ...props }, ref) => {
  return (
    <div
      className="group/native-select relative w-full has-[select:disabled]:opacity-50"
      data-slot="native-select-wrapper"
    >
      <select
        ref={ref}
        data-slot="native-select"
        data-size={size}
        className={cn(
          `h-11 w-full min-w-0 appearance-none rounded-md border border-input bg-background px-3 py-2 pr-9 ${FORM_CONTROL_TEXT_CLASS} text-foreground shadow-none transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed data-[size=sm]:h-9 data-[size=sm]:py-1`,
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
          className,
          FORM_CONTROL_TEXT_CLASS
        )}
        {...props}
      />
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground opacity-50 select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  )
})
NativeSelect.displayName = "NativeSelect"

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOption, NativeSelectOptGroup }
