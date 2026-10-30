// supabase/functions/order-mail/index.ts
//
// AN ORDER'S EMAILS (migration 214) — the special-orders mailbox, read into
// each order, and replies sent from the order's Emails tab.
//
// Mark, 2026-10-29: "Traci keeps missing incoming special order emails … is it
// possible to have a tab on the special order detail page for reading and
// responding to emails? could the app flag when a message comes in about an
// order?" Gmail stays the record. This copies into `special_order_messages`
// every message it can tie to an order, and an inbound one waits there until
// an email to the customer follows it or somebody presses No reply needed.
//
// FOUR DOORS, one function:
//   · pg_cron (215), every five minutes, with the `x-order-mail-secret`
//     header matching the ORDER_MAIL_SECRET edge secret: check every org whose
//     special-orders mailbox is Gmail.
//   · `{ mode: "check" }` — Check for email on the tab: the caller's org, now.
//   · `{ mode: "reply", order_id, answering?, to, cc?, subject?, body, files? }`
//     — send a reply in the conversation of the message it answers, and record
//     it at once.
//   · `{ mode: "record", order_id, ref }` — copy one email this mailbox just
//     sent into the order (a document sent from the Email tab goes out through
//     `send-special-order-email`, which files and stamps it; this puts it in
//     the history and answers what it answers, without waiting for a check).
//   · `{ mode: "attachment", message_id, part_id }` — one file from a
//     message, for the tab to open.
//   Deployed --no-verify-jwt, because the cron has no JWT; the other three
//   check the caller themselves, as sales-nightly's Run Now does.
//
// TYING A MESSAGE TO AN ORDER, in this order, first answer wins:
//   1. its Gmail conversation already holds a message tied to an order, or is
//      the order's own (`special_orders.thread_conversation_id`, 210);
//   2. its subject names exactly one order number ("SO-10156");
//   3. it is FROM an address that is the contact or customer of exactly one
//      open order (not canceled, event no more than three days past).
//   A message none of these tie is not copied: the mailbox also holds
//   Square's receipts and everybody's newsletters.
//
// THE MAILBOX NEEDS `gmail.readonly`, beside `gmail.send` (docs/po-email-setup.md
// A2). With only 210's `gmail.metadata` every check fails, and says so on the
// tab, because a body cannot be read with it.
//
// The service_role client writes the copies and the check's own row, scoped
// by org_id explicitly since it bypasses RLS. A reply's log line goes through
// the CALLER's client, so it is the same insert the browser makes.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  gmailAccessToken,
  resolveTransport,
  sendMailWithIds,
  TransportError,
  type ProviderConfig,
} from "../_shared/email.ts";
import { bracketed, orderThread } from "../_shared/orderThread.ts";
import {
  baseSubject,
  formatAddresses,
  leaves,
  mailFilesFrom,
  orderNumbersIn,
  readMessage,
  type GmailMessage,
  type ReadMessage,
} from "../_shared/orderMail.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const ROLES = ["owner", "admin", "purchaser", "supervisor"];

/** How far back the FIRST check of a mailbox reads: a month of mail, so the
 *  tab opens with the conversations already under way. */
const FIRST_CHECK_DAYS = 30;
/** Each later check starts this far before the last one ended, so a message
 *  Gmail files a little late is not skipped. Copies are unique per message. */
const OVERLAP_MS = 60 * 60 * 1000;
/** At most this many messages read per check; the rest wait for the next. */
const PER_CHECK = 150;

type Org = { id: string; name: string; settings: Record<string, unknown> };

type SpecialOrderSettings = {
  email_provider?: ProviderConfig;
  reply_to?: string;
  thread_subject?: string;
  number_prefix?: string;
};

function moduleSettings(org: Org): SpecialOrderSettings {
  return ((org.settings ?? {}) as { special_orders?: SpecialOrderSettings }).special_orders ?? {};
}

function transportFor(org: Org) {
  const s = (org.settings ?? {}) as {
    email_provider?: ProviderConfig;
    billing?: { email?: string };
  };
  return resolveTransport({
    explicit: moduleSettings(org).email_provider,
    orgProvider: s.email_provider,
    orgName: org.name,
    replyToFallbacks: [moduleSettings(org).reply_to, s.billing?.email],
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  // --- the cron's door -----------------------------------------------------
  const presented = req.headers.get("x-order-mail-secret")?.trim();
  if (presented) {
    const secret = Deno.env.get("ORDER_MAIL_SECRET")?.trim();
    if (!secret || presented !== secret) return json(401, { error: "wrong secret" });
    const { data: orgs, error } = await admin.from("orgs").select("id, name, settings");
    if (error) return json(500, { error: error.message });
    const gmailOrgs = ((orgs ?? []) as Org[]).filter((o) => moduleSettings(o).email_provider?.kind === "gmail");
    // pg_net gives up waiting after 10 s; the check carries on regardless.
    const work = (async () => {
      for (const org of gmailOrgs) {
        const result = await checkMailbox(admin, org);
        if (result.error) console.error(`order-mail ${org.id}: ${result.error}`);
      }
    })();
    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(work);
      return json(202, { started: gmailOrgs.length });
    }
    await work;
    return json(200, { checked: gmailOrgs.length });
  }

  // --- a signed-in caller --------------------------------------------------
  const caller = createClient(URL_, ANON, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json(401, { error: "not signed in" });
  const { data: member } = await caller
    .from("org_members")
    .select("role, org_id, display_name")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!member || !ROLES.includes(member.role as string)) {
    return json(403, { error: "a supervisor or above is required for an order's email" });
  }
  const { data: org, error: orgErr } = await admin
    .from("orgs")
    .select("id, name, settings")
    .eq("id", member.org_id)
    .maybeSingle();
  if (orgErr || !org) return json(500, { error: orgErr?.message ?? "no org" });

  try {
    if (body.mode === "check") return json(200, await checkMailbox(admin, org as Org));
    if (body.mode === "reply") {
      return await reply(admin, caller, org as Org, {
        userId: user.id,
        author: (member.display_name as string | null) ?? user.email ?? null,
      }, body);
    }
    if (body.mode === "attachment") return await attachment(caller, org as Org, body);
    if (body.mode === "record") return await recordSent(admin, caller, org as Org, body);
    return json(400, { error: 'mode must be "check", "reply", "record" or "attachment"' });
  } catch (e) {
    if (e instanceof TransportError) return json(e.status, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------

async function gmail<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(`Gmail refused ${path.split("?")[0]}: ${message}`);
  }
  return data as T;
}

async function mailboxToken(org: Org): Promise<{ token: string; mailbox: string }> {
  const transport = transportFor(org);
  if (transport.cfg.kind !== "gmail") {
    throw new Error("the special-orders mailbox is not a Gmail account, so its email cannot be read");
  }
  const token = await gmailAccessToken(transport.creds as Record<string, string>);
  const profile = await gmail<{ emailAddress?: string }>(token, "/profile");
  if (!profile.emailAddress) throw new Error("Gmail did not say which mailbox this is");
  return { token, mailbox: profile.emailAddress.toLowerCase() };
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

type CheckResult = { read: number; copied: number; waiting_settled: number; error?: string };

async function checkMailbox(admin: SupabaseClient, org: Org): Promise<CheckResult> {
  const started = new Date();
  try {
    const { data: state } = await admin
      .from("special_order_mail_sync")
      .select("checked_to")
      .eq("org_id", org.id)
      .maybeSingle();
    const from = state?.checked_to
      ? new Date(new Date(state.checked_to as string).getTime() - OVERLAP_MS)
      : new Date(started.getTime() - FIRST_CHECK_DAYS * 86_400_000);

    const { token, mailbox } = await mailboxToken(org);

    // Every message since `from`, then only those not copied already.
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const q = encodeURIComponent(`after:${Math.floor(from.getTime() / 1000)} -in:drafts -in:chats`);
      const page = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(
        token,
        `/messages?q=${q}&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ""}`
      );
      for (const m of page.messages ?? []) ids.push(m.id);
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < 2000);

    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin
        .from("special_order_messages")
        .select("gmail_message_id")
        .eq("org_id", org.id)
        .in("gmail_message_id", ids.slice(i, i + 200));
      for (const r of data ?? []) known.add(r.gmail_message_id as string);
    }
    // Oldest first, so a conversation's first message ties it before its
    // replies are looked at, and a later check picks up where this stopped.
    const fresh = ids.filter((id) => !known.has(id)).reverse().slice(0, PER_CHECK);
    const truncated = ids.length - known.size > fresh.length;

    const touched = new Set<string>();
    let copied = 0;
    let lastSeen = from;
    for (const id of fresh) {
      const message = await gmail<GmailMessage>(token, `/messages/${id}?format=full`);
      const read = readMessage(message, mailbox);
      const at = new Date(Number(message.internalDate) || Date.now());
      if (at > lastSeen) lastSeen = at;
      if (!read.ok) continue;
      const match = await matchOrder(admin, org, message.threadId, read.message);
      if (!match) continue;
      const { error } = await admin.from("special_order_messages").upsert(
        rowFor(org.id, match.orderId, message, read.message, match.by),
        { onConflict: "org_id,gmail_message_id", ignoreDuplicates: true }
      );
      if (error) throw new Error(`a message could not be copied: ${error.message}`);
      touched.add(match.orderId);
      copied++;
    }

    let settled = 0;
    if (touched.size) {
      const { data, error } = await admin.rpc("settle_special_order_messages", { p_orders: [...touched] });
      if (error) throw new Error(`waiting mail could not be settled: ${error.message}`);
      settled = (data as number) ?? 0;
    }

    // A check that stopped at PER_CHECK resumes from the last message it read;
    // one that read everything is good up to when it started.
    await admin.from("special_order_mail_sync").upsert({
      org_id: org.id,
      checked_to: (truncated ? lastSeen : started).toISOString(),
      checked_at: new Date().toISOString(),
      last_error: null,
    });
    return { read: fresh.length, copied, waiting_settled: settled };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin.from("special_order_mail_sync").upsert({
      org_id: org.id,
      checked_at: new Date().toISOString(),
      last_error: message,
    });
    return { read: 0, copied: 0, waiting_settled: 0, error: message };
  }
}

function rowFor(
  orgId: string,
  orderId: string,
  message: GmailMessage,
  read: ReadMessage,
  by: "thread" | "subject" | "address" | "sent"
) {
  return {
    org_id: orgId,
    order_id: orderId,
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId,
    rfc_message_id: read.rfcMessageId,
    direction: read.direction,
    from_address: read.from.address,
    from_name: read.from.name,
    to_addresses: formatAddresses(read.to),
    cc_addresses: formatAddresses(read.cc),
    subject: read.subject,
    sent_at: read.sentAt,
    snippet: read.snippet,
    body_text: read.text,
    attachments: read.attachments,
    matched_by: by,
  };
}

/** `ilike` with the address taken literally — `_` is common in addresses
 *  and is a wildcard there. */
function literalLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function matchOrder(
  admin: SupabaseClient,
  org: Org,
  threadId: string,
  read: ReadMessage
): Promise<{ orderId: string; by: "thread" | "subject" | "address" } | null> {
  // 1. The conversation.
  const { data: inThread } = await admin
    .from("special_order_messages")
    .select("order_id")
    .eq("org_id", org.id)
    .eq("gmail_thread_id", threadId)
    .limit(1)
    .maybeSingle();
  if (inThread) return { orderId: inThread.order_id as string, by: "thread" };
  const { data: ownThread } = await admin
    .from("special_orders")
    .select("id")
    .eq("org_id", org.id)
    .eq("thread_conversation_id", threadId)
    .limit(2);
  if (ownThread?.length === 1) return { orderId: ownThread[0].id as string, by: "thread" };

  // 2. The order number in the subject.
  const numbers = orderNumbersIn(read.subject, moduleSettings(org).number_prefix);
  if (numbers.length) {
    const { data: named } = await admin
      .from("special_orders")
      .select("id")
      .eq("org_id", org.id)
      .eq("kind", "order")
      .in("number", numbers)
      .limit(2);
    if (named?.length === 1) return { orderId: named[0].id as string, by: "subject" };
  }

  // 3. The sender, against open orders. Ours are never matched this way: an
  //    email from the mailbox that no conversation ties is not about an order
  //    anybody can name.
  if (read.direction !== "in") return null;
  const address = read.from.address;
  const sinceDay = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const { data: customers } = await admin
    .from("customers")
    .select("id")
    .eq("org_id", org.id)
    .ilike("email", literalLike(address))
    .limit(20);
  const customerIds = (customers ?? []).map((c) => c.id as string);
  const openOrders = () =>
    admin
      .from("special_orders")
      .select("id")
      .eq("org_id", org.id)
      .eq("kind", "order")
      .neq("status", "cancelled")
      .gte("event_date", sinceDay)
      .limit(2);
  const [{ data: byContact }, { data: byCustomer }] = await Promise.all([
    openOrders().ilike("contact_email", literalLike(address)),
    customerIds.length ? openOrders().in("customer_id", customerIds) : Promise.resolve({ data: [] }),
  ]);
  const open = [...new Set([...(byContact ?? []), ...(byCustomer ?? [])].map((o) => o.id as string))];
  if (open.length === 1) return { orderId: open[0], by: "address" };
  return null;
}
// ---------------------------------------------------------------------------
// A reply
// ---------------------------------------------------------------------------

async function reply(
  admin: SupabaseClient,
  caller: SupabaseClient,
  org: Org,
  who: { userId: string; author: string | null },
  body: Record<string, unknown>
): Promise<Response> {
  const orderId = String(body.order_id ?? "");
  const to = String(body.to ?? "").trim();
  const cc = String(body.cc ?? "").trim();
  const text = String(body.body ?? "");
  const chosenSubject = String(body.subject ?? "").trim();
  if (!orderId || !to || !text.trim()) {
    return json(400, { error: "a reply needs order_id, to and a body" });
  }
  const extra = mailFilesFrom(body.files);
  if ("error" in extra) return json(400, { error: extra.error });

  // Through the CALLER's client: RLS decides whether they may see the order.
  const { data: order } = await caller
    .from("special_orders")
    .select("id, org_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.org_id !== org.id) return json(404, { error: "special order not found" });

  const transport = transportFor(org);
  const answeringId = body.answering ? String(body.answering) : null;
  const { data: answering } = answeringId
    ? await caller
        .from("special_order_messages")
        .select("gmail_thread_id, rfc_message_id, subject, order_id")
        .eq("id", answeringId)
        .maybeSingle()
    : { data: null };
  if (answeringId && (!answering || answering.order_id !== orderId)) {
    return json(404, { error: "the message being answered is not on this order" });
  }

  // In the conversation of the message it answers, under "Re: " its subject,
  // naming it — which is what threads for the customer AND in the mailbox.
  // With nothing to answer it goes into the order's own conversation (210).
  let subject: string;
  let headers: { inReplyTo?: string; references?: string; threadId?: string; messageId?: string };
  let record: ((sent: Awaited<ReturnType<typeof sendMailWithIds>>, subject: string) => Promise<string | null>) | null =
    null;
  if (answering) {
    const base = baseSubject(answering.subject as string | null);
    subject = base ? `Re: ${base}` : "Re:";
    const ref = answering.rfc_message_id ? bracketed(answering.rfc_message_id as string) : undefined;
    headers = { inReplyTo: ref, references: ref, threadId: answering.gmail_thread_id as string };
  } else {
    const thread = await orderThread(caller, orderId, transport.cfg.from, {
      org: org.name,
      template: moduleSettings(org).thread_subject,
    });
    if (!thread) return json(404, { error: "special order not found" });
    subject = thread.subject;
    headers = thread.headers;
    record = thread.record;
  }

  // The tab shows the subject and lets it be changed; what it sends wins.
  if (chosenSubject) subject = chosenSubject;
  const sent = await sendMailWithIds(transport, {
    to,
    cc: cc || undefined,
    subject,
    text,
    attachments: extra.files,
    ...headers,
  });

  /* ---- from here down, nothing may turn a sent email into a failure ---- */
  const warnings: string[] = [];
  if (record) {
    const problem = await record(sent, subject);
    if (problem) warnings.push(problem);
  }

  // Copy the reply in now rather than at the next check, so it is on the tab
  // when the page refreshes — and so it answers what it answers.
  const copyProblem = await copySent(admin, org, orderId, sent.ref);
  if (copyProblem) warnings.push(copyProblem);

  const { error: logError } = await caller.from("special_order_events").insert({
    org_id: org.id,
    order_id: orderId,
    message: `Reply emailed to ${to}${cc ? ` (cc ${cc})` : ""} · ${sent.ref}`,
    author: who.author,
    author_id: who.userId,
    source: "app",
  });
  if (logError) warnings.push(`the log entry was not written: ${logError.message}`);

  return json(200, {
    id: sent.ref,
    warning: warnings.length ? `sent, but ${warnings.join("; ")}` : undefined,
  });
}

/**
 * Copy one email this mailbox sent into the order, at once, and settle what it
 * answers. Returns a problem worth a warning, or null; never throws — the
 * email has gone either way, and the next check would copy it anyway.
 */
async function copySent(admin: SupabaseClient, org: Org, orderId: string, ref: string): Promise<string | null> {
  try {
    const { token, mailbox } = await mailboxToken(org);
    const gmailId = ref.replace(/^gmail\s+/, "");
    const message = await gmail<GmailMessage>(token, `/messages/${gmailId}?format=full`);
    const read = readMessage(message, mailbox);
    if (!read.ok) return null;
    const { error } = await admin.from("special_order_messages").upsert(
      rowFor(org.id, orderId, message, read.message, "sent"),
      { onConflict: "org_id,gmail_message_id", ignoreDuplicates: true }
    );
    if (error) return `the email was not copied to the order: ${error.message}`;
    const { error: settleError } = await admin.rpc("settle_special_order_messages", { p_orders: [orderId] });
    if (settleError) return `the order still shows as waiting: ${settleError.message}`;
    return null;
  } catch (e) {
    return `the email is not on the tab until the next check: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** `{ mode: "record" }` — see the header. The order goes through the CALLER's
 *  client, so RLS decides whether they may see it. */
async function recordSent(
  admin: SupabaseClient,
  caller: SupabaseClient,
  org: Org,
  body: Record<string, unknown>
): Promise<Response> {
  const orderId = String(body.order_id ?? "");
  const ref = String(body.ref ?? "");
  if (!orderId || !/^gmail\s+\S+$/.test(ref)) return json(400, { error: "record needs order_id and a gmail ref" });
  const { data: order } = await caller.from("special_orders").select("id, org_id").eq("id", orderId).maybeSingle();
  if (!order || order.org_id !== org.id) return json(404, { error: "special order not found" });
  const problem = await copySent(admin, org, orderId, ref);
  return json(200, { warning: problem ?? undefined });
}

// ---------------------------------------------------------------------------
// An attachment
// ---------------------------------------------------------------------------

async function attachment(caller: SupabaseClient, org: Org, body: Record<string, unknown>): Promise<Response> {
  const messageId = String(body.message_id ?? "");
  const partId = String(body.part_id ?? "");
  if (!messageId || !partId) return json(400, { error: "needs message_id and part_id" });

  // Through the caller's client, so RLS decides whether they may read it.
  const { data: row } = await caller
    .from("special_order_messages")
    .select("org_id, gmail_message_id, attachments")
    .eq("id", messageId)
    .maybeSingle();
  if (!row || row.org_id !== org.id) return json(404, { error: "message not found" });
  const file = ((row.attachments ?? []) as { part_id: string; filename: string; mime_type: string }[]).find(
    (a) => a.part_id === partId
  );
  if (!file) return json(404, { error: "that file is not on this message" });

  // Gmail's attachment id is minted afresh on every fetch, so the message is
  // read again and the part found by its place in it.
  const { token } = await mailboxToken(org);
  const message = await gmail<GmailMessage>(token, `/messages/${row.gmail_message_id}?format=full`);
  const part = leaves(message.payload).find((p) => p.partId === partId);
  const freshId = part?.body?.attachmentId;
  if (!freshId) return json(404, { error: "Gmail no longer has that file on the message" });
  const data = await gmail<{ data?: string }>(
    token,
    `/messages/${row.gmail_message_id}/attachments/${encodeURIComponent(freshId)}`
  );
  const base64 = (data.data ?? "").replace(/-/g, "+").replace(/_/g, "/");
  return json(200, { filename: file.filename, mime_type: file.mime_type, base64 });
}
