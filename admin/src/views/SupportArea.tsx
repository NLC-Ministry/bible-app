// 客服區（#555）：電腦版左邊搜尋、右邊打開的人；手機版一次只顯示一邊。
// 搜尋框的內容放在這一層，打開某人再回來時搜尋結果還在（結果本身有 60 秒快取）。
import { useState } from "react";
import type { AdminApi } from "../api.ts";
import type { AdminRoute } from "../route.ts";
import { UserDetail } from "./UserDetail.tsx";
import { UserSearch, type SearchState } from "./UserSearch.tsx";

type Props = {
  api: AdminApi;
  route: Extract<AdminRoute, { view: "search" } | { view: "user" }>;
  capabilities: readonly string[];
};

export function SupportArea({ api, route, capabilities }: Props) {
  const [search, setSearch] = useState<SearchState>(() => ({
    query: "",
    reason: route.view === "user" ? route.reason : ""
  }));
  const userOpen = route.view === "user";

  return (
    <div className={`adm-support${userOpen ? " adm-support--user-open" : ""}`}>
      <div className="adm-support__search">
        <UserSearch api={api} state={search} onChange={setSearch} selectedUserId={userOpen ? route.userId : null} />
      </div>
      <div className="adm-support__detail">
        {route.view === "user"
          ? <UserDetail api={api} userId={route.userId} tab={route.tab} reason={route.reason} capabilities={capabilities} />
          : <p className="adm-muted adm-empty">搜尋姓名或 email，點選結果查看這個人的資料。</p>}
      </div>
    </div>
  );
}
