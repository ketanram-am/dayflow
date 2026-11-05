export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const EMPLOYEE_ID_RE = /^[A-Za-z0-9-]{3,20}$/;

export function isValidEmail(v: string) {
  return EMAIL_RE.test(v.trim());
}

export function isValidEmployeeId(v: string) {
  return EMPLOYEE_ID_RE.test(v.trim());
}

/** Returns the list of unmet password rules (empty = strong enough). */
export function passwordIssues(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 8) issues.push("At least 8 characters");
  if (!/[A-Z]/.test(pw)) issues.push("One uppercase letter");
  if (!/[a-z]/.test(pw)) issues.push("One lowercase letter");
  if (!/[0-9]/.test(pw)) issues.push("One number");
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push("One symbol");
  return issues;
}

export function passwordScore(pw: string) {
  return 5 - passwordIssues(pw).length;
}

/** Great-circle distance in metres (display only; the server decides). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
