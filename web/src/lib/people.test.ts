import { describe, expect, it } from "vitest";
import { attendanceStatus } from "./people";

const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };

describe("attendanceStatus", () => {
  it("no check-in and no leave is Absent", () => expect(attendanceStatus({ today: null, onLeave: false, shiftStart: null })).toBe("Absent"));
  it("approved leave is On Leave", () => expect(attendanceStatus({ today: null, onLeave: true, shiftStart: null })).toBe("On Leave"));
  it("checked out wins", () => expect(attendanceStatus({ today: { check_in_time: at(11, 0), check_out_time: at(18, 0) }, onLeave: false, shiftStart: null })).toBe("Checked Out"));
  it("after shift start is Late", () => expect(attendanceStatus({ today: { check_in_time: at(9, 10), check_out_time: null }, onLeave: false, shiftStart: "09:00:00" })).toBe("Late"));
  it("on time is Present", () => expect(attendanceStatus({ today: { check_in_time: at(9, 0), check_out_time: null }, onLeave: false, shiftStart: "09:00:00" })).toBe("Present"));
});
