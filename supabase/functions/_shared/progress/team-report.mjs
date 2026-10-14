// 後台隊伍除錯（#566）：SQL 回的隊伍事實（admin_api_team_*）→ 清單、隊伍頁、異動歷程、跨階段對應。
//
// 判斷都在這裡、用和會友 App 同一份規則：
//   · 成員的報名與進度：plan-report.mjs → plan-progress.mjs（和計畫總覽、名單同一份）。
//   · 隊伍進度、邀請碼看不看得到：team-progress.mjs（App 團隊視窗用的 getTeamOverallPlanProgress、isTeamFull）。
//   · 階段結束不能改、帶隊按鈕：campaign-stage-kinds.mjs（App 的 isCampaignStageEnded）＋ SQL 的帶隊條件
//     （previous_campaign_stage_plan_id、get_reading_team_carryover_offer 的判定）。
// 第一階段只讀；檢查的「修法」指向 #571 的修正動作。
import { isCampaignStageEnded, isCampaignStageKind } from "./campaign-stage-kinds.mjs";
import { preparePlanReport } from "./plan-report.mjs";
import { getTeamOverallPlanProgress, isTeamFull } from "./team-progress.mjs";

export const TEAM_STATUS_LABEL = Object.freeze({ forming: "招募中", ready: "已滿" });

const MEMBER_ROLE_LABEL = { captain: "隊長", member: "隊員" };
const FIX_LATER = "後台的修正動作在下一階段開放（#571）；在那之前請工程協助。";

const statusLabel = (status) => TEAM_STATUS_LABEL[status] || String(status || "未知");
const nameOf = (value, fallback = "（未填姓名）") => (String(value || "").trim() || fallback);
const arr = (value) => (Array.isArray(value) ? value : []);

// 帶隊被擋／被略過的原因：文字同會友 App 帶隊後的提示（db.describeReadingTeamCarryoverSkips）
const CARRY_REASON_TEXT = {
  already_in_target_team: "已在那個階段加入別隊",
  captain_already_in_target: "隊長已在那個階段的這個組別加入別隊",
  plan_requires_pastoral_zone: "還沒設定牧區",
  plan_audience_restricted: "大區不在那個階段的開放範圍"
};
export function carryReasonText(reason) {
  return CARRY_REASON_TEXT[reason] || String(reason || "不符合加入條件");
}

// ── 加入方式：最近一次被加進這隊時經過的函式（0149 的呼叫堆疊）──────────────────────
export function joinMethod(functions) {
  if (functions === null || functions === undefined) return { key: "unknown", label: "不明（異動紀錄開始之前加入）" };
  const list = arr(functions).map(String);
  if (list.includes("carry_reading_teams_to_stage")) return { key: "carry", label: "帶隊帶入" };
  if (list.includes("create_reading_team")) return { key: "create", label: "建隊" };
  if (list.includes("join_reading_team_by_code")) return { key: "code", label: "邀請碼" };
  if (list.length === 0) return { key: "manual", label: "直接改資料庫（管理員）" };
  return { key: "other", label: `其他（${list.join("、")}）` };
}

// ── 成員的報名進度：和計畫總覽、名單同一份規則 ─────────────────────────────────
function describeMembers(resolved, data) {
  const report = preparePlanReport({ resolved, overview: { today: data && data.today, people: arr(data && data.people), meta: null } });
  return { report, byId: new Map(report.people.map((person) => [person.id, person])) };
}

function planChapterTotal(report) {
  return arr(report.plan.books).reduce((sum, book) => sum + (report.ctx.chaptersByBook.get(String(book)) || 0), 0);
}

function planFacts(report) {
  const plan = report.plan;
  const stage = isCampaignStageKind(plan);
  return {
    id: plan.id,
    name: plan.name,
    planKind: plan.planKind,
    startDate: plan.startDate,
    endDate: plan.endDate,
    stage,
    ended: isCampaignStageEnded(plan, report.ctx.todayKey)
  };
}

// ── 除錯檢查 ────────────────────────────────────────────────────────────
// 每項 { id, label, ok, applicable, problems[], impact, fix }；ok=false 才算一項異常。
export function teamChecks({ team, people, plan }) {
  const members = arr(team.members);
  const count = members.length;
  const division = Number(team.division) || 0;
  const checks = [];
  const add = (id, label, problems, impact, fix, applicable = true) => {
    checks.push({ id, label, applicable, ok: !applicable || problems.length === 0, problems: applicable ? problems : [], impact, fix });
  };

  const expected = isTeamFull(count, division) ? "ready" : "forming";
  add("status", "狀態和實際人數一致",
    team.status === expected ? [] : [`狀態是「${statusLabel(team.status)}」，實際 ${count}／${division} 人，應該是「${statusLabel(expected)}」`],
    expected === "forming"
      ? "會友 App 只看人數，仍會露出邀請碼；但舊版 App 與照搬的組隊狀況會把這隊當成已滿。下一位用邀請碼加入時會自動改回招募中。"
      : "人數已滿，邀請碼加入本來就會被擋；只是狀態沒更新，團隊統計可能仍當成未完成。",
    `重算狀態。${FIX_LATER}`);

  add("capacity", "人數沒有超過組別上限",
    count > division ? [`${count} 人，超過 ${division} 人組的上限 ${count - division} 人`] : [],
    "團隊排行、平均進度會失真；App 的團隊統計固定以組別人數計算。",
    `移出多出的隊員。${FIX_LATER}`);

  const captains = members.filter((member) => member.member_role === "captain");
  const captainMember = members.find((member) => member.user_id === team.captain_id);
  const captainProblems = [];
  if (!captainMember) captainProblems.push(`隊長（${nameOf(team.captain_name)}）不在成員名單裡`);
  else if (captainMember.member_role !== "captain") captainProblems.push(`隊長（${nameOf(captainMember.name)}）在名單裡的角色是隊員`);
  if (captains.length > 1) captainProblems.push(`有 ${captains.length} 位成員的角色是隊長：${captains.map((member) => nameOf(member.name)).join("、")}`);
  for (const member of captains) {
    if (member.user_id !== team.captain_id) captainProblems.push(`${nameOf(member.name)} 的角色是隊長，但隊伍記的隊長是別人`);
  }
  add("captain", "隊長在成員名單裡且只有一位", [...new Set(captainProblems)],
    "隊長才看得到的按鈕（改隊名、移出隊員、帶隊進下一階段）會不見或出現在錯的人身上；帶隊要隊長本人在名單裡、角色是隊長。",
    `轉移或補回隊長。${FIX_LATER}`);

  const enrollProblems = [];
  for (const member of members) {
    const person = people.get(member.user_id);
    if (member.is_active === false) enrollProblems.push(`${nameOf(member.name)} 的帳號已停用`);
    else if (!person || !person.enrolled) enrollProblems.push(`${nameOf(member.name)} 沒有報名這個計畫`);
  }
  add("enrolled", "每位成員都有報名這個計畫", enrollProblems,
    "沒報名的人不會出現在計畫名單與總覽，團隊平均進度會把他算成 0。",
    `請那位會友到計畫頁按「加入」，或把他移出隊伍。${FIX_LATER}`);

  const duplicateProblems = [];
  for (const member of members) {
    if (Number(member.division) !== division || member.global_plan_id !== team.global_plan_id) {
      duplicateProblems.push(`${nameOf(member.name)} 的成員資料記的組別或計畫和隊伍不一樣`);
    }
  }
  for (const other of arr(team.elsewhere)) {
    const member = members.find((item) => item.user_id === other.user_id);
    duplicateProblems.push(`${nameOf(member && member.name)} 同時在「${nameOf(other.team_name, "另一支隊")}」`);
  }
  add("duplicate", "沒有人在同計畫同組別的兩支隊", duplicateProblems,
    "同一個人同組別在兩隊，團隊排行會重複計算，App 只會顯示其中一隊。",
    `把他從其中一隊移出。${FIX_LATER}`);

  const ended = plan.stage && plan.ended;
  const afterEnd = Number(team.events_after_end) || 0;
  add("after_end", "階段結束後沒有異動",
    afterEnd > 0 ? [`結束日（${plan.endDate}）之後有 ${afterEnd} 筆異動`] : [],
    "已結束階段的名單被改過（例如管理員改到上一階段的同名隊），現行階段的隊不會跟著變，看起來就像「隔幾天又變回去」。",
    "到現行階段的那一隊修改；打開「跨階段對應」找到對應的隊。",
    ended);

  return checks;
}

function issuesOf(checks) {
  return checks.filter((check) => !check.ok);
}

// ── 會友 App 應該顯示 ───────────────────────────────────────────────────────
function memberProgressInput(person) {
  if (!person || !person.enrolled) return { currentRound: 1, chaptersRead: 0 };
  return { currentRound: person.round, chaptersRead: Number(person.byRound && person.byRound[String(person.round)]) || 0 };
}

// 帶隊按鈕：隊長打開下一階段的組隊視窗時，會不會看到「帶「這隊」加入」（App getCarryoverTeams＋SQL 的 offer 條件）
export function carryoverState({ team, plan, nextStages, todayKey, captainOk }) {
  if (!plan.stage) return { applicable: false, message: "一般計畫沒有帶隊進下一階段。", stages: [] };
  const list = arr(nextStages);
  if (list.length === 0) return { applicable: true, message: "還沒有以這個計畫為上一階段的階段計畫（下一階段還沒建立或被隱藏），不會出現帶隊按鈕。", stages: [] };
  const names = new Map(arr(team.members).map((member) => [member.user_id, nameOf(member.name)]));
  const stages = list.map((next) => {
    const target = next.plan || {};
    const base = { planId: target.id, planName: nameOf(target.name, "下一階段"), carriedTeam: null, skipped: [], warning: "" };
    if (isCampaignStageEnded(target, todayKey)) return { ...base, shown: false, reason: "下一階段已經結束。" };
    if (next.carried) {
      return { ...base, shown: false, carriedTeam: { id: next.carried.id, name: next.carried.name }, reason: `已經帶進去了：「${nameOf(next.carried.name, "未命名隊伍")}」。` };
    }
    if (!captainOk) return { ...base, shown: false, reason: "隊長不在成員名單裡或角色不是隊長，下一階段不會出現帶隊按鈕。" };
    if (next.captain_team) {
      return { ...base, shown: false, reason: `隊長在「${base.planName}」已經有 ${team.division} 人組的隊「${nameOf(next.captain_team.name, "未命名隊伍")}」。` };
    }
    const skipped = arr(next.member_blocks).map((block) => ({
      id: block.user_id,
      name: names.get(block.user_id) || "（未填姓名）",
      reason: carryReasonText(block.reason) + (block.team_name ? `（「${block.team_name}」）` : "")
    }));
    return {
      ...base,
      shown: true,
      reason: `隊長打開「${base.planName}」的組隊視窗時會看到「帶「${nameOf(team.name, "這隊")}」加入」。`,
      warning: next.captain_block ? `但按下去整隊帶不過去：隊長${carryReasonText(next.captain_block)}。` : "",
      skipped
    };
  });
  return { applicable: true, message: "", stages };
}

function appView({ team, plan, report, people, nextStages, captainOk }) {
  const members = arr(team.members);
  const division = Number(team.division) || 0;
  const full = isTeamFull(members.length, division);
  const progress = getTeamOverallPlanProgress(members.map((member) => memberProgressInput(people.get(member.user_id))), planChapterTotal(report));
  return {
    progress: progress.averageProgress,
    inviteVisible: !full,
    invite: full
      ? `看不到邀請碼：顯示「名單已滿員並鎖定，團隊統計會固定以 ${division} 人計算」。`
      : `看得到邀請碼（${members.length}／${division} 人，還缺 ${division - members.length} 人）。`,
    inviteNote: !full && plan.stage && plan.ended ? "階段已結束，用邀請碼加入會失敗（名單已鎖定）。" : "",
    carry: carryoverState({ team, plan, nextStages, todayKey: report.ctx.todayKey, captainOk })
  };
}

function captainIsValid(team) {
  return arr(team.members).some((member) => member.user_id === team.captain_id && member.member_role === "captain");
}

// ── 清單 ────────────────────────────────────────────────────────────────
export function buildTeamList({ resolved, data }) {
  const { report, byId } = describeMembers(resolved, data);
  const plan = planFacts(report);
  const teams = arr(data && data.teams).map((team) => {
    const members = arr(team.members);
    const division = Number(team.division) || 0;
    const issues = issuesOf(teamChecks({ team, people: byId, plan }));
    return {
      id: team.id,
      name: team.name,
      division,
      status: team.status,
      statusLabel: statusLabel(team.status),
      memberCount: members.length,
      missing: Math.max(0, division - members.length),
      captainName: team.captain_name || "",
      carried: !!team.carried_from_team_id,
      issues: issues.length,
      issueLabels: issues.map((check) => check.label)
    };
  });
  return {
    plan,
    today: report.ctx.todayKey,
    teams,
    counts: {
      teams: teams.length,
      unfilled: teams.filter((team) => team.missing > 0).length,
      issues: teams.filter((team) => team.issues > 0).length,
      members: new Set(arr(data && data.teams).flatMap((team) => arr(team.members).map((member) => member.user_id))).size
    }
  };
}

// ── 隊伍頁 ──────────────────────────────────────────────────────────────
export function buildTeamDetail({ resolved, data }) {
  const { report, byId } = describeMembers(resolved, data);
  const plan = planFacts(report);
  const team = (data && data.team) || {};
  const members = arr(team.members);
  const checks = teamChecks({ team, people: byId, plan });
  const captainOk = captainIsValid(team);
  return {
    plan,
    today: report.ctx.todayKey,
    team: {
      id: team.id,
      name: team.name,
      division: Number(team.division) || 0,
      status: team.status,
      statusLabel: statusLabel(team.status),
      captain: { id: team.captain_id, name: team.captain_name || "" },
      inviteCode: team.invite_code || "",
      memberCount: members.length,
      carriedFromTeamId: team.carried_from_team_id || null,
      createdAt: team.created_at || null,
      lastEventAt: team.last_event_at || null
    },
    app: appView({ team, plan, report, people: byId, nextStages: data && data.next_stages, captainOk }),
    checks,
    issues: issuesOf(checks).length,
    members: members.map((member) => {
      const person = byId.get(member.user_id);
      return {
        id: member.user_id,
        name: member.name || "",
        role: member.member_role,
        roleLabel: MEMBER_ROLE_LABEL[member.member_role] || String(member.member_role || ""),
        joinedAt: member.joined_at || null,
        joinMethod: joinMethod(member.joined_via),
        active: member.is_active !== false,
        unit: [member.great_region, member.pastoral_zone, member.small_group].filter(Boolean).join("・"),
        enrolled: !!(person && person.enrolled),
        statusLabel: person ? person.statusLabel : member.is_active === false ? "帳號已停用" : "未報名",
        progress: person ? person.progress : 0,
        round: person ? person.round : 0,
        chapters: person ? person.chapters : 0,
        behindDays: person ? person.behindDays : 0
      };
    })
  };
}

// ── 異動歷程 ────────────────────────────────────────────────────────────
function engineering(event) {
  return {
    functions: arr(event.functions),
    txid: event.txid ?? null,
    dbUser: event.db_user || "",
    appName: event.app_name || "",
    callContext: event.call_context || ""
  };
}

function describeMemberEvent(event, teamDeleteTxids) {
  const who = nameOf(event.user_name);
  const fns = arr(event.functions).map(String);
  const role = event.member_role === "captain" ? "（隊長）" : "";
  if (event.event_type === "insert") {
    const method = joinMethod(fns);
    const actor = { code: "本人用邀請碼", create: "本人建立隊伍", carry: "隊長帶隊進下一階段", manual: "直接改資料庫", other: `函式 ${fns.join("、")}` }[method.key];
    return { text: `${who}${role} 加入（${method.label}）`, actor };
  }
  if (fns.includes("disband_reading_team") || fns.includes("leave_reading_team") || teamDeleteTxids.has(String(event.txid))) {
    return { text: `${who}${role} 跟著隊伍解散移出`, actor: "隊長解散隊伍（或刪除整隊）" };
  }
  if (fns.includes("remove_reading_team_member")) return { text: `${who}${role} 被移出`, actor: "隊長或管理員（紀錄看不出是哪一位）" };
  if (fns.length === 0) return { text: `${who}${role} 被移出`, actor: "直接改資料庫" };
  return { text: `${who}${role} 被移出`, actor: `函式 ${fns.join("、")}` };
}

function describeTeamEvent(event) {
  const fns = arr(event.functions).map(String);
  if (event.event_type === "insert") {
    return {
      text: event.carried_from_team_id ? "從上一階段帶隊建立這支隊" : `建立隊伍「${nameOf(event.name_new, "未命名隊伍")}」`,
      actor: event.carried_from_team_id ? "隊長帶隊進下一階段" : fns.length === 0 ? "直接改資料庫" : "隊長建立"
    };
  }
  if (event.event_type === "delete") {
    return { text: "隊伍被刪除", actor: fns.includes("disband_reading_team") || fns.includes("leave_reading_team") ? "隊長解散隊伍" : fns.length === 0 ? "直接改資料庫" : `函式 ${fns.join("、")}` };
  }
  const changes = [];
  if (event.name_old !== event.name_new) changes.push(`隊名從「${nameOf(event.name_old, "")}」改成「${nameOf(event.name_new, "")}」`);
  if (event.status_old !== event.status_new) changes.push(`狀態從「${statusLabel(event.status_old)}」改成「${statusLabel(event.status_new)}」`);
  if (event.division_old !== event.division_new) changes.push(`組別從 ${event.division_old} 人改成 ${event.division_new} 人`);
  if (event.plan_changed) changes.push("改到別的計畫");
  if (fns.includes("transfer_reading_team_captain")) changes.push(`隊長轉給 ${nameOf(event.captain_name)}`);
  const actor = fns.includes("rename_reading_team") ? "隊長或管理員改名"
    : fns.includes("transfer_reading_team_captain") ? "隊長或管理員轉移隊長"
      : fns.includes("join_reading_team_by_code") ? "有人用邀請碼加入時自動更新"
        : fns.includes("remove_reading_team_member") ? "移出隊員時自動更新"
          : fns.length === 0 ? "直接改資料庫" : `函式 ${fns.join("、")}`;
  return { text: changes.length > 0 ? changes.join("；") : "隊伍資料更新", actor };
}

export function buildTeamHistory(data) {
  const memberEvents = arr(data && data.member_events);
  const teamEvents = arr(data && data.team_events);
  const teamDeleteTxids = new Set(teamEvents.filter((event) => event.event_type === "delete").map((event) => String(event.txid)));
  const events = [
    ...memberEvents.map((event) => ({
      id: `m${event.id}`,
      at: event.at,
      kind: "member",
      eventType: event.event_type,
      member: { id: event.user_id, name: event.user_name || "" },
      ...describeMemberEvent(event, teamDeleteTxids),
      engineering: engineering(event)
    })),
    ...teamEvents.map((event) => ({
      id: `t${event.id}`,
      at: event.at,
      kind: "team",
      eventType: event.event_type,
      member: null,
      ...describeTeamEvent(event),
      engineering: engineering(event)
    }))
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.id.localeCompare(a.id));
  return { recordsSince: (data && data.records_since) || null, events };
}

// ── 跨階段對應 ──────────────────────────────────────────────────────────
// 依計畫開始日排；每一段和「它帶隊來源的那一段」比：多了誰、少了誰。
// 少的人如果在這一階段同組別的別隊 → 推斷「帶隊時被略過（他已在別隊）」；不在別隊 → 推斷「沒帶進來或之後被移出」。
export function buildTeamLineage(data) {
  const plans = new Map(arr(data && data.plans).map((plan) => [plan.id, plan]));
  const names = (data && data.names) || {};
  const elsewhere = arr(data && data.elsewhere);
  const teams = arr(data && data.teams);
  const byId = new Map(teams.map((team) => [team.id, team]));
  const order = [...teams].sort((a, b) => {
    const pa = plans.get(a.global_plan_id) || {};
    const pb = plans.get(b.global_plan_id) || {};
    return String(pa.start_date || "").localeCompare(String(pb.start_date || "")) || String(a.id).localeCompare(String(b.id));
  });
  const memberName = (id) => nameOf(names[id]);
  const stages = order.map((team) => {
    const plan = plans.get(team.global_plan_id) || {};
    const members = arr(team.members).map((member) => ({ id: member.user_id, name: memberName(member.user_id), role: member.member_role }));
    const parent = team.carried_from_team_id ? byId.get(team.carried_from_team_id) : null;
    let added = [];
    let removed = [];
    if (parent) {
      const now = new Set(members.map((member) => member.id));
      const before = new Set(arr(parent.members).map((member) => member.user_id));
      added = members.filter((member) => !before.has(member.id)).map((member) => ({ id: member.id, name: member.name }));
      removed = arr(parent.members).filter((member) => !now.has(member.user_id)).map((member) => {
        const other = elsewhere.find((item) => item.user_id === member.user_id && item.global_plan_id === team.global_plan_id
          && Number(item.division) === Number(team.division));
        return {
          id: member.user_id,
          name: memberName(member.user_id),
          elsewhere: other ? { id: other.team_id, name: other.team_name || "" } : null,
          inferred: other
            ? `推斷：帶隊時被略過——他在這一階段已經在「${nameOf(other.team_name, "別隊")}」`
            : "推斷：帶隊時沒帶進來（例如沒設牧區），或之後被移出"
        };
      });
    }
    return {
      plan: { id: plan.id || team.global_plan_id, name: plan.name || "", startDate: plan.start_date || null, endDate: plan.end_date || null, planKind: plan.plan_kind || "" },
      team: { id: team.id, name: team.name, division: Number(team.division) || 0, captainName: team.captain_name || "", status: team.status, statusLabel: statusLabel(team.status) },
      current: team.id === (data && data.team_id),
      carriedFromTeamId: team.carried_from_team_id || null,
      hasParent: !!parent,
      members,
      added,
      removed
    };
  });
  return { teamId: (data && data.team_id) || null, stages };
}
