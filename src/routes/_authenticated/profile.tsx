import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserRound, KeyRound } from "lucide-react";
import { auth, wf } from "@/lib/api";
import { AppShell, Card, CardTitle } from "@/components/AppShell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordIssues } from "@/lib/validation";
import { useMe } from "@/lib/attendance";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Dayflow" },
      { name: "description", content: "Manage your Dayflow profile." },
      { property: "og:title", content: "Profile — Dayflow" },
      { property: "og:description", content: "Your employee details and password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Profile,
});

function Profile() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data } = useMe(user.id);
  const emp = data?.employee;
  const [name, setName] = useState("");
  const [eid, setEid] = useState("");
  const [pw, setPw] = useState({ current: "", next: "" });
  useEffect(() => { if (emp) { setName(emp.full_name); setEid(emp.employee_id ?? ""); } }, [emp]);
  const isEmail = true; // password sign-in is the only method on the Dayflow backend

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return void toast.error("Enter your full name");
    try {
      await wf.updateEmployee(user.id, { full_name: name.trim() });
    } catch (err) {
      return void toast.error(err instanceof Error ? err.message : "Could not save profile");
    }
    toast.success("Profile saved");
    qc.invalidateQueries({ queryKey: ["me"] });
  }
  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    const issues = passwordIssues(pw.next);
    if (issues.length) return void toast.error(`Password needs: ${issues.join(", ").toLowerCase()}`);
    try {
      await auth.changePassword(pw.current, pw.next);
    } catch (err) {
      return void toast.error(err instanceof Error ? err.message : "Could not change password");
    }
    toast.success("Password changed");
    setPw({ current: "", next: "" });
  }

  return (
    <AppShell user={user} title="Profile">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle icon={UserRound} title="Employee details" />
          <div className="mb-6 flex items-center gap-4">
            <Avatar className="h-16 w-16">
              {emp?.profile_image && <AvatarImage src={emp.profile_image} alt={name} />}
              <AvatarFallback className="bg-primary text-primary-foreground">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-display text-lg font-semibold text-foreground">{emp?.full_name}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <p className="text-xs capitalize text-primary">{data?.isAdmin ? "Administrator" : "Employee"}</p>
            </div>
          </div>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="n">Full name</Label><Input id="n" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="eid">Employee ID</Label><Input id="eid" value={eid} placeholder="EMP-001" readOnly={!!emp?.employee_id} onChange={(e) => setEid(e.target.value)} />{emp?.employee_id && <p className="text-xs text-muted-foreground">Linked to payroll records, so it can't be changed here.</p>}</div>
            <Button type="submit">Save changes</Button>
          </form>
        </Card>
        <Card className="h-fit">
          <CardTitle icon={KeyRound} title="Password" />
          {isEmail ? (
            <form onSubmit={changePw} className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="cp">Current password</Label><Input id="cp" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="np">New password</Label><Input id="np" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
              <Button type="submit" variant="secondary">Change password</Button>
            </form>
          ) : <p className="text-sm text-muted-foreground">Password changes are unavailable for this sign-in method.</p>}
        </Card>
      </div>
    </AppShell>
  );
}
