// The order's conversation subject (migration 167) — the server copy in
// `supabase/functions/_shared/threadSubject.ts` and its browser mirror in
// `lib/specialOrderDocs`, run over the same cases so they cannot drift.

import { eq, test } from "./harness";
import { threadSubject as server } from "../../../supabase/functions/_shared/threadSubject";
import { orderEmailSubject, threadSubject as browser } from "../../src/lib/specialOrderDocs";

const cases: [string | null, { org: string; number: string; title: string | null }, string][] = [
  [null, { org: "Donut Friend", number: "SO-10098", title: "Smith Wedding" }, "Donut Friend SO-10098: Smith Wedding"],
  ["", { org: "Donut Friend", number: "SO-10098", title: "Smith Wedding" }, "Donut Friend SO-10098: Smith Wedding"],
  [null, { org: "Donut Friend", number: "SO-10098", title: null }, "Donut Friend SO-10098"],
  [null, { org: "Donut Friend", number: "SO-10098", title: "  " }, "Donut Friend SO-10098"],
  [null, { org: "Donut Friend", number: "SO-10098", title: "Smith\n  Wedding" }, "Donut Friend SO-10098: Smith Wedding"],
  ["{number} — {title}", { org: "Donut Friend", number: "SO-7", title: "" }, "SO-7"],
  ["Order {number} from {org}", { org: "Donut Friend", number: "SO-7", title: "x" }, "Order SO-7 from Donut Friend"],
  ["{org}: {unknown} {number}", { org: "DF", number: "SO-7", title: "" }, "DF: {unknown} SO-7"],
];

test("threadSubject: Mark's shape, and an order with no title", () => {
  for (const [template, values, want] of cases) {
    eq(server(template, values), want, `server: ${JSON.stringify([template, values])}`);
    eq(browser(template, values), want, `browser: ${JSON.stringify([template, values])}`);
  }
});

test("orderEmailSubject: a fixed subject wins over the template and a new title", () => {
  eq(
    orderEmailSubject(
      { thread_subject: "Donut Friend SO-10098: Smith Wedding", number: "SO-10098", title: "Smith–Jones Wedding" },
      "Donut Friend",
      {}
    ),
    "Donut Friend SO-10098: Smith Wedding",
    "renaming the order keeps the thread's subject"
  );
  eq(
    orderEmailSubject({ thread_subject: null, number: "SO-10098", title: "Smith Wedding" }, "Donut Friend", {
      special_orders: { thread_subject: "{number} · {title}" },
    }),
    "SO-10098 · Smith Wedding",
    "no thread yet → the org's template"
  );
});
