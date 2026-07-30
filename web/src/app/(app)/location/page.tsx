import { getAppSession } from "@/lib/session";
import { LocationDetail } from "./LocationDetail";

// The body lives in LocationDetail; this page is its shell, like the other
// detail screens. Singular and id-less on purpose: it is always the location
// you're working at, and the header switcher — which lists closed locations
// too — is how you get to a different one (Mark, 2026-07-30).
//
// KEYED BY THE LOCATION (Mark, 2026-07-30 — "switching locations kinda updates
// the page but not completely"). Switching is a navigation to the SAME route,
// so React keeps every component instance and a `useState(props)` initialiser
// — which runs once per mount — never sees the new location. Measured: after
// DF01 → DF03 the Active switch still read `aria-checked="true"` beside a
// label that already said "Inactive", and the hours and production mapping
// were DF01's. Everything without state (the name, the addresses, the tax
// rate) updated correctly, which is what made it look like a partial refresh.
//
// The key remounts the subtree instead, so a new location is a new screen and
// no future stateful child can quietly inherit the last one's data. Same fix
// as the order guide's `key={locationId}:${guideDate}` (CLAUDE.md).
// getAppSession is React-cached, so asking for it here costs nothing.
export default async function LocationPage() {
  const session = await getAppSession();
  return <LocationDetail key={session.activeLocation?.id ?? "none"} />;
}
