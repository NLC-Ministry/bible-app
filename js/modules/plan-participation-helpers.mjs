// Pure participation/team-state model for joined plan cards.
//
// Extracted from plan.js so the variant logic is unit-testable in isolation:
// plan.js references runtime globals (state, db, ...) at module load and cannot
// be imported directly in tests, whereas this helper is pure and side-effect free.

function summarizeTeam(context) {
  const team = context.team || {};
  const division = Number(team.division || 3);
  const memberCount = Number(team.memberCount || team.current_count || context.memberCount || 0);
  const capacity = Number(team.capacity || team.division || division);
  return { division, memberCount, capacity, isFull: capacity > 0 && memberCount >= capacity };
}

// 「還缺 N 人」CTA 用的卡片內容：卷入用戶去邀請組員，而不是單純陳述現況。
function invitePendingModel(info) {
  return {
    variant: "team-open",
    title: "邀請組員加入",
    description: `${info.division}人組・還缺 ${info.capacity - info.memberCount} 人`,
    tone: "brand",
    icon: "share",
    action: { label: "邀請組員", division: info.division, action: "open-team-dialog" }
  };
}

// 個人讀經中、但能帶上一個計畫的隊伍進來（#652）：一支就直接帶，兩支以上開團隊視窗選。
function carryoverModel(teams) {
  const [first] = teams;
  if (teams.length === 1) {
    return {
      variant: "carryover",
      title: `帶「${first.name || "我的團隊"}」加入`,
      description: "上一個計畫的隊伍可直接帶入",
      tone: "brand",
      icon: "people",
      action: { label: "帶隊加入", division: Number(first.division), action: "carry-team" }
    };
  }
  return {
    variant: "carryover",
    title: `帶上一個計畫的 ${teams.length} 支隊伍加入`,
    description: "上一個計畫的隊伍可直接帶入",
    tone: "brand",
    icon: "people",
    action: { label: "帶隊加入", division: Number(first.division), action: "open-team-dialog" }
  };
}

// carryoverTeams：getReadingTeamCarryoverTeams 的結果（[{ sourceTeamId, name, division, memberCount }]）。
export function getPlanParticipationModel(plan, contexts = [], { carryoverTeams = [] } = {}) {
  const normalizedContexts = Array.isArray(contexts) ? contexts.filter(Boolean) : [];
  const divisions = [3, 6];
  const joinedContexts = normalizedContexts.filter(context => context && context.team);
  // Consider EVERY joined division, not just the first context, so a member who
  // is in both team sizes is not offered a division they already joined.
  const joinedDivisions = new Set(
    joinedContexts
      .map(context => Number(context.team.division))
      .filter(division => !Number.isNaN(division))
  );
  const availableDivision = divisions.find(division => !joinedDivisions.has(division));

  if (joinedContexts.length === 0) {
    const teams = (Array.isArray(carryoverTeams) ? carryoverTeams : [])
      .filter(team => team && [3, 6].includes(Number(team.division)));
    if (teams.length) return carryoverModel(teams);
    return {
      variant: "solo",
      title: "個人讀經中",
      description: "尚未加入團隊",
      tone: "neutral",
      icon: "user",
      action: {
        label: "建立 / 加入團隊",
        division: 3,
        action: "join-team-division"
      }
    };
  }

  const infos = joinedContexts.map(summarizeTeam);
  const notFull = infos.find(info => !info.isFull);

  if (availableDivision) {
    // 只加入了其中一種人數。那隊還沒滿，先邀請補人；已經滿了的話，這隊沒有
    // 「已滿」可講的意義（使用者可能還想試另一種人數），改成引導去組另一隊，
    // 不要用「N人組已滿」這種話——那只描述了其中一隊，容易讓人以為講的是全部。
    const primary = infos[0];
    if (!primary.isFull) return invitePendingModel(primary);
    return {
      variant: "team-full-other-available",
      title: `還可以組一隊 ${availableDivision} 人隊`,
      description: `${primary.division}人隊已滿員`,
      tone: "brand",
      icon: "people",
      action: { label: `組 ${availableDivision} 人隊`, division: availableDivision, action: "open-team-dialog" }
    };
  }

  // 兩種人數都加入了。只要還有一隊沒滿就繼續邀請；兩隊都滿才算真的沒事可做，
  // 顯示不分人數的「隊伍已滿」，不再是可點的按鈕。
  if (notFull) return invitePendingModel(notFull);

  return {
    variant: "team-full",
    title: "隊伍已滿",
    description: "",
    tone: "success",
    icon: "checkCircle",
    action: null
  };
}

export function shouldHidePlanTeamInviteShortcut(teamContextsByPlan = [], requiredDivisions = [3, 6]) {
  const plans = Array.isArray(teamContextsByPlan) ? teamContextsByPlan : [];
  const divisions = Array.from(new Set(
    (Array.isArray(requiredDivisions) ? requiredDivisions : [])
      .map(Number)
      .filter(Number.isFinite)
  ));

  if (plans.length === 0 || divisions.length === 0) return false;

  return plans.every(contexts => {
    const joinedDivisions = new Set(
      (Array.isArray(contexts) ? contexts : [])
        .filter(context => context && context.team)
        .map(context => Number(context.team.division))
        .filter(Number.isFinite)
    );
    return divisions.every(division => joinedDivisions.has(division));
  });
}
