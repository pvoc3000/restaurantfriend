import { AppHeader } from "@/components/AppHeader";
import { getAppSession } from "@/lib/session";

// Everything inside the (app) route group is signed-in + location-scoped.
//
// `panel` is the parallel slot for detail slide-overs: in-app navigation to
// /items/[id] or /vendors/[id] is intercepted into it (see @panel), floating
// the detail over the page you're on instead of replacing it. Hard loads and
// deep links still render the dedicated pages; the slot falls back to null.
export default async function AppLayout({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
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
      {panel}
    </>
  );
}
