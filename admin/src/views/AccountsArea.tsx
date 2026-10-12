// 帳號與權限區（#550 第二組）：上面兩個分頁「使用者名單」「管理範圍」。
// 兩邊的資料都放在這一層，切分頁再回來不重抓。角色由會員中心同步，這一區不改角色。
import { useState } from "react";
import { KeyRound, Users } from "lucide-react";
import type { AdminApi } from "../api.ts";
import { formatRoute, type AdminRoute } from "../route.ts";
import type { OrgTreeNode } from "../types.ts";
import { INITIAL_SCOPES, ScopeManager, type ScopesState } from "./ScopeManager.tsx";
import { INITIAL_DIRECTORY, UserDirectory, type DirectoryState } from "./UserDirectory.tsx";

type Props = {
  api: AdminApi;
  route: Extract<AdminRoute, { view: "accounts" }>;
  capabilities: readonly string[];
  org: readonly OrgTreeNode[];
  doc: Document;
};

export function AccountsArea({ api, route, capabilities, org, doc }: Props) {
  const [directory, setDirectory] = useState<DirectoryState>(INITIAL_DIRECTORY);
  const [scopes, setScopes] = useState<ScopesState>(INITIAL_SCOPES);
  const usersView = route.tab === "users";

  return (
    <div className="adm-support-area">
      <nav className="adm-tabs adm-support-tabs" aria-label="帳號與權限">
        <a
          className={`adm-tab${usersView ? " adm-tab--active" : ""}`}
          href={formatRoute({ view: "accounts", tab: "users", profileId: null })}
          aria-current={usersView ? "page" : undefined}
        >
          <Users className="adm-icon" aria-hidden="true" />使用者名單
        </a>
        <a
          className={`adm-tab${usersView ? "" : " adm-tab--active"}`}
          href={formatRoute({ view: "accounts", tab: "scopes", profileId: null })}
          aria-current={usersView ? undefined : "page"}
        >
          <KeyRound className="adm-icon" aria-hidden="true" />管理範圍
        </a>
      </nav>
      {usersView
        ? <UserDirectory api={api} org={org} capabilities={capabilities} state={directory} setState={setDirectory} doc={doc} />
        : <ScopeManager api={api} org={org} profileId={route.profileId} capabilities={capabilities} state={scopes} setState={setScopes} doc={doc} />}
    </div>
  );
}
