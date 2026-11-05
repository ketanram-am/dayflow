/** Leave-day maths shared by LeaveSync and its tests. Dates are YYYY-MM-DD (UTC). */
export function workingDays(start: string, end: string, holidays: string[] = []): number {
  if (!start || !end || end < start) return 0;
  const hol = new Set(holidays);
  let n = 0;
  for (let d = new Date(start + "T00:00:00Z"); d <= new Date(end + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !hol.has(iso)) n++;
  }
  return n;
}

/** Days a request consumes: half day = 0.5, hourly = hours / 8, full = working days. */
export function requestDays(r: { start_date: string; end_date: string; duration?: string | null; hours?: number | null }, holidays: string[] = []): number {
  if (r.duration === "half") return 0.5;
  if (r.duration === "hourly") return Math.round(((Number(r.hours) || 0) / 8) * 100) / 100;
  return workingDays(r.start_date, r.end_date, holidays);
}
