const SUMMARY_KEYS = [
  "withoutPastoralZoneNotJoined",
  "withoutPastoralZoneJoined",
  "withPastoralZoneNotJoined",
  "withPastoralZoneJoined",
  "totalJoined",
  "totalRegistered"
];

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function hasCompleteSummary(summary) {
  return summary && SUMMARY_KEYS.every(key => Number.isFinite(Number(summary[key])));
}

function isUnsetPastoralZone(row) {
  const label = String(row && row.label || "").trim();
  return !label || label === "未設定牧區" || label === "未設定";
}

export function resolveAdminRegistrationSummary(context) {
  if (hasCompleteSummary(context && context.summary)) {
    return Object.fromEntries(SUMMARY_KEYS.map(key => [key, count(context.summary[key])]));
  }

  const pastoralZones = Array.isArray(context && context.pastoralZones) ? context.pastoralZones : [];
  const withoutPastoralZone = pastoralZones.find(isUnsetPastoralZone) || {};
  const totalJoined = pastoralZones.reduce((total, row) => total + count(row.signupCount), 0);
  const totalRegistered = pastoralZones.reduce((total, row) => total + count(row.registeredCount), 0);
  const withoutPastoralZoneJoined = count(withoutPastoralZone.signupCount);
  const withoutPastoralZoneRegistered = count(withoutPastoralZone.registeredCount);
  const withoutPastoralZoneNotJoined = Math.max(0, withoutPastoralZoneRegistered - withoutPastoralZoneJoined);
  const withPastoralZoneJoined = Math.max(0, totalJoined - withoutPastoralZoneJoined);
  const withPastoralZoneNotJoined = Math.max(
    0,
    totalRegistered - totalJoined - withoutPastoralZoneNotJoined
  );

  return {
    withoutPastoralZoneNotJoined,
    withoutPastoralZoneJoined,
    withPastoralZoneNotJoined,
    withPastoralZoneJoined,
    totalJoined,
    totalRegistered
  };
}