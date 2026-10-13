// 管理用的「計畫篩選」清單：App 管理分頁（js/modules/pastoral.js，#551）和後台照搬的舊管理分頁
// （js/modules/admin.js）共用同一份規則——哪些計畫列得出來、狀態、排序。
// 依賴（generatePlanObject、isPlanHidden、canManageHiddenPlans）由呼叫端傳入，這支是純函式。

export function getManagementPlanStatus(plan, today = new Date()) {
  const startValue = plan && (plan.startDate || plan.start_date);
  const endValue = plan && (plan.endDate || plan.end_date);
  const startDate = startValue ? new Date(`${String(startValue).slice(0, 10)}T00:00:00`) : null;
  const endDate = endValue ? new Date(`${String(endValue).slice(0, 10)}T23:59:59`) : null;
  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 'unknown';
  if (today < startDate) return 'upcoming';
  if (today > endDate) return 'completed';
  return 'ongoing';
}

export function managementPlanKey(plan) {
  return String((plan && (plan.globalPlanId || plan.id || plan.presetKey || plan.name)) || '');
}

export function listManagementPlans({
  activePlans = [],
  globalPlans = [],
  generatePlanObject = null,
  isPlanHidden = null,
  canManageHiddenPlans = null,
  today = new Date()
} = {}) {
  const seen = new Set();
  const plans = [...(activePlans || []), ...(globalPlans || [])].reduce((result, sourcePlan) => {
    const key = String(sourcePlan.globalPlanId || sourcePlan.id || sourcePlan.presetKey || sourcePlan.name || '');
    if (!key || seen.has(key) || sourcePlan.planKind === 'church_campaign') return result;
    seen.add(key);

    let plan = sourcePlan;
    if ((!Array.isArray(plan.days) || plan.days.length === 0) && typeof generatePlanObject === 'function') {
      const books = plan.books || plan.target_books || [];
      if (books.length > 0) {
        plan = generatePlanObject(plan.name, plan.startDate || plan.start_date, plan.endDate || plan.end_date, books, plan.presetKey || plan.id, plan.isFixed !== false && plan.is_fixed !== false);
        plan.globalPlanId = sourcePlan.globalPlanId || sourcePlan.id;
        plan.id = sourcePlan.id || plan.id;
        plan.name = sourcePlan.name || plan.name;
        plan.planKind = sourcePlan.planKind;
        plan.stageNo = sourcePlan.stageNo;
      }
    }
    const status = getManagementPlanStatus(plan, today);
    const hidden = typeof isPlanHidden === 'function' && isPlanHidden(plan);
    const canSeeHidden = typeof canManageHiddenPlans === 'function' && canManageHiddenPlans();
    // A future fixed plan can accept enrollments before its official start date.
    // Once it is released (not hidden), leaders must be able to inspect its join
    // status too. Keep unreleased future stages out of this people-facing report.
    const isOpenEarlyEnrollment = status === 'upcoming' && !hidden;
    if ((status === 'ongoing' || status === 'completed' || isOpenEarlyEnrollment)
      && !(hidden && !canSeeHidden)) {
      result.push({ ...plan, managementStatus: status });
    }
    return result;
  }, []);

  const statusPriority = { ongoing: 0, upcoming: 1, completed: 2 };
  return plans.sort((left, right) => {
    const statusDifference = (statusPriority[left.managementStatus] ?? 3) - (statusPriority[right.managementStatus] ?? 3);
    if (statusDifference !== 0) return statusDifference;
    const leftEnd = String(left.endDate || left.end_date || '');
    const rightEnd = String(right.endDate || right.end_date || '');
    return rightEnd.localeCompare(leftEnd);
  });
}
