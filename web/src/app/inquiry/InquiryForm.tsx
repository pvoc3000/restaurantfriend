"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { DateField } from "@/components/ui/DateField";
import { TimePicker } from "@/components/ui/TimePicker";
import { createClient } from "@/lib/supabase/client";
import {
  EMPTY_INQUIRY,
  inquiryPayload,
  inquiryStateMessage,
  validateInquiry,
  type InquiryDraft,
  type InquiryErrors,
  type InquiryShop,
} from "@/lib/inquiry";
import {
  EMPTY_BASKET,
  EMPTY_RULES,
  basketIsEmpty,
  basketLines,
  basketPayload,
  basketProblems,
  estimateTotals,
  readMenu,
  todayIn,
  type Basket,
  type InquiryMenuItem,
  type InquiryRules,
} from "@/lib/inquiryOrder";
import { BasketSummary, OrderBuilder, type DeliveryQuote } from "./OrderBuilder";

/**
 * The customer's whole surface for starting an order.
 *
 * MOBILE-FIRST, because that is where it will be filled in — this link lives on
 * a Square site somebody reached from Instagram on a phone. One column, big
 * type, big targets, no chrome.
 *
 * ---------------------------------------------------------------------------
 * IT FOLLOWS `/q/{token}`, NOT THE APP'S PARTS TABLE
 * ---------------------------------------------------------------------------
 * CLAUDE.md is emphatic that every control in this app is one of ours —
 * `ui/TextInput`, `ui/PickList`, `ui/Checkbox` — and that reaching for a raw
 * `<input>` is nearly always a mistake. That rule is about the SIGNED-IN power
 * tool, whose controls are dense, keyboard-driven and 36px high because a
 * purchaser reads a hundred rows at a desk.
 *
 * The customer-facing surface has its own dress, and `/q/{token}` set it: raw
 * inputs, `h-12`, and `text-[16px]` — sixteen pixels being the exact threshold
 * below which iOS Safari zooms the page on focus, which on a twelve-field form
 * is the difference between usable and infuriating. This is that dress's second
 * page. Do not "fix" it by swapping in the app's controls.
 *
 * ---------------------------------------------------------------------------
 * THE FIELDS ARE THE SQUARE FORM'S, IN ITS ORDER AND ITS WORDS
 * ---------------------------------------------------------------------------
 * Measured off the three real submissions in `FMP Export/Special Orders/`. A
 * customer who has ordered before should recognise the form they are filling
 * in; there is nothing to gain from rewording "Any allergies?".
 *
 * ---------------------------------------------------------------------------
 * THE TWO `<select>`s ARE DELIBERATE, AND THE DATE AND TIME ARE OURS
 * ---------------------------------------------------------------------------
 * CLAUDE.md records that there are no native `<select>`s left in this app,
 * because an OS menu landing in the middle of a screen that looks nothing like
 * it reads as a different application. That argument is about the DESK. On a
 * phone a native select is the platform's own wheel picker — one thumb, no
 * scrolling a 320px panel — and `ui/PickList` portals to the body and
 * positions `fixed`, which is machinery for escaping table cells that this page
 * does not have.
 *
 * The date and time go the OTHER way, to `ui/DateField` / `ui/TimePicker`, and
 * for a reason that is not consistency: those components carry the fix for
 * Safari painting today's date into an empty date input, which on a form whose
 * date starts empty is a customer submitting no date while believing they
 * asked for today. The rule is not "always ours" or "always native" — it is
 * that a control carrying a hard-won bug fix is never re-implemented.
 */
export function InquiryForm({ orgId }: { orgId: string }) {
  const [draft, setDraft] = useState<InquiryDraft>(EMPTY_INQUIRY);
  const [shops, setShops] = useState<InquiryShop[]>([]);
  const [honeypot, setHoneypot] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ title: string; body: string; ok: boolean } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // THE BASKET (4b). The menu is priced at a SHOP, so it is fetched again when
  // the pickup shop changes — the price a customer sees must be the one 133
  // writes, and that is read at the same shop (`inquiry_price_location`).
  const [menu, setMenu] = useState<InquiryMenuItem[]>([]);
  const [rules, setRules] = useState<InquiryRules>(EMPTY_RULES);
  const [basket, setBasket] = useState<Basket>(EMPTY_BASKET);
  // The delivery estimate, KEYED BY THE ADDRESS it was worked out for: an
  // edited address makes it stale without an effect to clear it.
  const [quoted, setQuoted] = useState<{ address: string; quote: DeliveryQuote } | null>(null);

  const priceLocation = draft.fulfillment === "pickup" && draft.locationId ? draft.locationId : null;

  const errors: InquiryErrors = validateInquiry(draft);
  const shown: InquiryErrors = touched ? errors : {};

  const empty = basketIsEmpty(basket);
  const lines = useMemo(() => basketLines(basket, menu), [basket, menu]);
  const problems = useMemo(() => basketProblems(basket, menu, rules.minimums), [basket, menu, rules]);

  const address = draft.address.trim();
  const delivery: DeliveryQuote =
    draft.fulfillment !== "delivery"
      ? { status: "none" }
      : !rules.delivery_estimate
        ? { status: "unavailable" }
        : !address
          ? { status: "needs_address" }
          : quoted && quoted.address === address
            ? quoted.quote
            : { status: "needs_address" };
  const estimate = estimateTotals({
    lines,
    rules,
    eventDate: draft.eventDate || null,
    today: todayIn(rules.timezone),
    deliveryFee: delivery.status === "ok" ? delivery.fee : null,
  });

  /**
   * THE HYDRATION GUARD, and `/welcome`'s lesson behind it: before React
   * hydrates, `onSubmit` is not attached, so pressing the button makes the
   * BROWSER submit the form natively. There it costs somebody a filled-in form
   * rather than a one-time token, which is still the worst thing this page can
   * do to a person.
   *
   * `useSyncExternalStore` rather than an effect, because setting state in one
   * is what the `set-state-in-effect` lint objects to.
   */
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("inquiry_shops", { p_org_id: orgId });
      if (cancelled) return;
      if (error) {
        // A customer never sees a Postgres message. An empty shop list simply
        // renders no shop question, which is a fine form to fill in — but a
        // developer looking at this needs the cause, and the commonest one by
        // far is migration 057 not having been applied.
        console.error("inquiry_shops failed", error.message);
        return;
      }
      setShops((data ?? []) as InquiryShop[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("inquiry_menu", {
        p_org_id: orgId,
        p_location_id: priceLocation,
      });
      if (cancelled) return;
      if (error) {
        // No menu means no builder, and the form is exactly the v1 form —
        // which is a fine form to fill in. The commonest cause by far is
        // migration 132 not having been applied.
        console.error("inquiry_menu failed", error.message);
        return;
      }
      const read = readMenu(data);
      setMenu(read.items);
      setRules(read.rules);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, priceLocation]);

  /** Ask `inquiry-delivery-quote` what delivery to this address comes to. On
   *  BLUR, not per keystroke: every call is a paid maps lookup. */
  async function quoteDelivery() {
    if (draft.fulfillment !== "delivery" || !rules.delivery_estimate || !address) return;
    if (quoted && quoted.address === address && quoted.quote.status !== "unavailable") return;
    const asked = address;
    setQuoted({ address: asked, quote: { status: "loading" } });
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("inquiry-delivery-quote", {
      body: { org_id: orgId, address: asked },
    });
    const r = (data ?? {}) as { state?: string; fee?: number; miles?: number };
    const quote: DeliveryQuote =
      error || !r.state
        ? { status: "unavailable" }
        : r.state === "ok" && typeof r.fee === "number" && typeof r.miles === "number"
          ? { status: "ok", fee: r.fee, miles: r.miles }
          : r.state === "outside_area"
            ? { status: "outside" }
            : { status: "unavailable" };
    setQuoted((prev) => (prev && prev.address === asked ? { address: asked, quote } : prev));
  }

  function set<K extends keyof InquiryDraft>(key: K, value: InquiryDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function submit() {
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    // The basket's own rules — the minimums, a flavour for every message, no
    // character we cannot cut. 133 checks them all again.
    if (problems.length > 0) {
      document.getElementById("summary-heading")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    setBusy(true);
    setFailed(null);
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("submit-inquiry", {
      body: inquiryPayload(draft, orgId, honeypot, empty ? null : basketPayload(basket, menu)),
    });
    setBusy(false);

    if (error) {
      setFailed(
        "Something went wrong sending your inquiry. Please try again, or email " +
          "us directly and we’ll pick it up from there."
      );
      return;
    }

    const state = (data ?? {}) as { state?: string };
    setDone(inquiryStateMessage(state.state ?? ""));
  }

  if (done) {
    return (
      <Shell>
        <h1 className="text-[26px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {done.title}
        </h1>
        <p className="text-[16px] leading-relaxed text-muted">{done.body}</p>
        {!done.ok && (
          <button
            type="button"
            onClick={() => setDone(null)}
            className="h-12 w-full border border-ink text-[14px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white"
          >
            Go back to the form
          </button>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="space-y-2">
        <h1 className="text-[26px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Special order inquiry
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">
          Tell us about your order and we’ll come back to you with a quote.
          Everything we make is custom, so a real person reads every one of
          these.
        </p>
        {/* The key to the mark every required label carries (Mark, 2026-09-24:
            "Indicate the fields that are required by putting a symbol or
            glyph after the label"). */}
        <p className="text-[13px] text-muted">
          <RequiredMark /> Required
        </p>
      </header>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Full name" required error={shown.name}>
          <input
            type="text"
            value={draft.name}
            autoComplete="name"
            onChange={(e) => set("name", e.target.value)}
            aria-required
            className={inputClass(shown.name)}
          />
        </Field>

        <Field label="Email" required error={shown.email}>
          <input
            type="email"
            inputMode="email"
            value={draft.email}
            autoComplete="email"
            onChange={(e) => set("email", e.target.value)}
            aria-required
            className={inputClass(shown.email)}
          />
        </Field>

        <Field label="Phone number" required error={shown.phone}>
          <input
            type="tel"
            inputMode="tel"
            value={draft.phone}
            autoComplete="tel"
            onChange={(e) => set("phone", e.target.value)}
            aria-required
            className={inputClass(shown.phone)}
          />
        </Field>

        <Field label="Occasion" required hint="Birthday, wedding, office party…" error={shown.occasion}>
          <input
            type="text"
            value={draft.occasion}
            onChange={(e) => set("occasion", e.target.value)}
            aria-required
            className={inputClass(shown.occasion)}
          />
        </Field>

        {/* Pickup or delivery, as two big cells rather than a menu — it is a
            choice of two on a phone, and a native <select> for two options is
            three taps where this is one. */}
        <Field label="Delivery or pickup">
          <div className="flex border border-ink">
            {(["pickup", "delivery"] as const).map((mode, i) => (
              <button
                key={mode}
                type="button"
                onClick={() => set("fulfillment", mode)}
                aria-pressed={draft.fulfillment === mode}
                className={
                  "h-12 flex-1 text-[14px] font-semibold uppercase tracking-[0.06em] " +
                  (i === 1 ? "border-l border-ink " : "") +
                  (draft.fulfillment === mode
                    ? "bg-ink text-white"
                    : "bg-white hover:bg-neutral-100")
                }
              >
                {mode === "pickup" ? "Pickup" : "Delivery"}
              </button>
            ))}
          </div>
        </Field>

        {shops.length > 0 && draft.fulfillment === "pickup" && (
          <Field label="Preferred location">
            <select
              value={draft.locationId}
              onChange={(e) => set("locationId", e.target.value)}
              className={inputClass()}
            >
              <option value="">No preference</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {/* DELIVERY ONLY (Mark, 2026-09-24: for pickup "not necessary"). What
            was typed survives a switch back to pickup, but only a delivery
            sends it (`inquiryPayload`). */}
        {draft.fulfillment === "delivery" && (
        <Field label="Address" required hint="Where we’re delivering to." error={shown.address}>
          <input
            type="text"
            value={draft.address}
            autoComplete="street-address"
            onChange={(e) => set("address", e.target.value)}
            onBlur={() => void quoteDelivery()}
            aria-required
            className={inputClass(shown.address)}
          />
        </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* `ui/DateField`, not a raw `<input type="date">`, and that is the
              one place on this page where the app's parts table wins over the
              simpler public dress. SAFARI PAINTS TODAY'S DATE INTO AN EMPTY
              DATE INPUT — its internal edit fields render the current date as
              a ghost whenever the value is "" — so on a form whose date starts
              empty, a customer would see today already filled in, leave it, and
              submit no date at all believing they had asked for today. That
              component is where the fix lives, and copying a second one here is
              how the bug comes back. */}
          <Field label="Date" required error={shown.eventDate}>
            <DateField
              variant="field"
              value={draft.eventDate || null}
              onChange={(next) => set("eventDate", next ?? "")}
              ariaLabel="Date you need it"
            />
          </Field>
          {/* `ui/TimePicker` beside `ui/DateField`, both in the form box, so
              the two read as one pair (Mark, 2026-09-11: every time in the app
              is our own picker). */}
          <Field label="Time" required error={shown.eventTime}>
            <TimePicker
              variant="field"
              value={draft.eventTime || null}
              onChange={(next) => set("eventTime", next ?? "")}
              ariaLabel="Time you need it"
            />
          </Field>
        </div>

        {menu.length > 0 && (
          <>
            <OrderBuilder
              menu={menu}
              basket={basket}
              onChange={setBasket}
              minimums={rules.minimums}
            />
            <BasketSummary
              lines={lines}
              problems={problems}
              showProblems={touched}
              estimate={estimate}
              delivery={delivery}
            />
          </>
        )}

        {/* NO "What are you interested in?" any more (Mark, 2026-09-24: "seems
            unnecessary now") — the builder says it, and the box below says the
            rest. `interest` still travels as null, so 058's column and the v1
            form keep working. */}

        {/* THE FALLBACK, always here (Mark: "If they want something we don't
            have the ability to model in this page, we should have a fall back
            option for them"). "Details", with one hint (Mark, 2026-09-24): "We
            definitely want customers to build their order rather than describe
            it" — so the box is worded as support for the build, and as the
            place for what the builder does not have. */}
        <Field
          label="Details"
          hint="More info on what you selected above, or if you couldn’t find what you were looking for, you can describe it here."
        >
          <textarea
            value={draft.description}
            rows={5}
            onChange={(e) => set("description", e.target.value)}
            className="w-full border border-ink px-3 py-2 text-[16px] leading-relaxed outline-none focus:border-2"
          />
        </Field>

        <Field label="Any allergies?">
          <input
            type="text"
            value={draft.allergies}
            onChange={(e) => set("allergies", e.target.value)}
            className={inputClass()}
          />
        </Field>

        {/* THE HONEYPOT. Hidden from people and from screen readers, reachable
            by a bot that fills every input it finds. Its VALUE is posted and
            migration 057 decides what to do about it — a filled one answers
            with the ordinary "received", so a bot cannot tell it was refused. */}
        <div aria-hidden className="hidden">
          <label>
            Company website
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </label>
        </div>

        <p className="border-l-2 border-mark pl-3 text-[14px] leading-relaxed text-muted">
          We need two business days to put an order into production. Sooner than
          that and a rush fee applies — we’ll tell you what it is before you
          commit to anything.
        </p>

        {failed && <p className="text-[15px] text-accent">{failed}</p>}

        <button
          type="submit"
          disabled={busy || !ready}
          className="h-12 w-full border-2 border-ink bg-ink text-[14px] font-semibold uppercase tracking-[0.06em] text-white transition-colors hover:bg-neutral-800 disabled:opacity-35"
        >
          {busy ? "Sending…" : ready ? "Send my inquiry" : "Loading…"}
        </button>

        <p className="text-[13px] text-muted">
          Nothing is ordered or charged here — this starts a conversation.
        </p>
      </form>
    </Shell>
  );
}

function inputClass(error?: string): string {
  // 16px is not a taste: below it, iOS Safari zooms the page on focus.
  return (
    "h-12 w-full border px-3 text-[16px] outline-none focus:border-2 " +
    (error ? "border-accent" : "border-ink")
  );
}

function Field({
  label,
  hint,
  error,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** Marks the label (`INQUIRY_REQUIRED`, migration 135). The mark only —
   *  `validateInquiry` and the gate are what actually require it. */
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
        {label}
        {required && (
          <>
            {" "}
            <RequiredMark />
            <span className="sr-only"> (required)</span>
          </>
        )}
      </span>
      {children}
      {error ? (
        <span className="block text-[13px] text-accent">{error}</span>
      ) : hint ? (
        <span className="block text-[13px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

/** The required mark: an asterisk in the error colour, hidden from screen
 *  readers, which hear "(required)" beside it instead. */
function RequiredMark() {
  return (
    <span aria-hidden className="font-semibold text-accent">
      *
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-xl space-y-6 px-5 py-10">{children}</main>;
}
