"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { DateField } from "@/components/ui/DateField";
import { TimeField } from "@/components/ui/TimeField";
import { createClient } from "@/lib/supabase/client";
import {
  EMPTY_INQUIRY,
  INQUIRY_INTEREST_OPTIONS,
  inquiryPayload,
  inquiryStateMessage,
  validateInquiry,
  type InquiryDraft,
  type InquiryErrors,
  type InquiryShop,
} from "@/lib/inquiry";

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
 * The date and time go the OTHER way, to `ui/DateField` / `ui/TimeField`, and
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

  const errors: InquiryErrors = validateInquiry(draft);
  const shown: InquiryErrors = touched ? errors : {};

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

  function set<K extends keyof InquiryDraft>(key: K, value: InquiryDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function submit() {
    setTouched(true);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setFailed(null);
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("submit-inquiry", {
      body: inquiryPayload(draft, orgId, honeypot),
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
            className="h-12 w-full border border-ink text-[14px] font-semibold uppercase tracking-[0.06em]"
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
      </header>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Full name" error={shown.name}>
          <input
            type="text"
            value={draft.name}
            autoComplete="name"
            onChange={(e) => set("name", e.target.value)}
            className={inputClass(shown.name)}
          />
        </Field>

        <Field label="Email" error={shown.email}>
          <input
            type="email"
            inputMode="email"
            value={draft.email}
            autoComplete="email"
            onChange={(e) => set("email", e.target.value)}
            className={inputClass(shown.email)}
          />
        </Field>

        <Field label="Phone number" error={shown.phone}>
          <input
            type="tel"
            inputMode="tel"
            value={draft.phone}
            autoComplete="tel"
            onChange={(e) => set("phone", e.target.value)}
            className={inputClass(shown.phone)}
          />
        </Field>

        <Field label="Occasion" hint="Birthday, wedding, office party…">
          <input
            type="text"
            value={draft.occasion}
            onChange={(e) => set("occasion", e.target.value)}
            className={inputClass()}
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
                  (draft.fulfillment === mode ? "bg-ink text-white" : "bg-white")
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

        <Field
          label="Address"
          hint={
            draft.fulfillment === "delivery"
              ? "Where we’re delivering to."
              : "Optional — helps us know where you are."
          }
        >
          <input
            type="text"
            value={draft.address}
            autoComplete="street-address"
            onChange={(e) => set("address", e.target.value)}
            className={inputClass()}
          />
        </Field>

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
          <Field label="Date" error={shown.eventDate}>
            <DateField
              variant="field"
              value={draft.eventDate || null}
              onChange={(next) => set("eventDate", next ?? "")}
              ariaLabel="Date you need it"
            />
          </Field>
          {/* `ui/TimeField` beside `ui/DateField` for that component's own
              stated reason: the two sit side by side, so a bordered time next
              to a borderless date reads as one of them being broken. It also
              carries the seconds-slicing that stops Safari ignoring a value
              Postgres hands back as `13:30:00`. */}
          <Field label="Time" error={shown.eventTime}>
            <TimeField
              variant="field"
              value={draft.eventTime || null}
              onChange={(next) => set("eventTime", next ?? "")}
              ariaLabel="Time you need it"
            />
          </Field>
        </div>

        <Field label="What are you interested in?">
          <select
            value={draft.interest}
            onChange={(e) => set("interest", e.target.value)}
            className={inputClass()}
          >
            <option value="">Not sure yet</option>
            {INQUIRY_INTEREST_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="What are you looking for?"
          hint="Flavours, colours, wording on letter donuts — as much detail as you have."
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
          className="h-12 w-full border-2 border-ink bg-ink text-[14px] font-semibold uppercase tracking-[0.06em] text-white transition-colors disabled:opacity-35"
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
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
        {label}
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

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-xl space-y-6 px-5 py-10">{children}</main>;
}
