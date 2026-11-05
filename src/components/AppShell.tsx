import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  LayoutDashboard, Repeat, HeartPulse, CloudUpload, BrainCircuit, ListChecks, Settings, LogOut, Menu, UserRound, ShieldCheck, ChevronDown, Search, Bell, CalendarDays, PanelLeftClose, PanelLeftOpen, CalendarOff, MapPin, Users, Inbox, MessageCircleQuestion, Timer, ScrollText, Wallet, FileClock, Gauge,
} from "lucide-react";
import { auth, wf } from "@/lib/api";
import type { SessionUser } from "@/lib/types";

type User = Pick<SessionUser, "id" | "email">;
import { Logo, LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMe } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import campus from "@/assets/dashboard-campus.jpg";
import companyBg from "@/assets/office-building.jpg";

const main = [
  { to: "/dashboard", label: "Horizon", icon: LayoutDashboard },
  { to: "/attendance", label: "GeoPulse", icon: MapPin },
  { to: "/shifts", label: "RotaFlow", icon: Repeat },
  { to: "/wellness", label: "ZenBreak", icon: HeartPulse },
  { to: "/sync", label: "SyncShield", icon: CloudUpload },
  { to: "/tasks", label: "TaskForge", icon: ListChecks },
  { to: "/questions", label: "Questions for You", icon: MessageCircleQuestion },
  { to: "/pay", label: "Pay Explorer", icon: Wallet },
] as const;
const admin = [
  { to: "/leave", label: "LeaveSync", icon: CalendarOff },
  { to: "/queue", label: "Resolution Queue", icon: Inbox },
  { to: "/overtime", label: "Overtime", icon: Timer },
  { to: "/policy", label: "Policy Studio", icon: ScrollText },
  { to: "/audit", label: "Audit Ledger", icon: FileClock },
  { to: "/scorecard", label: "Scorecard", icon: Gauge },
] as const;

function NavLinks({ isAdmin, collapsed, onNavigate }: { isAdmin: boolean; collapsed?: boolean; onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const item = (i: (typeof main)[number] | (typeof admin)[number]) => {
    const active = path === i.to;
    return (
      <Link
        key={i.to}
        to={i.to}
        onClick={onNavigate}
        title={collapsed ? i.label : undefined}
        className={cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          collapsed && "justify-center px-0",
          active ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        )}
      >
         {active && <motion.span layoutId="nav-active" className="workspace-active absolute inset-0 rounded-lg" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
         <i.icon className="relative h-4 w-4 shrink-0" />
        {!collapsed && <span className="relative truncate">{i.label}</span>}
      </Link>
    );
  };
  return (
    <nav className="flex h-full flex-col bg-sidebar p-3 text-sidebar-foreground">
      <Link to="/dashboard" className={cn("mb-6 px-2 pt-1", collapsed && "px-0 text-center")} onClick={onNavigate}>
         {collapsed ? <LogoMark className="mx-auto h-8 w-8" /> : <><Logo /><p className="mt-1 text-[8px] text-muted-foreground">Workforce Intelligence Platform</p></>}
      </Link>
      {!collapsed && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">Workspace</p>}
      <div className="space-y-1">{main.map(item)}</div>
      {isAdmin && (
        <>
           {!collapsed && <p className="mt-4 mb-2 border-t border-sidebar-border px-3 pt-3 text-[10px] font-semibold uppercase text-muted-foreground">Operations</p>}
          {collapsed && <div className="my-3 border-t border-sidebar-border" />}
          <div className="space-y-1">{admin.map(item)}</div>
        </>
      )}
      {!collapsed && (
         <div className="mt-auto pt-6">
           <img src={campus} width={1536} height={512} alt="" className="workspace-illustration mb-3 h-28 w-full object-cover" loading="lazy" />
         <div className="flex items-start gap-2 p-2 text-[10px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-primary" />
          Location is read only when you verify or punch.
        </div>
         </div>
      )}
    </nav>
  );
}

function useNotifications(userId: string, isAdmin: boolean) {
  return useQuery({
    queryKey: ["notifications", userId, isAdmin],
    queryFn: async () => {
      if (isAdmin) {
        const k = await wf.kpis();
        return { leave: k.pending_leave, swaps: k.pending_swaps };
      }
      const [leave, swaps] = await Promise.all([wf.leave("pending"), wf.swaps()]);
      return { leave: leave.length, swaps: swaps.filter((x) => x.status === "pending" && x.requester_id === userId).length };
    },
  });
}

export function AppShell({ user, title, actions, children }: { user: User; title: string; actions?: ReactNode; children: ReactNode }) {
  const { data } = useMe(user.id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const emp = data?.employee;
  const name = emp?.full_name || user.email?.split("@")[0] || "Employee";
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const isAdmin = !!data?.isAdmin;
   const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const { data: notes } = useNotifications(user.id, isAdmin);
  const noteCount = (notes?.leave ?? 0) + (notes?.swaps ?? 0);
  const today = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

   useEffect(() => { setCollapsed(localStorage.getItem("df_sidebar") === "1"); }, []);
   useEffect(() => localStorage.setItem("df_sidebar", collapsed ? "1" : "0"), [collapsed]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    sessionStorage.removeItem("df_last_verify");
    await auth.logout();
    navigate({ to: "/dashboard", replace: true });
  }

  return (
     <div className="dayflow-workspace relative isolate flex min-h-screen bg-background text-foreground">
       <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
         <img src={companyBg} alt="" className="h-full w-full scale-110 object-cover opacity-30 blur-xl" />
         <div className="absolute inset-0 bg-background/60" />
       </div>
       <aside className={cn("sticky top-0 hidden h-screen shrink-0 border-r border-sidebar-border transition-[width] duration-200 md:block", collapsed ? "w-16" : "w-48")}>
        <NavLinks isAdmin={isAdmin} collapsed={collapsed} />
         <Button variant="ghost" size="icon"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute top-16 -right-3 hidden h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/70 shadow-card transition-colors hover:text-sidebar-primary md:flex"
        >
          {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
         </Button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-transparent">
         <header className="sticky top-0 z-20 grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:flex sm:justify-between md:px-4">
          <div className="flex min-w-0 items-center gap-2">
             <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu"><Menu /></Button>
              </SheetTrigger>
               <SheetContent side="left" className="dayflow-workspace w-64 border-0 p-0"><NavLinks isAdmin={isAdmin} /></SheetContent>
            </Sheet>
            <h1 className="truncate font-display text-base font-semibold text-foreground">{title}</h1>
          </div>
           <div className="flex shrink-0 items-center gap-2 md:gap-3">
            {isAdmin && (
              <form
                className="relative hidden md:block"
                onSubmit={(e) => {
                  e.preventDefault();
                  navigate({ to: "/employees", search: { q: search } });
                }}
              >
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee, ID…" className="h-9 w-56 rounded-full bg-card pl-9 text-sm" />
              </form>
            )}
            <span className="hidden items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground xl:flex">
              <CalendarDays className="h-3.5 w-3.5 text-primary" /> {today}
            </span>
            {actions}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative rounded-full" aria-label="Notifications">
                   <Bell className="h-4 w-4" />
                  {noteCount > 0 && <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">{noteCount}</span>}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>{isAdmin ? "Pending approvals" : "Your pending requests"}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {noteCount === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Nothing pending right now.</p>}
                {(notes?.leave ?? 0) > 0 && (
                  <DropdownMenuItem onClick={() => navigate({ to: "/leave" })}>
                     <CalendarOff className="mr-2 h-4 w-4 text-warning" /> {notes?.leave} leave request{(notes?.leave ?? 0) > 1 ? "s" : ""} pending
                  </DropdownMenuItem>
                )}
                {(notes?.swaps ?? 0) > 0 && (
                  <DropdownMenuItem onClick={() => navigate({ to: "/shifts" })}>
                     <Repeat className="mr-2 h-4 w-4 text-primary" /> {notes?.swaps} shift swap{(notes?.swaps ?? 0) > 1 ? "s" : ""} pending
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full p-1 pr-2 transition-colors hover:bg-muted">
                <Avatar className="h-8 w-8">
                  {emp?.profile_image && <AvatarImage src={emp.profile_image} alt={name} />}
                  <AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials}</AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium text-foreground sm:inline">{name}</span>
                <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:block" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-medium">{name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  <p className="mt-1 text-xs capitalize text-primary">{isAdmin ? "Administrator" : "Employee"}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate({ to: "/profile" })}><UserRound className="mr-2 h-4 w-4" /> Profile</DropdownMenuItem>
                {isAdmin && <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}><Settings className="mr-2 h-4 w-4" /> Settings</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
         <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-3 p-3 md:p-4">{children}</main>
      </div>
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border bg-card p-4 shadow-card md:p-5", className)}>{children}</div>;
}

export function CardTitle({ icon: Icon, title, hint, right }: { icon?: React.ComponentType<{ className?: string }>; title: string; hint?: string | undefined; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        {Icon && <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary"><Icon className="h-4 w-4" /></div>}
        <div>
          <h2 className="font-display text-sm font-semibold text-foreground">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone = "default" }: { label: string; value: ReactNode; sub?: ReactNode; icon: React.ComponentType<{ className?: string }>; tone?: "default" | "success" | "warning" | "danger" }) {
  const toneCls = { default: "bg-primary/15 text-primary", success: "bg-success/15 text-success", warning: "bg-warning/15 text-warning", danger: "bg-destructive/15 text-destructive" }[tone];
  return (
    <div className="flex h-full flex-col rounded-2xl border bg-card p-4 shadow-card transition-colors hover:border-primary/40">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", toneCls)}><Icon className="h-4 w-4" /></div>
      </div>
      <p className="mt-2 font-display text-xl font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    inside: "bg-success/15 text-success", approved: "bg-success/15 text-success",
    outside: "bg-destructive/15 text-destructive", rejected: "bg-destructive/15 text-destructive",
    pending: "bg-warning/15 text-warning", low_accuracy: "bg-warning/15 text-warning",
    uncertain: "bg-warning/15 text-warning",
    unconfigured: "bg-muted text-muted-foreground",
  };
  const label: Record<string, string> = { low_accuracy: "Low accuracy", uncertain: "Uncertain", unconfigured: "Not configured" };
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", map[status] ?? "bg-muted text-muted-foreground")}>{label[status] ?? status}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function AdminOnly({ isAdmin, loading, children }: { isAdmin: boolean; loading: boolean; children: ReactNode }) {
  if (loading) return <Empty>Loading…</Empty>;
  if (!isAdmin) return <Empty>This area is for administrators only.</Empty>;
  return <>{children}</>;
}
