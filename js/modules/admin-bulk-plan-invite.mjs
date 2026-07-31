export function wasPlanInviteRemindedToday(member) {
  return member && (member.remindedToday === true || member.reminded_today === true);
}

export async function sendBulkPlanInvitations({
  members,
  plan,
  sendInvitation,
  onProgress = () => {}
}) {
  const eligibleMembers = (Array.isArray(members) ? members : [])
    .filter(member => !wasPlanInviteRemindedToday(member));
  const summary = {
    total: eligibleMembers.length,
    sentCount: 0,
    duplicateCount: 0,
    failedMembers: []
  };

  for (let index = 0; index < eligibleMembers.length; index += 1) {
    const member = eligibleMembers[index];
    onProgress({ completed: index, total: eligibleMembers.length, member });
    let result = null;
    try {
      result = await sendInvitation(plan, member.id);
    } catch {
      result = null;
    }
    if (result && result.success) {
      member.remindedToday = true;
      if (result.context?.duplicate === true || result.context?.sent === false) {
        summary.duplicateCount += 1;
      } else {
        summary.sentCount += 1;
      }
    } else {
      summary.failedMembers.push(member);
    }
  }

  onProgress({ completed: eligibleMembers.length, total: eligibleMembers.length, member: null });
  return summary;
}
