import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MapPinned, Crosshair, Loader2 } from "lucide-react";
import { wf } from "@/lib/api";
import { AdminOnly, AppShell, Card, CardTitle } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPosition, useMe, useOfficeSettings } from "@/lib/attendance";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Dayflow" },
      { name: "description", content: "Configure the office geofence and attendance rules." },
      { property: "og:title", content: "Settings — Dayflow" },
      { property: "og:description", content: "Administrator attendance settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: me, isLoading } = useMe(user.id);
  const { data: s } = useOfficeSettings();
  const [f, setF] = useState({ office_name: "", latitude: "", longitude: "", radius_m: "150", max_accuracy_m: "100", break_reminder_min: "240" });
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    if (s) setF({ office_name: s.office_name, latitude: s.latitude?.toString() ?? "", longitude: s.longitude?.toString() ?? "", radius_m: String(s.radius_m), max_accuracy_m: String(s.max_accuracy_m), break_reminder_min: String(s.break_reminder_min) });
  }, [s]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function useHere() {
    setLocating(true);
    try {
      const p = await getPosition();
      setF({ ...f, latitude: p.lat.toFixed(6), longitude: p.lng.toFixed(6) });
      toast.success(`Location captured (± ${Math.round(p.accuracy)} m)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not get location");
    } finally {
      setLocating(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const lat = Number(f.latitude), lng = Number(f.longitude), r = Number(f.radius_m), acc = Number(f.max_accuracy_m), br = Number(f.break_reminder_min);
    if (!f.latitude || isNaN(lat) || lat < -90 || lat > 90) return void toast.error("Latitude must be between -90 and 90");
    if (!f.longitude || isNaN(lng) || lng < -180 || lng > 180) return void toast.error("Longitude must be between -180 and 180");
    if (!(r >= 20 && r <= 5000)) return void toast.error("Radius must be 20–5000 m");
    if (!(acc >= 5 && acc <= 1000)) return void toast.error("Required accuracy must be 5–1000 m");
    if (!(br >= 30 && br <= 720)) return void toast.error("Break reminder must be 30–720 minutes");
    try {
      await wf.setOffice({ office_name: f.office_name.trim() || "Main office", latitude: lat, longitude: lng, radius_m: r, max_accuracy_m: acc, break_reminder_min: br });
    } catch (err) {
      return void toast.error(err instanceof Error ? err.message : "Could not save settings");
    }
    toast.success("Settings saved");
    qc.invalidateQueries({ queryKey: ["office"] });
  }

  return (
    <AppShell user={user} title="ControlRoom">
      <AdminOnly isAdmin={!!me?.isAdmin} loading={isLoading}>
        <Card className="max-w-3xl">
          <CardTitle icon={MapPinned} title="Office geofence" hint="Check-in is only accepted inside this area" />
          <form onSubmit={save} className="space-y-5">
            <div className="space-y-1.5"><Label>Office name</Label><Input value={f.office_name} onChange={set("office_name")} /></div>
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-1.5"><Label>Latitude</Label><Input inputMode="decimal" value={f.latitude} onChange={set("latitude")} /></div>
              <div className="space-y-1.5"><Label>Longitude</Label><Input inputMode="decimal" value={f.longitude} onChange={set("longitude")} /></div>
              <Button type="button" variant="secondary" onClick={useHere} disabled={locating}>{locating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Crosshair className="mr-2 h-4 w-4" />} Use my location</Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Radius (m)</Label><Input type="number" value={f.radius_m} onChange={set("radius_m")} /></div>
              <div className="space-y-1.5"><Label>Required GPS accuracy (m)</Label><Input type="number" value={f.max_accuracy_m} onChange={set("max_accuracy_m")} /></div>
              <div className="space-y-1.5"><Label>Break reminder after (min)</Label><Input type="number" value={f.break_reminder_min} onChange={set("break_reminder_min")} /></div>
            </div>
            {f.latitude && f.longitude && (
              <a className="inline-block text-xs text-primary hover:underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${f.latitude}&mlon=${f.longitude}#map=17/${f.latitude}/${f.longitude}`}>Preview on map ↗</a>
            )}
            <div><Button type="submit">Save settings</Button></div>
          </form>
        </Card>
      </AdminOnly>
    </AppShell>
  );
}
