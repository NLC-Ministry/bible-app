// 「打開才載」的資料 hook（#565 從 PlanArea 抽出；#566 隊伍頁也用）。
// 同一份參數 60 秒內走快取（api.peek）；重新整理先 invalidate 再換 refresh 讓這裡重抓。params 是 null＝還不用載。
import { useEffect, useRef, useState } from "react";
import { cacheKey, type AdminAction, type AdminApi } from "./api.ts";

export type Loaded<T> = { data: T | null; error: unknown; loading: boolean };

export function useAdminData<T>(api: AdminApi, action: AdminAction, params: Record<string, unknown> | null, refresh: number): Loaded<T> {
  const key = params ? cacheKey(action, params) : "";
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [state, setState] = useState<Loaded<T> & { key: string }>(() => ({
    key, data: params ? api.peek<T>(action, params) ?? null : null, error: null, loading: false
  }));

  useEffect(() => {
    const current = paramsRef.current;
    if (!current) return undefined;
    const cached = api.peek<T>(action, current);
    if (cached !== undefined) {
      setState({ key, data: cached, error: null, loading: false });
      return undefined;
    }
    let active = true;
    setState((prev) => ({ key, data: prev.key === key ? prev.data : null, error: null, loading: true }));
    api.call<T>(action, current)
      .then((data) => { if (active) setState({ key, data, error: null, loading: false }); })
      .catch((error) => { if (active) setState({ key, data: null, error, loading: false }); });
    return () => { active = false; };
  }, [api, action, key, refresh]);

  if (!params) return { data: null, error: null, loading: false };
  if (state.key === key) return state;
  const cached = api.peek<T>(action, params);
  return cached !== undefined ? { data: cached, error: null, loading: false } : { data: null, error: null, loading: true };
}
