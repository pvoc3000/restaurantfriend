// Deleting a special order — the refusals and the confirm's words.
//
// These are pure because they are the thing TWO doors must agree about: the
// record's command row and the list's `⋯` both call them, and a delete on this
// table has three separate answers (refuse, ask, ask differently) that a second
// copy would get subtly wrong. Every case below was checked by breaking the
// rule it covers.

import { eq, no, ok, test } from "./harness";
import {
  deleteConfirmMessage,
  deleteRefusal,
  type DeleteContext,
} from "../../src/lib/specialOrderWrites";
import {
  SPECIAL_ORDER_VIEW_KEYS,
  hasViewParams,
  parseSpecialOrderView,
  viewCookieValue,
} from "../../src/lib/specialOrderView";

function ctx(over: Partial<DeleteContext> = {}): DeleteContext {
  return {
    id: "id-1",
    number: "10021",
    kind: "order",
    scheduled: false,
    fromStanding: null,
    madeCount: 0,
    lineCount: 0,
    paymentCount: 0,
    ...over,
  };
}

/* --------------------------------------------------------------------------
 * THE REFUSALS
 * -------------------------------------------------------------------------- */

test("an ordinary order has nothing to refuse", () => {
  eq(deleteRefusal(ctx()), null);
  eq(deleteRefusal(ctx({ lineCount: 4, paymentCount: 2 })), null);
});

test("a MATERIALIZED day is refused, and the refusal names its standing order", () => {
  // 099's whole point: the slot would free and the next top-up would make the
  // donuts again. This must be a refusal and never a confirm you click through.
  const why = deleteRefusal(ctx({ fromStanding: "9762" }));
  ok(why !== null, "a materialized day must be refused");
  ok(why!.includes("9762"), "names the standing order it came from");
  ok(why!.includes("Cancel it instead"), "says what to do instead");
});

test("the materialized refusal OUTRANKS the scheduled one", () => {
  // Both are true of a scheduled wholesale day, and only one of them is about
  // something the app would silently undo. Ordering matters because the reader
  // acts on the first sentence they are given.
  const why = deleteRefusal(ctx({ fromStanding: "9763", scheduled: true }));
  ok(why!.includes("9763"), "the standing order is the one to say");
});

test("a scheduled order is refused, and points at unscheduling", () => {
  const why = deleteRefusal(ctx({ scheduled: true }));
  ok(why !== null, "a scheduled order must be refused");
  ok(why!.includes("Unschedule it first"), "names the way through");
});

test("an order whose standing parent was DELETED is an ordinary order again", () => {
  // 051 makes `standing_order_id` `on delete set null` so the days already made
  // survive their parent. `readDeleteContext` resolves the parent's NUMBER, so
  // an orphan reads as null here — refusing it would strand rows nothing can
  // ever make again.
  eq(deleteRefusal(ctx({ fromStanding: null, madeCount: 0 })), null);
});

/* --------------------------------------------------------------------------
 * THE CONFIRM
 * -------------------------------------------------------------------------- */

test("the confirm NAMES the order, because a row menu is one of its two doors", () => {
  ok(deleteConfirmMessage(ctx()).startsWith("Delete order 10021?"), "names the number");
});

test("it counts what goes, and says nothing about what does not", () => {
  const both = deleteConfirmMessage(ctx({ lineCount: 2, paymentCount: 1 }));
  ok(both.includes("2 lines and 1 payment"), "counts both, pluralised");
  const lines = deleteConfirmMessage(ctx({ lineCount: 1 }));
  ok(lines.includes("1 line,"), "one line is singular");
  no(lines.includes("payment"), "a payment nobody made is not mentioned");
  const bare = deleteConfirmMessage(ctx());
  no(bare.includes("This also removes"), "an empty order removes nothing else");
});

test("a STANDING ORDER is a different question, and says the days survive", () => {
  const m = deleteConfirmMessage(ctx({ kind: "standing_order", number: "9762", madeCount: 15, lineCount: 1 }));
  ok(m.startsWith("Delete standing order 9762?"), "names what it is");
  ok(m.includes("15 orders it has already made are NOT deleted"), "states the survivors");
  ok(m.includes("PAUSE it instead"), "offers the reversible act");
  no(m.includes("CANCELLED"), "cancelling is advice for a DAY, not for a recurrence");
});

test("a standing order that has made nothing does not say so awkwardly", () => {
  const m = deleteConfirmMessage(ctx({ kind: "standing_order", number: "9762", madeCount: 0 }));
  no(m.includes("already made"), "nothing made, nothing to reassure about");
  ok(m.includes("PAUSE it instead"), "the advice still stands");
});

test("a template is called a template", () => {
  ok(deleteConfirmMessage(ctx({ kind: "template", number: "7" })).startsWith("Delete template 7?"));
});

/* --------------------------------------------------------------------------
 * THE REMEMBERED VIEW
 * -------------------------------------------------------------------------- */

test("a request carrying any view key uses its own view, not the cookie's", () => {
  ok(hasViewParams({ view: "past" }), "a dimension counts");
  ok(hasViewParams({ q: "knotted" }), "the search box counts");
  ok(hasViewParams({ sort: "date", dir: "asc" }), "the sort counts");
  // A CLEARED search box is a view somebody chose, and `?q=` is how it reaches
  // the server. Reading it as "no view" would restore the cookie over it.
  ok(hasViewParams({ q: "" }), "an empty value is still a value");
});

test("a bare list, or one carrying only a breadcrumb, falls back to the cookie", () => {
  no(hasViewParams({}), "nothing at all");
  no(hasViewParams({ from: "/customers/1", fromLabel: "Cafe Knotted" }), "crumbs are not a view");
  no(hasViewParams(null), "no params at all");
});

test("the cookie round-trips whatever filterHref wrote, arrays included", () => {
  eq(viewCookieValue("/special-orders?view=all&status=order"), "view=all&status=order");
  // A view cleared back to the defaults writes NO query, and the cookie must
  // say so — otherwise clearing your filters would be undone on the next load.
  eq(viewCookieValue("/special-orders"), "");
  eq(parseSpecialOrderView("view=all&status=order"), { view: "all", status: "order" });
  eq(parseSpecialOrderView(""), {});
  eq(parseSpecialOrderView(undefined), {});
});

test("a repeated key comes back as an array, exactly as it does from the URL", () => {
  // `urlFilterParams` does this, and the two must agree or a view restored from
  // the cookie would differ from the same view restored from the address bar.
  eq(parseSpecialOrderView("kitchen=DF01&kitchen=DF02"), { kitchen: ["DF01", "DF02"] });
});

test("every dimension the list filters by is a recognised view key", () => {
  // Keep in step with `SpecialOrdersList`'s dimensions. A key missing here
  // means a URL carrying only that key is not seen as a view, and the cookie
  // would overwrite it.
  for (const key of ["view", "status", "kind", "kitchen", "pickup", "todo"]) {
    ok((SPECIAL_ORDER_VIEW_KEYS as readonly string[]).includes(key), `${key} is a view key`);
  }
});
