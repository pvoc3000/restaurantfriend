// THE SHOP NOTICES' ONE LAYOUT — the emails this module sends to the SHOP
// (not the customer) when a customer does something nobody here pressed a
// button for: a new inquiry, a quote approved, a payment taken online (Mark,
// 2026-09-24: "which emails should we get at each step of the process?" →
// those three, each as its own message rather than a Cc on the customer's).
//
// One layout so the three read as one family: a small kicker, a big title, an
// "Open …" button into the app, a table of facts, optional sections (an order's
// lines, free text), a footer. Email-safe HTML — tables and inline styles only,
// no web fonts, no images — black on white with one rule colour, the app's own
// look. Every notice also gets a plain-text part.
//
// ONE FILE FOR THE LAYOUT AND ALL THREE NOTICES, ON PURPOSE: it is PURE, with
// NO DENO APIS AND NO IMPORTS, so `web/scripts/fixtures` compiles and tests this
// very file (`squareOrder.ts`' arrangement). Deno needs an import's `.ts`
// extension and the fixtures' CommonJS build cannot load one, so splitting it
// into modules would cost the tests.

export type Notice = { subject: string; html: string; text: string };

/** One row of the facts table. `html` overrides the escaped text (links). */
export type Fact = { label: string; text: string | null | undefined; html?: string };

/** A block below the facts: an order's lines, a paragraph of details. */
export type Section = { html: string; text: string };

/** An order line as the notices show it — `special_order_items`' columns. */
export type NoticeLine = {
  name: string;
  qty: number;
  unit_price: number;
  notes: string | null;
};

export const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const usd = (x: number) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** "Friday, October 30, 2026" — read off the string, never through local time. */
export function longDate(d: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? "");
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "10:00 AM" from "10:00" or "10:00:00". */
export function clockTime(t: string | null | undefined): string | null {
  const m = /^(\d{2}):(\d{2})/.exec(t ?? "");
  if (!m) return null;
  const h = +m[1];
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "Friday, October 30, 2026 at 10:00 AM", or whichever half there is. */
export function when(date: string | null | undefined, time: string | null | undefined): string {
  return [longDate(date), clockTime(time)].filter(Boolean).join(" at ");
}

/** A mailto link for the facts table. */
export function emailFact(label: string, address: string | null | undefined): Fact {
  return {
    label,
    text: address,
    html: address ? `<a href="mailto:${esc(address)}" style="color:#000000;">${esc(address)}</a>` : undefined,
  };
}

/** A tel link for the facts table. */
export function phoneFact(label: string, phone: string | null | undefined): Fact {
  return {
    label,
    text: phone,
    html: phone
      ? `<a href="tel:${esc(phone.replace(/[^\d+]/g, ""))}" style="color:#000000;">${esc(phone)}</a>`
      : undefined,
  };
}

const MUTED = "#6b6b6b";
const RULE = "#e5e5e5";
const HEADING = `margin:28px 0 8px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};font-weight:600;`;
const CELL = `padding:8px 0;border-bottom:1px solid ${RULE};vertical-align:top;font-size:15px;line-height:1.45;`;
const LABEL = `padding:8px 16px 8px 0;border-bottom:1px solid ${RULE};vertical-align:top;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};white-space:nowrap;`;

/** An unpriced extra (134) is written at $0 with this note. */
export const isQuoted = (l: NoticeLine) => (l.notes ?? "").startsWith("Price to be quoted");

/** A note worth showing: not the "to be quoted" marker, and not a letter line's
 *  own `"H"` — the kitchen's copy of what the line's name already says. */
export function shownNote(l: NoticeLine): string | null {
  const n = (l.notes ?? "").trim();
  if (!n || isQuoted(l) || /^"[^"]*"$/.test(n)) return null;
  return n;
}

/** A section heading, for sections built by a caller. */
export function sectionHeading(text: string): string {
  return `<p style="${HEADING}">${esc(text)}</p>`;
}

/** A paragraph of free text a customer or staff typed, line breaks kept. */
export function textSection(heading: string, body: string | null | undefined): Section | null {
  const b = (body ?? "").trim();
  if (!b) return null;
  return {
    html: `${sectionHeading(heading)}<p style="margin:0;font-size:15px;line-height:1.5;white-space:pre-wrap;">${esc(b)}</p>`,
    text: `${heading}:\n${b}`,
  };
}

/**
 * An order's lines with a subtotal. Unpriced extras read "to be quoted" and
 * count as $0, and `footnotes` say what the subtotal is not.
 */
export function linesSection(
  heading: string,
  lines: NoticeLine[],
  opts: { subtotalLabel: string; footnotes?: string[]; empty?: string }
): Section {
  if (lines.length === 0) {
    const empty = opts.empty ?? "No lines.";
    return {
      html: `${sectionHeading(heading)}<p style="margin:0;font-size:15px;color:${MUTED};">${esc(empty)}</p>`,
      text: empty,
    };
  }
  const subtotal = Math.round(lines.reduce((a, l) => a + l.qty * l.unit_price, 0) * 100) / 100;
  const anyQuoted = lines.some(isQuoted);
  const rows = lines
    .map((l) => {
      const n = shownNote(l);
      const note = n ? `<div style="font-size:13px;color:${MUTED};">${esc(n)}</div>` : "";
      const amount = isQuoted(l) ? `<span style="color:${MUTED};">to be quoted</span>` : usd(l.qty * l.unit_price);
      return (
        `<tr>` +
        `<td style="${CELL}width:48px;text-align:right;padding-right:12px;white-space:nowrap;">${l.qty}×</td>` +
        `<td style="${CELL}">${esc(l.name)}${note}</td>` +
        `<td style="${CELL}text-align:right;white-space:nowrap;padding-left:12px;">${amount}</td>` +
        `</tr>`
      );
    })
    .join("");
  const notes = [...(anyQuoted ? ["Plus items marked “to be quoted”."] : []), ...(opts.footnotes ?? [])];
  const html =
    `${sectionHeading(heading)}` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}` +
    `<tr><td></td><td style="padding:10px 0 0;font-size:15px;font-weight:600;">${esc(opts.subtotalLabel)}</td>` +
    `<td style="padding:10px 0 0 12px;font-size:15px;font-weight:600;text-align:right;white-space:nowrap;">${usd(subtotal)}</td></tr>` +
    `</table>` +
    notes.map((f) => `<p style="margin:6px 0 0;font-size:13px;color:${MUTED};">${esc(f)}</p>`).join("");
  const text = [
    `${heading}:`,
    ...lines.map(
      (l) =>
        `  ${l.qty} × ${l.name} — ${isQuoted(l) ? "price to be quoted" : usd(l.qty * l.unit_price)}${
          shownNote(l) ? ` (${shownNote(l)})` : ""
        }`
    ),
    `${opts.subtotalLabel}: ${usd(subtotal)}${anyQuoted ? " plus items to be quoted" : ""}`,
  ].join("\n");
  return { html, text };
}

export type NoticeSpec = {
  subject: string;
  /** The small line above the title: "New special order inquiry". */
  kicker: string;
  /** The big line: "#10123 · Victoria Fay". */
  title: string;
  /** Under the title: "Birthday — Friday, October 30 at 10:00 AM". */
  subtitle?: string | null;
  /** The black button into the app; omitted when there is no URL. */
  button?: { url: string | null; label: string } | null;
  /** The first line of the plain-text part: "New inquiry #10123 from …". */
  lead: string;
  factsHeading: string;
  facts: Fact[];
  sections?: (Section | null)[];
  footer?: string | null;
};

export function renderNotice(spec: NoticeSpec): Notice {
  const facts = spec.facts.filter((f) => (f.text ?? "").trim() !== "");
  const sections = (spec.sections ?? []).filter((s): s is Section => s !== null);
  const url = spec.button?.url ?? null;

  const factRows = facts
    .map(
      (f) =>
        `<tr><td style="${LABEL}">${esc(f.label)}</td><td style="${CELL}">${f.html ?? esc((f.text ?? "").trim())}</td></tr>`
    )
    .join("");

  const button =
    url && spec.button
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;"><tr><td style="background:#000000;">` +
        `<a href="${esc(url)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">${esc(spec.button.label)}</a>` +
        `</td></tr></table>`
      : "";

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(spec.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #000000;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#000000;">
<tr><td style="padding:28px 28px 32px;">
<p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};">${esc(spec.kicker)}</p>
<h1 style="margin:0;font-size:24px;line-height:1.2;font-weight:700;text-transform:uppercase;letter-spacing:-0.01em;">${esc(spec.title)}</h1>
${spec.subtitle ? `<p style="margin:6px 0 0;font-size:15px;color:#333333;">${esc(spec.subtitle)}</p>` : ""}
${button}
${sectionHeading(spec.factsHeading)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${factRows}</table>
${sections.map((s) => s.html).join("\n")}
${spec.footer ? `<p style="margin:28px 0 0;font-size:12px;color:${MUTED};">${esc(spec.footer)}</p>` : ""}
</td></tr></table>
</td></tr></table>
</body></html>`;

  const text = [
    spec.lead,
    url ? `Open it: ${url}` : null,
    "",
    ...facts.map((f) => `${f.label}: ${(f.text ?? "").trim()}`),
    ...sections.flatMap((s) => ["", s.text]),
    spec.footer ? `\n${spec.footer}` : null,
  ]
    .filter((x) => x !== null)
    .join("\n");

  return { subject: spec.subject, html, text };
}


/* ==========================================================================
 * 1. A NEW INQUIRY (Mark, 2026-09-24: "create a nice html email that includes
 *    all the submitted info and send it to specialorders@donutfriend.com")
 *
 * Built from the LEAD AS THE GATE WROTE IT (133–136), not from the request:
 * the prices are the server's, the delivery figures are `submit-inquiry`'s own
 * estimate, and a field the gate dropped (an address on a pickup) is not shown.
 * ========================================================================== */

export type NoticeOrder = {
  number: string;
  title: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  event_date: string | null; // YYYY-MM-DD
  event_time: string | null; // HH:MM[:SS]
  fulfillment: string | null;
  delivery_address: string | null;
  delivery_distance: number | null;
  delivery_charge: number | null;
  shop: string | null;
  allergen_info: string | null;
  details: string | null;
};

export function buildInquiryNotice(o: NoticeOrder, lines: NoticeLine[], leadUrl: string | null): Notice {
  const name = (o.contact_name ?? "").trim() || "Someone";
  const occasion = (o.title ?? "").trim();
  const whenText = when(o.event_date, o.event_time);
  const delivery = o.fulfillment === "delivery";
  const estimate =
    delivery && o.delivery_charge !== null
      ? `${usd(Number(o.delivery_charge))}${
          o.delivery_distance !== null ? ` for ${Number(o.delivery_distance).toFixed(1)} mi` : ""
        } (estimated)`
      : delivery && o.delivery_distance !== null
        ? `${Number(o.delivery_distance).toFixed(1)} mi — beyond the estimate's range`
        : null;

  const facts: Fact[] = [
    { label: "Name", text: o.contact_name },
    emailFact("Email", o.contact_email),
    phoneFact("Phone", o.contact_phone),
    { label: "Occasion", text: occasion },
    { label: "When", text: whenText },
    { label: "Fulfillment", text: delivery ? "Delivery" : "Pickup" },
    ...(delivery
      ? [
          { label: "Deliver to", text: o.delivery_address },
          { label: "Delivery", text: estimate },
        ]
      : [{ label: "Pickup at", text: o.shop ?? "No preference" }]),
    { label: "Allergies", text: o.allergen_info },
  ];

  return renderNotice({
    subject: `New inquiry #${o.number} — ${name}${occasion ? `, ${occasion}` : ""}${
      o.event_date ? ` (${o.event_date})` : ""
    }`,
    kicker: "New special order inquiry",
    title: `#${o.number} · ${name}`,
    subtitle: [occasion, whenText].filter(Boolean).join(" — ") || null,
    button: { url: leadUrl, label: `Open inquiry #${o.number}` },
    lead: `New inquiry #${o.number} from ${name}.`,
    factsHeading: "Who and when",
    facts,
    sections: [
      linesSection("Their order", lines, {
        subtotalLabel: "Estimated subtotal",
        footnotes: ["Prices as the website showed them, before tax, delivery and any rush fee."],
        empty: "They didn’t build an order — see the details below.",
      }),
      textSection("Details", o.details),
    ],
    footer: `Submitted on the website. Reply to this email to write to ${name}.`,
  });
}


/* ==========================================================================
 * 2. A QUOTE APPROVED (Mark, 2026-09-24: "When a customer approves a quote,
 *    can you also send a copy of the signed quote to specialorders@").
 *
 * Its OWN message rather than a Cc on the customer's confirmation, which sat
 * inside the customer's thread, sent from the shop's mailbox to itself, and
 * was easy to miss. `approve-quote` attaches the signed PDF it just filed.
 * ========================================================================== */

export type ApprovalOrder = {
  number: string;
  title: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  event_date: string | null;
  event_time: string | null;
  fulfillment: string | null;
  delivery_address: string | null;
  shop: string | null;
};

/** "Thursday, September 24, 2026 at 3:41 PM" in the org's zone. */
export function stampIn(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = (opts: Intl.DateTimeFormatOptions) => {
    try {
      return d.toLocaleString("en-US", { ...opts, timeZone });
    } catch {
      return d.toLocaleString("en-US", { ...opts, timeZone: "UTC" });
    }
  };
  return `${fmt({ weekday: "long", month: "long", day: "numeric", year: "numeric" })} at ${fmt({
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function buildApprovalNotice(
  o: ApprovalOrder,
  lines: NoticeLine[],
  approval: { name: string | null; at: string | null; timeZone: string; signedAttached: boolean },
  orderUrl: string | null
): Notice {
  const customer = (o.contact_name ?? "").trim() || "The customer";
  const signer = (approval.name ?? "").trim() || customer;
  const occasion = (o.title ?? "").trim();
  const whenText = when(o.event_date, o.event_time);
  const delivery = o.fulfillment === "delivery";
  return renderNotice({
    subject: `Quote approved #${o.number} — ${signer}${occasion ? `, ${occasion}` : ""}${
      o.event_date ? ` (${o.event_date})` : ""
    }`,
    kicker: "Quote approved",
    title: `#${o.number} · ${signer}`,
    subtitle: [occasion, whenText].filter(Boolean).join(" — ") || null,
    button: { url: orderUrl, label: `Open order #${o.number}` },
    lead: `${signer} approved quote #${o.number}.`,
    factsHeading: "The approval",
    facts: [
      { label: "Signed by", text: signer },
      { label: "Approved", text: stampIn(approval.at, approval.timeZone) },
      { label: "Customer", text: o.contact_name },
      emailFact("Email", o.contact_email),
      phoneFact("Phone", o.contact_phone),
      { label: "When", text: whenText },
      { label: "Fulfillment", text: o.fulfillment ? (delivery ? "Delivery" : "Pickup") : null },
      delivery ? { label: "Deliver to", text: o.delivery_address } : { label: "Pickup at", text: o.shop },
    ],
    sections: [
      linesSection("The order", lines, {
        subtotalLabel: "Subtotal",
        footnotes: ["Before tax, delivery, rush and any discount — the quote has the total."],
      }),
    ],
    footer: `${approval.signedAttached ? "The signed quote is attached. " : "No signed copy was produced. "}Reply to this email to write to ${customer}.`,
  });
}

/* ==========================================================================
 * 3. PAID ONLINE — a payment nobody here took: the Square pay link (on an
 *    order or a customer invoice) or QuickBooks Payments (131). Sent once per
 *    payment, by whichever path RECORDED it (`record_pay_link_payment` and
 *    `record_qbo_invoice_payment` each say "recorded" exactly once).
 * ========================================================================== */

export type PaymentFacts = {
  /** What was paid: one order, or a customer invoice covering several. */
  kind: "order" | "invoice";
  number: string;
  title: string | null;
  customer: string | null;
  amount: number;
  /** "visa ending 1111", or the processor's own word. */
  method: string;
  processor: "Square" | "QuickBooks";
  /** What is still owed after this payment; null when unknown. */
  balance: number | null;
  event_date: string | null;
  /** An invoice's orders, "#10079 — Birthday". */
  orders?: string[];
};

export function buildPaymentNotice(p: PaymentFacts, url: string | null): Notice {
  const what = p.kind === "invoice" ? `Invoice ${p.number}` : `#${p.number}`;
  const who = (p.customer ?? "").trim();
  const paidInFull = p.balance !== null && p.balance <= 0.005;
  const balanceText =
    p.balance === null ? null : paidInFull ? "Paid in full" : `${usd(p.balance)} still owed`;
  return renderNotice({
    subject: `Paid online ${what} — ${usd(p.amount)}${who ? ` from ${who}` : ""}${paidInFull ? " (paid in full)" : ""}`,
    kicker: `Paid online · ${p.processor}`,
    title: `${usd(p.amount)} · ${what}`,
    subtitle: [who, balanceText].filter(Boolean).join(" — ") || null,
    button: { url, label: p.kind === "invoice" ? `Open invoice ${p.number}` : `Open order #${p.number}` },
    lead: `${who || "A customer"} paid ${usd(p.amount)} online on ${what}.`,
    factsHeading: "The payment",
    facts: [
      { label: "Amount", text: usd(p.amount) },
      { label: "Customer", text: who },
      { label: "Method", text: `${p.method} (${p.processor})` },
      { label: "For", text: p.kind === "invoice" ? `Invoice ${p.number}` : `Order #${p.number}${p.title ? ` — ${p.title}` : ""}` },
      { label: "Covers", text: p.orders && p.orders.length ? p.orders.join("; ") : null },
      { label: "Event", text: longDate(p.event_date) },
      { label: "Balance", text: balanceText },
    ],
    footer: "Recorded on the order automatically — nothing to enter by hand.",
  });
}
