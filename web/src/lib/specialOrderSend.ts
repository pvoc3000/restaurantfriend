/**
 * SENDING A SPECIAL-ORDER DOCUMENT — the client half of decision 12, and the
 * mint half of decision 17.
 *
 * The compose card holds the blob; this module holds everything that has to be
 * true around it. Client-safe (the `poProcessing` idiom): every write here goes
 * through the caller's own supabase client, so RLS applies exactly as it would
 * from any screen.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { customerLabel } from "./specialOrders";
import type { OrderDocData } from "./specialOrderDocs";

/* ==========================================================================
 * THE APPROVAL TOKEN (decision 17)
 * ========================================================================== */

/**
 * 128 bits of randomness, base64url.
 *
 * `crypto.getRandomValues` and not `Math.random`, which is not a CSPRNG and
 * whose output is guessable from a handful of samples — and this token IS the
 * capability. 22 characters, URL-safe, and short enough to survive being
 * forwarded through a mail client that likes to wrap long lines.
 */
export function mintTokenValue(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Where the customer goes. Built from the browser's own origin rather than a
 *  configured base URL: the app has exactly one, and a stale `APP_URL` secret
 *  would put a dead link in front of a customer. */
export function approvalUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/q/${token}`;
}

/**
 * Mint a token when the compose card OPENS, so the link in the draft body is
 * real and the human can see and edit the sentence carrying it.
 *
 * IT IS MINTED WITHOUT A SNAPSHOT, and that is the safety property: until the
 * send succeeds the row has no `document_snapshot`, and `quote_by_token` reads
 * a snapshot-less token as `unknown`. So a compose card opened and then
 * cancelled leaves a URL that shows nothing — never a live, approvable quote
 * nobody sent.
 */
export async function mintQuoteToken(
  supabase: SupabaseClient,
  args: { orderId: string; orgId: string }
): Promise<string> {
  const token = mintTokenValue();
  const { data, error } = await supabase
    .from("special_order_quote_tokens")
    .insert({ org_id: args.orgId, order_id: args.orderId, token })
    .select("token")
    .single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The approval link could not be created.");
  return token;
}

/**
 * What `/q/{token}` renders — the quote AS SENT.
 *
 * Deliberately not the whole `OrderDocData`: this ends up readable by anyone
 * holding the link, so it carries what the paper quote carries and nothing
 * else. No customer id, no internal notes, no kitchen, no `taken_by`, no
 * contact phone — the customer knows their own number, and a capability URL
 * should expose the document rather than the record behind it.
 */
export type QuoteSnapshot = {
  number: string;
  title: string | null;
  event_date: string | null;
  event_time: string | null;
  fulfillment: string;
  location_name: string | null;
  /** Both names, because the quote prints both blocks and the two are
   *  routinely different people — a corporate order's customer is accounts
   *  payable and its contact is whoever is running the party. */
  customer_name: string;
  contact_name: string | null;
  lines: {
    name: string;
    notes: string | null;
    qty: number;
    unit_price: number;
    taxable: boolean;
  }[];
  totals: OrderDocData["totals"];
  notes_quote: string | null;
  org: { name: string; addressLine: string; contactLine: string; terms: string };
  sent_on: string;
};

export function quoteSnapshot(
  order: OrderDocData,
  org: { name: string; addressLine: string; contactLine: string; terms: string },
  today: string
): QuoteSnapshot {
  return {
    number: order.number,
    title: order.title,
    event_date: order.event_date,
    event_time: order.event_time,
    fulfillment: order.fulfillment,
    location_name: order.location_name,
    customer_name: customerLabel(order.customer),
    contact_name: order.contact_name,
    lines: order.lines.map((l) => ({
      name: l.name,
      notes: l.notes,
      qty: l.qty,
      unit_price: l.unit_price,
      taxable: l.taxable,
    })),
    totals: order.totals,
    notes_quote: order.notes_quote,
    org,
    sent_on: today,
  };
}

/**
 * Write the snapshot BEFORE the send, not after.
 *
 * Either order can fail badly and this is the better failure. Written first, a
 * send that then fails leaves a live link nobody has been given — the email
 * never went out — and the next compose supersedes it. Written after, a send
 * that succeeds and a write that fails leaves a link the customer HAS been
 * given that says the quote does not exist.
 */
export async function bindQuoteSnapshot(
  supabase: SupabaseClient,
  token: string,
  snapshot: QuoteSnapshot
): Promise<void> {
  const { data, error } = await supabase
    .from("special_order_quote_tokens")
    .update({ document_snapshot: snapshot })
    .eq("token", token)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new Error("The approval link could not be prepared — nothing was updated.");
  }
}

/* ==========================================================================
 * THE SEND
 * ========================================================================== */

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // result is a data: URL — the base64 payload starts after the comma.
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function sendSpecialOrderEmail(
  supabase: SupabaseClient,
  args: {
    orderId: string;
    kind: "quote" | "invoice" | "receipt" | "order";
    to: string;
    cc?: string;
    subject: string;
    body: string;
    blob: Blob;
    filename: string;
    quoteToken?: string | null;
  }
): Promise<{ warning?: string }> {
  const { data, error } = await supabase.functions.invoke("send-special-order-email", {
    body: {
      order_id: args.orderId,
      kind: args.kind,
      to: args.to,
      cc: args.cc || undefined,
      subject: args.subject,
      body: args.body,
      pdf_base64: await blobToBase64(args.blob),
      filename: args.filename,
      quote_token: args.quoteToken ?? undefined,
    },
  });
  if (error) {
    // FunctionsHttpError carries the function's JSON response — surface the
    // real message ("secret EMAIL_CREDS_SPECIALORDERS is not set"), not
    // "non-2xx status code".
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      const parsed = await ctx?.json();
      if (parsed?.error) message = parsed.error;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  return { warning: (data as { warning?: string } | null)?.warning };
}

/* ==========================================================================
 * THE APPROVAL PAGE'S OWN CALL (anon)
 * ========================================================================== */

export type QuoteTokenState =
  | { state: "unknown" }
  | { state: "superseded" }
  | { state: "open"; quote: QuoteSnapshot }
  | { state: "approved"; quote?: QuoteSnapshot; approved_at: string; approved_name: string }
  | { state: "already_approved"; approved_at: string; approved_name: string }
  | { state: "name_required" };

/**
 * What the four states MEAN to somebody holding a link, in their words rather
 * than ours. Pure, so it is fixture-tested — a customer reading the wrong
 * sentence here is the one failure of this feature nobody would report.
 */
export function quoteStateMessage(state: QuoteTokenState["state"]): {
  title: string;
  body: string;
} {
  switch (state) {
    case "unknown":
      return {
        title: "This link isn’t valid",
        body:
          "It may have been mistyped, or the quote may have been withdrawn. " +
          "Reply to the email we sent you and we’ll sort it out.",
      };
    case "superseded":
      return {
        title: "This quote has been revised",
        body: "Please check your email for the current one — the link in the newest message is the one to use.",
      };
    case "approved":
    case "already_approved":
      return {
        title: "Approved — thank you",
        body: "We have your approval on file. Your invoice will follow by email.",
      };
    case "name_required":
      return {
        title: "Please type your name",
        body: "Your typed name is your signature, so we need it before we can record the approval.",
      };
    case "open":
      return { title: "", body: "" };
  }
}
