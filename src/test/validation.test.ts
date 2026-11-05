import { describe, expect, it } from "vitest";
import { isValidEmail, isValidEmployeeId, passwordIssues, distanceMeters } from "@/lib/validation";

describe("registration rules", () => {
  it("rejects malformed emails", () => {
    expect(isValidEmail("jane@company.com")).toBe(true);
    expect(isValidEmail("jane@company")).toBe(false);
    expect(isValidEmail("jane company.com")).toBe(false);
  });
  it("requires 8+ chars with upper, lower, number and symbol", () => {
    expect(passwordIssues("Str0ng!pw")).toEqual([]);
    expect(passwordIssues("weakpass")).toHaveLength(3);
    expect(passwordIssues("Ab1!")).toContain("At least 8 characters");
  });
  it("accepts employee IDs of 3-20 letters, numbers or dashes", () => {
    expect(isValidEmployeeId("EMP-001")).toBe(true);
    expect(isValidEmployeeId("E1")).toBe(false);
    expect(isValidEmployeeId("EMP 001")).toBe(false);
  });
  it("computes geofence distance", () => {
    const d = distanceMeters({ lat: 12.9716, lng: 77.5946 }, { lat: 12.9725, lng: 77.5946 });
    expect(Math.round(d)).toBe(100);
  });
});
