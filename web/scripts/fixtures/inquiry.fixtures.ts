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
  inquiryIsSubmittable,
  inquiryPayload,
  inquiryStateMessage,
  isRealDate,
  isRealTime,
  looksLikeEmail,
  looksLikePhone,
  phoneDigits,
  validateInquiry,
  type InquiryDraft,
} from "../../src/lib/inquiry";

function draft(over: Partial<InquiryDraft> = {}): InquiryDraft {
  return { ...EMPTY_INQUIRY, name: "Victoria Fay", email: "vlangfay@gmail.com", ...over };
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

test("a name and ONE way to reach them is the whole requirement", () => {
  eq(validateInquiry(draft()), {}, "name + email is enough");
  eq(validateInquiry(draft({ email: "", phone: "(323) 630-0095" })), {}, "name + phone is enough");
  ok(inquiryIsSubmittable(draft({ email: "", phone: "3236300095" })));
});

test("everything else is optional — a lead is the START of a conversation", () => {
  // Turning away somebody who has not decided when their party is would refuse
  // exactly the inquiries this shop wants.
  eq(validateInquiry(draft({ occasion: "", eventDate: "", eventTime: "", description: "" })), {});
});

test("no name is refused", () => {
  ok(validateInquiry(draft({ name: "" })).name);
  ok(validateInquiry(draft({ name: "   " })).name, "whitespace is not a name");
});

test("no way to reach them is ONE message, on the email field", () => {
  const errors = validateInquiry(draft({ email: "", phone: "" }));
  ok(errors.email, "the message lands on email");
  no(errors.phone, "and NOT also on phone — one problem reads as one problem");
});

test("a malformed contact detail is named where it was typed", () => {
  eq(Object.keys(validateInquiry(draft({ email: "nope" }))), ["email"]);
  // A half-typed phone and no email is ONE problem, not two: saying both
  // "that isn't a phone number" and "we need an email or a phone" makes a
  // person hunt for a second mistake they have not made. The precise message
  // wins, and `inquiryIsSubmittable` still refuses.
  eq(Object.keys(validateInquiry(draft({ email: "", phone: "12" }))), ["phone"]);
  no(inquiryIsSubmittable(draft({ email: "", phone: "12" })));
});

test("an impossible date or time is caught before it is posted", () => {
  ok(validateInquiry(draft({ eventDate: "2026-02-31" })).eventDate);
  ok(validateInquiry(draft({ eventTime: "25:00" })).eventTime);
  no(inquiryIsSubmittable(draft({ eventDate: "2026-02-31" })));
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
      "fulfillment", "honeypot", "interest", "location_id", "name", "occasion",
      "org_id", "phone",
    ]
  );
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
