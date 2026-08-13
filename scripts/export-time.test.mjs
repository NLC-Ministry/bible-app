// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  formatTaiwanDate,
  formatTaiwanDateTime,
  formatTaiwanExportDateTime,
  prependTaiwanExportTime
} from "../js/modules/export-time.mjs";
import {
  convertAdminRegistrationStatisticsToCSV,
  convertTeamRegistrationStatusToCSV
} from "../js/modules/admin.js";

const exportedAt = new Date("2026-08-11T16:05:06Z");
const expectedFirstRow = '"匯出時間（台灣時間）","2026-08-12 00:05:06（台灣時間 UTC+8）"';

describe("Taiwan time in exported files", () => {
  it("formats timestamps and filename dates in Asia/Taipei across the UTC date boundary", () => {
    expect(formatTaiwanDateTime(exportedAt)).toBe("2026-08-12 00:05:06");
    expect(formatTaiwanExportDateTime(exportedAt)).toBe("2026-08-12 00:05:06（台灣時間 UTC+8）");
    expect(formatTaiwanDate(exportedAt)).toBe("2026-08-12");
    expect(formatTaiwanDate("2026-08-12")).toBe("2026-08-12");
  });

  it("prepends export time as the first CSV row", () => {
    expect(prependTaiwanExportTime("欄位\n資料", exportedAt).split("\n")[0]).toBe(expectedFirstRow);
  });

  it("adds the same first row to registration-statistics and team exports", () => {
    const registrationCsv = convertAdminRegistrationStatisticsToCSV({
      greatRegions: [],
      pastoralZones: [],
      summary: {}
    }, exportedAt);
    const teamCsv = convertTeamRegistrationStatusToCSV([{
      plan: { name: "測試計畫", startDate: "2026-08-12", endDate: "2026-08-13" },
      teams: [{
        name: "測試隊",
        status: "forming",
        memberCount: 1,
        members: [{ name: "隊長", role: "captain", pastoralZone: "第一牧區" }]
      }]
    }], 3, exportedAt);

    expect(registrationCsv.split("\n")[0]).toBe(expectedFirstRow);
    expect(teamCsv.split("\n")[0]).toBe(expectedFirstRow);
  });
});
