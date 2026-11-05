import { auth } from "@/lib/api";
import type { SessionUser } from "@/lib/types";

/** The app has no sign-in page: without a session it signs in with the seeded demo administrator. */
const DEMO_EMAIL = "avery@dayflow.demo";
const DEMO_PASSWORD = "Dayflow-demo-2026!";

/** Shown when the Dayflow server can't be reached, so pages render their own error states instead of a blank screen. */
export const OFFLINE_USER: SessionUser = {
  id: "offline", email: DEMO_EMAIL, name: "Offline", role: "reviewer", employee_id: null, csrf: "",
};

export async function requireUser(): Promise<SessionUser> {
  const user = await auth.getSession();
  if (user) return user;
  try {
    return await auth.login(DEMO_EMAIL, DEMO_PASSWORD);
  } catch (e) {
    console.warn("Dayflow server unreachable; showing the app without data.", e);
    return OFFLINE_USER;
  }
}
