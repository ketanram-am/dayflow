import { createFileRoute, redirect } from "@tanstack/react-router";
import { head } from "@/components/EngineUI";

export const Route = createFileRoute("/_authenticated/resolutions")({
  head: head("Resolution Queue Redirect", "The Dayflow Resolution Queue is available at /queue."),
  beforeLoad: () => { throw redirect({ to: "/queue", statusCode: 301, replace: true }); },
});