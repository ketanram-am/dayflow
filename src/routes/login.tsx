import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MapPin, ShieldCheck } from "lucide-react";
import { auth, ApiError } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import hero from "@/assets/hero-office.jpg";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Dayflow" },
      { name: "description", content: "Sign in to Dayflow, powered by the Dayflow verified timecard backend." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await auth.login(email, password);
      qc.clear();
      navigate({ to: "/dashboard", replace: true });
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-10">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" aria-label="Sign in">
          <Logo />
          <div>
            <h1 className="font-display text-2xl font-semibold">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to check in, plan shifts and request leave.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          {import.meta.env["VITE_SHOW_DEMO_HINT"] !== "0" && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Demo accounts: avery@dayflow.demo (administrator) or e004@dayflow.demo (employee). Synthetic data only.
              Set VITE_SHOW_DEMO_HINT=0 to hide this line.
            </p>
          )}
        </form>
      </div>
      <div className="relative hidden lg:block">
        <img src={hero} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/30 to-transparent" />
        <p className="absolute bottom-10 left-10 right-10 flex items-center gap-2 font-display text-lg font-semibold">
          <MapPin className="h-5 w-5 text-primary-glow" /> Verified location. Verified hours. One audit trail.
        </p>
      </div>
    </div>
  );
}
