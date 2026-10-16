// 隊伍修正動作（#571）的小元件：再確認一次（可填原因）、加人時找人。
// 按鈕何時出現在 ../teams.ts（teamFixState、memberRemoval…）；真正的檢查與稽核在 SQL。
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import type { AdminApi } from "../api.ts";
import { text } from "../format.ts";
import { hitUnit, type UserSearchHit } from "../teams.ts";
import { Badge, ErrorNotice, Spinner } from "../ui.tsx";

/** 再確認一次：說明＋原因（選填，記進稽核）＋確定／取消 */
export function FixConfirm({ label, children, confirmLabel, danger = false, busy, onCancel, onConfirm }: {
  label: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const id = useId();
  return (
    <div className={`adm-notice adm-team-fix${danger ? " adm-notice--danger" : ""}`} role="alertdialog" aria-label={label}>
      <div className="adm-notice__body">
        {children}
        <label className="adm-label" htmlFor={id}>原因（選填，會記進稽核）</label>
        <input id={id} className="adm-input" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
        <div className="adm-row">
          <button
            type="button"
            className={`adm-button ${danger ? "adm-button--danger-solid" : "adm-button--primary"}`}
            onClick={() => onConfirm(reason)}
            disabled={busy}
          >{busy ? "處理中…" : confirmLabel}</button>
          <button type="button" className="adm-button" onClick={onCancel} disabled={busy}>取消</button>
        </div>
      </div>
    </div>
  );
}

/** 加人：用 user_search 找人（姓名或 email），選一位後交給上層確認 */
export function AddMemberSearch({ api, memberIds, onPick, onClose }: {
  api: AdminApi;
  memberIds: readonly string[];
  onPick: (hit: UserSearchHit) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UserSearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const id = useId();

  const search = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    api.call<UserSearchHit[]>("user_search", { q })
      .then((data) => setHits(Array.isArray(data) ? data : []))
      .catch((err) => { setError(err); setHits(null); })
      .finally(() => setLoading(false));
  };

  return (
    <div className="adm-team-add">
      <div className="adm-team-add__head">
        <label className="adm-label" htmlFor={id}>把人加進這隊：用姓名或 email 找人</label>
        <button type="button" className="adm-icon-button" onClick={onClose} aria-label="關閉加人" title="關閉">
          <X className="adm-icon" aria-hidden="true" />
        </button>
      </div>
      <form className="adm-row" onSubmit={search} role="search">
        <span className="adm-input-icon adm-team-add__input">
          <Search className="adm-icon adm-icon--small" aria-hidden="true" />
          <input id={id} className="adm-input" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} />
        </span>
        <button type="submit" className="adm-button" disabled={loading || !query.trim()}>搜尋</button>
      </form>
      {loading && <Spinner label="搜尋中…" />}
      {error !== null && <ErrorNotice error={error} />}
      {hits && hits.length === 0 && <p className="adm-muted adm-small">找不到符合的人。</p>}
      {hits && hits.length > 0 && (
        <ul className="adm-team-add__hits">
          {hits.map((hit) => {
            const inTeam = memberIds.includes(hit.id);
            return (
              <li key={hit.id} className="adm-team-add__hit">
                <span className="adm-team-member__name">
                  {text(hit.name, "（未填姓名）")}
                  {hit.is_active === false && <Badge tone="warning">帳號已停用</Badge>}
                  {inTeam && <Badge>已在這隊</Badge>}
                </span>
                <span className="adm-team-member__meta">{hitUnit(hit) || "未填牧區"}{hit.email_masked ? `・${hit.email_masked}` : ""}</span>
                <button type="button" className="adm-button" onClick={() => onPick(hit)} disabled={inTeam || hit.is_active === false}>選這位</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
