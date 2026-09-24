// qbo-webhook — Intuit tells us a QuickBooks payment happened (131).
//
// Mark, 2026-09-24: QuickBooks is being tried as a second processor on
// customer invoices, and a payment taken on QuickBooks' own pay link must land
// here without anybody typing it in. Intuit POSTs a notification for every
// Payment created or updated in the company; this reads the payment back from
// QuickBooks and records it against the invoice it is linked to, through
// `record_qbo_invoice_payment` → `allocate_customer_invoice_payment`, the same
// path the Square pay link settles through.
//
// DEPLOYED WITHOUT JWT VERIFICATION, `qbo-oauth`'s reason: Intuit sends no
// Supabase token.
//
//   npx supabase functions deploy qbo-webhook --no-verify-jwt --project-ref …
//
// WHERE ITS AUTHORITY COMES FROM: the `intuit-signature` header, an HMAC-SHA256
// of the raw body keyed by the app's webhook verifier token (the secret
// `QBO_WEBHOOK_VERIFIER`). Anything unsigned or mis-signed is refused before it
// is parsed. And even a genuine notification is only a HINT — the amount, the
// date and which invoice it pays are read back from QuickBooks with our own
// token, never taken from the body.
//
// Both of Intuit's payload shapes are read: the classic `eventNotifications`
// and the CloudEvents array. Which one this app's subscription sends is logged
// on arrival (`shape`), so the first live event settles it.
//
// Only Create/Update are acted on. A payment voided or deleted in QuickBooks is
// LOGGED, not reversed — record the refund by hand, as with a Square refund.
// A replay is harmless: 131's unique index and the function's own check make a
// second recording of the same payment a no-op ('duplicate').

import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { QboError, loadConnection, qboFetch } from "../_shared/qbo.ts";

type Event = { realm: string; entity: string; id: string; operation: string };

async function signatureOk(raw: string, header: string | null, key: string): Promise<boolean> {
  if (!header) return false;
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(raw)));
  const expected = btoa(String.fromCharCode(...mac));
  const given = header.trim();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Both shapes, flattened to the four facts we need. */
function eventsOf(body: unknown): { shape: string; events: Event[] } {
  const events: Event[] = [];
  const b = body as Record<string, unknown>;
  if (b && Array.isArray(b.eventNotifications)) {
    for (const n of b.eventNotifications as Record<string, unknown>[]) {
      const realm = String(n.realmId ?? "");
      const ents = ((n.dataChangeEvent as { entities?: Record<string, unknown>[] } | undefined)?.entities) ?? [];
      for (const e of ents) {
        events.push({
          realm,
          entity: String(e.name ?? ""),
          id: String(e.id ?? ""),
          operation: String(e.operation ?? ""),
        });
      }
    }
    return { shape: "classic", events };
  }
  const list = Array.isArray(body) ? body : b && typeof b.type === "string" ? [b] : [];
  for (const e of list as Record<string, unknown>[]) {
    // "qbo.payment.created.v1" → Payment, Create
    const parts = String(e.type ?? "").split(".");
    const entity = parts[1] ?? "";
    const verb = parts[2] ?? "";
    events.push({
      realm: String(e.intuitaccountid ?? ""),
      entity: entity ? entity[0].toUpperCase() + entity.slice(1) : "",
      id: String(e.intuitentityid ?? ""),
      operation: verb === "created" ? "Create" : verb === "updated" ? "Update" : verb,
    });
  }
  return { shape: list.length ? "cloudevents" : "unknown", events };
}

async function handlePayment(admin: SupabaseClient, ev: Event): Promise<void> {
  const log = (what: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ at: "qbo-webhook", what, realm: ev.realm, payment: ev.id, ...extra }));

  const { data: row } = await admin
    .from("accounting_connections")
    .select("org_id")
    .eq("provider", "qbo")
    .eq("realm_id", ev.realm)
    .maybeSingle();
  if (!row) return log("unknown company");

  const conn = await loadConnection(admin, row.org_id as string);
  const res = (await qboFetch(admin, conn, `payment/${encodeURIComponent(ev.id)}`)) as {
    Payment?: {
      TxnDate?: string;
      Line?: { Amount?: unknown; LinkedTxn?: { TxnId?: string; TxnType?: string }[] }[];
    };
  };
  const p = res?.Payment;
  if (!p) return log("payment not found");

  for (const line of p.Line ?? []) {
    for (const t of line.LinkedTxn ?? []) {
      if (t.TxnType !== "Invoice" || !t.TxnId) continue;
      const { data, error } = await admin.rpc("record_qbo_invoice_payment", {
        p_realm: ev.realm,
        p_qbo_invoice: String(t.TxnId),
        p_amount: Number(line.Amount ?? 0),
        p_payment_id: ev.id,
        p_paid_on: p.TxnDate ?? null,
      });
      log(error ? "record failed" : String(data), {
        invoice: t.TxnId,
        amount: line.Amount,
        ...(error ? { error: error.message } : {}),
      });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  const key = Deno.env.get("QBO_WEBHOOK_VERIFIER");
  if (!key) {
    console.error(JSON.stringify({ at: "qbo-webhook", what: "QBO_WEBHOOK_VERIFIER is not set" }));
    return new Response("not configured", { status: 500 });
  }

  const raw = await req.text();
  if (!(await signatureOk(raw, req.headers.get("intuit-signature"), key))) {
    return new Response("bad signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad body", { status: 400 });
  }
  const { shape, events } = eventsOf(body);
  console.log(JSON.stringify({
    at: "qbo-webhook", what: "received", shape,
    events: events.map((e) => `${e.entity}:${e.operation}:${e.id}`),
  }));

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const work = (async () => {
    for (const ev of events) {
      if (ev.entity !== "Payment") continue;
      if (ev.operation !== "Create" && ev.operation !== "Update") {
        console.log(JSON.stringify({
          at: "qbo-webhook", what: "not reversed — record by hand",
          operation: ev.operation, payment: ev.id, realm: ev.realm,
        }));
        continue;
      }
      try {
        await handlePayment(admin, ev);
      } catch (e) {
        console.error(JSON.stringify({
          at: "qbo-webhook", what: "failed", payment: ev.id,
          error: e instanceof QboError || e instanceof Error ? e.message : String(e),
        }));
      }
    }
  })();

  // Answer Intuit at once and finish in the background — it retries anything
  // slow, and a retry is harmless but noisy. Where the runtime lacks
  // `waitUntil`, the work is simply awaited.
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work);
  else await work;

  return new Response("ok");
});
