import { describe, expect, it } from "vitest";
import { resolveAdminRegistrationSummary } from "../js/modules/admin-registration-summary.mjs";

describe("registration summary compatibility", () => {
  it("derives all six values from the older pastoral-zone response", () => {
    expect(resolveAdminRegistrationSummary({
      pastoralZones: [
        { label: "未設定牧區", signupCount: 203, registeredCount: 344 },
        { label: "A牧區", signupCount: 228, registeredCount: 292 }
      ]
    })).toEqual({
      withoutPastoralZoneNotJoined: 141,
      withoutPastoralZoneJoined: 203,
      withPastoralZoneNotJoined: 64,
      withPastoralZoneJoined: 228,
      totalJoined: 431,
      totalRegistered: 636
    });
  });

  it("ignores an incomplete server summary and uses the compatible fallback", () => {
    const result = resolveAdminRegistrationSummary({
      summary: {},
      pastoralZones: [{ label: "未設定", signupCount: 2, registeredCount: 5 }]
    });
    expect(result.totalJoined).toBe(2);
    expect(result.totalRegistered).toBe(5);
    expect(result.withoutPastoralZoneNotJoined).toBe(3);
  });
});