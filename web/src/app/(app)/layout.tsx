import { cookies } from "next/headers";

import { AppChrome } from "@/components/AppChrome";
import { AppHeader } from "@/components/AppHeader";
import { InactiveLocationGate } from "@/components/InactiveLocationGate";
import { ScrollMemory } from "@/components/ScrollMemory";
import { SideChrome } from "@/components/SideChrome";
import { CHROME_COOKIE, parseChromeMode } from "@/lib/chromeMode";
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
  // Which navigation chrome — the two black bands or the left rail. Read on the
  // SERVER, so the right one paints first and --rf-nav-w is already correct on
  // the first frame; a client-only preference would flash the wrong chrome and
  // jump the page sideways. See lib/chromeMode. (This doesn't newly opt the
  // route out of static rendering — getAppSession already reads cookies.)
  const chromeMode = parseChromeMode((await cookies()).get(CHROME_COOKIE)?.value);

  return (
    // Both chromes are composed here and picked on the client, so switching is
    // one re-render rather than a round trip. TEMPORARY — see SideChrome for
    // how to delete whichever one loses.
    <AppChrome
      initialMode={chromeMode}
      top={<AppHeader session={session} chromeMode={chromeMode} />}
      side={<SideChrome session={session} chromeMode={chromeMode} />}
    >
      {/* The page gutter. 48px on a desk, 16px below 1280 — an iPad portrait
          window has no 96px to spare, and the order guide's row is the widest
          thing in the app (Mark, 2026-07-29: "we should be designing responsive
          pages where the table is never wider than the window"). The masthead,
          its collapsed strip and the ActionBar carry the SAME pair, so the four
          black-and-white bands stay aligned at every width.
          It's a variable rather than the literal `px-4 xl:px-12` because the
          left navigation rail has to widen the left side without touching the
          right — see globals.css, where the values ARE that literal pair until
          the sidebar chrome is switched on. */}
      <main className="flex-1 py-8 pl-[var(--rf-content-pl)] pr-[var(--rf-content-pr)]">
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
    </AppChrome>
  );
}
