import { describe, expect, it } from "vitest";
import { wellnessScore } from "@/lib/wellness";

describe("wellnessScore", () => {
  it("is null without worked days", () => expect(wellnessScore({ workedDays: 0, daysWithBreak: 0, overtimeHours: 0, avgBreakMin: 0 })).toBeNull());
  it("is 100 for daily 30-min breaks and no overtime", () => expect(wellnessScore({ workedDays: 5, daysWithBreak: 5, overtimeHours: 0, avgBreakMin: 30 })).toBe(100));
  it("drops overtime part to 0 at 10h overtime", () => expect(wellnessScore({ workedDays: 5, daysWithBreak: 5, overtimeHours: 10, avgBreakMin: 30 })).toBe(70));
  it("halves consistency when breaks taken half the days", () => expect(wellnessScore({ workedDays: 4, daysWithBreak: 2, overtimeHours: 0, avgBreakMin: 30 })).toBe(80));
});
