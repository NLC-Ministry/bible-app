// 使用者查詢：搜尋框＋結果清單（#555）。
// 停止輸入 250ms 才送；新的搜尋會取消還在路上的舊搜尋（AbortController），結果不會被舊回應蓋掉。
// 搜尋字的規則和 admin-api 共用 search-query.ts 的 validateSearchQuery，不合規則就不送。
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { validateSearchQuery } from "../../../supabase/functions/admin-api/search-query.ts";
import { isAbortError, type AdminApi } from "../api.ts";
import { formatRoute } from "../route.ts";
import { formatDateTime, text } from "../format.ts";
import type { SearchResult } from "../types.ts";
import { Badge, ErrorNotice, Spinner } from "../ui.tsx";

export const SEARCH_DEBOUNCE_MS = 250;

export type SearchState = { query: string; reason: string };

type Props = {
  api: AdminApi;
  state: SearchState;
  onChange: (next: SearchState) => void;
  selectedUserId: string | null;
};

export function UserSearch({ api, state, onChange, selectedUserId }: Props) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const trimmed = state.query.trim();
  const validation = trimmed ? validateSearchQuery(trimmed) : null;

  useEffect(() => {
    // 字一改就取消還在路上的舊搜尋，舊結果不會在新搜尋送出前閃回來
    controllerRef.current?.abort();
    if (!validation || !validation.ok) {
      setResults(null);
      setLoading(false);
      setError(null);
      return undefined;
    }
    const query = validation.query;
    const cached = api.peek<SearchResult[]>("user_search", { q: query });
    if (cached) {
      setResults(cached);
      setLoading(false);
      setError(null);
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      const controller = new AbortController();
      controllerRef.current = controller;
      api.call<SearchResult[]>("user_search", { q: query }, { signal: controller.signal })
        .then((data) => {
          if (controller.signal.aborted) return;
          setResults(Array.isArray(data) ? data : []);
          setError(null);
          setLoading(false);
        })
        .catch((err) => {
          if (isAbortError(err) || controller.signal.aborted) return;
          setError(err);
          setResults(null);
          setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // validation 由 trimmed 決定，只看 trimmed 就好
  }, [api, trimmed]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return (
    <div className="adm-search">
      <form className="adm-search__form" role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="adm-label" htmlFor="adm-search-input">搜尋使用者</label>
        <div className="adm-input-icon">
          <Search className="adm-icon" aria-hidden="true" />
          <input
            id="adm-search-input"
            className="adm-input"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="姓名或 email"
            value={state.query}
            maxLength={100}
            onChange={(event) => onChange({ ...state, query: event.target.value })}
          />
        </div>
        <label className="adm-label" htmlFor="adm-reason-input">查看理由（選填，會記在稽核紀錄）</label>
        <input
          id="adm-reason-input"
          className="adm-input"
          type="text"
          autoComplete="off"
          placeholder="例如：因回報 #123"
          value={state.reason}
          maxLength={200}
          onChange={(event) => onChange({ ...state, reason: event.target.value })}
        />
      </form>

      <div className="adm-search__results" aria-live="polite">
        {validation && !validation.ok && (
          <p className="adm-muted adm-small">請輸入至少 1 個中文字或 2 個英文字母／數字。</p>
        )}
        {loading && <Spinner label="搜尋中…" />}
        {!loading && error !== null && <ErrorNotice error={error} />}
        {!loading && error === null && results && results.length === 0 && (
          <p className="adm-muted">找不到符合「{trimmed}」的使用者。</p>
        )}
        {!loading && error === null && results && results.length > 0 && (
          <ul className="adm-result-list">
            {results.map((user) => (
              <li key={user.id}>
                <a
                  className={`adm-result${selectedUserId === user.id ? " adm-result--active" : ""}`}
                  href={formatRoute({ view: "user", userId: user.id, tab: "overview", reason: state.reason })}
                  aria-current={selectedUserId === user.id ? "page" : undefined}
                >
                  <span className="adm-result__name">
                    {text(user.name, "（未填姓名）")}
                    {user.role_code !== "member" && <Badge tone="brand">{text(user.role_label, user.role_code)}</Badge>}
                    {user.is_active === false && <Badge tone="warning">已停用</Badge>}
                  </span>
                  <span className="adm-result__meta">{text(user.email_masked, "沒有 email")}</span>
                  <span className="adm-result__meta">
                    {[user.great_region, user.pastoral_zone, user.small_group].filter(Boolean).join("・") || "未填牧區"}
                  </span>
                  <span className="adm-result__meta">最近使用：{formatDateTime(user.last_seen_at)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {results && results.length >= 20 && (
          <p className="adm-muted adm-small">只列出前 20 筆，請輸入更完整的姓名或 email。</p>
        )}
      </div>
    </div>
  );
}
