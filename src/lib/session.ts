import { redirect } from "@tanstack/react-router";
import { auth } from "@/lib/api";
import type { SessionUser } from "@/lib/types";

/** Route guard: returns the signed-in user or sends the browser to the sign-in page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await auth.getSession();
  if (!user) throw redirect({ to: "/login" });
  return user;
}
