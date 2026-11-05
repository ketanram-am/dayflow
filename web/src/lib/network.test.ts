import { describe, expect, it, beforeEach } from "vitest";
import { ApiError } from "./api";
import { isNetworkError, isOnline, setSimOffline } from "./attendance";

describe("offline detection", () => {
  beforeEach(() => setSimOffline(false));

  it("treats a status-0 ApiError as a network failure", () => {
    expect(isNetworkError(new ApiError("Could not reach the Dayflow server.", 0))).toBe(true);
  });

  it("does not treat a server rejection as a network failure", () => {
    expect(isNetworkError(new ApiError("Outside the geofence", 403))).toBe(false);
  });

  it("simulated offline makes everything queue", () => {
    setSimOffline(true);
    expect(isOnline()).toBe(false);
    expect(isNetworkError(new Error("anything"))).toBe(true);
  });
});
