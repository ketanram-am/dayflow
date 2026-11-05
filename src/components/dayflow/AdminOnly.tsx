import type { ReactNode } from "react";
import { Empty } from "@/components/AppShell";
import { useMe } from "@/lib/attendance";
import { State } from "@/components/EngineUI";

/** Friendly gate for reviewer-only engine pages; the server enforces the same rule. */
export function AdminOnly({ userId, children }: { userId: string; children: ReactNode }) {
  const { data, isLoading, error, fetchStatus } = useMe(userId);
  if (isLoading || error) return <State loading={isLoading} error={error} paused={fetchStatus === "paused"} />;
  if (!data?.isAdmin) return <Empty>Administrators only. Ask a reviewer if you need this page.</Empty>;
  return <>{children}</>;
}

export const humanise = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const KIND_LABEL: Record<string, string> = {
  fill_punch: "Add missing punch", remove_duplicate: "Remove duplicate", pay_premium: "Pay meal premium",
  accept_as_recorded: "Pay as recorded", ask_employee: "Ask employee", fix_schedule: "Fix schedule",
  needs_manager: "Manager decides", record_leave: "Record leave",
};
