"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/specialOrders";
import { isCustomerInvoiceSnapshot, orderLineDescription } from "@/lib/customerInvoices";
import { usDate } from "@/lib/specialOrderDocs";
import {
  payStateMessage,
  squareScriptUrl,
  type PayResult,
  type PayTokenState,
  type SquareConfig,
} from "@/lib/payLink";

/**
 * The customer's whole surface for paying an invoice: read it, pay it.
 *
 * MOBILE-FIRST, `/q`'s reasoning — the link arrives by email and is opened on
 * a phone. One column, the balance in big type, the wallet buttons first
 * because on a phone they are one tap.
 *
 * THE CARD NUMBER NEVER TOUCHES THIS APP. Square's Web Payments SDK draws its
 * own fields in iframes on its own origin and hands back a single-use token;
 * that token, and never an amount, is what goes to `square-pay`. The amount is
 * decided on the server from the link itself (migration 119).
 *
 * READING IS SAFE; PAYING IS THE ACT — so, like `/q`, the invoice is fetched on
 * load and a mail scanner following the link costs nothing.
 */

/* ---- the slice of Square's SDK this page uses --------------------------- */

type TokenResult = { status: string; token?: string; errors?: { message?: string }[] };
type SquareMethod = {
  attach?: (selector: string) => Promise<void>;
  tokenize: (verification?: Record<string, unknown>) => Promise<TokenResult>;
  destroy?: () => Promise<void>;
};
type SquarePayments = {
  card: () => Promise<SquareMethod>;
  giftCard: () => Promise<SquareMethod>;
  paymentRequest: (req: Record<string, unknown>) => unknown;
  applePay: (req: unknown) => Promise<SquareMethod>;
  googlePay: (req: unknown) => Promise<SquareMethod>;
};
type SquareGlobal = { payments: (appId: string, locationId: string) => SquarePayments };

function loadSquare(environment: SquareConfig["environment"]): Promise<SquareGlobal> {
  const w = window as unknown as { Square?: SquareGlobal };
  if (w.Square) return Promise.resolve(w.Square);
  return new Promise((resolve, reject) => {
    const src = squareScriptUrl(environment);
    let script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () =>
      w.Square ? resolve(w.Square) : reject(new Error("Square did not load"))
    );
    script.addEventListener("error", () => reject(new Error("Square could not be reached")));
  });
}

async function fetchPayState(token: string): Promise<PayTokenState> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("pay_by_token", { p_token: token });
  if (error) {
    // `/q`'s rule: a customer never sees a Postgres message. The commonest
    // cause by far is migration 119 not being applied.
    console.error("pay_by_token failed", error.message);
    return { state: "unknown" };
  }
  return data as PayTokenState;
}

type Methods = {
  card: SquareMethod | null;
  giftCard: SquareMethod | null;
  applePay: SquareMethod | null;
  googlePay: SquareMethod | null;
};

export function PayInvoice({ token }: { token: string }) {
  const [state, setState] = useState<PayTokenState | null>(null);
  const [result, setResult] = useState<PayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<Record<keyof Methods, boolean>>({
    card: false,
    giftCard: false,
    applePay: false,
    googlePay: false,
  });
  const [showGiftCard, setShowGiftCard] = useState(false);
  const [sdkFailed, setSdkFailed] = useState(false);
  const methods = useRef<Methods>({ card: null, giftCard: null, applePay: null, googlePay: null });
  const payments = useRef<SquarePayments | null>(null);

  /* ---- 1. the invoice ---------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await fetchPayState(token);
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const open = state?.state === "open" ? state : null;
  const square = open?.square ?? null;
  const balance = open?.balance ?? 0;

  /* ---- 2. Square's fields, once the invoice says what to charge ---------- */

  useEffect(() => {
    if (!square || result) return;
    let cancelled = false;
    const m = methods.current;

    (async () => {
      let sq: SquareGlobal;
      try {
        sq = await loadSquare(square.environment);
      } catch (e) {
        console.error(e);
        if (!cancelled) setSdkFailed(true);
        return;
      }
      if (cancelled) return;
      const p = sq.payments(square.application_id, square.location_id);
      payments.current = p;

      const request = p.paymentRequest({
        countryCode: "US",
        currencyCode: "USD",
        total: { amount: balance.toFixed(2), label: "Amount due" },
      });

      // Each method is optional: Apple Pay exists only in Safari on Apple
      // hardware with a registered domain, Google Pay only where Google says
      // so. A method that throws simply isn't offered.
      try {
        m.card = await p.card();
        await m.card.attach?.("#sq-card");
        if (!cancelled) setReady((r) => ({ ...r, card: true }));
      } catch (e) {
        console.error("card", e);
        if (!cancelled) setSdkFailed(true);
      }
      try {
        m.applePay = await p.applePay(request);
        if (!cancelled) setReady((r) => ({ ...r, applePay: true }));
      } catch {
        m.applePay = null;
      }
      try {
        m.googlePay = await p.googlePay(request);
        await m.googlePay.attach?.("#sq-google-pay");
        if (!cancelled) setReady((r) => ({ ...r, googlePay: true }));
      } catch {
        m.googlePay = null;
      }
    })();

    return () => {
      cancelled = true;
      for (const k of ["card", "googlePay", "giftCard"] as const) {
        void m[k]?.destroy?.();
        m[k] = null;
      }
      m.applePay = null;
    };
  }, [square, balance, result]);

  // The gift-card field is attached only when asked for: most customers pay by
  // card, and a second set of empty boxes reads as "fill in both".
  useEffect(() => {
    if (!showGiftCard || !payments.current || methods.current.giftCard) return;
    let cancelled = false;
    (async () => {
      try {
        const g = await payments.current!.giftCard();
        await g.attach?.("#sq-gift-card");
        if (cancelled) {
          void g.destroy?.();
          return;
        }
        methods.current.giftCard = g;
        setReady((r) => ({ ...r, giftCard: true }));
      } catch (e) {
        console.error("giftCard", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showGiftCard]);

  /* ---- 3. paying ---------------------------------------------------------- */

  async function pay(kind: keyof Methods) {
    const method = methods.current[kind];
    if (!method || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Buyer verification (3-D Secure) where the card's bank asks for it —
      // Square decides; for a card that doesn't need it this is a no-op.
      const tokenized =
        kind === "card"
          ? await method.tokenize({
              amount: balance.toFixed(2),
              currencyCode: "USD",
              intent: "CHARGE",
              customerInitiated: true,
              sellerKeyedIn: false,
              billingContact: {},
            })
          : await method.tokenize();
      if (tokenized.status !== "OK" || !tokenized.token) {
        // A wallet sheet the customer closed is not an error worth a sentence.
        if (tokenized.status !== "Cancel") {
          setError(tokenized.errors?.[0]?.message ?? "Please check the details and try again.");
        }
        return;
      }

      const supabase = createClient();
      const { data, error: e } = await supabase.functions.invoke("square-pay", {
        body: {
          token,
          source_id: tokenized.token,
          // One key per press. Square refuses to charge the same key twice,
          // and the server's claim stops two DIFFERENT presses both charging.
          idempotency_key: crypto.randomUUID(),
          source_type: kind === "giftCard" ? "gift_card" : kind,
        },
      });
      if (e) {
        setError(
          "Something went wrong and we couldn’t confirm the payment. Please check your card statement before trying again, or reply to our email."
        );
        return;
      }
      const r = data as PayResult;
      if (r.state === "declined" || r.state === "unconfirmed") {
        setError(r.message);
        return;
      }
      if (r.state === "paid") {
        setResult(r);
        return;
      }
      // unknown / superseded / cancelled / busy — the link changed under us.
      if (r.state === "busy") {
        setError(payStateMessage("busy").body);
        return;
      }
      setState(await fetchPayState(token));
    } catch (e) {
      console.error(e);
      setError("Please check the details and try again.");
    } finally {
      setBusy(false);
    }
  }

  /* ---- rendering ---------------------------------------------------------- */

  if (result?.state === "paid") {
    return (
      <Shell>
        <h1 className="text-[22px] font-bold uppercase leading-tight tracking-[-0.01em]">
          Paid — thank you
        </h1>
        <p className="text-[15px]">
          We received {money(result.amount)}
          {result.method ? ` (${result.method})` : ""}. A confirmation is on its way by email.
        </p>
        {result.receipt_url && (
          <p className="text-[15px]">
            <a href={result.receipt_url} className="underline" target="_blank" rel="noreferrer">
              View your receipt
            </a>
          </p>
        )}
      </Shell>
    );
  }

  if (state === null) {
    return (
      <Shell>
        <p className="text-muted">Loading your invoice…</p>
      </Shell>
    );
  }

  if (state.state !== "open") {
    const message = payStateMessage(state.state);
    return (
      <Shell>
        <h1 className="text-[22px] font-bold uppercase leading-tight tracking-[-0.01em]">
          {message.title}
        </h1>
        <p className="text-[15px] text-muted">{message.body}</p>
      </Shell>
    );
  }

  const invoice = state.invoice;
  const unavailable = !square || sdkFailed;

  return (
    <Shell>
      <header className="space-y-1">
        <h1 className="text-[26px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {invoice.org.name}
        </h1>
        <p className="text-[13px] text-muted">{invoice.org.addressLine}</p>
        <p className="text-[13px] text-muted">{invoice.org.contactLine}</p>
      </header>

      {/* ONE LINE PER ORDER, not the itemisation (Mark, 2026-09-22: "we
          don't need individual line items. let's do one line item with the
          order number, name, and date"). An order's own invoice is one such
          line carrying the invoice TOTAL, so tax, delivery and discounts are
          inside it; a customer invoice (124) is one per order it covers —
          Cafe Knotted's week is seven. The attached PDF is the paper. */}
      <section className="space-y-1 text-[15px] tabular-nums">
        {isCustomerInvoiceSnapshot(invoice) ? (
          <div className="border-y-2 border-ink py-2">
            <p className="pb-1 text-[13px] text-muted">
              Invoice #{invoice.number}
              {invoice.due_on ? ` · due ${usDate(invoice.due_on)}` : ""}
            </p>
            {invoice.lines.map((line, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 py-1">
                <span className="min-w-0">{line.description}</span>
                <span className="shrink-0">{money(line.amount)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-4 border-y-2 border-ink py-3">
            <span className="min-w-0">{orderLineDescription(invoice)}</span>
            <span className="shrink-0">{money(state.total)}</span>
          </div>
        )}
        {state.paid !== 0 && <Total label="Paid" value={-state.paid} />}
        <div className="flex items-baseline justify-between gap-4 border-t-2 border-ink pt-2 text-[19px] font-bold">
          <span>Amount due</span>
          <span>{money(balance)}</span>
        </div>
      </section>

      {invoice.notes_quote && (
        <p className="whitespace-pre-wrap text-[14px] text-muted">{invoice.notes_quote}</p>
      )}

      <section className="space-y-4 border-t-2 border-ink pt-5">
        {unavailable ? (
          <>
            <h2 className="text-[17px] font-bold uppercase">{payStateMessage("unavailable").title}</h2>
            <p className="text-[15px] text-muted">{payStateMessage("unavailable").body}</p>
          </>
        ) : (
          <>
            {ready.applePay && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void pay("applePay")}
                className="h-12 w-full border-2 border-ink bg-ink text-[14px] font-semibold uppercase tracking-[0.06em] text-white transition-colors hover:bg-neutral-800 disabled:opacity-35"
              >
                Pay with Apple Pay
              </button>
            )}
            {/* Google draws its own button into this box once attached. */}
            <div
              id="sq-google-pay"
              onClick={() => void pay("googlePay")}
              className={ready.googlePay ? "" : "hidden"}
            />

            <div className="space-y-2">
              <p className="text-[12px] uppercase tracking-[0.12em] text-subtle">Card</p>
              <div id="sq-card" />
              <button
                type="button"
                disabled={busy || !ready.card}
                onClick={() => void pay("card")}
                className="h-12 w-full border-2 border-ink bg-ink text-[14px] font-semibold uppercase tracking-[0.06em] text-white transition-colors hover:bg-neutral-800 disabled:opacity-35"
              >
                {busy ? "Paying…" : `Pay ${money(balance)}`}
              </button>
            </div>

            {showGiftCard ? (
              <div className="space-y-2">
                <p className="text-[12px] uppercase tracking-[0.12em] text-subtle">Gift card</p>
                <div id="sq-gift-card" />
                <button
                  type="button"
                  disabled={busy || !ready.giftCard}
                  onClick={() => void pay("giftCard")}
                  className="h-12 w-full border-2 border-ink bg-white text-[14px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-neutral-100 disabled:opacity-35"
                >
                  {busy ? "Paying…" : `Pay ${money(balance)} with gift card`}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowGiftCard(true)}
                className="text-[14px] underline"
              >
                Pay with a gift card
              </button>
            )}

            {error && <p className="text-[14px] text-accent">{error}</p>}
          </>
        )}
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
