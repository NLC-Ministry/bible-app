// 後台共用的小元件（#555）。樣式全在 admin.css（CSP 不允許行內 style，所以不用 style 屬性）。
import React from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { AdminApiError, describeAdminError } from "./api.ts";

export function Spinner({ label }: { label: string }) {
  return (
    <div className="adm-status" role="status">
      <Loader2 className="adm-icon adm-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorNotice({ error, action }: { error: unknown; action?: React.ReactNode }) {
  const requestId = error instanceof AdminApiError ? error.requestId : null;
  return (
    <div className="adm-notice adm-notice--danger" role="alert">
      <TriangleAlert className="adm-icon" aria-hidden="true" />
      <div className="adm-notice__body">
        <p>{describeAdminError(error)}</p>
        {requestId && <p className="adm-muted adm-small">請求編號：<code>{requestId}</code></p>}
        {action}
      </div>
    </div>
  );
}

export function Card({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="adm-card">
      <header className="adm-card__header">
        <h3>{title}</h3>
        {actions && <div className="adm-card__actions">{actions}</div>}
      </header>
      <div className="adm-card__body">{children}</div>
    </section>
  );
}

export function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="adm-field">
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "brand" | "danger" | "warning"; children: React.ReactNode }) {
  return <span className={`adm-badge adm-badge--${tone}`}>{children}</span>;
}

/** 長條：CSP 不允許行內 style，所以用 SVG 的屬性畫寬度（#565 從 PlanArea 搬來，隊伍頁也用） */
export function Bar({ value, max, label }: { value: number; max: number; label?: string }) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <svg className="adm-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label} focusable="false">
      <rect className="adm-bar__track" x="0" y="0" width="100" height="8" />
      <rect className="adm-bar__fill" x="0" y="0" width={width} height="8" />
    </svg>
  );
}

/** 三個以內的選項用分段按鈕，不用下拉（選項一眼看得到）。 */
export function Segmented<T extends string>({ label, options, value, onChange, disabled = false }: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="adm-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`adm-segmented__option${option.value === value ? " adm-segmented__option--active" : ""}`}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => { if (option.value !== value) onChange(option.value); }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
