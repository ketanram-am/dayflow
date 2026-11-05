import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/session";
import { LocationPage } from "@/routes/_authenticated/location";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => ({ user: await requireUser() }),
  head: () => ({
    meta: [
      { title: "ZoneLock – Verify Location — Dayflow" },
      { name: "description", content: "Allow location access to verify attendance." },
      { property: "og:title", content: "Enable Location Access — Dayflow" },
      {
        property: "og:description",
        content: "Dayflow verifies check-in against your office geofence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RootLocationPage,
});

function RootLocationPage() {
  return <LocationPage />;
}
