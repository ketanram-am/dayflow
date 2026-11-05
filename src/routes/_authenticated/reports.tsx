import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FileBarChart, Download } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { wf } from "@/lib/api";
import { AdminOnly, AppShell, Card, CardTitle, Empty } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtHours, todayUTC, useMe } from "@/lib/attendance";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Dayflow" },
      { name: "description", content: "Attendance reports and analytics for administrators." },
      { property: "og:title", content: "Reports — Dayflow" },
      { property: "og:description", content: "Generate and export attendance reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Reports,
});

function Reports() {
  const { user } = Route.useRouteContext();
  const { data: me, isLoading } = useMe(user.id);
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(todayUTC());

  const { data } = useQuery({
    queryKey: ["attendance", "report", from, to],
    enabled: !!me?.isAdmin,
    queryFn: async () => {
      const [rows, emps] = await Promise.all([wf.report(from, to), wf.employees()]);
      return { rows, emps };
    },
  });

  const rows = data?.rows ?? [];
  const per = (data?.emps ?? []).map((e) => {
    const mine = rows.filter((r) => r.employee_id === e.id);
    const hrs = mine.reduce((s, r) => s + Number(r.total_working_hours ?? 0), 0);
    return { ...e, days: mine.length, hours: hrs, avg: mine.filter((r) => r.total_working_hours != null).length ? hrs / mine.filter((r) => r.total_working_hours != null).length : null, offline: mine.filter((r) => !!r.synced_offline).length };
  }).sort((a, b) => b.days - a.days);
  const daily = Object.entries(rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.attendance_date]: (m[r.attendance_date] ?? 0) + 1 }), {})).map(([d, n]) => ({ day: d.slice(5), present: n }));

  function exportCsv() {
    const names = new Map((data?.emps ?? []).map((e) => [e.id, e]));
    const head = ["date", "employee_id", "name", "email", "check_in", "check_out", "hours", "location_status", "synced_offline"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((r) => { const e = names.get(r.employee_id); return [r.attendance_date, e?.employee_id, e?.full_name, e?.email, r.check_in_time, r.check_out_time, r.total_working_hours, r.location_status, r.synced_offline].map(esc).join(","); });
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dayflow-attendance-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <AppShell user={user} title="InsightLens">
      <AdminOnly isAdmin={!!me?.isAdmin} loading={isLoading}>
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>To</Label><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
            <Button className="ml-auto" onClick={exportCsv} disabled={!rows.length}><Download className="mr-2 h-4 w-4" /> Export CSV</Button>
          </div>
        </Card>
        <Card>
          <CardTitle title="Daily attendance" hint={`${rows.length} records in range`} />
          {daily.length ? (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={28} />
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} cursor={{ fill: "var(--muted)" }} />
                  <Bar dataKey="present" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty>No attendance in this range.</Empty>}
        </Card>
        <Card>
          <CardTitle icon={FileBarChart} title="By employee" />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>ID</TableHead><TableHead className="text-right">Days</TableHead><TableHead className="text-right">Total hours</TableHead><TableHead className="text-right">Avg / day</TableHead><TableHead className="text-right">Offline syncs</TableHead></TableRow></TableHeader>
              <TableBody>
                {per.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.full_name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.employee_id ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.days}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtHours(p.hours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtHours(p.avg)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.offline}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </AdminOnly>
    </AppShell>
  );
}
