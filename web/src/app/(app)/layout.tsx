import { AppHeader } from "@/components/AppHeader";
import { InactiveLocationGate } from "@/components/InactiveLocationGate";
import { ScrollMemory } from "@/components/ScrollMemory";
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
      <main className="flex-1 px-4 py-8 xl:px-12">
        {/* The switcher lists closed locations too, so every screen but
            /location has to answer for one. See InactiveLocationGate. */}
        <InactiveLocationGate
          code={session.activeLocation?.code ?? null}
          isActive={session.activeLocation?.is_active ?? true}
          locationId={session.activeLocation?.id ?? null}
        >
          {children}
        </InactiveLocationGate>
      </main>
      {/* Renders nothing; remembers where you were on every screen. AFTER the
          page, so a screen publishing its own scroll key has already done so by
          the time this one's effect runs (effects go child-first, siblings in
          order). */}
      <ScrollMemory locationId={session.activeLocation?.id ?? null} />
    </>
  );
}
