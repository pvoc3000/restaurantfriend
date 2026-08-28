import { CalcPad } from "@/components/ui/CalcPad";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { getAppSession } from "@/lib/session";

/**
 * The chrome-less, signed-in shell.
 *
 * The shift report runs full screen on an iPad at the end of a shift — no
 * masthead, no nav, no page gutter — so it cannot live in `(app)`, whose
 * layout supplies all three. It is the FIRST chrome-less route in the app that
 * is also signed in: `/login`, `/welcome`, `/q/[token]` and `/inquiry` are all
 * public, which is why none of them is a precedent for the session call below.
 *
 * `proxy.ts` needs NO change. It exempts those four by name and bounces
 * everything else to /login, so a route group it has never heard of is already
 * gated — and `getAppSession()` redirects on its own if it somehow is not.
 *
 * Two things are kept from `(app)` and each earns its place:
 *   · ConfirmProvider, because Cancel asks a destructive question and
 *     `confirmDialog` resolves against whichever provider is mounted.
 *   · CalcPad, because the counting pages are numeric fields on a touch
 *     device, which is the whole reason that component exists.
 *
 * Deliberately NOT kept: `InactiveLocationGate` (a report already written for a
 * shop that has since closed must still be finishable) and `ScrollMemory`
 * (each page of the runner is its own short screen; there is no long list to
 * come back to).
 */
export default async function FullscreenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Not for the props — the pages fetch their own — but because this is what
  // redirects a signed-out request, and because it is cached, so the page's own
  // call costs nothing.
  await getAppSession();

  return (
    <ConfirmProvider>
      <div className="flex min-h-screen flex-col bg-white">{children}</div>
      <CalcPad />
    </ConfirmProvider>
  );
}
