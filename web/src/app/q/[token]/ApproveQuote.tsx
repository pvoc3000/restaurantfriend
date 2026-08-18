"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/specialOrders";
import { usDate, usTime } from "@/lib/specialOrderDocs";
import { quoteStateMessage, type QuoteTokenState } from "@/lib/specialOrderSend";

/**
 * The customer's whole surface: read the quote, type your name, tap Approve.
 *
 * MOBILE-FIRST, because that is where it will be read — the link arrives by
 * email and is opened on a phone standing in a kitchen or a car park. One
 * column, big type, one button, and no chrome at all.
 *
 * READING IS SAFE; APPROVING IS THE ACT. Unlike `/welcome`, whose token is
 * spent by verification and therefore must not be touched on load, this token
 * is spent by APPROVAL. So the quote can be fetched in an effect and a mail
 * scanner following the link costs nothing. (That difference is worth stating
 * because the two pages look alike and the rule is opposite.)
 *
 * WHAT IT SHOWS IS THE SNAPSHOT, not the order. Money is derived live
 * (decision 6), so the order can change after the quote is sent; the customer
 * reads and signs the document that was emailed to them. Nothing on this page
 * is fetched from `special_orders` at all — see migration 052.
 */
export function ApproveQuote({ token }: { token: string }) {
  const [state, setState] = useState<QuoteTokenState | null>(null);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error: e } = await supabase.rpc("quote_by_token", { p_token: token });
      if (cancelled) return;
      if (e) {
        // A CUSTOMER NEVER SEES A POSTGRES MESSAGE. What they get is the
        // "this link isn't valid" page, which is the honest thing to tell
        // somebody whose link did not work — but a developer looking at this
        // needs the cause, and the commonest one by far is migration 052 not
        // having been applied, where the RPC simply does not exist.
        console.error("quote_by_token failed", e.message);
        setState({ state: "unknown" });
        return;
      }
      setState(data as QuoteTokenState);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function approve() {
    setBusy(true);
    setError(null);
    const supabase = createClient();

    /**
     * THE PDF IS RENDERED HERE, IN THE CUSTOMER'S BROWSER, and posted to the
     * `approve-quote` function to be filed — which is the only place it CAN be
     * rendered. @react-pdf needs a DOM-ish runtime, and the customer has no
     * credentials to write to a private bucket, so the artifact is made here
     * and stored there.
     *
     * A FAILURE TO RENDER MUST NOT BLOCK THE APPROVAL. The approval is the
     * fact; the signed PDF is a copy of it. So the render is attempted, and if
     * it throws the approval goes ahead without an attachment — the same rule
     * the receiving screen follows when an upload succeeds and a read fails.
     */
    let pdfBase64: string | null = null;
    try {
      if (state?.state === "open") {
        const [{ pdf }, docs] = await Promise.all([
          import("@react-pdf/renderer"),
          import("@/components/specialOrders/pdf/SignedQuotePdf"),
        ]);
        const blob = await pdf(
          <docs.SignedQuotePdf
            quote={state.quote}
            approval={{ name: name.trim(), at: new Date().toISOString() }}
          />
        ).toBlob();
        pdfBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      // Filed without the artifact. See above.
    }

    const { data, error: e } = await supabase.functions.invoke("approve-quote", {
      body: { token, name: name.trim(), pdf_base64: pdfBase64 },
    });
    setBusy(false);
    if (e) {
      setError(
        "Something went wrong recording your approval. Please reply to our email and we’ll take it from there."
      );
      return;
    }
    setState(data as QuoteTokenState);
  }

  if (state === null) {
    return (
      <Shell>
        <p className="text-muted">Loading your quote…</p>
      </Shell>
    );
  }

  if (state.state !== "open") {
    const message = quoteStateMessage(state.state);
    return (
      <Shell>
        <h1 className="text-[22px] font-bold uppercase leading-tight tracking-[-0.01em]">
          {message.title}
        </h1>
        <p className="text-[15px] text-muted">{message.body}</p>
        {"approved_name" in state && state.approved_name ? (
          <p className="text-[14px] text-muted">
            Approved by {state.approved_name} on {state.approved_at.slice(0, 10)}.
          </p>
        ) : null}
      </Shell>
    );
  }

  const quote = state.quote;
  return (
    <Shell>
      <header className="space-y-1">
        <h1 className="text-[26px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {quote.org.name}
        </h1>
        <p className="text-[13px] text-muted">{quote.org.addressLine}</p>
        <p className="text-[13px] text-muted">{quote.org.contactLine}</p>
      </header>

      <section className="space-y-1 border-y-2 border-ink py-4">
        <p className="text-[12px] uppercase tracking-[0.12em] text-subtle">
          Quote #{quote.number}
        </p>
        {quote.title && <p className="text-[17px] font-semibold">{quote.title}</p>}
        <p className="text-[15px]">
          {usDate(quote.event_date)}
          {quote.event_time ? ` · ${usTime(quote.event_time)}` : ""}
        </p>
        <p className="text-[15px] text-muted">
          {quote.fulfillment === "delivery" ? "Delivery" : "Pickup"}
          {quote.location_name ? ` · ${quote.location_name}` : ""}
        </p>
      </section>

      {/* THE LINES, in a stack rather than a table. A five-column table on a
          375px phone is a horizontal scroll, and what a customer checks is
          "did they get my order right", one item at a time. */}
      <section className="space-y-3">
        {quote.lines.map((line, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4 border-b border-hairline pb-2">
            <div className="min-w-0">
              <p className="text-[15px]">{line.name}</p>
              {line.notes && <p className="text-[13px] text-muted">{line.notes}</p>}
            </div>
            <p className="shrink-0 text-[15px] tabular-nums">
              {line.qty} × {money(line.unit_price)}
            </p>
          </div>
        ))}
      </section>

      <section className="space-y-1 text-[15px] tabular-nums">
        <Total label="Subtotal" value={quote.totals.subtotal} />
        {quote.totals.discount !== 0 && <Total label="Discount" value={-quote.totals.discount} />}
        {quote.totals.tax !== 0 && <Total label="Tax" value={quote.totals.tax} />}
        {quote.totals.deliveryCharge !== 0 && (
          <Total label="Delivery" value={quote.totals.deliveryCharge} />
        )}
        {quote.totals.rushFee !== 0 && <Total label="Rush fee" value={quote.totals.rushFee} />}
        <div className="flex items-baseline justify-between gap-4 border-t-2 border-ink pt-2 text-[19px] font-bold">
          <span>Total</span>
          <span>{money(quote.totals.total)}</span>
        </div>
      </section>

      {quote.notes_quote && (
        <p className="whitespace-pre-wrap text-[14px] text-muted">{quote.notes_quote}</p>
      )}

      {quote.org.terms && (
        <section className="space-y-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em]">Terms</h2>
          <p className="text-[13px] leading-relaxed text-muted">{quote.org.terms}</p>
        </section>
      )}

      {/* TYPED-NAME CLICKWRAP, not a drawn signature (decision 17): legally
          equivalent under ESIGN/UETA for this class of agreement and far easier
          on a phone, where a finger-drawn signature is a scribble nobody would
          accept anyway. */}
      <section className="space-y-4 border-t-2 border-ink pt-5">
        <label className="block space-y-1.5">
          <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
            Type your full name
          </span>
          <input
            type="text"
            value={name}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
            className="h-12 w-full border border-ink px-3 text-[16px] outline-none focus:border-2"
          />
        </label>

        <label className="flex items-start gap-3 text-[14px]">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-black"
          />
          <span>
            I agree to the terms above and approve this quote. My typed name is
            my signature.
          </span>
        </label>

        {error && <p className="text-[14px] text-accent">{error}</p>}

        <button
          type="button"
          disabled={busy || !agreed || !name.trim()}
          onClick={() => void approve()}
          className="h-12 w-full border-2 border-ink bg-ink text-[14px] font-semibold uppercase tracking-[0.06em] text-white transition-colors disabled:opacity-35"
        >
          {busy ? "Recording…" : "Approve this quote"}
        </button>

        <p className="text-[13px] text-muted">
          Nothing is charged here — your invoice will follow by email.
        </p>
      </section>
    </Shell>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span>{money(value)}</span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-xl space-y-6 px-5 py-10">{children}</main>
  );
}
