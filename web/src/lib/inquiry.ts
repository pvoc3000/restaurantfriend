/**
 * The public inquiry form's rules — decision 18 of docs/special-orders-brief.md.
 *
 * Pure, so every one of them can be broken in a fixture rather than in front of
 * a customer. Nothing here touches the DB, React or the DOM.
 *
 * ---------------------------------------------------------------------------
 * THESE RULES ARE STATED TWICE, ON PURPOSE
 * ---------------------------------------------------------------------------
 * Migration 057's `create_inquiry` enforces the same validation in SQL, because
 * it is the gate and a form is only ever a courtesy — anyone can POST past it.
 * So this module is not the authority; it exists so a person is told what is
 * wrong beside the field rather than after a round trip.
 *
 * The pair has to be kept in step by hand. If you change a rule here, change it
 * in 057 too, and vice versa: the fixtures pin this side and the Docker harness
 * pins that one.
 */

/** Every state `create_inquiry` can answer with, and the two the transport can
 *  add. The page never composes a sentence from a code — see
 *  `inquiryStateMessage`. */
export type InquiryState =
  | "created"
  | "received"
  | "unknown_org"
  | "name_required"
  | "contact_required"
  | "email_invalid"
  | "date_invalid"
  | "time_invalid"
  | "fulfillment_invalid";

export type InquiryFulfillment = "pickup" | "delivery";

export type InquiryDraft = {
  name: string;
  email: string;
  phone: string;
  occasion: string;
  fulfillment: InquiryFulfillment;
  address: string;
  locationId: string;
  eventDate: string;
  eventTime: string;
  interest: string;
  description: string;
  allergies: string;
};

export const EMPTY_INQUIRY: InquiryDraft = {
  name: "",
  email: "",
  phone: "",
  occasion: "",
  fulfillment: "pickup",
  address: "",
  locationId: "",
  eventDate: "",
  eventTime: "",
  interest: "",
  description: "",
  allergies: "",
};

/**
 * The coarse "What are you interested in?" vocabulary, taken verbatim from the
 * Square form this replaces so a returning customer sees the same words.
 *
 * It survives the arrival of a build-your-box picker rather than being replaced
 * by it: most of this shop's work is custom, and no picker expresses "spell WE'RE
 * PREGNANT! in letter donuts". This is what somebody choosing to describe
 * instead of build still gets to say.
 */
export const INQUIRY_INTEREST_OPTIONS = [
  "Regular Donuts",
  "Miniature Donuts",
  "Giant Donuts",
  "Donut Letters",
  "Donut Cake",
  "Vegan / Gluten-free",
  "Something else",
] as const;

/** A shop as the public sees it — `inquiry_shops` returns exactly this. */
export type InquiryShop = { id: string; name: string };

/**
 * Shape-only, deliberately. There is no regex that decides whether an address
 * receives mail, and every attempt to write a strict one turns away somebody
 * with a legitimate address. The confirmation email is the real test, which is
 * one of the three reasons decision 18 sends it.
 */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  if (!v || /\s/.test(v)) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

/** The digits, and only the digits — the same normalisation `create_inquiry`
 *  matches customers on, and the reason '(323) 630-0095' and '323.630.0095' are
 *  one person. */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Seven digits is the shortest thing that could be a phone number; below that
 *  it is somebody typing an area code and stopping. */
export function looksLikePhone(value: string): boolean {
  return phoneDigits(value).length >= 7;
}

/**
 * A DATE, checked by ROUND TRIP rather than by regex.
 *
 * `new Date("2026-02-31")` does not fail — it rolls over to March 2nd — so a
 * shape test alone accepts a day that does not exist and a `Date` test alone
 * silently moves it. Building the date and formatting it back is the only check
 * that catches both, and it is the same one `invoiceDeliveryDate` makes for the
 * same reason.
 *
 * Also note the parts are read off the STRING and the date is built in UTC. A
 * local-time `new Date("2026-08-16")` is midnight UTC, which west of Greenwich
 * is the 15th — how a customer's wedding ends up on a document a day early.
 */
export function isRealDate(value: string): boolean {
  const v = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const built = new Date(Date.UTC(y, mo - 1, d));
  return (
    built.getUTCFullYear() === y &&
    built.getUTCMonth() === mo - 1 &&
    built.getUTCDate() === d
  );
}

/** `<input type="time">` yields `HH:MM` or nothing, so this exists for the
 *  values that did not come from one. */
export function isRealTime(value: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return false;
  return Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

export type InquiryErrors = Partial<Record<keyof InquiryDraft, string>>;

/**
 * What is wrong with this draft, keyed by field so the message can sit under
 * the box it is about.
 *
 * REQUIRED: a name, and ONE WAY TO REACH THEM. Everything else is optional,
 * including the date — a lead is the beginning of a conversation, and refusing
 * somebody who has not decided when their party is would turn away exactly the
 * inquiries this shop wants.
 */
export function validateInquiry(draft: InquiryDraft): InquiryErrors {
  const errors: InquiryErrors = {};

  if (!draft.name.trim()) {
    errors.name = "We need a name to call you by.";
  }

  const hasEmail = draft.email.trim() !== "";
  const hasPhone = draft.phone.trim() !== "";

  if (hasEmail && !looksLikeEmail(draft.email)) {
    errors.email = "That doesn’t look like an email address.";
  }
  if (hasPhone && !looksLikePhone(draft.phone)) {
    errors.phone = "That doesn’t look like a phone number.";
  }
  if (!hasEmail && !hasPhone) {
    // Named on the EMAIL field rather than both, because asking for one of two
    // things in two places reads as two problems. Email is the one we prefer —
    // it is what the confirmation and the quote go to.
    errors.email = "An email address or a phone number — either will do.";
  }

  if (draft.eventDate.trim() && !isRealDate(draft.eventDate)) {
    errors.eventDate = "That date doesn’t exist.";
  }
  if (draft.eventTime.trim() && !isRealTime(draft.eventTime)) {
    errors.eventTime = "That time doesn’t look right.";
  }

  return errors;
}

export function inquiryIsSubmittable(draft: InquiryDraft): boolean {
  return Object.keys(validateInquiry(draft)).length === 0;
}

/**
 * What each state MEANS to the person who just pressed the button, in their
 * words rather than ours — `quoteStateMessage`'s shape, and pure for the same
 * reason: a customer reading the wrong sentence here is the one failure of this
 * feature nobody would ever report.
 *
 * NOTE `received` AND `created` READ THE SAME. That is not laziness, it is the
 * privacy rule surfacing: the gate answers `received` for a throttled duplicate
 * and for a swallowed honeypot, and a page that worded those differently would
 * undo in the UI exactly what 057 is careful about in SQL. It also happens to
 * be the honest thing to tell somebody who double-tapped the button.
 */
export function inquiryStateMessage(state: InquiryState | string): {
  title: string;
  body: string;
  ok: boolean;
} {
  switch (state) {
    case "created":
    case "received":
      return {
        ok: true,
        title: "Thank you — we’ve got it",
        body:
          "A real person reads every one of these, and we’ll come back to you " +
          "with a quote. Check your email for a confirmation.",
      };
    case "unknown_org":
      return {
        ok: false,
        title: "Something’s wrong at our end",
        body:
          "This form isn’t configured correctly, which is our fault and not " +
          "yours. Please email us and we’ll take it from there.",
      };
    case "name_required":
      return { ok: false, title: "We need a name", body: "Tell us what to call you." };
    case "contact_required":
      return {
        ok: false,
        title: "We need a way to reach you",
        body: "An email address or a phone number — either will do.",
      };
    case "email_invalid":
      return {
        ok: false,
        title: "That email doesn’t look right",
        body: "Have another look — it’s where your quote will go.",
      };
    case "date_invalid":
      return { ok: false, title: "That date doesn’t exist", body: "Check the day and month." };
    case "time_invalid":
      return { ok: false, title: "That time doesn’t look right", body: "Use a 24-hour time." };
    case "fulfillment_invalid":
      return {
        ok: false,
        title: "Pickup or delivery?",
        body: "Choose one and try again.",
      };
    default:
      return {
        ok: false,
        title: "That didn’t go through",
        body:
          "Something went wrong sending your inquiry. Please try again, or " +
          "email us directly and we’ll pick it up from there.",
      };
  }
}

/** The body `submit-inquiry` takes. Kept here rather than in the component so
 *  the wire shape is fixture-tested with everything else — a renamed key is a
 *  field that silently stops arriving. */
export function inquiryPayload(
  draft: InquiryDraft,
  orgId: string,
  honeypot: string
): Record<string, unknown> {
  const orNull = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    org_id: orgId,
    name: draft.name.trim(),
    email: orNull(draft.email),
    phone: orNull(draft.phone),
    occasion: orNull(draft.occasion),
    fulfillment: draft.fulfillment,
    address: orNull(draft.address),
    location_id: orNull(draft.locationId),
    event_date: orNull(draft.eventDate),
    event_time: orNull(draft.eventTime),
    interest: orNull(draft.interest),
    description: orNull(draft.description),
    allergies: orNull(draft.allergies),
    honeypot,
  };
}
