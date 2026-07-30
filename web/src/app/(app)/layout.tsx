import { AppHeader } from "@/components/AppHeader";
import { getAppSession } from "@/lib/session";

// Everything inside the (app) route group is signed-in + location-scoped.
//
// Detail views are FULL SCREEN (Mark, 2026-07-30). They were slide-overs
// floated over the list by a @panel parallel slot with intercepting routes;
// that slot is gone, so /items/[id] & co. are ordinary pages reached the
// ordinary way, and breadcrumbs (which the panel had to hide) lead back.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAppSession();

  return (
    <>
      <AppHeader session={session} />
      {/* The page gutter. 48px on a desk, 16px below 1280 — an iPad portrait
          window has no 96px to spare, and the order guide's row is the widest
          thing in the app (Mark, 2026-07-29: "we should be designing responsive
          pages where the table is never wider than the window"). The masthead,
          its collapsed strip and the ActionBar carry the SAME pair, so the four
          black-and-white bands stay aligned at every width. */}
      <main className="flex-1 px-4 py-8 xl:px-12">{children}</main>
    </>
  );
}
