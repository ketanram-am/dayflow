import { describe, expect, it } from "vitest";
import { requestDays, workingDays } from "@/lib/leave";

describe("leave days", () => {
  it("skips weekends", () => expect(workingDays("2026-11-06", "2026-11-09")).toBe(2)); // Fri..Mon
  it("skips holidays", () => expect(workingDays("2026-11-10", "2026-11-12", ["2026-11-11"])).toBe(2));
  it("half day counts 0.5", () => expect(requestDays({ start_date: "2026-11-10", end_date: "2026-11-10", duration: "half" })).toBe(0.5));
  it("hourly counts hours/8", () => expect(requestDays({ start_date: "2026-11-10", end_date: "2026-11-10", duration: "hourly", hours: 4 })).toBe(0.5));
});
