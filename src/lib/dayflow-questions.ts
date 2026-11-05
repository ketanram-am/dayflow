import type { Resolution } from "./dayflow";

/** A reviewer without an employee identity must never receive answer controls. */
export function myQuestions(items: Resolution[], employeeId: string | null | undefined) {
  if (!employeeId) return [];
  return items.filter((item) => item.employee_id === employeeId && item.lane === "waiting" && item.state === "open");
}