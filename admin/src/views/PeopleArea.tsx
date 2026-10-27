// 「人」區（#567）：上面兩個分頁「名單與查詢」「管理範圍」；點名單裡的人打開個人頁（整頁，左上角回名單）。
// 原本分在「客服 → 查詢使用者」和「帳號與權限 → 使用者名單」兩處，合成這一區。
// 名單、管理範圍的資料放在 App 那一層（ui），打開某人、切到別區再回來都不重抓。
// 能力：名單與管理範圍要 accounts.read，個人頁要 support.read（伺服器端 admin-api 仍會再擋）。
import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { AdminApi } from "../api.ts";
import { formatRoute, type AdminRoute } from "../route.ts";
import { currentTabId } from "../tabs.ts";
import type { OrgTreeNode } from "../types.ts";
import { AreaTabs } from "./AreaTabs.tsx";
import { INITIAL_SCOPES, ScopeManager, type ScopesState } from "./ScopeManager.tsx";
import { UserDetail } from "./UserDetail.tsx";
import { INITIAL_DIRECTORY, UserDirectory, type DirectoryState } from "./UserDirectory.tsx";

export type PeopleUiState = { directory: DirectoryState; scopes: ScopesState };
export const INITIAL_PEOPLE_UI: PeopleUiState = { directory: INITIAL_DIRECTORY, scopes: INITIAL_SCOPES };

type Props = {
  api: AdminApi;
  route: Extract<AdminRoute, { view: "people" } | { view: "user" }>;
  capabilities: readonly string[];
  org: readonly OrgTreeNode[];
  ui: PeopleUiState;
  setUi: Dispatch<SetStateAction<PeopleUiState>>;
  doc: Document;
};

/** 把整個 ui 的 setState 拆成某一塊的 setState（子元件照原本的介面用） */
function slice<K extends keyof PeopleUiState>(setUi: Props["setUi"], key: K): Dispatch<SetStateAction<PeopleUiState[K]>> {
  return (action) => setUi((prev) => ({
    ...prev,
    [key]: typeof action === "function" ? (action as (value: PeopleUiState[K]) => PeopleUiState[K])(prev[key]) : action
  }));
}

export function PeopleArea({ api, route, capabilities, org, ui, setUi, doc }: Props) {
  const canList = capabilities.includes("accounts.read");
  // setState 要穩定（子元件的 useCallback／useEffect 依賴它）
  const setDirectory = useMemo(() => slice(setUi, "directory"), [setUi]);
  const setScopes = useMemo(() => slice(setUi, "scopes"), [setUi]);
  const scopesView = route.view === "people" && route.tab === "scopes";

  let content;
  if (route.view === "user") {
    content = capabilities.includes("support.read")
      ? <UserDetail api={api} userId={route.userId} reason={route.reason} capabilities={capabilities} backHref={canList ? formatRoute({ view: "people", tab: "directory", profileId: null }) : null} />
      : <NoAccess body="你的帳號沒有查看個人資料的後台權限。" />;
  } else if (!canList) {
    content = <NoAccess body="你的帳號沒有名單與管理範圍的後台權限。" />;
  } else if (scopesView) {
    content = <ScopeManager api={api} org={org} profileId={route.profileId} capabilities={capabilities} state={ui.scopes} setState={setScopes} doc={doc} />;
  } else {
    content = <UserDirectory api={api} org={org} capabilities={capabilities} state={ui.directory} setState={setDirectory} doc={doc} />;
  }

  return (
    <div className="adm-support-area">
      {/* 分頁和左側選單同一份（tabs.ts，#619）；沒有 accounts.read 就沒有分頁 */}
      <AreaTabs area="people" current={currentTabId(route) ?? ""} capabilities={capabilities} className="adm-support-tabs" />
      {content}
    </div>
  );
}

function NoAccess({ body }: { body: string }) {
  return (
    <div className="adm-message">
      <h2>沒有權限</h2>
      <p>{body}</p>
    </div>
  );
}
