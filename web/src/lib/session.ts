import { auth } from "@/lib/api";
import type { SessionUser } from "@/lib/types";

/** Route guard: returns the current user, opening as the manager when there is no session (no sign-in page). */
export async function requireUser(): Promise<SessionUser> {
  return (await auth.getSession()) ?? (await auth.start());
}
