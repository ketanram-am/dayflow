import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared bits for the Dayflow engine screens. Values always come straight from the API. */
export function head(title: string, description: string) {
  return () => ({
    meta: [
      { title: `${title} — Dayflow` },
      { name: "description", content: description },
      { property: "og:title", content: `${title} — Dayflow` },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  });
}

export function State({ loading, error, empty, paused, children }: { loading?: boolean; error?: unknown; empty?: string | false | undefined; paused?: boolean; children?: ReactNode }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  if (paused || offline) return <div role="status" className="p-4 text-sm text-muted-foreground">Offline. Reconnect to load current Dayflow data and send changes.</div>;
  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;
  if (error) return <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{(error as Error).message || "Request failed"}</div>;
  if (empty) return <div className="p-6 text-center text-sm text-muted-foreground">{empty}</div>;
  return <>{children}</>;
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "good" | "warn" | "bad" }) {
  const t = { muted: "bg-muted text-muted-foreground", good: "bg-primary/15 text-primary", warn: "bg-accent text-accent-foreground", bad: "bg-destructive/15 text-destructive" }[tone];
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", t)}>{children}</span>;
}

export const mins = (m?: number | null) => (m == null ? "—" : `${m} min`);
export const money = (v: unknown) => (v == null || v === "" ? "—" : `$${Number(v).toFixed(2)}`);
export const when = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");
export const label = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Readable rendering of any JSON value the engine returns. */
export function JsonView({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  if (typeof value !== "object") return <span className="break-words">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">none</span>;
    return <ul className="space-y-1">{value.map((v, i) => <li key={i} className="rounded border bg-muted/30 p-2"><JsonView value={v} depth={depth + 1} /></li>)}</ul>;
  }
  if (depth > 3) return <code className="text-[11px]">{JSON.stringify(value)}</code>;
  return (
    <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-1 text-xs">
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-muted-foreground">{label(k)}</dt><dd className="min-w-0"><JsonView value={v} depth={depth + 1} /></dd></div>
      ))}
    </dl>
  );
}
