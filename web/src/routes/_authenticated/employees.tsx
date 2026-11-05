import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Users, Search, UserCheck, UserX, CalendarOff, ChevronLeft, ChevronRight, History } from "lucide-react";
import { wf } from "@/lib/api";
import { AdminOnly, AppShell, Card, CardTitle, Empty, Stat, StatusPill } from "@/components/AppShell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtHours, fmtTime, todayUTC, useMe } from "@/lib/attendance";
import type { AttStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/employees")({
  validateSearch: (s: Record<string, unknown>) => ({ q: typeof s["q"] === "string" ? (s["q"] as string) : "" }),
  head: () => ({
    meta: [
      { title: "PeopleHub – Employees — Dayflow" },
      { name: "description", content: "Employee directory with GeoPulse attendance status, search and department filters." },
      { property: "og:title", content: "PeopleHub – Employees — Dayflow" },
      { property: "og:description", content: "Search employees and review their GeoPulse check-in and check-out records." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EmployeesPage,
});

const PAGE = 10;
const tone: Record<AttStatus, string> = {
  Present: "bg-success/15 text-success",
  Late: "bg-warning/15 text-warning",
  "Checked Out": "bg-primary/15 text-primary",
  "On Leave": "bg-accent text-accent-foreground",
  Absent: "bg-destructive/10 text-destructive",
};

function EmployeesPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: me, isLoading } = useMe(user.id);
  const { q: initialQ } = Route.useSearch();
  const [q, setQ] = useState(initialQ);
  const [dept, setDept] = useState("all");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<{ id: string; name: string; code: string | null } | null>(null);

  const { data } = useQuery({
    queryKey: ["employees", "admin"],
    enabled: !!me?.isAdmin,
    queryFn: async () => {
      const rows = await wf.overview(todayUTC());
      return rows.map((e) => ({ ...e, today: e.attendance }));
    },
  });

  async function update(id: string, patch: { role?: "admin" | "employee"; is_active?: boolean }) {
    if (id === user.id && (patch.role === "employee" || patch.is_active === false)) return void toast.error("You can't remove your own admin access");
    try { await wf.updateEmployee(id, patch); } catch (e) { return void toast.error((e as Error).message); }
    toast.success("Employee updated");
    qc.invalidateQueries({ queryKey: ["employees"] });
  }

  const all = data ?? [];
  const depts = useMemo(() => [...new Set(all.map((e) => e.department).filter(Boolean) as string[])].sort(), [all]);
  const list = all.filter((e) =>
    (dept === "all" || e.department === dept) &&
    `${e.full_name} ${e.employee_id ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const rows = list.slice(cur * PAGE, cur * PAGE + PAGE);
  const count = (s: AttStatus[]) => all.filter((e) => e.is_active && s.includes(e.status)).length;

  return (
    <AppShell user={user} title="PeopleHub">
      <AdminOnly isAdmin={!!me?.isAdmin} loading={isLoading}>
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Total Employees" icon={Users} value={all.length} />
          <Stat label="Present" icon={UserCheck} tone="success" value={count(["Present", "Late", "Checked Out"])} sub="Checked in today" />
          <Stat label="Absent" icon={UserX} tone="danger" value={count(["Absent"])} />
          <Stat label="On Leave" icon={CalendarOff} tone="warning" value={count(["On Leave"])} />
        </section>
        <Card>
          <CardTitle icon={Users} title="Employee directory" hint={`${list.length} shown`} right={
            <div className="flex flex-wrap gap-2">
              <div className="relative w-56"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Name or Employee ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} /></div>
              <Select value={dept} onValueChange={(v) => { setDept(v); setPage(0); }}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All departments</SelectItem>{depts.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          } />
          {rows.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Employee ID</TableHead><TableHead>Name</TableHead><TableHead>Department</TableHead><TableHead>Status</TableHead><TableHead>Check in / out</TableHead><TableHead>Role</TableHead><TableHead>Active</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {rows.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{e.employee_id ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">{e.profile_image && <AvatarImage src={e.profile_image} />}<AvatarFallback className="bg-secondary text-xs">{e.full_name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 font-medium text-foreground">{e.full_name}</p>
                            <p className="truncate text-xs text-muted-foreground">{e.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{e.department ?? "—"}</TableCell>
                      <TableCell><span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", tone[e.status])}>{e.status}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">{e.today ? `${fmtTime(e.today.check_in_time)} – ${fmtTime(e.today.check_out_time)}` : "—"}</TableCell>
                      <TableCell>
                        <Select value={e.role} onValueChange={(v) => update(e.id, { role: v as "admin" | "employee" })}>
                          <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="employee">Employee</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Switch checked={e.is_active} onCheckedChange={(v) => update(e.id, { is_active: v })} aria-label="Active" /></TableCell>
                      <TableCell><Button size="sm" variant="ghost" onClick={() => setOpen({ id: e.id, name: e.full_name, code: e.employee_id })}><History className="mr-1 h-4 w-4" />Records</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : <Empty>No employees match.</Empty>}
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>Page {cur + 1} of {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={cur === 0} onClick={() => setPage(cur - 1)}><ChevronLeft className="h-4 w-4" />Prev</Button>
              <Button size="sm" variant="outline" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next<ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </Card>
        <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{open?.name} {open?.code && <span className="font-mono text-sm text-muted-foreground">· {open.code}</span>}</DialogTitle></DialogHeader>
            {open && <Records employeeId={open.id} />}
          </DialogContent>
        </Dialog>
      </AdminOnly>
    </AppShell>
  );
}

function Records({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["attendance", "emp", employeeId],
    queryFn: () => wf.attendance({ employee_id: employeeId, limit: 30 }),
  });
  if (isLoading) return <Empty>Loading…</Empty>;
  if (!data?.length) return <Empty>No GeoPulse check-in records yet.</Empty>;
  return (
    <div className="max-h-96 overflow-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Check in</TableHead><TableHead>Check out</TableHead><TableHead>Hours</TableHead><TableHead>GPS</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.attendance_date}</TableCell>
              <TableCell className="tabular-nums">{fmtTime(r.check_in_time)}</TableCell>
              <TableCell className="tabular-nums">{fmtTime(r.check_out_time)}</TableCell>
              <TableCell className="tabular-nums">{fmtHours(r.total_working_hours == null ? null : Number(r.total_working_hours))}</TableCell>
              <TableCell><StatusPill status={r.location_status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
