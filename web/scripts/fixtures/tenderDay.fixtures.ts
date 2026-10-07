// `supabase/functions/_shared/tenderDay.ts` — which shop-day a Square payment
// is counted on. A payment follows the date of its SALE (Mark, 2026-10-07):
// the DF01 HP register was offline on the evening of 2026-10-06, its payments
// reached Square at 6:35 the next morning, and that day's journal entry was
// refused $458.85 apart.

import { eq, test } from "./harness";
import {
  addDays,
  chunkDays,
  hourReportingDay,
  orderDays,
  orderKey,
  tenderDay,
} from "../../../supabase/functions/_shared/tenderDay";

const DF01 = "FDP4EYJ4SG1CY";

test("hourReportingDay: the day rolls at 1:00 AM local", () => {
  eq(hourReportingDay("2026-10-07T00:00:00.000", 1), "2026-10-06", "half past midnight is still last night");
  eq(hourReportingDay("2026-10-07T01:00:00.000", 1), "2026-10-07", "1:00 AM opens the day");
  eq(hourReportingDay("2026-10-06T17:00:00.000Z", 1), "2026-10-06", "a trailing Z is the same wall time");
  eq(hourReportingDay("2026-10-01T00:00:00.000", 1), "2026-09-30", "across a month");
  eq(hourReportingDay("not a time", 1), null, "unreadable");
  eq(hourReportingDay(undefined, 1), null, "missing");
});

test("tenderDay: the real offline payment of 2026-10-06 goes back to its sale", () => {
  // Order q6mK3vgqHE4i4n0i4RVrE3ukSB6YY: rung up 5:20 PM on the 6th, its card
  // payment processed 6:35 AM on the 7th.
  const days = orderDays([{ loc: DF01, orderId: "q6mK3vgqHE4i4n0i4RVrE3ukSB6YY", day: "2026-10-06" }]);
  const ownDay = hourReportingDay("2026-10-07T06:00:00.000", 1)!;
  eq(ownDay, "2026-10-07", "the payment's own day");
  eq(
    tenderDay({ ownDay, type: "PAYMENT", orderDay: days.get(orderKey(DF01, "q6mK3vgqHE4i4n0i4RVrE3ukSB6YY")) }),
    "2026-10-06",
    "counted with the sale"
  );
});

test("tenderDay: a refund stays on the day it was given", () => {
  eq(tenderDay({ ownDay: "2026-10-07", type: "REFUND", orderDay: "2026-10-06" }), "2026-10-07");
});

test("tenderDay: a payment with no order in Sales keeps its own day", () => {
  eq(tenderDay({ ownDay: "2026-10-07", type: "PAYMENT", orderDay: undefined }), "2026-10-07");
});

test("tenderDay: an ordinary payment does not move", () => {
  eq(tenderDay({ ownDay: "2026-10-06", type: "PAYMENT", orderDay: "2026-10-06" }), "2026-10-06");
});

test("orderDays: per shop, and an order on two days is left out", () => {
  const days = orderDays([
    { loc: "A", orderId: "1", day: "2026-10-06" },
    { loc: "A", orderId: "1", day: "2026-10-06" },
    { loc: "B", orderId: "1", day: "2026-10-05" },
    { loc: "A", orderId: "2", day: "2026-10-06" },
    { loc: "A", orderId: "2", day: "2026-10-07" },
    { loc: "A", orderId: "", day: "2026-10-07" },
  ]);
  eq(days.get(orderKey("A", "1")), "2026-10-06", "the same day twice is one day");
  eq(days.get(orderKey("B", "1")), "2026-10-05", "the same id at another shop is another order");
  eq(days.get(orderKey("A", "2")), undefined, "two days: not guessed");
  eq(days.size, 2, "nothing for a blank id");
});

test("chunkDays: consecutive, no gap, no overlap, the last one short", () => {
  eq(chunkDays("2026-10-06", "2026-10-06", 14), [["2026-10-06", "2026-10-06"]], "one day");
  eq(
    chunkDays("2026-09-29", "2026-10-20", 14),
    [["2026-09-29", "2026-10-12"], ["2026-10-13", "2026-10-20"]],
    "22 days"
  );
  eq(chunkDays("2026-10-01", "2026-10-14", 14).length, 1, "exactly one piece");
  eq(chunkDays("2026-10-07", "2026-10-06", 14), [], "an empty range");
  eq(addDays("2026-02-28", 1), "2026-03-01", "addDays crosses a month");
});
