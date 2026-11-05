import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { Bell, CalendarDays, CheckCircle2, ChevronRight, Info } from "lucide-react";
import { wf } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function WorkforceHeatmap() {
  const end = new Date(); end.setHours(0,0,0,0);
  const start = new Date(end); start.setDate(start.getDate()-6);
  const { data } = useQuery({ queryKey: ["workforce-heatmap", start.toISOString().slice(0,10)], queryFn: async () => {
    const from = start.toISOString().slice(0,10), to = new Date(end.getTime()+86400000).toISOString().slice(0,10);
    const { isAdmin } = await wf.me();
    const rows = isAdmin ? await wf.report(from, to) : await wf.attendance({ start: from, end: to });
    return rows.filter(r => r.check_in_time >= start.toISOString());
  }});
  const hours = [9,11,13,15,17,19];
  const days = Array.from({length:5}, (_,i) => { const d = new Date(start); d.setDate(d.getDate()+i); return d; });
  const counts = days.map(d => hours.map(h => (data ?? []).filter(r => {const at = new Date(r.check_in_time); return at.toDateString() === d.toDateString() && at.getHours() >= h && at.getHours() < h+2;}).length));
  const max = Math.max(1,...counts.flat());
  return <section className="workspace-panel min-w-0 rounded-xl border bg-card p-3 shadow-card"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="flex items-center gap-1 text-xs font-semibold">Workforce Heatmap <Info className="h-3 w-3 text-muted-foreground" /></h3><span className="text-[9px] text-muted-foreground">Check-ins · last 7 days</span></div><div className="grid grid-cols-[auto_repeat(6,minmax(0,1fr))] gap-1 text-[9px]">{days.map((d,i) => <div key={d.toISOString()} className="contents"><span className="self-center pr-1 text-muted-foreground">{d.toLocaleDateString(undefined,{weekday:"short"})}</span>{hours.map((h,j) => <div key={h} title={`${d.toLocaleDateString()} ${h}:00–${h+2}:00 · ${(counts[i]?.[j] ?? 0)} check-ins`} className="heatmap-cell h-5 rounded" style={{"--heat": (counts[i]?.[j] ?? 0) ? 20+(counts[i]?.[j] ?? 0)/max*80 : 0} as CSSProperties} />)}</div>)}<span />{hours.map(h=><span key={h} className="text-center text-muted-foreground">{h > 12 ? h-12 : h}{h >= 12 ? "PM" : "AM"}</span>)}</div><div className="mt-2 flex justify-end gap-2 text-[9px] text-muted-foreground"><span>Low</span><span className="h-2 w-12 rounded bg-gradient-primary" /><span>High</span></div></section>;
}

export function SmartAlerts() {
  const {data} = useQuery({queryKey:["workspace-alerts"],queryFn:async()=>{
    const [leave,swaps] = await Promise.all([wf.leave("pending"), wf.swaps()]);
    return {leave:leave.length, swaps:swaps.filter(x=>x.status==="pending").length};
  }});
  return <section className="workspace-panel min-w-0 rounded-xl border bg-card p-3 shadow-card"><h3 className="mb-3 flex items-center gap-2 text-xs font-semibold"><Bell className="h-4 w-4 text-warning" /> Smart Alerts <span className="text-destructive">({(data?.leave??0)+(data?.swaps??0)})</span></h3><div className="space-y-2"><Button asChild variant="ghost" className="h-auto w-full justify-start whitespace-normal border bg-background p-2"><Link to="/leave"><CalendarDays className="text-warning" /><span className="flex-1 text-left text-[10px]">Leave approvals<span className="block font-normal text-muted-foreground">{data?.leave ?? 0} pending requests</span></span><ChevronRight /></Link></Button><Button asChild variant="ghost" className="h-auto w-full justify-start whitespace-normal border bg-background p-2"><Link to="/shifts"><CalendarDays className="text-violet" /><span className="flex-1 text-left text-[10px]">Shift swap requests<span className="block font-normal text-muted-foreground">{data?.swaps ?? 0} awaiting review</span></span><ChevronRight /></Link></Button>{data && !data.leave && !data.swaps && <p className="flex items-center gap-1 text-[10px] text-success"><CheckCircle2 className="h-3 w-3" /> All requests are up to date</p>}</div></section>;
}