// The order guide's `?date=` — the screen's ONE piece of day state (Mark,
// 2026-08-25).
//
// Every case here is a way of losing somebody's walk or filing it under the
// wrong day, which is the failure that prompted the feature: nothing has ever
// deleted a guide entry, but the page only ever asked for TODAY's, so an
// unfinished walk had no route back after midnight.
//
// The two that need pinning hardest are the ones a "tidy-up" would break: a
// rolled-over date must be REFUSED rather than silently accepted as some other
// day, and today must produce the BARE path, which is what keeps the guide at
// one address and the date from being remembered.

import { guideHref, parseGuideDate, weekdayOf } from "../../src/lib/orderGuide";
import { eq, test } from "./harness";

const TODAY = "2026-08-25"; // a Tuesday

test("parseGuideDate: nothing asked for is today", () => {
  eq(parseGuideDate(undefined, TODAY), TODAY);
  eq(parseGuideDate("", TODAY), TODAY);
});

test("parseGuideDate: a past date is taken as given", () => {
  eq(parseGuideDate("2026-08-24", TODAY), "2026-08-24");
  eq(parseGuideDate("2025-01-01", TODAY), "2025-01-01");
});

test("parseGuideDate: today itself is fine", () => {
  eq(parseGuideDate(TODAY, TODAY), TODAY);
});

test("parseGuideDate: the future is allowed", () => {
  // The weekday picker this replaced could reach all seven days, so refusing
  // forward dates would be a capability the single control took AWAY. The
  // consequence is real and lives in the UI instead: generation stamps the
  // guide date onto the PO as its order_date, so the control marks itself
  // whenever the day on screen is not today.
  eq(parseGuideDate("2026-08-28", TODAY), "2026-08-28");
});

test("parseGuideDate: a date that ROLLS OVER is refused, not accepted", () => {
  // `new Date("2026-02-31")` does not throw — it quietly becomes March 2nd.
  // Without the round-trip check this returns "2026-02-31", which Postgres
  // then refuses with a raw cast error in front of somebody mid-walk.
  eq(parseGuideDate("2026-02-31", TODAY), TODAY);
  eq(parseGuideDate("2026-13-01", TODAY), TODAY);
  eq(parseGuideDate("2026-08-32", TODAY), TODAY);
});

test("parseGuideDate: junk is refused", () => {
  eq(parseGuideDate("yesterday", TODAY), TODAY);
  eq(parseGuideDate("2026-8-4", TODAY), TODAY);
  eq(parseGuideDate("2026-08-24T00:00:00Z", TODAY), TODAY);
  eq(parseGuideDate("'; drop table order_guide_entries; --", TODAY), TODAY);
});

test("weekdayOf: ISO, Monday = 1", () => {
  eq(weekdayOf("2026-08-24"), 1); // Monday — the shop's ordering day
  eq(weekdayOf("2026-08-25"), 2); // Tuesday
  eq(weekdayOf("2026-08-31"), 1); // Monday
});

test("guideHref: today is the BARE path, so the guide keeps one address", () => {
  // Also what stops the date being sticky: the nav link, the back-trail and a
  // Today reset all resolve to the same url, which carries no day at all.
  eq(guideHref(TODAY, TODAY), "/order-guide");
});

test("guideHref: any other day carries its date and nothing else", () => {
  // One axis. There is no `?day=`: the weekday is derived from the date, so a
  // second parameter could only ever contradict it.
  eq(guideHref("2026-08-24", TODAY), "/order-guide?date=2026-08-24");
  eq(guideHref("2026-08-28", TODAY), "/order-guide?date=2026-08-28");
});
