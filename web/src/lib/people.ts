export type AttStatus = "Present" | "Absent" | "Late" | "Checked Out" | "On Leave";

/** Default start of the working day (local time) when no shift is assigned. */
export const DEFAULT_START = "09:30";

export function attendanceStatus(o: {
  today: { check_in_time: string; check_out_time: string | null } | null;
  onLeave: boolean;
  shiftStart: string | null;
}): AttStatus {
  if (o.today) {
    if (o.today.check_out_time) return "Checked Out";
    const t = new Date(o.today.check_in_time);
    const [h = 9, m = 30] = (o.shiftStart ?? DEFAULT_START).split(":").map(Number);
    return t.getHours() * 60 + t.getMinutes() > h * 60 + m ? "Late" : "Present";
  }
  return o.onLeave ? "On Leave" : "Absent";
}
