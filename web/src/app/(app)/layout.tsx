import { AppHeader } from "@/components/AppHeader";
import { CalcPad } from "@/components/ui/CalcPad";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { IdleLock } from "@/components/IdleLock";
import { InactiveLocationGate } from "@/components/InactiveLocationGate";
import { PageAccessGate } from "@/components/PageAccessGate";
import { ScrollMemory } from "@/components/ScrollMemory";
import { ShellProvider } from "@/components/ShellProvider";
import { TabletBar } from "@/components/tablet/TabletBar";
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
    // Every confirm in the app is asked through this (Mark, 2026-08-10) — one
    // panel, so a call site is a line rather than its own dialog. It wraps the
    // whole shell because the questions are asked from the masthead's drawers
    // as well as from the page.
    <ConfirmProvider>
      <ShellProvider shell={session.shell}>
      {/* TWO SHELLS OVER ONE ROUTE TREE (Mark, 2026-09-09). The desk gets the
          masthead and its two-tier menu; a tablet gets one black bar and a
          landing page of actions (`/start`). `session.shell` decides — the
          `rf.shell` cookie, defaulting to tablet on a registered shared iPad.
          Both publish `--rf-header-h`, so every sticky table head below is
          right under either. */}
      {session.shell === "tablet" ? (
        <TabletBar
          locations={session.workableLocations}
          working={session.activeLocation}
          registeredDevice={session.registeredDevice}
        />
      ) : (
        <AppHeader session={session} />
      )}
      {/* The page gutter. 48px on a desk, 16px below 1280 — an iPad portrait
          window has no 96px to spare, and the order guide's row is the widest
          thing in the app (Mark, 2026-07-29: "we should be designing responsive
          pages where the table is never wider than the window"). The masthead,
          its collapsed strip and the ActionBar carry the SAME pair, so the four
          black-and-white bands stay aligned at every width. */}
      <main className="flex-1 px-4 py-8 xl:px-12">
        {/* The Page Permissions sheet, applied to a typed URL: the menu hides
            a screen from a role, and this says so in a sentence for anyone who
            reaches it anyway. OUTSIDE the location gate, because "you may not
            open this" is the more fundamental of the two answers. */}
        <PageAccessGate role={session.membership.role}>
          {/* You can deactivate the shop you're standing in, right from the
              Locations list — so every screen but /locations has to answer for
              a closed one. See InactiveLocationGate. */}
          <InactiveLocationGate
            code={session.activeLocation?.code ?? null}
            isActive={session.activeLocation?.is_active ?? true}
            locationId={session.activeLocation?.id ?? null}
          >
            {children}
          </InactiveLocationGate>
        </PageAccessGate>
      </main>
      {/* Renders nothing; remembers where you were on every screen. AFTER the
          page, so a screen publishing its own scroll key has already done so by
          the time this one's effect runs (effects go child-first, siblings in
          order). */}
      <ScrollMemory locationId={session.activeLocation?.id ?? null} />
      {/* Also renders nothing until a `data-rf-calc` field is focused on a
          touch device — then it IS the keyboard: digits and operators
          together, so `lib/calc` expressions are typeable on an iPad. */}
      <CalcPad />
      {/* A registered shared iPad locks back to its picker after five
          minutes idle. Nothing on a desk browser — the session only says
          `registeredDevice` when the device cookie is present. */}
      {session.registeredDevice && <IdleLock />}
      </ShellProvider>
    </ConfirmProvider>
  );
}
