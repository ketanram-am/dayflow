import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { auth } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Demo only. A two-way Manager / Employee toggle so a recording never needs a sign-out. It renders only when the
 * backend was started with DAYFLOW_DEMO_SWITCH=1, and the server decides which accounts it can reach.
 */
export function RoleSwitch() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const demo = useQuery({ queryKey: ["demo-accounts"], queryFn: auth.demoAccounts, retry: false });
  if (!demo.data?.enabled) return null;
  const options = [
    { role: "reviewer" as const, label: "Manager", icon: ShieldCheck, to: "/queue" as const },
    { role: "employee" as const, label: "Employee", icon: UserRound, to: "/questions" as const },
  ].map((o) => ({ ...o, account: demo.data.accounts.find((a) => a.role === o.role) })).filter((o) => o.account);

  async function pick(o: (typeof options)[number]) {
    if (!o.account || o.account.current) return;
    try {
      await auth.switchTo(o.account.id);
      await qc.cancelQueries();
      qc.clear();
      toast.success(`Now viewing as ${o.account.name} (${o.label.toLowerCase()})`);
      navigate({ to: o.to, replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch");
    }
  }

  return (
    <div role="group" aria-label="Demo: view as" className="flex items-center gap-2">
      <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground lg:inline">View as</span>
      <div className="relative flex rounded-full border bg-card p-0.5 shadow-sm">
        {options.map((o) => {
          const active = !!o.account?.current;
          return (
            <button
              key={o.role}
              type="button"
              aria-pressed={active}
              onClick={() => pick(o)}
              className={cn("relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {active && <motion.span layoutId="role-switch" className="absolute inset-0 rounded-full bg-primary shadow" transition={{ type: "spring", stiffness: 420, damping: 32 }} />}
              <o.icon className="relative h-3.5 w-3.5" />
              <span className="relative">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
