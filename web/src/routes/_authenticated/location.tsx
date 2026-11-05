import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MapPin, Loader2, ShieldAlert, CheckCircle2, XCircle, Crosshair, RotateCcw, ArrowRight, ShieldCheck, Zap, Globe2, Activity, Radio, Route as Route2, Building2, CircleDot, ChevronsRight, Lock } from "lucide-react";
import building from "@/assets/office-building.jpg";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/AppShell";
import { getPosition, permissionState, verifyLocation, type GeoFix, type VerifyResult } from "@/lib/attendance";

export const Route = createFileRoute("/_authenticated/location")({
  head: () => ({
    meta: [
      { title: "ZoneLock – Verify Location — Dayflow" },
      { name: "description", content: "Allow location access to verify attendance." },
      { property: "og:title", content: "Enable Location Access — Dayflow" },
      { property: "og:description", content: "Dayflow verifies check-in against your office geofence." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LocationRoute,
});

function LocationRoute() {
  return <LocationPage />;
}

export function LocationPage() {
  const [perm, setPerm] = useState<string>("checking");
  const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    permissionState().then(setPerm);
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const f = await getPosition();
      setFix(f);
      setPerm("granted");
      setResult(await verifyLocation(f, "login"));
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === 1) setPerm("denied");
      setError(e instanceof Error ? e.message : "Could not verify your location.");
    } finally {
      setBusy(false);
    }
  }

  const denied = perm === "denied";
  const inside = result?.status === "inside";
  const step = result ? (inside ? 4 : 3) : fix || perm === "granted" ? 2 : 1;
  const steps = [
    { t: "Sign In", d: "You are authenticated" },
    { t: "Enable GPS", d: "Grant location permission" },
    { t: "Verify Location", d: "Check office geofence" },
    { t: "Mark Attendance", d: "Complete check-in / check-out" },
  ];
  const radius = result?.radius_m ?? 100;
  const dist = result?.distance_m ?? null;
  const scale = dist != null ? Math.max(radius, dist) * 1.2 : radius * 1.2;
  const youR = dist != null ? (dist / scale) * 70 : null;
  const fenceR = (radius / scale) * 70;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute -left-40 top-0 h-[32rem] w-[32rem] rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-40 bottom-0 h-[32rem] w-[32rem] rounded-full bg-accent/30 blur-3xl" />
      <header className="relative flex items-center justify-between border-b border-border/60 px-5 py-3">
        <Logo />
        <Link to="/dashboard" className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground"><MapPin className="h-4 w-4" /> ZoneLock</Link>
      </header>
      <main className="relative mx-auto grid max-w-7xl gap-5 p-4 md:p-6 lg:grid-cols-[260px_1fr_280px]">
        {/* Left intro */}
        <aside className="flex flex-col items-center text-center lg:items-stretch">
          <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
            <span className="absolute inset-0 rounded-full bg-primary/30 animate-pulse-ring" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/20 text-primary ring-1 ring-primary/50"><ShieldCheck className="h-10 w-10" /></div>
          </div>
          <h1 className="mt-4 text-center font-display text-4xl font-bold">Zone<span className="text-primary">Lock</span></h1>
          <p className="text-center font-medium">GPS Location Verification</p>
          <p className="mt-2 text-center text-sm text-muted-foreground">Secure, geofence-based attendance that works only within the approved office area.</p>
          <img src={building} alt="Office building" className="mt-4 hidden h-40 w-full rounded-2xl object-cover lg:block" />
          <ul className="mt-4 hidden space-y-3 text-left lg:block">
            {[[Crosshair, "Geofence Check-in", "Attendance only inside office"], [Zap, "Real-time Verification", "Instant location & distance check"], [ShieldCheck, "Secure & Private", "Location used only for attendance"]].map(([I, t, d]) => {
              const Icon = I as typeof Zap;
              return <li key={t as string} className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"><Icon className="h-5 w-5" /></div><div><p className="text-sm font-semibold">{t as string}</p><p className="text-xs text-muted-foreground">{d as string}</p></div></li>;
            })}
          </ul>
        </aside>

        {/* Center */}
        <section className="rounded-3xl border border-primary/30 bg-card/80 p-5 shadow-card backdrop-blur md:p-6">
          <div className="flex items-start gap-3">
            <Crosshair className="mt-1 h-8 w-8 shrink-0 text-success" />
            <div>
              <h2 className="font-display text-xl font-bold md:text-2xl">Verify Your Work Location</h2>
              <p className="text-sm text-muted-foreground">Enable GPS and confirm that you are within the company's permitted area.</p>
            </div>
          </div>
          <div className="mt-5 grid items-center gap-5 md:grid-cols-2">
            <div className="flex flex-col items-center">
              <div className="relative flex h-44 w-44 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 to-success/20 ring-1 ring-primary/40">
                {busy && <span className="absolute inset-0 rounded-full bg-primary/30 animate-pulse-ring" />}
                <Globe2 className="absolute h-36 w-36 text-primary/30" />
                {denied ? <ShieldAlert className="relative h-14 w-14 text-destructive" /> : <MapPin className="relative h-14 w-14 text-primary" />}
              </div>
              <p className="mt-3 flex items-center gap-2 rounded-full border border-primary/40 px-4 py-1.5 text-xs">
                <Activity className="h-3.5 w-3.5 text-primary" />
                {busy ? "Scanning your location…" : result ? "Location checked" : denied ? "Permission denied" : "Ready to scan"}
              </p>
            </div>
            <dl className="space-y-2 text-sm">
              <Row icon={MapPin} label="Permission Status">
                <span className={perm === "granted" ? "rounded-full bg-success/20 px-2.5 py-0.5 text-success" : denied ? "rounded-full bg-destructive/20 px-2.5 py-0.5 text-destructive" : "text-muted-foreground"}>
                  {perm === "granted" ? "✓ Granted" : denied ? "Denied" : perm === "prompt" ? "Not yet granted" : "Ask on enable"}
                </span>
              </Row>
              <Row icon={Crosshair} label="Latitude">{fix ? `${fix.lat.toFixed(4)}°` : "—"}</Row>
              <Row icon={Crosshair} label="Longitude">{fix ? `${fix.lng.toFixed(4)}°` : "—"}</Row>
              <Row icon={Radio} label="GPS Accuracy">{fix ? `± ${Math.round(fix.accuracy)} m` : "—"}</Row>
              <Row icon={Route2} label="Distance from Office">{dist != null ? `${Math.round(dist)} m` : "—"}</Row>
            </dl>
          </div>

          {result && (
            <div className={`mt-5 flex items-center gap-3 rounded-2xl border p-4 ${inside ? "border-success/50 bg-success/15" : "border-warning/50 bg-warning/10"}`}>
              {inside ? <CheckCircle2 className="h-7 w-7 shrink-0 text-success" /> : <XCircle className="h-7 w-7 shrink-0 text-warning" />}
              <p className="flex-1 text-sm font-semibold md:text-base">
                {inside && "You are inside the office geofence"}
                {result.status === "outside" && `You are ${Math.round(dist ?? 0)} m from ${result.office_name} (allowed ${result.radius_m} m)`}
                {result.status === "uncertain" && `Uncertain: about ${Math.round(dist ?? 0)} m from ${result.office_name} and your GPS error (± ${Math.round(result.accuracy_m ?? fix?.accuracy ?? 0)} m) crosses the boundary. Move closer to the centre and retry.`}
                {result.status === "low_accuracy" && `GPS accuracy is weaker than the required ${result.max_accuracy_m} m. Move near a window and retry.`}
                {result.status === "unconfigured" && "An administrator has not set the office location yet."}
              </p>
              <StatusPill status={result.status} />
            </div>
          )}
          {error && (
            <div className="mt-5 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
              <p className="font-medium">{error}</p>
              {denied && <p className="mt-1 text-destructive/80">Allow location for this site in your browser or device settings, then press Try again. Without it you can view records but cannot check in or out.</p>}
            </div>
          )}

          <div className="relative mt-5 overflow-hidden rounded-2xl border bg-accent/20">
            <svg viewBox="0 0 300 160" className="h-48 w-full" role="img" aria-label="Office geofence map">
              <defs><pattern id="zl-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" className="stroke-border" strokeWidth="0.6" /></pattern></defs>
              <rect width="300" height="160" fill="url(#zl-grid)" />
              <circle cx="190" cy="80" r={fenceR} className="fill-success/25 stroke-success" strokeDasharray="4 3" strokeWidth="1.2" />
              <circle cx="190" cy="80" r="8" className="fill-primary" />
              {youR != null && <><line x1="190" y1="80" x2={190 - youR * 0.7} y2={80 + youR * 0.7} className="stroke-success" strokeWidth="1" /><circle cx={190 - youR * 0.7} cy={80 + youR * 0.7} r="5" className="fill-success stroke-card" strokeWidth="1.5" /></>}
            </svg>
            <div className="absolute left-3 top-3 space-y-1.5 rounded-xl border bg-card/90 p-3 text-xs">
              <p className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-primary" /> Office</p>
              <p className="flex items-center gap-2"><CircleDot className="h-3.5 w-3.5 text-success" /> Your Location</p>
              <p className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded border border-dashed border-success" /> Geofence ({result?.radius_m ?? "—"} m)</p>
            </div>
          </div>

          <div className="mt-5 flex flex-col items-center gap-2">
            <Button size="lg" onClick={enable} disabled={busy} className="h-14 w-full max-w-md rounded-full bg-gradient-to-r from-primary to-success text-base font-bold uppercase tracking-wide">
              {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : error ? <RotateCcw className="mr-2 h-5 w-5" /> : <Crosshair className="mr-2 h-5 w-5" />}
              {error ? "Try again" : result ? "Re-check location" : "Verify my location"} <ChevronsRight className="ml-2 h-5 w-5" />
            </Button>
            <Link to="/dashboard" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {result ? <>Continue to dashboard <ArrowRight className="h-3.5 w-3.5" /></> : "Continue with limited access (no check-in)"}
            </Link>
          </div>
        </section>

        {/* Right */}
        <aside className="space-y-5">
          <div className="rounded-3xl border bg-card/80 p-5 shadow-card">
            <h3 className="font-display text-lg font-bold">Verification Steps</h3>
            <ol className="mt-4 space-y-4">
              {steps.map((s, i) => {
                const n = i + 1; const done = n < step || (n === 4 && inside && false); const cur = n === step;
                return (
                  <li key={s.t} className={`flex items-center gap-3 rounded-xl p-2 ${cur ? "bg-primary/20 ring-1 ring-primary/50" : ""}`}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-success bg-success text-primary-foreground" : cur ? "border-primary bg-primary/30" : "border-muted-foreground/40"}`}>{done && <CheckCircle2 className="h-4 w-4" />}</span>
                    <div><p className="text-sm font-semibold">{s.t}</p><p className="text-xs text-muted-foreground">{s.d}</p></div>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="rounded-3xl border bg-card/80 p-5 shadow-card">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Activity className="h-5 w-5 text-primary" /> Live Status</h3>
            <p className="mt-3 flex items-center gap-2 text-sm"><span className={`h-3 w-3 rounded-full ${fix ? "bg-success" : "bg-muted-foreground/50"}`} /> {fix ? "Location Active" : "Location not read yet"}</p>
            <svg viewBox="0 0 200 40" className="mt-2 h-10 w-full"><path d="M0 30 Q15 10 30 28 T60 26 T90 14 T120 28 T150 12 T180 26 T200 8" fill="none" className={fix ? "stroke-success" : "stroke-muted-foreground/40"} strokeWidth="2" /></svg>
          </div>
          <div className="rounded-3xl border bg-card/80 p-5 shadow-card">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold"><ShieldCheck className="h-5 w-5 text-primary" /> Privacy & Security</h3>
            <p className="mt-2 flex items-end gap-3 text-sm text-muted-foreground">Your location is accessed only during attendance verification. Background tracking is disabled.<Lock className="h-8 w-8 shrink-0 text-primary" /></p>
          </div>
        </aside>
      </main>
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof MapPin; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border bg-background/40 px-3 py-2.5">
      <dt className="flex items-center gap-2 text-foreground"><Icon className="h-4 w-4 text-primary" />{label}</dt>
      <dd className="font-medium tabular-nums text-foreground">{children}</dd>
    </div>
  );
}
