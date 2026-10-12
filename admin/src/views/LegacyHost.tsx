// 照搬的舊管理區塊（#550）：上面一排區塊分頁，下面是 /legacy 的 iframe（App 管理分頁的同一份畫面）。
//
// iframe 第一次進來才載入，之後切到別區只是藏起來，回來不用重新開機（舊程式要先載一輪資料）。
// iframe 和外殼之間的通道、匯出前的稽核都在 legacy.ts；這裡只管畫面狀態。
import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { describeAdminError, type AdminApi } from "../api.ts";
import { downloadBlob } from "../download.ts";
import { IFRAME_ACTIVITY_EVENT } from "../idle.ts";
import { LEGACY_PATH, legacySectionsOf, startLegacyHost, type LegacyArea, type LegacyHost as Host } from "../legacy.ts";
import { formatRoute } from "../route.ts";
import type { ResolvedTheme } from "../theme.ts";

type FrameState =
  | { name: "booting" }
  | { name: "ready" }
  | { name: "failed" };

type Props = {
  api: AdminApi;
  win: Window;
  visible: boolean;
  area: LegacyArea;
  section: string;
  theme: ResolvedTheme;
  getToken: () => string | null;
  getIdToken: () => string | null;
  onLoginRequired: () => void;
};

export function LegacyHost({ api, win, visible, area, section, theme, getToken, getIdToken, onLoginRequired }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const hostRef = useRef<Host | null>(null);
  const latest = useRef({ section, theme, getToken, getIdToken, onLoginRequired });
  latest.current = { section, theme, getToken, getIdToken, onLoginRequired };
  const [frame, setFrame] = useState<FrameState>({ name: "booting" });
  // iframe 回報的「目前這一區開不開得了」（小測驗、大測驗要功能開關打開）
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // 開機失敗（session_expired）和 token 要不到（login_required）可能同時來，只導向一次
    let loginRequested = false;
    const requestLogin = () => {
      if (loginRequested) return;
      loginRequested = true;
      latest.current.onLoginRequired();
    };
    const host = startLegacyHost({
      win,
      frameWindow: () => frameRef.current?.contentWindow ?? null,
      initial: () => ({ section: latest.current.section, theme: latest.current.theme }),
      getToken: () => latest.current.getToken(),
      getIdToken: () => latest.current.getIdToken(),
      auditExport: (file) => api.call("legacy_export_audit", file),
      saveFile: (blob, filename) => downloadBlob(win.document, filename, blob),
      describeError: describeAdminError,
      onReady: () => setFrame({ name: "ready" }),
      onSection: (id, available) => setUnavailable(available ? null : id),
      onError: (code) => {
        if (code === "session_expired") requestLogin();
        else setFrame({ name: "failed" });
      },
      onLoginRequired: requestLogin,
      onActivity: () => win.dispatchEvent(new Event(IFRAME_ACTIVITY_EVENT))
    });
    hostRef.current = host;
    return () => {
      host.stop();
      hostRef.current = null;
    };
  }, [api, win]);

  // 換區：iframe 還在開機也先送，iframe 開完機才會處理
  useEffect(() => {
    setUnavailable(null);
    hostRef.current?.open(section);
  }, [section]);

  useEffect(() => {
    hostRef.current?.setTheme(theme);
  }, [theme]);

  const reload = () => {
    setFrame({ name: "booting" });
    setUnavailable(null);
    setReloadKey((key) => key + 1);
  };

  const sections = legacySectionsOf(area);
  const current = sections.find((item) => item.id === section);

  return (
    <div className="adm-legacy" hidden={!visible}>
      <nav className="adm-tabs adm-legacy__tabs" aria-label="管理區塊">
        {sections.map((item) => (
          <a
            key={item.id}
            className={`adm-tab${item.id === section ? " adm-tab--active" : ""}`}
            href={formatRoute({ view: "legacy", area, section: item.id })}
            aria-current={item.id === section ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
      {frame.name === "failed" && (
        <div className="adm-message">
          <h2>管理畫面載入失敗</h2>
          <p>可能是網路不穩，或這個帳號在會友 App 的資料讀不到。重新載入看看；一直失敗請聯絡開發者。</p>
          <button type="button" className="adm-button adm-button--primary" onClick={reload}>
            <RotateCw className="adm-icon" aria-hidden="true" />重新載入
          </button>
        </div>
      )}
      {frame.name !== "failed" && unavailable === section && (
        <div className="adm-message">
          <h2>{current?.label || "這一區"}目前沒有開放</h2>
          <p>小測驗、大測驗要先在「功能開放設定」打開；如果剛打開，請按重新載入。</p>
          <button type="button" className="adm-button" onClick={reload}>
            <RotateCw className="adm-icon" aria-hidden="true" />重新載入
          </button>
        </div>
      )}
      <iframe
        key={reloadKey}
        ref={frameRef}
        className="adm-legacy__frame"
        src={LEGACY_PATH}
        title={`${current?.label || ""}管理`}
        hidden={frame.name === "failed" || unavailable === section}
      />
    </div>
  );
}
