// extract-invoice — read the line items off an attached invoice.
//
// Receiving records quantities; migration 018 got the invoice into the system;
// this reads it. The web app posts an attachment id, this function downloads
// that object, hands it to Claude with a JSON schema it must answer in, and
// writes the result back onto the attachment row (migration 019). Matching the
// extracted lines against the purchase order happens in the browser — see
// web/src/lib/invoiceMatch.ts — because it's 5–20 lines against 5–20 lines and
// the human has to confirm every write anyway.
//
// **Nothing here writes to the order.** The extraction is a PROPOSAL: it says
// what the invoice appears to say, and the reconcile mode on PO detail is where
// a person turns any of it into a received quantity or a price. An OCR mistake
// that silently became a catalog price would propagate into every future order.
//
// Setup: one secret, `ANTHROPIC_API_KEY`.
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Design rule 1, same as send-po-email: the Supabase client carries the
// CALLER's JWT, so the storage download and the write-back both flow through
// RLS exactly as they would from the browser. The explicit role check just
// gives a readable error instead of a silent zero-row update.

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const MODEL = "claude-opus-5";

// The API takes images as jpeg/png/gif/webp and PDFs as documents. HEIC — what
// an iPhone hands you from the photo library — is NOT among them, which is why
// the attach control asks iOS for JPEG (see PoAttachments).
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// A photographed page is ~1–4 MB; anything far past that is a scan nobody
// needed at that resolution. The API's own request ceiling is 32 MB and base64
// inflates by a third, so this leaves plenty of room and fails with an
// actionable message rather than a wire error.
const MAX_BYTES = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// The shape the model must answer in.
//
// Structured outputs (`output_config.format`) constrain the response to this
// schema, so the app parses a guaranteed shape instead of coaxing JSON out of
// prose. Two rules the schema layer enforces: every object needs
// `additionalProperties: false`, and every property must be listed in
// `required` — optionality is expressed by allowing null, not by omission.
// ---------------------------------------------------------------------------

const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });

const INVOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "vendor_name",
    "invoice_number",
    "invoice_date",
    "ship_date",
    "invoice_total",
    "lines",
    "notes",
  ],
  properties: {
    vendor_name: nullable("string"),
    invoice_number: nullable("string"),
    invoice_date: nullable("string"),
    // When the goods actually moved, if the page says. Kept separate from
    // invoice_date because a distributor bills on a cycle and delivers on a
    // day, and receiving cares about the day — this is what the receiving
    // screen offers as the order's delivery date.
    ship_date: nullable("string"),
    invoice_total: nullable("number"),
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "product_id",
          "alt_product_id",
          "description",
          "qty",
          "unit_price",
          "extended",
          "pack",
        ],
        properties: {
          // The vendor's own SKU. This is the join key — a purchase order line
          // snapshots the same value in `product_id` — so it matters far more
          // than anything else on the line.
          product_id: nullable("string"),
          // A SECOND number for the same line, when the page prints more than
          // one. Distributors running SAP print both a catalog number and an
          // internal MATERIAL number, and WHICH of them is the one we ordered
          // under varies line by line — Dawn invoice 96461403 printed our SKU
          // under PRODUCT ID on one line and under MATERIAL on the other three.
          // With one field the model has to choose, and a right answer sits on
          // the page unused.
          alt_product_id: nullable("string"),
          description: { type: "string" },
          qty: nullable("number"),
          unit_price: nullable("number"),
          extended: nullable("number"),
          pack: nullable("string"),
        },
      },
    },
    // The reader's own caveats — surfaced to the human rather than quietly
    // dropped. Named `notes`, not `unreadable`, because a field called
    // "unreadable" invites the model to report only illegibility and stay quiet
    // about the judgements it made, which are just as worth seeing.
    notes: nullable("string"),
  },
};

const PROMPT = `You are reading a supplier invoice for a bakery's receiving desk.

Transcribe every line item exactly as printed. Do not compute, correct, or
tidy: if the arithmetic on the page is wrong, report what is printed.

- product_id is the SUPPLIER'S item or SKU number for that line, as printed.
  It is the single most important field — it is what this invoice gets matched
  against. If a line has no printed item number, use null; never invent one and
  never substitute a different number from the row.
- alt_product_id is a SECOND item number printed for the same line, when the
  page carries more than one such column. Distributors commonly print both a
  catalog/product number and an internal MATERIAL or SAP number, and either
  one may be the number the customer ordered under. Put the column labelled as
  the item or product number in product_id and the other in alt_product_id.
  Report BOTH whenever both are printed, even if one column is blank on this
  particular row — a blank PRODUCT ID with a filled MATERIAL means product_id
  is null and alt_product_id carries the material number. Use null when the
  line really does show only one number, and never repeat the same number in
  both fields. Do not put a quantity, a price, a case count, a purchase order
  number or a line number here; only an identifier for the ITEM.
- qty is the quantity billed and extended is that line's total charge. Both are
  printed on the page — never compute them.
- unit_price is the rate printed for ONE of whatever qty counts. Many lines show
  two rates (a per-pound or per-each figure for catch-weight goods alongside a
  case price): pick the one where qty × unit_price equals extended. If neither
  does — a line billed by actual weight, say — report the rate as printed and
  say so in "notes"; do not adjust a number to make the arithmetic close.
- pack is the pack or size text if the line shows one ("12 x 32 oz", "CS").
- Use null for any field not printed on that line. Do not guess.
- Skip subtotal, tax, delivery, and total rows — those are not line items.
  Put the invoice's grand total in invoice_total.
- ship_date is the date the goods MOVED, taken from a field the page labels as
  such: Ship Date, Date Shipped, Delivered, Delivery Date, Service Date. Many
  invoices print no such field — use null then. Never copy the invoice date
  into it, and never take an order date, a due date, or a payment-terms date:
  those are different facts and one of them being wrong here would put the
  wrong day on a purchase order.
- invoice_date and ship_date as YYYY-MM-DD.

Use "notes" for anything the reader of this data should know before trusting it,
naming the lines involved: text you couldn't make out, a choice you had to make
between two printed numbers, a line whose rate is quoted in different units than
its quantity. Prefer saying so over producing a confident guess.`;

// ---------------------------------------------------------------------------

/** Base64 without blowing the stack: `fromCharCode(...bytes)` on a multi-MB
 *  array exceeds the argument limit and throws. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { attachment_id } = await req.json();
    if (!attachment_id) return json(400, { error: "missing attachment_id" });

    // `.trim()` is not defensive programming for its own sake: a secret pasted
    // into a form field or written through an env file very often arrives with
    // a trailing newline or space, and the API rejects that as an invalid key
    // with no hint about why. Quotes get the same treatment — a value set as
    // ANTHROPIC_API_KEY="sk-ant-…" can keep them.
    const rawKey = Deno.env.get("ANTHROPIC_API_KEY");
    const apiKey = rawKey?.trim().replace(/^["']|["']$/g, "");
    if (!apiKey) {
      return json(500, {
        error:
          "ANTHROPIC_API_KEY is not set on this project — see supabase/functions/extract-invoice/index.ts",
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "not signed in" });

    const { data: attachment, error: attachmentError } = await supabase
      .from("purchase_order_attachments")
      .select("id, org_id, po_id, storage_path, file_name, content_type")
      .eq("id", attachment_id)
      .maybeSingle();
    if (attachmentError) return json(400, { error: attachmentError.message });
    if (!attachment) return json(404, { error: "attachment not found" });

    const { data: member } = await supabase
      .from("org_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("org_id", attachment.org_id)
      .maybeSingle();
    if (!member || !["owner", "admin", "purchaser"].includes(member.role)) {
      return json(403, { error: "purchaser role required to read invoices" });
    }

    // Through the caller's JWT, so migration 018's storage SELECT policy is
    // what decides whether this file is theirs to read.
    const { data: blob, error: downloadError } = await supabase.storage
      .from("po-attachments")
      .download(attachment.storage_path);
    if (downloadError || !blob) {
      return json(400, {
        error: `could not read the attachment: ${downloadError?.message ?? "not found"}`,
      });
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > MAX_BYTES) {
      return json(400, {
        error: `${attachment.file_name ?? "that file"} is ${Math.round(
          bytes.length / 1024 / 1024
        )} MB — too large to read. Attach a smaller photo or a PDF.`,
      });
    }

    // `blob.type` is what Storage serves it as and is the more reliable of the
    // two; the row's recorded content_type is the fallback for objects stored
    // before the browser reported one.
    const mediaType = blob.type || attachment.content_type || "";
    const data = toBase64(bytes);

    let source;
    if (mediaType === "application/pdf") {
      source = {
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf" as const, data },
      };
    } else if (IMAGE_TYPES.includes(mediaType)) {
      source = {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data,
        },
      };
    } else {
      return json(400, {
        error: `${mediaType || "that file type"} can't be read — attach a JPEG, PNG or PDF.`,
      });
    }

    const anthropic = new Anthropic({ apiKey });

    // The beta path is only for `fallbacks`: Claude Opus 5's safety classifiers
    // can decline a request outright (a 200 carrying stop_reason "refusal"), and
    // this parameter re-runs it on another model inside the same call instead of
    // handing the caller a dead end. An invoice is unlikely to trip them, but
    // the recovery costs two lines. The array form is used because it's the one
    // the TypeScript SDK types.
    let response;
    try {
      response = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-06-01"],
        fallbacks: [{ model: "claude-opus-4-8" }],
        output_config: {
          // Transcription, not deduction — this is well below the level of work
          // that rewards deeper thinking, and lower effort keeps a Friday
          // afternoon's worth of invoices quick.
          effort: "medium",
          format: { type: "json_schema", schema: INVOICE_SCHEMA },
        },
        messages: [{ role: "user", content: [source, { type: "text", text: PROMPT }] }],
      });
    } catch (e) {
      // A rejected key is the one failure here that says nothing useful on its
      // own — "invalid x-api-key" is identical whether the secret is wrong,
      // truncated, or carried a stray newline in from a paste. Report the SHAPE
      // of what the function received: enough to tell those apart, and nothing
      // that could be used as a credential.
      if ((e as { status?: number }).status === 401) {
        return json(401, {
          error:
            "Anthropic rejected the API key. The secret this function received is described below — " +
            "if it looks right, the key itself is wrong or revoked; if it looks wrong, re-set the secret.",
          key_shape: {
            length: apiKey.length,
            starts_with_sk_ant: apiKey.startsWith("sk-ant-"),
            had_surrounding_whitespace: rawKey !== rawKey?.trim(),
            had_quotes: /^["']|["']$/.test(rawKey?.trim() ?? ""),
          },
        });
      }
      throw e;
    }

    if (response.stop_reason === "refusal") {
      return json(422, {
        error: "the model declined to read this document",
        category: response.stop_details?.category ?? null,
      });
    }
    if (response.stop_reason === "max_tokens") {
      return json(422, {
        error:
          "the invoice was too long to finish reading — try splitting it or entering it by hand",
      });
    }

    // Thinking is on by default on this model, so thinking blocks come FIRST in
    // content — `content[0]` is not the answer. Find the text block.
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return json(502, { error: "the model returned no readable answer" });
    }

    let extraction: unknown;
    try {
      extraction = JSON.parse(text.text);
    } catch {
      return json(502, { error: "the model's answer was not valid JSON" });
    }

    // Written through the caller's JWT: the purchaser+ policy on
    // purchase_order_attachments is what allows it, same as every other write
    // this app makes.
    const { error: writeError } = await supabase
      .from("purchase_order_attachments")
      .update({
        extraction,
        extracted_at: new Date().toISOString(),
        extraction_model: response.model,
      })
      .eq("id", attachment.id);
    if (writeError) return json(400, { error: writeError.message });

    return json(200, { extraction, model: response.model });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
