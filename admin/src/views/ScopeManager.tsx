// 管理範圍（#550 第二組）：取代 App 管理分頁的「組織權限總覽」＋「管理範圍設定」。
//
// 左邊：組織名單（大區 → 牧區 → 小組）和每個單位的負責人；右邊：某位負責人的管理範圍。
// 請求預算：打開 1 個 scope_overview（負責人清單）；組織名單用 bootstrap 帶來的；點某位負責人不再打請求；
// 儲存 1 個 scope_set（伺服器檢查名稱、和稽核同一個交易），成功後就地更新，不重抓總覽。
// 角色由會員中心同步，這裡只能看、不能改。
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronLeft, Download, RefreshCw } from "lucide-react";
import { isAbortError, type AdminApi } from "../api.ts";
import { downloadCsv } from "../download.ts";
import { text } from "../format.ts";
import { formatRoute } from "../route.ts";
import {
  LEVEL_LABEL,
  WHOLE_CHURCH_ROLES,
  WHOLE_CHURCH_ROLE_LABEL,
  assignLeaders,
  effectiveScopes,
  isWholeChurch,
  scopeChoices,
  scopeLevel,
  scopeText,
  unassignedCount,
  usesPlacementFallback,
  type ScopeLevel
} from "../scopes.ts";
import type { CsvExport, OrgTreeNode, ScopeLeader, ScopeOverview, ScopeSetResult } from "../types.ts";
import { Badge, Card, ErrorNotice, Field, Spinner } from "../ui.tsx";

export type ScopesState = { leaders: ScopeLeader[] | null; loading: boolean; error: unknown };
export const INITIAL_SCOPES: ScopesState = { leaders: null, loading: false, error: null };

type Props = {
  api: AdminApi;
  org: readonly OrgTreeNode[];
  profileId: string | null;
  capabilities: readonly string[];
  state: ScopesState;
  setState: Dispatch<SetStateAction<ScopesState>>;
  doc: Document;
};

export function ScopeManager({ api, org, profileId, capabilities, state, setState, doc }: Props) {
  const load = useCallback((fresh: boolean) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    api.call<ScopeOverview>("scope_overview", {}, { fresh })
      .then((data) => setState({ leaders: Array.isArray(data?.leaders) ? data.leaders : [], loading: false, error: null }))
      .catch((err) => {
        if (isAbortError(err)) return;
        setState((prev) => ({ ...prev, loading: false, error: err }));
      });
  }, [api, setState]);

  useEffect(() => {
    if (state.leaders === null && !state.loading && state.error === null) load(false);
  }, [state.leaders, state.loading, state.error, load]);

  const onSaved = useCallback((result: ScopeSetResult) => {
    // 名單上的「管理範圍」也變了；總覽就地更新，快取丟掉
    api.invalidate(["directory_list", "scope_overview"]);
    setState((prev) => ({
      ...prev,
      leaders: (prev.leaders || []).map((leader) => leader.id === result.profile_id
        ? { ...leader, managed_regions: result.managed_regions, managed_zones: result.managed_zones, managed_groups: result.managed_groups }
        : leader)
    }));
  }, [api, setState]);

  const leaders = state.leaders;
  const selected = leaders && profileId ? leaders.find((leader) => leader.id === profileId) || null : null;

  return (
    <div className={`adm-support${profileId ? " adm-support--user-open" : ""}`}>
      <div className="adm-support__search adm-inbox">
        <Overview
          api={api}
          org={org}
          leaders={leaders}
          loading={state.loading}
          error={state.error}
          profileId={profileId}
          canExport={capabilities.includes("export")}
          onRefresh={() => load(true)}
          doc={doc}
        />
      </div>
      <div className="adm-support__detail">
        <a className="adm-back" href={formatRoute({ view: "people", tab: "scopes", profileId: null })}>
          <ChevronLeft className="adm-icon" aria-hidden="true" />回到權限總覽
        </a>
        {leaders === null
          ? (state.loading
            ? <Spinner label="載入負責人…" />
            : state.error !== null && <ErrorNotice error={state.error} action={<button type="button" className="adm-button" onClick={() => load(true)}>重試</button>} />)
          : (
            <>
              <PersonPicker leaders={leaders} profileId={profileId} />
              {profileId === null && <p className="adm-muted adm-empty">點選左邊組織名單裡的負責人，或從上面選一位，查看或設定管理範圍。</p>}
              {profileId !== null && selected === null && (
                <p className="adm-muted adm-empty">
                  這位不在負責人名單裡（一般會友或帳號已停用），不用設定管理範圍。
                  {capabilities.includes("support.read") && (
                    <> <a className="adm-link" href={formatRoute({ view: "user", userId: profileId, reason: "從管理範圍查看" })}>查看這位使用者</a></>
                  )}
                </p>
              )}
              {selected && (
                <ScopeEditor
                  key={selected.id}
                  api={api}
                  org={org}
                  leader={selected}
                  canWrite={capabilities.includes("accounts.write")}
                  canOpenUser={capabilities.includes("support.read")}
                  onSaved={onSaved}
                />
              )}
            </>
          )}
      </div>
    </div>
  );
}

function leaderLabel(leader: ScopeLeader): string {
  return `${text(leader.name, "（未填姓名）")}（${text(leader.role_label, leader.role_code)}）`;
}

function PersonPicker({ leaders, profileId }: { leaders: readonly ScopeLeader[]; profileId: string | null }) {
  const known = profileId !== null && leaders.some((leader) => leader.id === profileId);
  return (
    <div className="adm-scope-picker">
      <label className="adm-label" htmlFor="adm-scope-person">負責人</label>
      <select
        id="adm-scope-person"
        className="adm-select"
        value={known ? profileId ?? "" : ""}
        onChange={(event) => {
          const view = event.currentTarget.ownerDocument.defaultView;
          if (view) view.location.hash = formatRoute({ view: "people", tab: "scopes", profileId: event.target.value || null });
        }}
      >
        <option value="">選擇一位負責人…</option>
        {leaders.map((leader) => <option key={leader.id} value={leader.id}>{leaderLabel(leader)}</option>)}
      </select>
    </div>
  );
}

// ── 權限總覽 ────────────────────────────────────────────────────────────────

function Overview({ api, org, leaders, loading, error, profileId, canExport, onRefresh, doc }: {
  api: AdminApi;
  org: readonly OrgTreeNode[];
  leaders: ScopeLeader[] | null;
  loading: boolean;
  error: unknown;
  profileId: string | null;
  canExport: boolean;
  onRefresh: () => void;
  doc: Document;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const assignment = useMemo(() => assignLeaders(leaders || []), [leaders]);
  const unassigned = leaders ? unassignedCount(org, assignment) : null;

  const exportOrg = () => {
    setExporting(true);
    setExportError(null);
    api.call<CsvExport>("org_export")
      .then((file) => downloadCsv(doc, file.filename, file.csv))
      .catch((err) => setExportError(err))
      .finally(() => setExporting(false));
  };

  const chips = (people: readonly ScopeLeader[] | undefined) => (
    people && people.length > 0
      ? (
        <span className="adm-person-chips">
          {people.map((person) => (
            <a
              key={person.id}
              className={`adm-person-chip${person.id === profileId ? " adm-person-chip--active" : ""}`}
              href={formatRoute({ view: "people", tab: "scopes", profileId: person.id })}
              aria-current={person.id === profileId ? "page" : undefined}
            >
              {text(person.name, "（未填姓名）")}
            </a>
          ))}
        </span>
      )
      : <span className="adm-muted adm-small">尚未指派</span>
  );

  return (
    <div className="adm-org-tree">
      <div className="adm-inbox__toolbar">
        <h2 className="adm-inbox__title">權限總覽</h2>
        <button type="button" className="adm-icon-button" onClick={onRefresh} disabled={loading} aria-label="重新整理" title="重新整理">
          <RefreshCw className={`adm-icon${loading ? " adm-spin" : ""}`} aria-hidden="true" />
        </button>
        {canExport && (
          <button type="button" className="adm-icon-button" onClick={exportOrg} disabled={exporting} aria-label="匯出組織架構 CSV" title="匯出組織架構（大區、牧區、小組）CSV">
            <Download className="adm-icon" aria-hidden="true" />
          </button>
        )}
      </div>
      {unassigned !== null && (
        <p className="adm-muted adm-small" role="status">{unassigned > 0 ? `${unassigned} 個單位尚未指派` : "全部已指派"}</p>
      )}
      {exportError !== null && <ErrorNotice error={exportError} />}
      {error !== null && <ErrorNotice error={error} action={<button type="button" className="adm-button" onClick={onRefresh}>重試</button>} />}
      {leaders === null && loading && <Spinner label="載入負責人…" />}
      {leaders !== null && (
        <>
          <ul className="adm-org-tree__church">
            {WHOLE_CHURCH_ROLES.map((role) => (
              <li key={role} className="adm-org-tree__row">
                <span className="adm-org-tree__unit">{WHOLE_CHURCH_ROLE_LABEL[role]}<span className="adm-muted adm-small">全教會</span></span>
                {chips(assignment.wholeChurch[role])}
              </li>
            ))}
          </ul>
          {org.length === 0 && <p className="adm-muted">目前沒有任何大區資料。</p>}
          {org.map((region) => (
            <details key={region.id} className="adm-org-tree__region" open>
              <summary className="adm-org-tree__row">
                <span className="adm-org-tree__unit">{region.name}</span>
                {chips(assignment.byLevel.region.get(region.name))}
              </summary>
              {(region.zones || []).length === 0 && <p className="adm-muted adm-small adm-org-tree__empty">此大區目前沒有牧區資料。</p>}
              {(region.zones || []).map((zone) => (
                <details key={zone.id} className="adm-org-tree__zone">
                  <summary className="adm-org-tree__row">
                    <span className="adm-org-tree__unit">{zone.name}</span>
                    {chips(assignment.byLevel.zone.get(zone.name))}
                  </summary>
                  <ul className="adm-org-tree__groups">
                    {(zone.groups || []).map((group) => (
                      <li key={group.id} className="adm-org-tree__row">
                        <span className="adm-org-tree__unit">{group.name}</span>
                        {chips(assignment.byLevel.group.get(group.name))}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </details>
          ))}
        </>
      )}
    </div>
  );
}

// ── 某位負責人的管理範圍 ─────────────────────────────────────────────────────

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

const FIELD_PARAM: Record<ScopeLevel, "regions" | "zones" | "groups"> = { region: "regions", zone: "zones", group: "groups" };
const PLACEMENT: Record<ScopeLevel, keyof Pick<ScopeLeader, "great_region" | "pastoral_zone" | "small_group">> = {
  region: "great_region",
  zone: "pastoral_zone",
  group: "small_group"
};

function ScopeEditor({ api, org, leader, canWrite, canOpenUser, onSaved }: {
  api: AdminApi;
  org: readonly OrgTreeNode[];
  leader: ScopeLeader;
  canWrite: boolean;
  canOpenUser: boolean;
  onSaved: (result: ScopeSetResult) => void;
}) {
  const level = scopeLevel(leader.role_code);
  const choices = useMemo(() => (level ? scopeChoices(org, level, effectiveScopes(leader)) : null), [org, level, leader]);
  const [checked, setChecked] = useState<string[]>(() => choices?.selected ?? []);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  // 存好之後 leader 換成新的範圍：勾選改成新的有效範圍
  useEffect(() => { setChecked(choices?.selected ?? []); }, [choices]);

  const placement = [leader.great_region, leader.pastoral_zone, leader.small_group].filter(Boolean).join(" / ") || "尚未設定";
  const fallback = usesPlacementFallback(leader);
  const allNames = choices ? [...new Set(choices.sections.flatMap((section) => section.names))] : [];
  const dirty = !!choices && (!sameSet(checked, choices.selected) || choices.dropped.length > 0);

  const toggle = (name: string, on: boolean) => {
    setSaved(false);
    setChecked((prev) => (on ? (prev.includes(name) ? prev : [...prev, name]) : prev.filter((item) => item !== name)));
  };

  const save = () => {
    if (!level || !canWrite) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const params: Record<string, unknown> = { profile_id: leader.id, regions: [], zones: [], groups: [], [FIELD_PARAM[level]]: checked };
    if (reason.trim()) params.reason = reason.trim();
    api.call<ScopeSetResult>("scope_set", params)
      .then((result) => {
        setSaved(true);
        setReason("");
        onSaved(result);
      })
      .catch((err) => setError(err))
      .finally(() => setSaving(false));
  };

  const unit = level ? LEVEL_LABEL[level] : "";
  const placementName = level ? leader[PLACEMENT[level]] : null;

  return (
    <div className="adm-detail">
      <Card title={text(leader.name, "（未填姓名）")} actions={canOpenUser
        ? <a className="adm-link adm-small" href={formatRoute({ view: "user", userId: leader.id, reason: "從管理範圍查看" })}>查看這位使用者</a>
        : undefined}
      >
        <dl className="adm-fields">
          <Field name="電子信箱">{text(leader.email_masked, "未提供")}</Field>
          <Field name="會員中心角色"><Badge tone="brand">{text(leader.role_label, leader.role_code)}</Badge></Field>
          <Field name="牧養歸屬">{placement}</Field>
          <Field name="目前有效範圍">
            {scopeText(leader)}
            {fallback && <span className="adm-muted adm-small">（沒有另外設定，沿用本人歸屬）</span>}
          </Field>
        </dl>
        <p className="adm-muted adm-small">角色由會員中心同步，這裡不能改；要換角色請到會員中心。</p>
      </Card>

      {!level && (
        <p className="adm-muted">
          {isWholeChurch(leader.role_code) ? "這個角色固定擁有全教會範圍，不需要另外設定。" : "這個角色只有本人範圍，不使用管理範圍。"}
        </p>
      )}

      {level && choices && (
        <Card
          title={`管理的${unit}`}
          actions={canWrite && allNames.length > 0
            ? (
              <span className="adm-row">
                <button type="button" className="adm-link-button" onClick={() => { setSaved(false); setChecked(allNames); }}>全選</button>
                <button type="button" className="adm-link-button" onClick={() => { setSaved(false); setChecked([]); }}>全部不勾</button>
              </span>
            )
            : undefined}
        >
          {!canWrite && <p className="adm-muted adm-small">你只能查看，不能修改管理範圍。</p>}
          {choices.dropped.length > 0 && (
            <p className="adm-notice adm-small" role="note">
              「{choices.dropped.join("、")}」不在{unit}名單中，沒有勾選；儲存後會移除。
            </p>
          )}
          {allNames.length === 0 && <p className="adm-muted">目前沒有可選擇的{unit}資料。</p>}
          <div className="adm-scope-options">
            {choices.sections.map((section) => (
              <fieldset key={section.key} className="adm-scope-options__section">
                <legend>{section.title}</legend>
                {section.names.map((name) => (
                  <label key={`${section.key}:${name}`} className="adm-checkbox adm-scope-options__option">
                    <input type="checkbox" checked={checked.includes(name)} disabled={!canWrite || saving} onChange={(event) => toggle(name, event.target.checked)} />
                    {name}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          {canWrite && (
            <>
              <p className="adm-muted adm-small">
                全部不勾＝沿用本人的{unit}（{placementName || `目前沒有${unit}，只有本人範圍`}）。
              </p>
              <label className="adm-label" htmlFor="adm-scope-reason">修改原因（選填，會記在稽核紀錄）</label>
              <input
                id="adm-scope-reason"
                className="adm-input"
                type="text"
                autoComplete="off"
                maxLength={200}
                placeholder="例如：10 月起接手第三牧區"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              {error !== null && <ErrorNotice error={error} />}
              <div className="adm-row">
                <button type="button" className="adm-button adm-button--primary" onClick={save} disabled={saving || !dirty || allNames.length === 0}>
                  {saving ? "儲存中…" : "儲存管理範圍"}
                </button>
                {saved && <span className="adm-small" role="status">管理範圍已儲存。</span>}
                {!saved && !dirty && <span className="adm-muted adm-small">沒有變更</span>}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
