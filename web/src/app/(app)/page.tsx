import { redirect } from "next/navigation";

/**
 * THE APP LANDS ON THE LOCATIONS LIST (Mark, 2026-08-20: "can you make the
 * landing page for the app the locations page").
 *
 * `/` had been a leftover from the skeleton — a heading, the signed-in email,
 * a sentence pointing at Locations and a single "Vendors →" link, none of which
 * anybody has needed since the nav grew two tiers. Landing on the shop list
 * instead makes the first question the app asks the first question of the day:
 * which shop are you working at. Every location-scoped screen below reads that
 * answer (design rule 3), and `/locations` is where you give it.
 *
 * A REDIRECT, NOT A COPY OF THE LIST — the pattern `/location` and
 * `/pay-periods` already use. `/` stays the canonical landing address, which
 * matters because three things point at it and none should have to know where
 * home is: the masthead's Home icon, `proxy.ts` (which sends a signed-in user
 * hitting /login to `/`), and the login form's own `router.replace("/")`.
 * Moving home later is this one line again.
 *
 * NO `loading.tsx` BESIDE IT, deliberately: a redirect thrown during render
 * never paints, so a loading file here would announce a screen that does not
 * exist. `/locations` has its own.
 */
export default function HomePage() {
  redirect("/locations");
}
