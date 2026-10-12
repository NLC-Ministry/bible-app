// 後台外殼（#555）：登入 → bootstrap（開後台只打這 1 個 admin-api 請求）→ 依能力清單顯示左側導覽。
// 相依（登入、admin-api、window）全部從參數注入，測試用假的跑真的元件。
import React, { useEffect, useMemo, useState } from "react";
import { Activity, BookOpen, Headset, LogOut, Menu, Settings, ShieldCheck, type LucideIcon } from "lucide-react";
import { AdminApiError, type AdminApi } from "./api.ts";
import type { AdminAuth, SignOutReason } from "./auth.ts";
import { ENVIRONMENT_LABEL, type AdminEnvironment } from "./config.ts";
import { startIdleWatch } from "./idle.ts";
import { memberAppAdminUrl } from "./links.ts";
import { NAV_ITEMS, canUse, visibleNavItems, type NavItem } from "./nav.ts";
import { areaOf, parseRoute, type AdminRoute } from "./route.ts";
import {
  THEMES,
  THEME_LABEL,
  applyTheme,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
  type ResolvedTheme,
  type ThemePreference
} from "./theme.ts";
import type { Bootstrap } from "./types.ts";
import { Badge, ErrorNotice, Spinner } from "./ui.tsx";
import { AccountsArea } from "./views/AccountsArea.tsx";
import { LegacyHost } from "./views/LegacyHost.tsx";
import { SupportArea } from "./views/SupportArea.tsx";

type Phase =
  | { name: "starting" }
  | { name: "redirecting" }
  | { name: "signed_out"; reason: SignOutReason }
  | { name: "auth_error"; message: string }
  | { name: "loading" }
  | { name: "bootstrap_error"; error: unknown }
  | { name: "forbidden" }
  | { name: "ready"; boot: Bootstrap };

export type AdminAppProps = {
  auth: AdminAuth;
  api: AdminApi;
  environment: AdminEnvironment;
  win: Window;
};

const NAV_ICON: Record<NavItem["icon"], LucideIcon> = {
  headset: Headset,
  shield: ShieldCheck,
  activity: Activity,
  book: BookOpen,
  settings: Settings
};

function safeLocalStorage(win: Window): Storage | null {
  try {
    return win.localStorage;
  } catch (_err) {
    return null;
  }
}

export function AdminApp({ auth, api, environment, win }: AdminAppProps) {
  const [phase, setPhase] = useState<Phase>({ name: "starting" });
  const [route, setRoute] = useState<AdminRoute>(() => parseRoute(win.location.hash));
  const [navOpen, setNavOpen] = useState(false);
  const [idleWarning, setIdleWarning] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference(safeLocalStorage(win)));
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  // 最近一次打開的照搬區塊：iframe 第一次進來才建立，之後切到別區只藏起來（#550）
  const [legacyRoute, setLegacyRoute] = useState<Extract<AdminRoute, { view: "legacy" }> | null>(null);

  // 登入 → bootstrap
  useEffect(() => {
    let active = true;
    auth.init().then((result) => {
      if (!active) return;
      if (result.status === "redirecting") return setPhase({ name: "redirecting" });
      if (result.status === "signed_out") return setPhase({ name: "signed_out", reason: result.reason });
      if (result.status === "error") return setPhase({ name: "auth_error", message: result.message });
      setPhase({ name: "loading" });
      api.call<Bootstrap>("bootstrap")
        .then((boot) => {
          if (!active) return;
          const capabilities = Array.isArray(boot?.capabilities) ? boot.capabilities : [];
          setPhase(capabilities.includes("console.access") ? { name: "ready", boot: { ...boot, capabilities } } : { name: "forbidden" });
        })
        .catch((error) => {
          if (!active) return;
          if (error instanceof AdminApiError && error.status === 403) return setPhase({ name: "forbidden" });
          setPhase({ name: "bootstrap_error", error });
        });
    });
    return () => { active = false; };
  }, [auth, api]);

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseRoute(win.location.hash));
      setNavOpen(false);
    };
    win.addEventListener("hashchange", onHashChange);
    return () => win.removeEventListener("hashchange", onHashChange);
  }, [win]);

  // 閒置 30 分鐘登出（登入後才開始算）
  const ready = phase.name === "ready";
  useEffect(() => {
    if (!ready) return undefined;
    return startIdleWatch({
      target: win,
      doc: win.document,
      onIdle: () => { auth.logout("idle"); },
      onWarn: () => setIdleWarning(true),
      onActive: () => setIdleWarning(false)
    });
  }, [ready, auth, win]);

  // 主題：存偏好、跟著系統深淺色變
  useEffect(() => {
    const media = typeof win.matchMedia === "function" ? win.matchMedia("(prefers-color-scheme: dark)") : null;
    const apply = () => {
      const resolved = resolveTheme(theme, !!media?.matches);
      applyTheme(win.document.documentElement, resolved);
      setResolvedTheme(resolved);
    };
    apply();
    if (theme !== "system" || !media) return undefined;
    media.addEventListener?.("change", apply);
    return () => media.removeEventListener?.("change", apply);
  }, [theme, win]);

  const capabilities = phase.name === "ready" ? phase.boot.capabilities : [];
  const navItems = useMemo(() => visibleNavItems(capabilities), [capabilities]);
  const legacyActive = route.view === "legacy" && canUse(capabilities, route.area);
  useEffect(() => {
    if (legacyActive && route.view === "legacy") setLegacyRoute(route);
  }, [legacyActive, route]);

  if (phase.name !== "ready") {
    return <Gate phase={phase} auth={auth} />;
  }

  const me = phase.boot.me;
  const area = areaOf(route);
  const onThemeChange = (value: ThemePreference) => {
    setTheme(value);
    saveThemePreference(safeLocalStorage(win), value);
  };

  let content: React.ReactNode;
  if (route.view === "not_found") {
    content = <Message title="找不到這個頁面" body="網址可能打錯了，請從左側選單重新進入。" />;
  } else if (!canUse(capabilities, area)) {
    content = <Message title="沒有權限" body="你的帳號沒有這一區的後台權限。" />;
  } else if (route.view === "inbox" || route.view === "search" || route.view === "user") {
    content = <SupportArea api={api} route={route} capabilities={capabilities} doc={win.document} />;
  } else if (route.view === "accounts") {
    content = <AccountsArea api={api} route={route} capabilities={capabilities} org={Array.isArray(phase.boot.org) ? phase.boot.org : []} doc={win.document} />;
  } else if (route.view === "legacy") {
    content = null;
  } else {
    const item = NAV_ITEMS.find((nav) => nav.area === route.area);
    content = (
      <Message title={item?.label || ""} body={`${item?.description || ""}——這一區還在從 App 搬過來（#550），搬好之前請先用 App 的管理分頁。`}>
        <a className="adm-button" href={memberAppAdminUrl(environment)} target="_blank" rel="noopener noreferrer">開啟 App 管理分頁</a>
      </Message>
    );
  }

  return (
    <div className={`adm-app${legacyActive ? " adm-app--legacy" : ""}`}>
      <header className="adm-topbar">
        <button
          type="button"
          className="adm-icon-button adm-menu-button"
          aria-label="開關選單"
          aria-expanded={navOpen}
          aria-controls="adm-nav"
          onClick={() => setNavOpen((open) => !open)}
        >
          <Menu className="adm-icon" aria-hidden="true" />
        </button>
        <span className="adm-brand">速讀計畫後台</span>
        {environment !== "production" && <Badge tone="warning">{ENVIRONMENT_LABEL[environment]}</Badge>}
        <span className="adm-topbar__spacer" />
        <label className="adm-visually-hidden" htmlFor="adm-theme">主題</label>
        <select id="adm-theme" className="adm-select" value={theme} onChange={(event) => onThemeChange(event.target.value as ThemePreference)}>
          {THEMES.map((value) => <option key={value} value={value}>{THEME_LABEL[value]}</option>)}
        </select>
        <span className="adm-me">{me?.name || "管理員"}{me?.role_label ? `・${me.role_label}` : ""}</span>
        <button type="button" className="adm-button adm-button--ghost" onClick={() => { auth.logout("manual"); }}>
          <LogOut className="adm-icon" aria-hidden="true" />登出
        </button>
      </header>
      {idleWarning && (
        <div className="adm-banner" role="alert">一分鐘內沒有操作就會自動登出。移動滑鼠或按任意鍵就能繼續使用。</div>
      )}
      <div className="adm-body">
        <nav id="adm-nav" className={`adm-nav${navOpen ? " adm-nav--open" : ""}`} aria-label="後台功能">
          <ul>
            {navItems.map((item) => {
              const Icon = NAV_ICON[item.icon];
              const current = item.area === area;
              return (
                <li key={item.area}>
                  <a className={`adm-nav__link${current ? " adm-nav__link--active" : ""}`} href={`#/${item.area}`} aria-current={current ? "page" : undefined}>
                    <Icon className="adm-icon" aria-hidden="true" />
                    <span>{item.label}</span>
                    {!item.ready && <span className="adm-nav__soon">搬移中</span>}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="adm-main">
          {content}
          {legacyRoute && (
            <LegacyHost
              api={api}
              win={win}
              visible={legacyActive}
              area={legacyRoute.area}
              section={legacyRoute.section}
              theme={resolvedTheme}
              getToken={() => auth.getToken()}
              getIdToken={() => auth.getIdToken()}
              onLoginRequired={() => { auth.login(win.location.hash).catch(() => {}); }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function Message({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="adm-message">
      <h2>{title}</h2>
      <p>{body}</p>
      {children}
    </div>
  );
}

function Gate({ phase, auth }: { phase: Exclude<Phase, { name: "ready" }>; auth: AdminAuth }) {
  const [loginError, setLoginError] = useState(false);
  const login = () => {
    setLoginError(false);
    auth.login("#/support").catch(() => setLoginError(true));
  };
  const loginButton = <button type="button" className="adm-button adm-button--primary" onClick={login}>重新登入</button>;
  let body: React.ReactNode;
  switch (phase.name) {
    case "starting":
      body = <Spinner label="正在確認登入…" />;
      break;
    case "redirecting":
      body = <Spinner label="正在前往教會登入頁…" />;
      break;
    case "loading":
      body = <Spinner label="載入後台…" />;
      break;
    case "signed_out":
      body = (
        <Message
          title={phase.reason === "idle" ? "已因閒置自動登出" : "已登出"}
          body={phase.reason === "idle" ? "超過 30 分鐘沒有操作，為了保護會友資料，已自動登出。" : "你已登出後台。"}
        >
          {loginButton}
        </Message>
      );
      break;
    case "auth_error":
      body = <Message title="登入沒有完成" body={phase.message}>{loginButton}</Message>;
      break;
    case "forbidden":
      body = (
        <Message title="沒有後台權限" body="這個帳號不能使用後台。如果你應該要有權限，請聯絡系統管理員。">
          <button type="button" className="adm-button" onClick={() => { auth.logout("manual"); }}>換個帳號登入</button>
        </Message>
      );
      break;
    case "bootstrap_error":
      body = (
        <div className="adm-message">
          <h2>後台載入失敗</h2>
          <ErrorNotice error={phase.error} />
          {loginButton}
        </div>
      );
      break;
  }
  return (
    <div className="adm-gate">
      <div className="adm-gate__panel">
        <p className="adm-brand">速讀計畫後台</p>
        {body}
        {loginError && <p className="adm-danger-text">連不上登入服務，請檢查網路後再試。</p>}
      </div>
    </div>
  );
}
