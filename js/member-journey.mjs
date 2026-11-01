// 登入只看兩件事（#650）：會員中心有沒有這個帳號、會籍是不是停用。
// 姓名、初次資料、會籍申請、小組安置都不擋登入——那些是會變動的會員資料，
// App 拿到的又是副本，拿來擋登入會造成「一直要填姓名」的循環。

// nlc-session 在會員中心 /api/me/context 回 404 CONTEXT_NOT_FOUND 時寫進
// member_context_sync_error 的固定代碼。
export const MEMBER_HUB_NOT_FOUND_ERROR = 'member_hub_context_not_found';

export function isCanonicalMemberJourneyProjection(user) {
  return Number(user?.member_context_contract_version) >= 2;
}

function recoveryFields(user) {
  return {
    requiredAction: String(user?.member_context_required_action || ''),
    requiredActionUrl: String(user?.member_context_required_action_url || '') || null,
  };
}

export function getUserOnboardingBlock(user) {
  if (!user) return null;
  const recovery = recoveryFields(user);
  // 連不上會員中心時，nlc-session 保留上次確認成功的欄位：不管多久以前，照用。
  const confirmed = isCanonicalMemberJourneyProjection(user);
  if (confirmed && String(user?.member_context_membership_lifecycle_state || '') === 'inactive') {
    return { reason: 'inactive_membership', ...recovery };
  }
  if (String(user?.member_context_sync_error || '') === MEMBER_HUB_NOT_FOUND_ERROR) {
    return { reason: 'member_not_registered', ...recovery };
  }
  if (!confirmed) {
    return { reason: 'member_context_unavailable', ...recovery };
  }
  return null;
}

export const getCanonicalMemberPrerequisiteBlock = getUserOnboardingBlock;
