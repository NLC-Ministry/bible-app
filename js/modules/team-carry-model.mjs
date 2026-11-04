// 月初帶隊卡片的文字與判斷（#678）。純函式，不碰 DOM、不碰全域，可以直接測。
// 資料來自 get_reading_team_carry_status，每一筆的 state：
//   carry     隊長，可以帶隊
//   waiting   隊員，隊長還沒帶隊
//   carried   隊伍已被帶入，自己不在隊上
//   backfill  隊長自己的隊還有空位，可以把上月隊員補進來

const SKIP_REASON_TEXT = {
  already_in_target_team: "已加入別隊",
  plan_requires_pastoral_zone: "還沒設定牧區",
  plan_audience_restricted: "大區不在開放範圍",
  team_full: "隊伍已額滿"
};

// 計畫已開始：來源是上個月、目標是這個月。還沒開始（提早開放）：來源是這個月、目標是下個月。
export function carryMonthWords(entry) {
  return entry && entry.targetStarted === false
    ? { source: "這個月", target: "下個月" }
    : { source: "上個月", target: "這個月" };
}

export function carryTeamTitle(entry) {
  return `帶「${(entry && entry.name) || "我的團隊"}」進入${carryMonthWords(entry).target}的計畫`;
}

// 2026-12-04 → 12/4
export function formatCarryDate(value) {
  const match = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : "";
}

export function describeTeamCarryEntry(entry) {
  const name = entry.name || "我的團隊";
  const planName = entry.targetPlanName || "這個計畫";
  const division = Number(entry.division);
  const months = carryMonthWords(entry);

  if (entry.state === "carry") {
    return {
      icon: "people",
      title: carryTeamTitle(entry),
      description: `${planName}・${division} 人組・${Number(entry.memberCount || 0)} 位隊員`,
      hint: "",
      actions: [{ kind: "carry", label: "帶隊加入", primary: true }]
    };
  }

  if (entry.state === "waiting") {
    const opensOn = formatCarryDate(entry.takeoverOpensOn);
    const actions = [];
    if (entry.canTakeover) actions.push({ kind: "takeover", label: "由我帶隊加入", primary: true });
    actions.push(entry.reminderSentToday
      ? { kind: "remind", label: "今天已提醒", primary: false, disabled: true }
      : { kind: "remind", label: "提醒隊長", primary: !entry.canTakeover });
    return {
      icon: "people",
      title: `你${months.source}在「${name}」，隊長還沒帶隊。`,
      description: entry.canTakeover
        ? `隊員可以接手帶隊，接手的人會成為新隊長。`
        : (opensOn ? `${opensOn} 起如果隊長還沒帶隊，隊員可以接手。` : ""),
      hint: "如果想等隊長帶隊，先不要加入別隊（先加入別隊的人，帶隊時會被略過）。",
      actions
    };
  }

  if (entry.state === "carried") {
    return {
      icon: "checkCircle",
      title: `「${entry.carriedTeamName || name}」已由${entry.carriedByName || "隊友"}帶入`,
      description: entry.hasVacancy ? `${planName}・還有空位，可以直接加入。` : `${planName}・隊伍已額滿。`,
      hint: "",
      actions: entry.hasVacancy ? [{ kind: "join", label: "加入隊伍", primary: true }] : []
    };
  }

  if (entry.state === "backfill") {
    return {
      icon: "people",
      title: `把「${name}」的隊員補進「${entry.ownTeamName || "我的團隊"}」`,
      description: `${planName}・還有 ${Number(entry.ownTeamVacancy || 0)} 個空位`,
      hint: "",
      actions: [{ kind: "backfill", label: "補帶隊員", primary: true }]
    };
  }

  return null;
}

// 確認畫面要列出會帶入哪些人（issue 第 4、5 點）。
export function describeCarryRoster(roster = []) {
  const rows = Array.isArray(roster) ? roster.filter(Boolean) : [];
  const lines = [];
  const joining = rows.filter(row => !row.reason).map(row => row.name).filter(Boolean);
  const skipped = rows.filter(row => row.reason && row.name)
    .map(row => `${row.name}（${SKIP_REASON_TEXT[row.reason] || "不符合加入條件"}）`);
  lines.push(joining.length ? `會一起帶入：${joining.join("、")}` : "目前沒有其他隊員可以一起帶入。");
  if (skipped.length) lines.push(`不會帶入：${skipped.join("、")}`);
  return lines;
}

export function buildCarryConfirmMessage(entry, kind) {
  const name = entry.name || "我的團隊";
  const planName = entry.targetPlanName || "這個計畫";
  const roster = describeCarryRoster(entry.roster);
  if (kind === "takeover") {
    return [
      `你會成為「${name}」在「${planName}」的新隊長。`,
      ...roster,
      `原隊長${entry.captainName ? `${entry.captainName} ` : ""}不會自動加入新隊伍。`
    ].join("\n");
  }
  if (kind === "backfill") {
    return [
      `把「${name}」的隊員補進「${entry.ownTeamName || "我的團隊"}」，補到額滿為止。`,
      ...roster,
      "補帶後，這支隊伍就算是上個月隊伍的延續。"
    ].join("\n");
  }
  return [`確認後，隊員會直接加入「${planName}」和同一支隊伍。`, ...roster].join("\n");
}

// 提醒隊長的內容，由隊員按下按鈕時送出（沿用隊友提醒，一天一次）。
export function buildCaptainReminderMessage(entry) {
  const name = entry.name || "我們的隊伍";
  const planName = entry.targetPlanName || "新的計畫";
  return `「${name}」的隊員提醒你：「${planName}」的隊伍還沒帶進來，打開首頁就能帶隊。`;
}

// 同一個人只有 3 人、6 人兩種隊。兩種都有隊而且都滿了，就沒有帶隊的事可做，不用查狀態。
export function needsTeamCarryStatus(contexts = []) {
  const joined = (Array.isArray(contexts) ? contexts : []).filter(context => context && context.team);
  if (joined.length < 2) return true;
  return joined.some(context => {
    const team = context.team;
    const capacity = Number(team.capacity || team.division || 0);
    const count = Number(team.memberCount || team.current_count || context.memberCount || 0);
    return capacity > 0 && count < capacity;
  });
}

export function carryEntriesForPlan(entries = [], planId) {
  if (!planId) return [];
  return (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && String(entry.targetPlanId) === String(planId));
}

export function teamCarryEntryKey(entry) {
  return `${entry.targetPlanId}:${entry.sourceTeamId}:${entry.state}`;
}
