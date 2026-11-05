import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { QuestionsCard } from "@/components/dayflow/Questions";
import { head } from "@/components/EngineUI";

export const Route = createFileRoute("/_authenticated/questions")({
  head: head("Questions for You", "Confirm or correct the times the agent asked you about."),
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  return <AppShell user={user} title="Questions for You"><QuestionsCard employeeId={user.employee_id} showEmpty /></AppShell>;
}
