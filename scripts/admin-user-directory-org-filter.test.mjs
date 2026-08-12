import { describe, expect, it } from "vitest";
import {
  ADMIN_ORG_UNASSIGNED,
  buildAdminUserDirectoryOrgOptions,
  matchesAdminUserDirectoryOrgFilters
} from "../js/modules/admin-user-directory-filter.mjs";

const profiles = [
  { name: "甲", great_region: "北大區", pastoral_zone: "第一牧區", small_group: "和平小組" },
  { name: "乙", great_region: "北大區", pastoral_zone: "第二牧區", small_group: "喜樂小組" },
  { name: "丙", great_region: "南大區", pastoral_zone: "第三牧區", small_group: "恩典小組" },
  { name: "丁", great_region: "", pastoral_zone: "", small_group: "" }
];

describe("admin user directory organization filters", () => {
  it("limits child options to the selected organization branch", () => {
    expect(buildAdminUserDirectoryOrgOptions(profiles, { regions: ["北大區"] })).toEqual({
      regions: ["北大區", "南大區", ADMIN_ORG_UNASSIGNED],
      zones: ["第一牧區", "第二牧區"],
      groups: ["和平小組", "喜樂小組"]
    });
    expect(buildAdminUserDirectoryOrgOptions(profiles, {
      regions: ["北大區"],
      zones: ["第二牧區"]
    }).groups).toEqual(["喜樂小組"]);
  });

  it("unions child options when more than one parent organization is selected", () => {
    const options = buildAdminUserDirectoryOrgOptions(profiles, {
      regions: ["北大區", "南大區"],
      zones: ["第一牧區", "第三牧區"]
    });

    expect(options.zones).toEqual(["第一牧區", "第二牧區", "第三牧區"]);
    expect(options.groups).toEqual(["和平小組", "恩典小組"]);
  });

  it("matches exact region, zone and group values, including unassigned profiles", () => {
    expect(matchesAdminUserDirectoryOrgFilters(profiles[0], {
      regions: ["北大區", "南大區"],
      zones: ["第一牧區", "第三牧區"],
      groups: ["和平小組", "恩典小組"]
    })).toBe(true);
    expect(matchesAdminUserDirectoryOrgFilters(profiles[1], { zones: ["第一牧區", "第三牧區"] })).toBe(false);
    expect(matchesAdminUserDirectoryOrgFilters(profiles[3], {
      regions: [ADMIN_ORG_UNASSIGNED],
      zones: [ADMIN_ORG_UNASSIGNED],
      groups: [ADMIN_ORG_UNASSIGNED]
    })).toBe(true);
  });
});
