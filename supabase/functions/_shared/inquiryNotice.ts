// THE NEW-INQUIRY NOTICE — what the shop receives when a customer submits the
// public form (Mark, 2026-09-24: "create a nice html email that includes all
// the submitted info and send it to specialorders@donutfriend.com so we
// know").
//
// Built from the LEAD AS THE GATE WROTE IT (133–136), not from the request:
// the prices are the server's, the delivery figures are `submit-inquiry`'s own
// estimate, and a field the gate dropped (an address on a pickup) is not
// shown. `submit-inquiry` reads the rows and hands them here.
//
// Email-safe HTML: tables and inline styles only, no web fonts, no images —
// every mail client renders it, and a dark-mode client inverts it cleanly.
// Black on white with a single rule colour, the app's own look. A plain-text
// part rides along for clients that will not show HTML.
//
// PURE, NO DENO APIS AND NO IMPORTS, so `web/scripts/fixtures` compiles and
// tests this very file (`squareOrder.ts`' arrangement).

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

export type NoticeLine = {
  name: string;
  qty: number;
  unit_price: number;
  notes: string | null;
};

export type Notice = { subject: string; html: string; text: string };

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const usd = (x: number) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** "Friday, October 30, 2026" — read off the string, never through local time. */
export function longDate(d: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? "");
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
export function clockTime(t: string | null): string | null {
  const m = /^(\d{2}):(\d{2})/.exec(t ?? "");
  if (!m) return null;
  const h = +m[1];
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** An unpriced extra (134) is written at $0 with this note. */
const quoted = (l: NoticeLine) => (l.notes ?? "").startsWith("Price to be quoted");

/** A note worth showing: not the "to be quoted" marker, and not a letter line's
 *  own `"H"` — the kitchen's copy of what the line's name already says. */
const shownNote = (l: NoticeLine): string | null => {
  const n = (l.notes ?? "").trim();
  if (!n || quoted(l) || /^"[^"]*"$/.test(n)) return null;
  return n;
};

export function buildInquiryNotice(o: NoticeOrder, lines: NoticeLine[], leadUrl: string | null): Notice {
  const name = (o.contact_name ?? "").trim() || "Someone";
  const occasion = (o.title ?? "").trim();
  const when = [longDate(o.event_date), clockTime(o.event_time)].filter(Boolean).join(" at ");
  const subject = `New inquiry #${o.number} — ${name}${occasion ? `, ${occasion}` : ""}${
    o.event_date ? ` (${o.event_date})` : ""
  }`;

  const delivery = o.fulfillment === "delivery";
  const estimate =
    delivery && o.delivery_charge !== null
      ? `${usd(Number(o.delivery_charge))}${
          o.delivery_distance !== null ? ` for ${Number(o.delivery_distance).toFixed(1)} mi` : ""
        } (estimated)`
      : delivery && o.delivery_distance !== null
        ? `${Number(o.delivery_distance).toFixed(1)} mi — beyond the estimate's range`
        : null;

  // [label, plain value, html value]
  const facts: [string, string, string][] = [];
  const add = (label: string, plain: string | null | undefined, html?: string) => {
    if (plain && plain.trim()) facts.push([label, plain.trim(), html ?? esc(plain.trim())]);
  };
  add("Name", o.contact_name);
  add(
    "Email",
    o.contact_email,
    o.contact_email ? `<a href="mailto:${esc(o.contact_email)}" style="color:#000000;">${esc(o.contact_email)}</a>` : undefined
  );
  add(
    "Phone",
    o.contact_phone,
    o.contact_phone
      ? `<a href="tel:${esc(o.contact_phone.replace(/[^\d+]/g, ""))}" style="color:#000000;">${esc(o.contact_phone)}</a>`
      : undefined
  );
  add("Occasion", occasion);
  add("When", when);
  add("Fulfillment", delivery ? "Delivery" : "Pickup");
  if (delivery) {
    add("Deliver to", o.delivery_address);
    add("Delivery", estimate);
  } else {
    add("Pickup at", o.shop ?? "No preference");
  }
  add("Allergies", o.allergen_info);

  const subtotal = Math.round(lines.reduce((a, l) => a + l.qty * l.unit_price, 0) * 100) / 100;
  const anyQuoted = lines.some(quoted);

  /* ---- plain text ---- */
  const text = [
    `New inquiry #${o.number} from ${name}.`,
    leadUrl ? `Open it: ${leadUrl}` : null,
    "",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    "",
    lines.length
      ? [
          "Their order:",
          ...lines.map(
            (l) =>
              `  ${l.qty} × ${l.name} — ${quoted(l) ? "price to be quoted" : usd(l.qty * l.unit_price)}${
                shownNote(l) ? ` (${shownNote(l)})` : ""
              }`
          ),
          `Estimated subtotal: ${usd(subtotal)}${anyQuoted ? " plus items to be quoted" : ""}`,
        ].join("\n")
      : "They didn't build an order.",
    "",
    o.details ? `Details:\n${o.details}` : null,
  ]
    .filter((x) => x !== null)
    .join("\n");

  /* ---- html ---- */
  const cell = "padding:8px 0;border-bottom:1px solid #e5e5e5;vertical-align:top;font-size:15px;line-height:1.45;";
  const label =
    "padding:8px 16px 8px 0;border-bottom:1px solid #e5e5e5;vertical-align:top;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#6b6b6b;white-space:nowrap;";
  const heading =
    "margin:28px 0 8px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#6b6b6b;font-weight:600;";

  const factRows = facts
    .map(([k, , v]) => `<tr><td style="${label}">${esc(k)}</td><td style="${cell}">${v}</td></tr>`)
    .join("");

  const lineRows = lines
    .map((l) => {
      const n = shownNote(l);
      const note = n ? `<div style="font-size:13px;color:#6b6b6b;">${esc(n)}</div>` : "";
      const amount = quoted(l) ? `<span style="color:#6b6b6b;">to be quoted</span>` : usd(l.qty * l.unit_price);
      return (
        `<tr>` +
        `<td style="${cell}width:48px;text-align:right;padding-right:12px;white-space:nowrap;">${l.qty}×</td>` +
        `<td style="${cell}">${esc(l.name)}${note}</td>` +
        `<td style="${cell}text-align:right;white-space:nowrap;padding-left:12px;">${amount}</td>` +
        `</tr>`
      );
    })
    .join("");

  const orderBlock = lines.length
    ? `<p style="${heading}">Their order</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${lineRows}
<tr><td></td><td style="padding:10px 0 0;font-size:15px;font-weight:600;">Estimated subtotal</td><td style="padding:10px 0 0 12px;font-size:15px;font-weight:600;text-align:right;white-space:nowrap;">${usd(subtotal)}</td></tr>
</table>
${anyQuoted ? `<p style="margin:6px 0 0;font-size:13px;color:#6b6b6b;">Plus items marked “to be quoted”.</p>` : ""}
<p style="margin:6px 0 0;font-size:13px;color:#6b6b6b;">Prices as the website showed them, before tax, delivery and any rush fee.</p>`
    : `<p style="${heading}">Their order</p><p style="margin:0;font-size:15px;color:#6b6b6b;">They didn’t build an order — see the details below.</p>`;

  const detailsBlock = o.details
    ? `<p style="${heading}">Details</p><p style="margin:0;font-size:15px;line-height:1.5;white-space:pre-wrap;">${esc(o.details)}</p>`
    : "";

  const button = leadUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;"><tr><td style="background:#000000;">
<a href="${esc(leadUrl)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">Open inquiry #${esc(o.number)}</a>
</td></tr></table>`
    : "";

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #000000;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#000000;">
<tr><td style="padding:28px 28px 32px;">
<p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#6b6b6b;">New special order inquiry</p>
<h1 style="margin:0;font-size:24px;line-height:1.2;font-weight:700;text-transform:uppercase;letter-spacing:-0.01em;">#${esc(o.number)} · ${esc(name)}</h1>
${when || occasion ? `<p style="margin:6px 0 0;font-size:15px;color:#333333;">${esc([occasion, when].filter(Boolean).join(" — "))}</p>` : ""}
${button}
<p style="${heading}">Who and when</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${factRows}</table>
${orderBlock}
${detailsBlock}
<p style="margin:28px 0 0;font-size:12px;color:#6b6b6b;">Submitted on the website. Reply to this email to write to ${esc(name)}.</p>
</td></tr></table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
}
