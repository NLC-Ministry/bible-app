// #665：Logto 的兩種登入方式通常對應會員中心的兩位會員。帳號合併後，用另一種方式登入時，
// 這次的會員不是帳號原本的會員。這位會員沒有牧區、帳號原本有的話，不能拿他的資料覆寫帳號，
// 否則會友會被清空牧區、降級角色，看得到舊計畫卻加入不了新計畫。

function hasValue(value) {
  return String(value ?? "").trim() !== "";
}

/**
 * 只看這次會員自己的牧區（mergedOrg），不看 projectOrgFieldsFromHub 的結果：
 * 平台 API 失敗時那個結果會沿用帳號的舊值，看起來像「這次有牧區」，
 * 帳號就會被換成這次的會員。
 *
 * 會員 ID 相同時永遠不保留：會員中心清空這位會員的牧區，App 就跟著清空。
 * 兩位會員都有牧區時也不保留，要等會員中心合併會員才算根本解決。
 */
export function shouldKeepAccountMember({ linkSource, existingProfile, sessionMemberId, sessionPastoralZone }) {
  if (linkSource !== "identity") return false;
  const accountMemberId = existingProfile?.nlc_member_id;
  if (!accountMemberId || !sessionMemberId || accountMemberId === sessionMemberId) return false;
  if (hasValue(sessionPastoralZone)) return false;
  return hasValue(existingProfile?.pastoral_zone);
}

export function keptOrgFields(existingProfile) {
  return {
    great_region: existingProfile?.great_region || "",
    pastoral_zone: existingProfile?.pastoral_zone || "",
    small_group: existingProfile?.small_group || ""
  };
}

/**
 * 把 upsert 的內容改回帳號原本的會員資料：member_context_* 從 payload 拿掉就不會被覆寫。
 * member_context_sync_* 記的是這次同步的嘗試，照常更新。
 *
 * #685：姓名、Email、電話也用帳號原本的，否則牧區是原本會員的、聯絡資料卻是這次會員的。
 * 帳號原本是空值就維持空值，不拿這次會員的資料補。
 */
export function keepAccountMemberOnPayload(profilePayload, existingProfile) {
  profilePayload.name = existingProfile.name ?? "";
  profilePayload.email = existingProfile.email ?? null;
  profilePayload.phone = existingProfile.phone ?? null;
  for (const column of Object.keys(profilePayload)) {
    if (column.startsWith("member_context_") && !column.startsWith("member_context_sync_")) {
      delete profilePayload[column];
    }
  }
  profilePayload.member_context_synced_at = existingProfile.member_context_synced_at ?? null;
  profilePayload.nlc_member_id = existingProfile.nlc_member_id;
}
