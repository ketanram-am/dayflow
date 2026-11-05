import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dayflow Frontend" },
      { name: "description", content: "Dayflow Frontend starter project." },
      { property: "og:title", content: "Dayflow Frontend" },
      { property: "og:description", content: "Dayflow Frontend starter project." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <h1 className="text-2xl font-semibold text-foreground">Dayflow Frontend</h1>
    </main>
  );
}
