// The order guide's `?date=` — which day's walk is on screen (Mark, 2026-08-25).
//
// Every case here is a way of losing somebody's walk or filing it under the
// wrong day, which is the failure that prompted the feature: nothing has ever
// deleted a guide entry, but the page only ever asked for TODAY's, so an
// unfinished walk had no route back after midnight.
//
// The two that need pinning hardest are the ones a "tidy-up" would break:
// a rolled-over date must be REFUSED rather than silently accepted as some
// other day, and a day chip must CARRY the date it was clicked on.

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

test("parseGuideDate: the future falls back to today", () => {
  // A guide entry records a walk you DID, and generation stamps the guide date
  // onto the PO as its order date — so a forward-dated walk produces an order
  // claiming to have been placed on a day that has not happened.
  eq(parseGuideDate("2026-08-26", TODAY), TODAY);
  eq(parseGuideDate("2099-12-31", TODAY), TODAY);
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

test("guideHref: today writes no date, so the guide keeps one address", () => {
  eq(guideHref({ date: TODAY, day: 2, today: TODAY }), "/order-guide?day=2");
});

test("guideHref: another date rides along", () => {
  eq(
    guideHref({ date: "2026-08-24", day: 1, today: TODAY }),
    "/order-guide?day=1&date=2026-08-24"
  );
});

test("guideHref: a day chip KEEPS the date it was clicked on", () => {
  // The chips were bare `/order-guide?day=N`. Left that way, picking a filter
  // day while reviewing Monday's walk silently drops you back onto today's —
  // with the quantities you were looking at gone from the screen.
  eq(
    guideHref({ date: "2026-08-24", day: 3, today: TODAY }),
    "/order-guide?day=3&date=2026-08-24"
  );
});
