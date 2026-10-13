// `lib/inquiry` — the public form's rules (decision 18).
//
// Every case here was checked by BREAKING the rule it covers and confirming it
// goes red. The two that matter most, because their failure modes are silent:
// the date round trip (a shape test alone accepts February 31st, a `Date` test
// alone moves it), and `inquiryStateMessage` reading `received` and `created`
// identically, which is 057's privacy rule surfacing in the UI.

import { test, eq, ok, no } from "./harness";
import {
  EMPTY_INQUIRY,
  INQUIRY_INTEREST_OPTIONS,
  INQUIRY_REQUIRED,
  inquiryBlackoutNotices,
  inquiryBlackoutOn,
  inquiryIsSubmittable,
  inquiryShopFor,
  inquiryPayload,
  inquiryStateMessage,
  inquiryTimeWindow,
  readInquiryHours,
  isRealDate,
  isRealTime,
  looksLikeEmail,
  looksLikePhone,
  phoneDigits,
  readInquiryBlackouts,
  validateInquiry,
  type InquiryBlackouts,
  type InquiryDraft,
  type InquiryHours,
} from "../../src/lib/inquiry";

function draft(over: Partial<InquiryDraft> = {}): InquiryDraft {
  return { ...EMPTY_INQUIRY, name: "Victoria Fay", email: "vlangfay@gmail.com", ...over };
}

/** Every required field filled — 135's rules. */
function full(over: Partial<InquiryDraft> = {}): InquiryDraft {
  return draft({
    phone: "(323) 630-0095",
    occasion: "Birthday",
    eventDate: "2026-10-30",
    eventTime: "10:00",
    ...over,
  });
}

/* -------------------------------------------------------------------------
 * Email
 * ---------------------------------------------------------------------- */

test("email: ordinary addresses pass", () => {
  ok(looksLikeEmail("vlangfay@gmail.com"));
  ok(looksLikeEmail("alfreeed_12@yahoo.com"));
  ok(looksLikeEmail("bibijohnson2143@gmail.com"));
  ok(looksLikeEmail("  trimmed@example.com  "), "surrounding space is trimmed");
});

test("email: the shapes that are not addresses", () => {
  no(looksLikeEmail(""));
  no(looksLikeEmail("nobody"));
  no(looksLikeEmail("nobody@"));
  no(looksLikeEmail("@example.com"));
  no(looksLikeEmail("no domain@example"), "a space anywhere disqualifies");
  no(looksLikeEmail("two@at@example.com"));
  no(looksLikeEmail("nobody@example"), "a bare hostname has no dot");
});

/* -------------------------------------------------------------------------
 * Phone — the same normalisation `create_inquiry` matches customers on
 * ---------------------------------------------------------------------- */

test("phone: every punctuation style in the real data reduces to the digits", () => {
  eq(phoneDigits("(917) 721-9123"), "9177219123");
  eq(phoneDigits("323.630.0095"), "3236300095");
  eq(phoneDigits("323) 485-2621"), "3234852621", "real data holds this exact mangling");
  eq(phoneDigits("3236300095"), "3236300095");
});

test("phone: seven digits is the floor", () => {
  ok(looksLikePhone("323-630-0095"));
  ok(looksLikePhone("630-0095"), "seven digits, no area code");
  no(looksLikePhone("(323)"), "an area code and a stop");
  no(looksLikePhone(""));
});

/* -------------------------------------------------------------------------
 * The date round trip — the case a regex and a `Date` each get wrong ALONE
 * ---------------------------------------------------------------------- */

test("date: real days pass", () => {
  ok(isRealDate("2026-08-20"));
  ok(isRealDate("2024-02-29"), "a leap day is a day");
  ok(isRealDate("2026-12-31"));
});

test("date: FEBRUARY 31ST — the whole reason this is a round trip", () => {
  // `new Date("2026-02-31")` does NOT throw; it rolls over to March 2nd. A
  // shape check alone accepts it and a Date alone silently moves somebody's
  // event. Only building it and reading the parts back catches it.
  no(isRealDate("2026-02-31"));
  no(isRealDate("2026-04-31"), "April has thirty days");
  no(isRealDate("2025-02-29"), "2025 is not a leap year");
  no(isRealDate("2026-13-01"), "there is no thirteenth month");
  no(isRealDate("2026-00-10"));
  no(isRealDate("2026-08-00"));
});

test("date: only the ISO shape, because that is what the input emits", () => {
  no(isRealDate("8/20/2026"), "a US date is not this input's output");
  no(isRealDate("2026-8-20"), "unpadded");
  no(isRealDate(""));
  no(isRealDate("tomorrow"));
});

test("date: is read off the STRING, never through local time", () => {
  // A local-time `new Date("2026-08-16")` is midnight UTC, which west of
  // Greenwich is the 15th — how a wedding lands on a document a day early.
  // Every date in August must therefore be its own day, in any zone.
  for (let d = 1; d <= 31; d += 1) {
    const iso = `2026-08-${String(d).padStart(2, "0")}`;
    ok(isRealDate(iso), iso);
  }
});

test("time: 24-hour, and the boundaries", () => {
  ok(isRealTime("00:00"));
  ok(isRealTime("13:30"));
  ok(isRealTime("23:59"));
  no(isRealTime("24:00"));
  no(isRealTime("13:60"));
  no(isRealTime("1:30"), "unpadded");
  no(isRealTime("1:30 PM PT"), "the Square email's own format is not this input's");
  no(isRealTime(""));
});

/* -------------------------------------------------------------------------
 * validateInquiry — what a lead is allowed to be missing
 * ---------------------------------------------------------------------- */

test("REQUIRED (135, Mark 2026-09-24): name, email, phone, occasion, date, time", () => {
  eq(validateInquiry(full()), {}, "all six is enough");
  ok(inquiryIsSubmittable(full()));
  eq(INQUIRY_REQUIRED, ["name", "email", "phone", "occasion", "eventDate", "eventTime"]);
  for (const k of INQUIRY_REQUIRED) {
    eq(Object.keys(validateInquiry(full({ [k]: "" }))), [k], `${k} missing is exactly one problem, on ${k}`);
    eq(Object.keys(validateInquiry(full({ [k]: "   " }))), [k], `${k} as whitespace is missing`);
  }
});

test("everything else stays optional", () => {
  eq(validateInquiry(full({ address: "", locationId: "", description: "", allergies: "", interest: "" })), {});
});

test("a DELIVERY needs an address (136); a pickup never does", () => {
  eq(Object.keys(validateInquiry(full({ fulfillment: "delivery", address: "" }))), ["address"]);
  eq(Object.keys(validateInquiry(full({ fulfillment: "delivery", address: "  " }))), ["address"]);
  eq(validateInquiry(full({ fulfillment: "delivery", address: "5107 York Blvd" })), {});
  eq(validateInquiry(full({ fulfillment: "pickup", address: "" })), {});
});

test("email and phone are each their OWN problem now", () => {
  eq(Object.keys(validateInquiry(full({ email: "", phone: "" }))).sort(), ["email", "phone"]);
});

test("a malformed contact detail is named where it was typed", () => {
  eq(Object.keys(validateInquiry(full({ email: "nope" }))), ["email"]);
  eq(Object.keys(validateInquiry(full({ phone: "12" }))), ["phone"]);
  no(inquiryIsSubmittable(full({ phone: "12" })));
});

test("an impossible date or time is caught before it is posted", () => {
  ok(validateInquiry(full({ eventDate: "2026-02-31" })).eventDate);
  ok(validateInquiry(full({ eventTime: "25:00" })).eventTime);
  no(inquiryIsSubmittable(full({ eventDate: "2026-02-31" })));
});

/* -------------------------------------------------------------------------
 * THE PRIVACY RULE, surfacing in the UI
 * ---------------------------------------------------------------------- */

test("`received` and `created` are indistinguishable to the reader", () => {
  // 057 answers `received` for a throttled duplicate AND for a swallowed
  // honeypot. A page that worded those differently would undo in the UI exactly
  // what the migration is careful about in SQL — and it would also tell
  // somebody who double-tapped that their inquiry did not go through.
  eq(inquiryStateMessage("created"), inquiryStateMessage("received"));
  ok(inquiryStateMessage("created").ok);
  ok(inquiryStateMessage("received").ok);
});

test("every refusal has its own words, and none of them is a code", () => {
  const states = [
    "unknown_org", "name_required", "contact_required",
    "email_invalid", "date_invalid", "time_invalid", "fulfillment_invalid",
    "email_required", "phone_required", "phone_invalid", "occasion_required",
    "date_required", "time_required", "address_required",
  ];
  for (const s of states) {
    const m = inquiryStateMessage(s);
    no(m.ok, s);
    ok(m.title.length > 0, `${s} has a title`);
    ok(m.body.length > 0, `${s} has a body`);
    no(m.title.includes("_"), `${s} does not leak its own name`);
  }
});

test("an unrecognised state still says something useful", () => {
  // A state added to the SQL and not to this file must not render blank.
  const m = inquiryStateMessage("something_new_in_058");
  no(m.ok);
  ok(m.title.length > 0);
  ok(m.body.length > 0);
});

/* -------------------------------------------------------------------------
 * The wire shape
 * ---------------------------------------------------------------------- */

test("the payload's keys are the ones `submit-inquiry` reads", () => {
  // A renamed key is a field that silently stops arriving, which is invisible
  // until somebody notices a lead with no allergies on it.
  eq(
    Object.keys(inquiryPayload(EMPTY_INQUIRY, "org-1", "")).sort(),
    [
      "address", "allergies", "description", "email", "event_date", "event_time",
      "fulfillment", "honeypot", "interest", "items", "location_id", "name", "occasion",
      "org_id", "phone",
    ]
  );
});

test("the address goes only with a DELIVERY (Mark, 2026-09-24: hidden for pickup)", () => {
  eq(inquiryPayload(draft({ fulfillment: "pickup", address: "5107 York Blvd" }), "o", "").address, null);
  eq(inquiryPayload(draft({ fulfillment: "delivery", address: " 5107 York Blvd " }), "o", "").address, "5107 York Blvd");
});

test("a DELIVERY's shop is the nearest one the estimate found, never a stale pickup pick", () => {
  // Mark, 2026-10-01: delivery is measured from the kitchen, and a website
  // delivery's kitchen is the nearest shop.
  const picked = draft({ fulfillment: "pickup", locationId: "df01" });
  eq(inquiryPayload(picked, "o", "", null, "df02").location_id, "df01", "a pickup sends its own shop");
  const switched = draft({ fulfillment: "delivery", locationId: "df01", address: "1 Main St" });
  eq(inquiryPayload(switched, "o", "", null, "df02").location_id, "df02", "a delivery sends the nearest");
  eq(inquiryPayload(switched, "o", "").location_id, null, "and nothing when there was no estimate");
});

test("empty optional fields go as null, never as empty strings", () => {
  const p = inquiryPayload(draft({ occasion: "  " }), "org-1", "");
  eq(p.occasion, null, "whitespace is nothing");
  eq(p.address, null);
  eq(p.location_id, null);
  eq(p.event_date, null);
  eq(p.name, "Victoria Fay");
  eq(p.email, "vlangfay@gmail.com");
});

test("the honeypot rides in the payload rather than being decided here", () => {
  // The gate holds the whole rule (057), so a client that skipped this check
  // gains nothing. What the form must do is REPORT what was in the field.
  eq(inquiryPayload(EMPTY_INQUIRY, "org-1", "spam").honeypot, "spam");
  eq(inquiryPayload(EMPTY_INQUIRY, "org-1", "").honeypot, "");
});

test("fulfillment always has a value, because the column is NOT NULL", () => {
  eq(inquiryPayload(EMPTY_INQUIRY, "org-1", "").fulfillment, "pickup");
  eq(inquiryPayload(draft({ fulfillment: "delivery" }), "org-1", "").fulfillment, "delivery");
});

test("the interest vocabulary is the Square form's own", () => {
  // Measured off the three real submissions: 'Miniature Donuts' and
  // 'Donut Letters' are values customers have already seen.
  ok(INQUIRY_INTEREST_OPTIONS.includes("Miniature Donuts"));
  ok(INQUIRY_INTEREST_OPTIONS.includes("Donut Letters"));
});

/* -------------------------------------------------------------------------
 * Blackout dates (migrations 181, 182)
 *
 * Checked by BREAKING: dropping the fall to `default_location_id` lets a
 * no-preference inquiry through a DF01-only blackout that `create_inquiry`
 * would refuse; and removing the `unavailable` branch from `validateInquiry`
 * turns the typed-date case red.
 * ---------------------------------------------------------------------- */

const BLACKOUTS: InquiryBlackouts = {
  default_location_id: "df01",
  shop_ids: ["df01", "df02"],
  entries: [
    { starts_on: "2026-10-30", ends_on: "2026-10-31", location_ids: [] },
    { starts_on: "2026-11-03", ends_on: "2026-11-03", location_ids: ["df01"] },
    { starts_on: "2026-11-05", ends_on: "2026-11-05", location_ids: ["df02"] },
    { starts_on: "2026-11-07", ends_on: "2026-11-07", location_ids: ["df01"] },
    { starts_on: "2026-11-07", ends_on: "2026-11-07", location_ids: ["df02"] },
  ],
};

test("blackouts: an every-shop entry refuses the date whatever the shop", () => {
  eq(inquiryBlackoutOn(BLACKOUTS, "2026-10-31", "df02")?.starts_on, "2026-10-30");
  eq(inquiryBlackoutOn(BLACKOUTS, "2026-10-31", null)?.starts_on, "2026-10-30");
  eq(inquiryBlackoutOn(BLACKOUTS, "2026-11-01", null), null);
});

test("blackouts: a NAMED shop is judged by itself", () => {
  eq(inquiryBlackoutOn(BLACKOUTS, "2026-11-03", "df01")?.starts_on, "2026-11-03");
  eq(inquiryBlackoutOn(BLACKOUTS, "2026-11-03", "df02"), null, "another shop is open");
});

test("blackouts: NO PREFERENCE goes to the shop that is open, and is refused only when none is", () => {
  // DF01 off: not refused — the inquiry goes to DF02.
  eq(inquiryBlackoutOn(BLACKOUTS, "2026-11-03", null), null);
  eq(inquiryShopFor(BLACKOUTS, "2026-11-03"), "df02");
  // DF02 off: stays at the default.
  eq(inquiryBlackoutOn(BLACKOUTS, "2026-11-05", null), null);
  eq(inquiryShopFor(BLACKOUTS, "2026-11-05"), "df01");
  // An ordinary day: the default.
  eq(inquiryShopFor(BLACKOUTS, "2026-11-04"), "df01");
  // Both off, by two separate entries: refused.
  eq(inquiryShopFor(BLACKOUTS, "2026-11-07"), null);
  ok(inquiryBlackoutOn(BLACKOUTS, "2026-11-07", null), "every shop is off");
});

test("blackouts: the up-front notice lists what applies — for no shop, only what closes them all", () => {
  eq(inquiryBlackoutNotices(BLACKOUTS, null).map((e) => e.starts_on), ["2026-10-30"]);
  eq(inquiryBlackoutNotices(BLACKOUTS, "df02").map((e) => e.starts_on), ["2026-10-30", "2026-11-05", "2026-11-07"]);
});

test("blackouts: a typed date is refused under the field — the date, never the reason", () => {
  const unavailable = (date: string) => inquiryBlackoutOn(BLACKOUTS, date, null);
  eq(
    validateInquiry(full({ eventDate: "2026-10-30" }), unavailable).eventDate,
    "We’re sorry, but we are not taking special orders for October 30, 2026.",
  );
  eq(validateInquiry(full({ eventDate: "2026-10-29" }), unavailable), {});
  eq(validateInquiry(full({ eventDate: "2026-10-30" })), {}, "no list, no refusal here");
});

test("blackouts: the gate's refusal has its own words", () => {
  const m = inquiryStateMessage("date_unavailable");
  no(m.ok);
  eq(m.title, "We’re sorry, but we are not taking special orders for that date");
});

test("blackouts: a malformed answer is no blackouts, never a crash", () => {
  eq(readInquiryBlackouts(null), { default_location_id: null, shop_ids: [], entries: [] });
  eq(readInquiryBlackouts([]).entries, []);
  eq(
    readInquiryBlackouts({
      default_location_id: "df01",
      entries: [
        { title: "Internal reason", starts_on: "2026-01-01", ends_on: "2026-01-01" },
        { starts_on: 3 },
        null,
      ],
    }),
    {
      default_location_id: "df01",
      shop_ids: [],
      // A title in the answer (a function older than 191) is DROPPED on the way in.
      entries: [{ starts_on: "2026-01-01", ends_on: "2026-01-01", location_ids: [] }],
    },
  );
});

/* -------------------------------------------------------------------------
 * Opening hours (migration 200)
 *
 * Mark, 2026-10-13: pickup from 30 minutes after opening to 30 minutes before
 * close; a delivery's event time from two hours after opening to close.
 *
 * The hours are the two shops' real ones. Checked by BREAKING: reading the
 * weekday in local time or off by one loses Friday's 10 PM close; dropping the
 * delivery branch gives a delivery the pickup window; and removing the
 * `timeWindow` branch from `validateInquiry` turns the refusals red.
 * ---------------------------------------------------------------------- */

const HOURS: InquiryHours = {
  pickup_after_open_minutes: 30,
  pickup_before_close_minutes: 30,
  delivery_after_open_minutes: 120,
  shops: [
    {
      id: "df01",
      open_days: [1, 2, 3, 4, 5, 6, 7],
      open: ["10:00", "10:00", "10:00", "10:00", "10:00", "10:00", "10:00"],
      close: ["21:00", "21:00", "21:00", "21:00", "22:00", "22:00", "21:00"],
    },
    {
      id: "df02",
      open_days: [1, 2, 3, 4, 5, 6],
      open: ["07:00", "07:00", "07:00", "07:00", "07:00", null, "07:00"],
      close: ["21:00", "21:00", "21:00", "21:00", "21:00", "21:00", "21:00"],
    },
  ],
};

// 2026-11-19 is a Thursday, the 20th a Friday, the 21st a Saturday, the 22nd a Sunday.
test("hours: a pickup is 30 minutes inside opening and close", () => {
  eq(inquiryTimeWindow(HOURS, "df01", "2026-11-19", "pickup"), { earliest: "10:30", latest: "20:30" });
  eq(inquiryTimeWindow(HOURS, "df02", "2026-11-19", "pickup"), { earliest: "07:30", latest: "20:30" });
});

test("hours: a delivery is two hours after opening, up to close", () => {
  eq(inquiryTimeWindow(HOURS, "df01", "2026-11-19", "delivery"), { earliest: "12:00", latest: "21:00" });
  eq(inquiryTimeWindow(HOURS, "df02", "2026-11-19", "delivery"), { earliest: "09:00", latest: "21:00" });
});

test("hours: the weekday is the date's own", () => {
  eq(inquiryTimeWindow(HOURS, "df01", "2026-11-20", "pickup")?.latest, "21:30", "Friday closes at 10");
  eq(inquiryTimeWindow(HOURS, "df01", "2026-11-21", "delivery")?.latest, "22:00", "Saturday too");
  eq(inquiryTimeWindow(HOURS, "df01", "2026-11-22", "pickup")?.latest, "20:30", "Sunday is slot 7");
});

test("hours: the margins are the org's", () => {
  const h = { ...HOURS, pickup_after_open_minutes: 60, pickup_before_close_minutes: 0, delivery_after_open_minutes: 90 };
  eq(inquiryTimeWindow(h, "df01", "2026-11-19", "pickup"), { earliest: "11:00", latest: "21:00" });
  eq(inquiryTimeWindow(h, "df01", "2026-11-19", "delivery"), { earliest: "11:30", latest: "21:00" });
});

test("hours: nothing known is nothing refused", () => {
  eq(inquiryTimeWindow(HOURS, null, "2026-11-19", "pickup"), null, "no shop");
  eq(inquiryTimeWindow(HOURS, "df09", "2026-11-19", "pickup"), null, "a shop with no hours");
  eq(inquiryTimeWindow(HOURS, "df01", "", "pickup"), null, "no date yet");
  eq(inquiryTimeWindow(HOURS, "df01", "2026-02-31", "pickup"), null, "not a date");
  eq(inquiryTimeWindow(HOURS, "df02", "2026-11-21", "pickup"), null, "Saturday has no opening time typed");
  eq(inquiryTimeWindow(HOURS, "df02", "2026-11-22", "pickup"), null, "Sunday is not an open day");
  const short = { ...HOURS, shops: [{ ...HOURS.shops[0], close: Array(7).fill("10:30") }] };
  eq(inquiryTimeWindow(short, "df01", "2026-11-19", "pickup"), null, "margins that leave no window");
});

test("hours: validateInquiry refuses a time outside the window, and says the window", () => {
  const pickup = inquiryTimeWindow(HOURS, "df01", "2026-11-19", "pickup");
  const at = (eventTime: string, over: Partial<InquiryDraft> = {}) =>
    validateInquiry(full({ eventDate: "2026-11-19", eventTime, ...over }), undefined, pickup);
  eq(at("10:29").eventTime, "Pickup is between 10:30 AM and 8:30 PM that day.");
  eq(at("20:31").eventTime, "Pickup is between 10:30 AM and 8:30 PM that day.");
  eq(at("10:30"), {}, "the earliest minute is allowed");
  eq(at("20:30"), {}, "and the latest");

  const delivery = inquiryTimeWindow(HOURS, "df01", "2026-11-19", "delivery");
  const d = (eventTime: string) =>
    validateInquiry(
      full({ eventDate: "2026-11-19", eventTime, fulfillment: "delivery", address: "5107 York Blvd" }),
      undefined,
      delivery,
    );
  eq(d("11:59").eventTime, "We deliver between 12:00 PM and 9:00 PM that day.");
  eq(d("21:00"), {}, "a delivery may arrive at close");
  eq(d("20:45"), {}, "inside the last half hour a pickup may not have");

  eq(validateInquiry(full({ eventTime: "03:00" })), {}, "no window, no refusal here");
  eq(validateInquiry(full({ eventTime: "03:00" }), undefined, null), {});
});

test("hours: the gate's refusal has its own words", () => {
  const m = inquiryStateMessage("time_unavailable");
  no(m.ok);
  eq(m.title, "We can’t do that time");
});

test("hours: a malformed answer is no hours, never a crash", () => {
  eq(readInquiryHours(null).shops, []);
  eq(readInquiryHours({ shops: "x" }).pickup_after_open_minutes, 30);
  eq(
    readInquiryHours({
      delivery_after_open_minutes: 90,
      shops: [{ id: "df01", open_days: [1, "2"], open: ["10:00", null, "nope"], close: null }, { open: [] }, null],
    }),
    {
      pickup_after_open_minutes: 30,
      pickup_before_close_minutes: 30,
      delivery_after_open_minutes: 90,
      shops: [{ id: "df01", open_days: [1], open: ["10:00", null, null], close: [] }],
    },
  );
});

/* -------------------------------------------------------------------------
 * Tomorrow at the earliest (migration 201)
 *
 * Checked by BREAKING: `<` in place of `<=` lets today through.
 * ---------------------------------------------------------------------- */

test("dates: today and earlier are refused, tomorrow is not", () => {
  const on = (eventDate: string) => validateInquiry(full({ eventDate }), undefined, null, "2026-10-13");
  eq(on("2026-10-13").eventDate, "Choose a date after today.", "today");
  eq(on("2026-10-12").eventDate, "Choose a date after today.", "yesterday");
  eq(on("2025-12-31").eventDate, "Choose a date after today.", "last year");
  eq(on("2026-10-14"), {}, "tomorrow");
  eq(validateInquiry(full({ eventDate: "2020-01-01" })), {}, "no today given, no refusal here");
});

test("dates: the gate's refusal has its own words", () => {
  const m = inquiryStateMessage("date_past");
  no(m.ok);
  eq(m.title, "That date is too soon");
});
