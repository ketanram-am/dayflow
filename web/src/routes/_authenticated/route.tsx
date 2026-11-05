import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireUser } from "@/lib/session";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => ({ user: await requireUser() }),
  component: () => <Outlet />,
});
