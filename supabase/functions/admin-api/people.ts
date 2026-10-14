// 後台「人」區的個人頁（#567）：user_summary 打開某人只拿事實（admin_api_user_summary），這裡把事實變成
//   · 除錯檢查：只列真的發生過的事故——重複報名、沒有歸屬計畫的打卡、App 章數和計畫進度章數不一致、
//     登入身分對到別的帳號、同計畫同組別在兩隊、截止＋寬限後還被寫入、App 不是最新版。
//   · 「會友 App 現在應該顯示」：每個教會計畫用和會友 App 同一份規則（_shared/progress）算出進度，
//     拿來和會友的截圖對照。前端不再算一次。
// 純函式（buildPersonReport）＋一個 runner；scripts/admin-api-people.test.mjs 直接測。
import { careReasonText } from "../_shared/progress/plan-progress.mjs";
import { preparePlanReport, resolvePlanForReport } from "../_shared/progress/plan-report.mjs";
import { sqlFailure } from "./run-helpers.ts";
import type { ActionRunner } from "./types.ts";

export type CheckStatus = "ok" | "warn" | "fail" | "unknown";
export type CheckLink = { kind: "user" | "team"; id: string; label: string; plan_id?: string | null };
export type PersonCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  summary: string;
  details: string[];
  impact?: string;
  fix?: string;
  links?: CheckLink[];
};

/** 會友 App 目前的版本（/version.json）；拿不到就是 null。 */
export type AppVersionInfo = { version: string; minVersion: string | null } | null;

type Obj = Record<string, unknown>;

const BUILD_ID_RE = /^\d{14}$/;

function obj(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
}
function list(value: unknown): Obj[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as Obj[] : [];
}
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function str(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}
function planLabel(value: unknown): string {
  return `「${str(value) || "未命名計畫"}」`;
}
/** 20261011090000 → 2026-10-11 09:00 */
export function formatBuildId(buildId: string): string {
  if (!BUILD_ID_RE.test(buildId)) return buildId || "—";
  return `${buildId.slice(0, 4)}-${buildId.slice(4, 6)}-${buildId.slice(6, 8)} ${buildId.slice(8, 10)}:${buildId.slice(10, 12)}`;
}
function dateOnly(value: unknown): string {
  return str(value).slice(0, 10);
}

function duplicateCheck(facts: Obj): PersonCheck {
  const dups = list(facts.duplicate_enrollments);
  const base = { id: "duplicate_enrollment", label: "重複報名" };
  if (dups.length === 0) return { ...base, status: "ok", summary: "每個計畫只有一筆報名。", details: [] };
  return {
    ...base,
    status: "fail",
    summary: `${dups.length} 個計畫有不只一筆報名。`,
    details: dups.map((dup) => `${planLabel(dup.plan_name)}有 ${num(dup.count)} 筆報名`),
    impact: "打卡會分散在不同報名，計畫進度、排名會少算。",
    fix: "要合併成一筆報名（由工程處理，做法同以前合併重複報名的資料修正）。"
  };
}

function orphanCheck(facts: Obj): PersonCheck {
  const orphan = obj(facts.orphan_logs);
  const count = num(orphan.count);
  const base = { id: "orphan_logs", label: "沒有歸屬計畫的打卡" };
  if (count === 0) return { ...base, status: "ok", summary: "每筆打卡都有歸屬的計畫。", details: [] };
  const books = Array.isArray(orphan.books) ? orphan.books.map(str).filter(Boolean) : [];
  return {
    ...base,
    status: "fail",
    summary: `${count} 筆打卡（${num(orphan.chapters)} 章）沒有歸屬任何計畫。`,
    details: [
      ...(books.length ? [`書卷：${books.join("、")}`] : []),
      `閱讀時間：${dateOnly(orphan.first_read_at) || "—"} ～ ${dateOnly(orphan.last_read_at) || "—"}`
    ],
    impact: "App 的計畫進度會把這些打卡算進目前的計畫，章數會多算。",
    fix: "確認是哪個計畫讀的；歸到該計畫或刪除（修正動作在之後的單評估）。"
  };
}

function chapterCheck(facts: Obj): PersonCheck {
  const rows = list(facts.chapter_totals);
  const off = rows.filter((row) => num(row.app_total) !== num(row.in_books));
  const base = { id: "chapter_totals", label: "App 累積章數和計畫進度一致" };
  if (rows.length === 0) return { ...base, status: "ok", summary: "沒有參加教會計畫。", details: [] };
  if (off.length === 0) {
    return { ...base, status: "ok", summary: "每個計畫的累積章數都和計畫進度用的章數相同。", details: rows.map((row) => `${planLabel(row.plan_name)}：${num(row.app_total)} 章`) };
  }
  return {
    ...base,
    status: "warn",
    summary: `${off.length} 個計畫的累積章數和計畫進度不一樣。`,
    details: off.map((row) => {
      const extra = num(row.app_total) - num(row.in_books);
      return `${planLabel(row.plan_name)}：App 累積章數 ${num(row.app_total)}、計畫進度算 ${num(row.in_books)}（${extra} 章不在這個計畫的書卷裡）`;
    }),
    impact: "會友在統計頁看到的累積章數比計畫進度、排名多。",
    fix: "通常是在計畫裡讀了別卷書；確認後一般不需要處理。"
  };
}

function identityCheck(facts: Obj): PersonCheck {
  const identity = obj(facts.identities);
  const sharedMember = list(identity.shared_member_id);
  const sharedEmail = list(identity.shared_email);
  const base = { id: "identity", label: "登入身分只對到這一個帳號" };
  const links = (rows: Obj[]): CheckLink[] => rows
    .filter((row) => typeof row.id === "string")
    .map((row) => ({ kind: "user", id: str(row.id), label: str(row.name) || "（未填姓名）" }));
  if (sharedMember.length > 0) {
    return {
      ...base,
      status: "fail",
      summary: `同一個會員中心身分還有 ${sharedMember.length} 個帳號。`,
      details: sharedMember.map((row) => str(row.name) || "（未填姓名）"),
      impact: "會友換登入方式時可能登進另一個帳號，看起來像進度不見。",
      fix: "確認哪個是會友在用的帳號，另一個的資料要合併（由工程處理）。",
      links: links(sharedMember)
    };
  }
  if (num(identity.count) === 0) {
    return { ...base, status: "warn", summary: "這個帳號沒有任何登入身分。", details: [], impact: "這個帳號登不進來；會友可能用的是另一個帳號。", fix: "用姓名或 email 在名單找找看有沒有另一個帳號。" };
  }
  if (sharedEmail.length > 0) {
    return {
      ...base,
      status: "warn",
      summary: `同一個 email 還有 ${sharedEmail.length} 個帳號。`,
      details: sharedEmail.map((row) => str(row.name) || "（未填姓名）"),
      impact: "會友可能有兩個帳號，資料各在一邊。",
      fix: "打開另一個帳號看看是不是同一個人。",
      links: links(sharedEmail)
    };
  }
  return { ...base, status: "ok", summary: `${num(identity.count)} 個登入身分，都只對到這個帳號。`, details: [] };
}

function teamConflictCheck(facts: Obj): PersonCheck {
  const conflicts = list(facts.team_conflicts);
  const base = { id: "team_conflict", label: "沒有同時在兩隊" };
  if (conflicts.length === 0) return { ...base, status: "ok", summary: "每個計畫、每個組別最多一隊。", details: [] };
  const links: CheckLink[] = conflicts.flatMap((conflict) => list(conflict.teams)
    .filter((team) => typeof team.id === "string")
    .map((team) => ({ kind: "team" as const, id: str(team.id), label: str(team.name) || "未命名隊伍", plan_id: str(conflict.global_plan_id) || null })));
  return {
    ...base,
    status: "fail",
    summary: `${conflicts.length} 個計畫的同一組別在不只一隊。`,
    details: conflicts.map((conflict) => `${planLabel(conflict.plan_name)} ${num(conflict.division)} 人組：${list(conflict.teams).map((team) => str(team.name) || "未命名隊伍").join("、")}`),
    impact: "團隊進度、排名會重複算這個人。",
    fix: "從其中一隊移出（打開隊伍頁看是哪一隊多出來）。",
    links
  };
}

function graceCheck(facts: Obj): PersonCheck {
  const rows = list(facts.grace);
  const late = rows.filter((row) => num(row.late_writes) > 0);
  const base = { id: "grace", label: "截止與寬限期正常" };
  const describe = (row: Obj) => `${planLabel(row.plan_name)}：${dateOnly(row.end_date)} 截止${num(row.grace_days) > 0 ? `、寬限 ${num(row.grace_days)} 天（到 ${dateOnly(row.cutoff)}）` : ""}`;
  if (rows.length === 0) return { ...base, status: "ok", summary: "沒有參加固定日期的計畫。", details: [] };
  if (late.length === 0) return { ...base, status: "ok", summary: "截止後沒有被寫入或修改的打卡。", details: rows.map(describe) };
  return {
    ...base,
    status: "fail",
    summary: `${late.length} 個計畫在截止＋寬限之後還有打卡被寫入或修改。`,
    details: late.map((row) => `${describe(row)}；之後寫入 ${num(row.late_writes)} 筆`),
    impact: "已結算的進度被改動，排名、獎項可能和公布時不同。",
    fix: "多半是寬限期功能上線前的舊資料；若是最近的紀錄要找工程查原因。"
  };
}

export function appVersionCheck(facts: Obj, app: AppVersionInfo): PersonCheck {
  const last = obj(facts.last_report_build);
  const buildId = str(last.build_id);
  const reportedOn = dateOnly(last.reported_at);
  const base = { id: "app_version", label: "App 是最新版" };
  if (!buildId) {
    return { ...base, status: "unknown", summary: "查不到：會友沒有送過附診斷資訊的回報（伺服器只從回報知道 App 版本）。", details: [] };
  }
  const details = [`最近一次回報（${reportedOn || "—"}）時的版本：${formatBuildId(buildId)}`];
  if (!app || !BUILD_ID_RE.test(app.version)) {
    return { ...base, status: "unknown", summary: "查不到目前的最新版本。", details };
  }
  details.push(`目前最新版本：${formatBuildId(app.version)}`);
  if (buildId === app.version || buildId > app.version) {
    return { ...base, status: "ok", summary: "回報時就是最新版。", details };
  }
  if (app.minVersion && buildId < app.minVersion) {
    return {
      ...base,
      status: "fail",
      summary: "回報時的版本比強制更新的門檻還舊。",
      details,
      impact: "這個版本呼叫伺服器的方式已經改了，部分功能會壞。",
      fix: "請會友完全關掉 App 再打開；還是一樣就打開「/repair」修復頁。"
    };
  }
  return {
    ...base,
    status: "warn",
    summary: "回報時不是最新版（之後可能已自動更新）。",
    details,
    impact: "回報的問題可能新版已經修好。",
    fix: "請會友關掉 App 再打開，確認問題是否還在。"
  };
}

// ── 會友 App 現在應該顯示 ─────────────────────────────────────────────────

type PlanState = "upcoming" | "running" | "ended";

function planState(startKey: string, endKey: string, todayKey: string): PlanState {
  if (startKey && todayKey < startKey) return "upcoming";
  if (endKey && todayKey > endKey) return "ended";
  return "running";
}

export function describeAppPlans(rows: unknown, { accountActive }: { accountActive: boolean }) {
  return list(rows).map((row) => {
    const resolved = resolvePlanForReport(obj(row.plan));
    const report = preparePlanReport({ resolved, overview: obj(row.people) });
    const { plan, ctx } = report;
    const person = report.people[0] || null;
    const startKey = str(plan.startDate).slice(0, 10);
    const endKey = str(plan.endDate).slice(0, 10);
    return {
      plan: {
        id: str(plan.id),
        name: str(plan.name),
        start_date: startKey || null,
        end_date: endKey || null,
        state: planState(startKey, endKey, ctx.todayKey),
        books: Array.isArray(plan.books) ? plan.books : [],
        total_days: ctx.baselineDays.length,
        expected_days: ctx.expectedDays
      },
      // 停用的帳號 plan_progress_people 不會列出（App 也進不去）
      shown: person !== null,
      account_active: accountActive,
      enrolled: person ? person.enrolled : false,
      status: person ? person.status : null,
      status_label: person ? person.statusLabel : null,
      round: person ? person.round : 0,
      progress: person ? person.progress : 0,
      chapters: person ? person.chapters : 0,
      behind_days: person ? person.behindDays : 0,
      last_read_at: person ? person.lastReadAt : null,
      days_since_read: person ? person.daysSinceRead : null,
      read_days_7: person ? person.readDays7 : 0,
      care: person ? person.care : false,
      care_reasons: person ? person.careReasons.map(careReasonText).filter(Boolean) : [],
      teams: person ? person.teams : []
    };
  });
}

/** SQL 的事實 → 個人頁要的全部（帳號等原樣，facts／app_plans 換成檢查與 App 應顯示）。 */
export function buildPersonReport(summary: unknown, app: AppVersionInfo) {
  const data = obj(summary);
  const facts = obj(data.facts);
  const account = obj(data.account);
  const { facts: _facts, app_plans: appPlans, ...rest } = data;
  return {
    ...rest,
    checks: [
      duplicateCheck(facts),
      orphanCheck(facts),
      chapterCheck(facts),
      identityCheck(facts),
      teamConflictCheck(facts),
      graceCheck(facts),
      appVersionCheck(facts, app)
    ],
    app_plans: describeAppPlans(appPlans, { accountActive: account.is_active !== false }),
    today: str(facts.today) || null
  };
}

export const runUserSummary: ActionRunner = async ({ args, rpc, appVersion }) => {
  const result = await rpc("admin_api_user_summary", args);
  if (result.error) return sqlFailure("admin_api_user_summary", result.error);
  if (result.data === null || result.data === undefined) return { ok: false, status: 404, error: "user_not_found" };
  // 版本拿不到不影響其他檢查（那一項顯示「查不到」）
  const app = appVersion ? await appVersion().catch(() => null) : null;
  return { ok: true, data: buildPersonReport(result.data, app) };
};
