import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ClipboardList, CheckCircle2, Hourglass, CalendarClock, Target, Users, Plus, Trash2, CalendarDays, Columns3 } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { wf } from "@/lib/api";
import { AppShell, Card, CardTitle, Empty } from "@/components/AppShell";
import { AIAssistant, AIInsightsCard, KpiTile } from "@/components/ModuleUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useMe } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import robot from "@/assets/ai-robot.png";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "TaskForge – Task Management — Dayflow" },
      { name: "description", content: "Plan, assign and track team tasks with a Kanban board and AI insights." },
      { property: "og:title", content: "TaskForge – Task Management — Dayflow" },
      { property: "og:description", content: "Kanban task board, team workload and AI task assistant." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TasksPage,
});

const COLS = [
  { key: "todo", label: "To Do", color: "var(--primary)" },
  { key: "in_progress", label: "In Progress", color: "var(--warning)" },
  { key: "review", label: "Review", color: "var(--violet)" },
  { key: "completed", label: "Completed", color: "var(--success)" },
] as const;
type Status = (typeof COLS)[number]["key"];
const prioCls = { high: "bg-destructive/15 text-destructive", medium: "bg-warning/15 text-warning", low: "bg-success/15 text-success" } as Record<string, string>;

function TasksPage() {
  const { user } = Route.useRouteContext();
  const { data: me } = useMe(user.id);
  const isAdmin = !!me?.isAdmin;
  const qc = useQueryClient();
  const [project, setProject] = useState("all");

  const { data } = useQuery({
    queryKey: ["tasks", isAdmin],
    queryFn: async () => {
      const [tasks, emps] = await Promise.all([
        wf.tasks(),
        (isAdmin ? wf.employees() : wf.colleagues()).then((rows) => rows.filter((e) => !("is_active" in e) || e.is_active)),
      ]);
      return { tasks, emps: emps as { id: string; full_name: string }[] };
    },
  });
  const all = data?.tasks ?? [];
  const emps = data?.emps ?? [];
  const name = (id: string | null) => emps.find((e) => e.id === id)?.full_name || "Unassigned";
  const projects = [...new Set(all.map((t) => t.project))];
  const tasks = project === "all" ? all : all.filter((t) => t.project === project);
  const by = (s: Status) => tasks.filter((t) => t.status === s);
  const done = by("completed");
  const today = new Date().toISOString().slice(0, 10);
  const withDue = done.filter((t) => t.due_date && t.completed_at);
  const onTime = withDue.length ? Math.round((withDue.filter((t) => t.completed_at!.slice(0, 10) <= t.due_date!).length / withDue.length) * 1000) / 10 : null;
  const overdue = tasks.filter((t) => t.status !== "completed" && t.due_date && t.due_date < today).length;
  const completion = tasks.length ? Math.round((done.length / tasks.length) * 100) : null;

  const load = emps.map((e) => ({ ...e, open: all.filter((t) => t.assignee_id === e.id && t.status !== "completed").length })).filter((e) => e.open > 0).sort((a, b) => b.open - a.open);
  const maxOpen = Math.max(1, ...load.map((l) => l.open));
  const pie = COLS.map((c) => ({ name: c.label, value: by(c.key).length, color: c.color }));

  async function move(id: string, status: Status) {
    try { await wf.updateTask(id, { status }); } catch (e) { toast.error((e as Error).message); return; }
    qc.invalidateQueries({ queryKey: ["tasks"] });
  }
  async function remove(id: string) {
    try { await wf.deleteTask(id); } catch (e) { toast.error((e as Error).message); return; }
    qc.invalidateQueries({ queryKey: ["tasks"] });
  }

  return (
    <AppShell user={user} title="TaskForge">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary to-violet p-6 text-primary-foreground shadow-card md:p-8">
        <div className="relative z-10 max-w-xl">
          <h2 className="font-display text-2xl font-bold md:text-3xl">Smart Task Management</h2>
          <p className="mt-1 text-sm opacity-90 md:text-base">Plan, assign, track and optimize team tasks with AI.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["AI Task Assignment", "Workload Balancing", "Deadline Prediction", "Productivity Analytics"].map((t) => (
              <span key={t} className="flex items-center gap-1.5 rounded-full bg-primary-foreground/15 px-3 py-1.5 text-xs font-medium backdrop-blur"><CheckCircle2 className="h-3.5 w-3.5" />{t}</span>
            ))}
          </div>
        </div>
        <img src={robot} alt="" className="pointer-events-none absolute -bottom-4 right-4 hidden h-40 md:block" />
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Total Tasks" icon={ClipboardList} value={tasks.length} />
        <KpiTile label="Completed" icon={CheckCircle2} tone="success" value={done.length} />
        <KpiTile label="In Progress" icon={Hourglass} tone="warning" value={by("in_progress").length} />
        <KpiTile label="Pending" icon={CalendarClock} tone="danger" value={by("todo").length + by("review").length} sub={overdue ? `${overdue} overdue` : undefined} />
        <KpiTile label="On-time Rate" icon={Target} tone="violet" value={onTime == null ? "—" : `${onTime}%`} sub="Completed with due date" />
        <KpiTile label="Completion" icon={Users} tone="success" value={completion == null ? "—" : `${completion}%`} sub="Of all tasks" />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-display text-base font-semibold"><Columns3 className="h-5 w-5 text-violet" /> Task Board (Kanban)</h3>
            <div className="flex flex-wrap gap-2">
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Projects</SelectItem>{projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
              {isAdmin && <NewTask emps={emps} onDone={() => qc.invalidateQueries({ queryKey: ["tasks"] })} />}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {COLS.map((c) => (
              <div key={c.key} className="min-w-0 rounded-xl border bg-secondary/40 p-2">
                <p className="mb-2 px-1 text-sm font-semibold" style={{ color: c.color }}>{c.label} ({by(c.key).length})</p>
                <div className="space-y-2">
                  {by(c.key).map((t) => (
                    <div key={t.id} className="rounded-lg border bg-card p-2.5 shadow-sm">
                      <p className="text-sm font-medium leading-snug">{t.title}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                        <span className="rounded bg-accent px-1.5 py-0.5 text-accent-foreground">{t.tag}</span>
                        <span className={cn("rounded px-1.5 py-0.5 capitalize", prioCls[t.priority])}>{t.priority}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                        <span className="truncate">{name(t.assignee_id)}</span>
                        {t.due_date && <span className={cn("flex shrink-0 items-center gap-1", t.status !== "completed" && t.due_date < today && "text-destructive")}><CalendarDays className="h-3 w-3" />{new Date(t.due_date + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        <Select value={t.status} onValueChange={(v) => move(t.id, v as Status)}>
                          <SelectTrigger className="h-7 flex-1 text-[10px]" aria-label="Move task"><SelectValue /></SelectTrigger>
                          <SelectContent>{COLS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
                        </Select>
                        {isAdmin && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete task" onClick={() => remove(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                      </div>
                    </div>
                  ))}
                  {!by(c.key).length && <p className="px-1 py-3 text-center text-xs text-muted-foreground">No tasks</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <AIAssistant module="tasks" title="AI Task Assistant" suggestions={["Which tasks might be delayed?", "Who is overloaded?", "Suggest reassignments"]} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle icon={Users} title="Team Workload" hint="Open tasks per person" />
          {load.length ? <div className="space-y-3">{load.map((l) => {
            const pct = Math.round((l.open / maxOpen) * 100);
            const label = l.open >= 6 ? ["Overloaded", "bg-destructive/15 text-destructive"] : l.open <= 1 ? ["Underloaded", "bg-primary/15 text-primary"] : ["Optimal", "bg-success/15 text-success"];
            return <div key={l.id} className="flex items-center gap-2 text-sm"><span className="w-24 truncate">{l.full_name || "Unnamed"}</span><div className="h-2 flex-1 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} /></div><span className="w-6 text-right tabular-nums">{l.open}</span><span className={cn("rounded-full px-2 py-0.5 text-[10px]", label[1])}>{label[0]}</span></div>;
          })}</div> : <Empty>No open assigned tasks.</Empty>}
        </Card>
        <Card>
          <CardTitle title="Task Analytics" hint="By status" />
          {tasks.length ? <div className="flex items-center gap-4">
            <div className="relative h-36 w-36 shrink-0"><ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" innerRadius={48} outerRadius={64} stroke="none">{pie.map((p) => <Cell key={p.name} fill={p.color} />)}</Pie></PieChart></ResponsiveContainer><div className="absolute inset-0 flex flex-col items-center justify-center"><span className="font-display text-2xl font-bold">{tasks.length}</span><span className="text-[10px] text-muted-foreground">Total Tasks</span></div></div>
            <div className="flex-1 space-y-1.5 text-xs">{pie.map((p) => <div key={p.name} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} /><span className="flex-1">{p.name}</span><span className="tabular-nums">{p.value} ({Math.round((p.value / tasks.length) * 1000) / 10}%)</span></div>)}</div>
          </div> : <Empty>No tasks yet.</Empty>}
        </Card>
        <AIInsightsCard module="tasks" title="AI Insights" />
      </div>
    </AppShell>
  );
}

function NewTask({ emps, onDone }: { emps: { id: string; full_name: string }[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", project: "General", tag: "Feature", priority: "medium", assignee_id: "", due_date: "" });
  async function save() {
    if (!f.title.trim()) { toast.error("Enter a task title"); return; }
    try {
      await wf.createTask({ title: f.title.trim(), project: f.project.trim() || "General", tag: f.tag.trim() || "Feature", priority: f.priority as "low" | "medium" | "high", assignee_id: f.assignee_id || null, due_date: f.due_date || null });
    } catch (e) { toast.error((e as Error).message); return; }
    toast.success("Task created");
    setOpen(false); setF({ ...f, title: "" }); onDone();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" className="h-8"><Plus className="h-4 w-4" /> New Task</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5"><Label>Title</Label><Input value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Project</Label><Input value={f.project} maxLength={60} onChange={(e) => setF({ ...f, project: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Tag</Label><Input value={f.tag} maxLength={30} onChange={(e) => setF({ ...f, tag: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Priority</Label><Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Due date</Label><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label>Assignee</Label><Select value={f.assignee_id} onValueChange={(v) => setF({ ...f, assignee_id: v })}><SelectTrigger><SelectValue placeholder="Choose employee" /></SelectTrigger><SelectContent>{emps.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name || "Unnamed"}</SelectItem>)}</SelectContent></Select></div>
          <Button onClick={save}>Create task</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
