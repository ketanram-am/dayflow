/** Transparent wellness score (0-100); null when no worked days exist. */
export function wellnessScore(i: { workedDays: number; daysWithBreak: number; overtimeHours: number; avgBreakMin: number }): number | null {
  if (i.workedDays <= 0) return null;
  const consistency = Math.min(1, i.daysWithBreak / i.workedDays);
  const breakLen = Math.min(1, Math.max(0, i.avgBreakMin) / 30);
  const overtime = 1 - Math.min(1, Math.max(0, i.overtimeHours) / 10);
  return Math.round(40 * consistency + 30 * breakLen + 30 * overtime);
}
