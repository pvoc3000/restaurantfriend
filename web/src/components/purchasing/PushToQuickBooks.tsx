"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeQbo } from "@/lib/qboClient";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { money } from "@/lib/purchaseOrders";
import { normalizeInvoiceNumber, pushIsStale } from "@/lib/invoices";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import {
  billPushRefusals,
  buildBillPayload,
  expenseAccountFor,
  type ResolvedAccount,
  type QboRefValue,
  pushedLabel,
  qboTrackingFor,
  qboVendorId,
  splitAccountName,
  attachableMetadata,
  attachableFromResponse,
  attachmentRefusal,
  attachmentsToSend,
  withAttachments,
  proposeBillLink,
  linkedRef,
  balanceLabel,
  type BillLinkProposal,
  type QboCandidate,
  type QboEntity,
  type AccountingRef,
  type BillInvoice,
  type VendorLocationAccounting,
} from "@/lib/quickbooks";

/** The clock reading beside a balance — one implementation for `checkBalance`
 *  and `link`, which both stamp a moment QuickBooks answered as of. */
function checkedAtLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Sending one approved invoice to QuickBooks.
 *
 * THE PAYLOAD IS BUILT HERE, by the pure `lib/quickbooks`, and `qbo-sync`
 * validates it against the invoice it names before posting. That split is
 * `freeze_pay_period`'s: the rule — a credit is a VendorCredit with a positive
 * amount, an update carries Id and SyncToken — lives once, in a module the
 * fixtures can reach, rather than in a Deno twin drifting from it.
 *
 * IT FETCHES ITS OWN CONTEXT rather than taking it as props. Both things it
 * needs are small reads that only matter when this block renders, and the
 * server view would otherwise carry two more queries on every invoice whether
 * or not QuickBooks is connected. `VendorAccounting` does the same.
 */

type Ctx = {
  connected: boolean;
  orgAccount: { ref: string | null; name: string | null } | null;
  vendorName: string;
  /** 083's row for THIS invoice's shop. Null when nobody has configured the
   *  vendor there — or when the migration is not applied yet. */
  atShop: VendorLocationAccounting | null;
  schemaError: string | null;
  invoiceRef: AccountingRef | null;
  /** What is filed on this bill. The `invoice` ones go up with it (Mark,
   *  2026-09-02) — a two-page scan is two rows and QuickBooks should get both. */
  documents: { id: string; kind: string | null; file_name: string | null; content_type: string | null; storage_path: string }[];
};

export function PushToQuickBooks({
  invoiceId,
  vendorId,
  locationId,
  orgId,
  status,
  total,
  isCredit,
  invoiceNumber,
  invoiceDate,
  dueDate,
  financialsTouchedAt,
  syncedAt,
  canPush,
  supabase,
  onDone,
}: {
  invoiceId: string;
  vendorId: string;
  /** The invoice's own shop — `vendor_invoices.location_id`, NOT NULL. */
  locationId: string;
  orgId: string;
  status: "open" | "approved" | "void";
  total: number | null;
  isCredit: boolean;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  /** 089's pair — see `pushIsStale`. */
  financialsTouchedAt: string | null;
  syncedAt: string | null;
  /** purchaser+, matching what `record_accounting_push` will accept. */
  canPush: boolean;
  supabase: SupabaseClient;
  onDone: () => void;
}) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  /** What QuickBooks already has under this number. Null while unasked. */
  const [proposal, setProposal] = useState<BillLinkProposal | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  /** Mid the click-time duplicate lookup (see `push()`) — distinct from
   *  `busy`, which covers the SEND itself, so the button can say "Checking…"
   *  during the lookup and "Sending…" only once it actually knows there's
   *  nothing to link to. */
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  /** What QuickBooks says is still owed. HELD IN STATE AND NEVER STORED — see
   *  `refresh_status`. It disappears on reload, which is honest: a balance kept
   *  in our row would be stale the moment it landed and shown as if current. */
  const [balance, setBalance] = useState<{ text: string; at: string } | null>(null);
  /** QuickBooks answered, and the document it names is not there. Kept apart
   *  from `balance` because it is the one answer that needs an ACTION rather
   *  than a figure — see `unlink`. */
  const [gone, setGone] = useState(false);

  /**
   * THE ACTIVE OFFER's trigger (Mark, 2026-09-03, on top of a passive note he
   * already had: "how about offering to resync once the invoice is
   * reapproved?"). Fires once, the instant `status` transitions INTO
   * "approved" while this bill is linked, stale and pushable.
   *
   * HOOKS FIRST, CONDITION LATER — this has to live above the two early
   * returns below (no `ctx` yet; not connected), because React requires every
   * hook to run in the same order on every render. The real condition
   * (`already`, `stale`, `refusals`) is not knowable until AFTER those
   * returns, once `ctx` has resolved — so rather than share the main render
   * body's locals (which don't exist yet from a hook's vantage point), the
   * effect below recomputes the small amount of business logic itself,
   * reading `ctx` STATE directly. A "latest ref" written during render was
   * the first attempt and `react-hooks/refs` refuses it outright — mutating a
   * ref outside an effect is exactly what that rule exists to catch.
   *
   * Seeded to the CURRENT status on mount, not null, so loading an
   * already-approved, already-stale invoice does not itself read as a
   * transition — only a live re-approval witnessed within this page session
   * does. The passive note in the prose stack below covers "reloaded later,
   * still stale"; this covers the moment the cycle actually closes.
   */
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prevStatus === "approved" || status !== "approved") return;
    // SELF-CONTAINED, reading `ctx` STATE directly rather than the local
    // consts the main render body derives below — those live textually AFTER
    // this component's two early returns, and a hook (this effect) cannot,
    // so the small amount of business logic below is recomputed rather than
    // shared. `react-hooks/refs` refuses a "latest ref" written during render
    // as the alternative — mutating a ref outside an effect is exactly what
    // it exists to catch, so this effect does the whole job itself instead.
    if (!ctx || !ctx.connected) return;
    const already = pushedLabel(ctx.invoiceRef);
    const stale = pushIsStale({
      financials_touched_at: financialsTouchedAt,
      synced_at: syncedAt,
    });
    if (!already || !stale || !canPush) return;
    const account = expenseAccountFor(ctx.atShop, ctx.orgAccount);
    const vendorRef = qboVendorId(ctx.atShop?.external_ref ?? null);
    const refusals = billPushRefusals({
      invoice: {
        id: invoiceId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
        total,
        is_credit: isCredit,
        status,
        external_ref: ctx.invoiceRef,
      },
      vendorRef,
      vendorName: ctx.vendorName,
      accountRef: account?.ref ?? null,
    });
    if (refusals.length > 0) return;
    if (!account) return;
    const tracking = qboTrackingFor(ctx.atShop);
    const billInvoice: BillInvoice = {
      id: invoiceId,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: dueDate,
      total,
      is_credit: isCredit,
      status,
      external_ref: ctx.invoiceRef,
    };
    // ITS OWN CONFIRM, WORDED FOR THIS MOMENT rather than `push()`'s — reusing
    // that one would show a SECOND, differently-worded dialog asking the same
    // question the person just answered by re-approving.
    void (async () => {
      const ok = await confirmDialog({
        ...splitConfirmMessage(
          `This bill was edited since it was sent to QuickBooks.\n\n` +
            `Update it now to keep the two in sync?`
        ),
        confirmLabel: "Update in QuickBooks",
      });
      if (!ok) return;
      await sendToQuickBooks({ ctx, billInvoice, account, vendorRef, tracking });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, ctx, financialsTouchedAt, syncedAt, canPush]);

  const readContext = useCallback(async (): Promise<Ctx> => {
    const [conn, vendor, invoice, atShop, docs] = await Promise.all([
      supabase.rpc("accounting_connection_status", { p_org: orgId }),
      supabase.from("vendors").select("name").eq("id", vendorId).maybeSingle(),
      supabase.from("vendor_invoices").select("external_ref").eq("id", invoiceId).maybeSingle(),
      // Separate and allowed to fail: these columns arrive with 083, and
      // folding them into a query the rest of the block depends on would take
      // the whole thing down until it is applied.
      supabase
        .from("vendor_locations")
        .select(
          "external_ref, expense_account_ref, expense_account_name, qbo_location_ref, qbo_location_name, qbo_class_ref, qbo_class_name"
        )
        .eq("vendor_id", vendorId)
        .eq("location_id", locationId)
        .maybeSingle(),
      supabase
        .from("purchase_order_attachments")
        .select("id, kind, file_name, content_type, storage_path")
        .eq("invoice_id", invoiceId),
    ]);

    const row = Array.isArray(conn.data)
      ? (conn.data[0] as
          | { status?: string; bill_expense_account_ref?: string | null; bill_expense_account_name?: string | null }
          | undefined)
      : undefined;

    return {
      connected: row?.status === "connected",
      orgAccount: row
        ? { ref: row.bill_expense_account_ref ?? null, name: row.bill_expense_account_name ?? null }
        : null,
      vendorName: (vendor.data?.name as string) ?? "this vendor",
      atShop: (atShop.data ?? null) as VendorLocationAccounting | null,
      schemaError: atShop.error?.message ?? null,
      invoiceRef: (invoice.data?.external_ref ?? null) as AccountingRef | null,
      documents: (docs.data ?? []) as Ctx["documents"],
    };
  }, [supabase, orgId, vendorId, locationId, invoiceId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await readContext();
      if (!cancelled) setCtx(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [readContext]);

  /**
   * THE ACTUAL SEND, with no confirm of its own — `push()` and the
   * re-approval offer below both confirm first, in their own words, and then
   * call this. One implementation of the mechanics, two call sites, matching
   * 013's precedent: a stale-figures resync and a fresh send are the same
   * act, and duplicating the attachment/record-ref plumbing between them is
   * exactly how the two would drift.
   *
   * TAKES ITS INPUTS AS PARAMETERS rather than closing over the render
   * body's locals, which is what lets it be DECLARED HERE — above the two
   * early returns below, alongside the hooks — while `push()` still calls it
   * from much further down, after those returns. `ctx`/`billInvoice`/
   * `account`/`vendorRef`/`tracking` don't exist yet from a hook's vantage
   * point; taking them as arguments means this function doesn't need them to
   * exist until it is actually CALLED, which both call sites already
   * guarantee before calling it.
   */
  async function sendToQuickBooks(input: {
    ctx: Ctx;
    billInvoice: BillInvoice;
    account: ResolvedAccount;
    vendorRef: string | null;
    tracking: { location: QboRefValue | null; klass: QboRefValue | null };
  }) {
    const { ctx: liveCtx, billInvoice, account, vendorRef, tracking } = input;
    const qboRefId = liveCtx.invoiceRef?.qbo?.id ?? null;
    const { entity, body: payload } = buildBillPayload({
      invoice: billInvoice,
      vendorRef,
      vendorName: liveCtx.vendorName,
      accountRef: account.ref,
      department: tracking.location,
      klass: tracking.klass,
    });

    setBusy(true);
    setError(null);
    setWarnings([]);

    // THE SCAN GOES WITH THE BILL (Mark, 2026-09-02). Only what is filed as an
    // `invoice`, and only what is not already up there: a second upload of the
    // same file makes a SECOND attachment — QuickBooks has no upsert, measured.
    const localWarnings: string[] = [];
    const files = attachmentsToSend(liveCtx.documents, liveCtx.invoiceRef)
      .filter((d) => {
        const no = attachmentRefusal(d.content_type, d.file_name);
        if (no) localWarnings.push(no);
        return !no;
      })
      .map((d) => ({
        key: d.id,
        file_name: d.file_name ?? "invoice.pdf",
        content_type: d.content_type ?? "application/pdf",
        storage_path: d.storage_path,
        // The server overwrites the entity ref with the bill it really wrote;
        // this composes the shape and `IncludeOnSend: false`.
        metadata: attachableMetadata({
          entity,
          entityId: qboRefId ?? "0",
          fileName: d.file_name ?? "invoice.pdf",
          contentType: d.content_type ?? "application/pdf",
        }),
      }));

    const { data, message } = await invokeQbo(supabase, {
      mode: "push_bill",
      invoice_id: invoiceId,
      entity,
      payload,
      ...(files.length ? { attachments: files } : {}),
    });
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }

    // A refusal arrives as HTTP 200 with a Fault inside the item, so the status
    // said nothing — the pure rule reads it.
    const added: Record<string, string> = {};
    for (const r of (data?.attachment_results as { key: string; response?: unknown; error?: string }[]) ?? []) {
      if (r.error) { localWarnings.push(r.error); continue; }
      const read = attachableFromResponse(r.response);
      if (read.ok) added[r.key] = read.id;
      else localWarnings.push(`The invoice scan was not attached: ${read.message}`);
    }
    if (Object.keys(added).length > 0) {
      // Recorded through 081's definer, like the push itself — `external_ref`
      // is writable straight through PostgREST otherwise, which is the whole
      // reason that function exists. Its merge replaces the `qbo` branch whole,
      // so the full branch goes back.
      // THE REF THE SERVER RECORDED, added to — never rebuilt from parts. Its
      // `sync_token` is the one AFTER the attachment, because attaching a file
      // bumps the bill's own token and the push response predates that.
      const ref = withAttachments(data!.ref as AccountingRef, added);
      const { data: rec, error: refErr } = await supabase.rpc("record_accounting_push", {
        p_invoice: invoiceId,
        p_ref: ref,
      });
      if (refErr || !Array.isArray(rec) || rec.length === 0) {
        localWarnings.push("The scan went up but was not recorded, so pushing again would attach a second copy.");
      }
    }

    setWarnings([...((data?.warnings as string[]) ?? []), ...localWarnings]);
    setSent(
      `${data?.updated ? "Updated" : "Sent"} as ${entity} ${
        (data?.doc_number as string) ?? (data?.qbo_id as string)
      }`
    );
    setCtx(await readContext());
    onDone();
  }

  // STILL DECIDING — a same-shaped placeholder holds the space rather than
  // showing nothing for the beat before the connection check resolves
  // (Mark, 2026-09-03: "place a dummy button and prose in place just as a
  // placeholder while the app is deciding what to actually show"). It is
  // deliberately BLANK rather than a guess at the real label — at this point
  // we don't yet know whether this becomes Send, Update, or nothing at all
  // (the org may not be connected), and a placeholder that claims a specific
  // action would be worse than one that claims nothing. (Link to QuickBooks
  // is never a first-paint state anyway — see `push()` — it only appears
  // after Send is clicked and finds a duplicate.)
  // `aria-hidden` because there is no content here for a screen reader to
  // announce, only a shape.
  if (!ctx) {
    return (
      <div className="flex flex-col items-end gap-1.5" aria-hidden="true">
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          <span className="h-9 w-40 border border-hairline bg-neutral-50" />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          <span className="h-[13px] w-48 bg-neutral-50" />
        </div>
      </div>
    );
  }

  // NOTHING AT ALL once we know: an invoice screen is not the place to
  // advertise a feature nobody has set up.
  if (!ctx.connected) return null;

  const account = expenseAccountFor(ctx.atShop, ctx.orgAccount);
  // The mapping is the SHOP's now, not the vendor's — 026's column, finally read.
  const vendorRef = qboVendorId(ctx.atShop?.external_ref ?? null);
  const tracking = qboTrackingFor(ctx.atShop);
  const billInvoice: BillInvoice = {
    id: invoiceId,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    due_date: dueDate,
    total,
    is_credit: isCredit,
    status,
    external_ref: ctx.invoiceRef,
  };
  const refusals = billPushRefusals({
    invoice: billInvoice,
    vendorRef,
    vendorName: ctx.vendorName,
    accountRef: account?.ref ?? null,
  });
  const already = pushedLabel(ctx.invoiceRef);
  /** The refusal worth words. `billPushRefusals` still returns the approval one
   *  — the BUTTON is still correctly disabled by it — this only declines to
   *  restate it beside the control that settles it. */
  const shownRefusal = refusals.find((r) => !/approve it first/i.test(r)) ?? null;
  /** Edited since the last push — see `pushIsStale`. Only meaningful once
   *  `already`, which is why every use of it below is gated on that too.
   *  (The active-offer effect near the top of the component recomputes this
   *  itself, from `ctx` state directly — see its own comment for why.) */
  const stale = pushIsStale({
    financials_touched_at: financialsTouchedAt,
    synced_at: syncedAt,
  });

  async function checkBalance() {
    setBusy(true);
    setError(null);
    const { data, message } = await invokeQbo(supabase, {
      mode: "refresh_status",
      invoice_ids: [invoiceId],
    });
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    const st = ((data?.statuses as Record<string, unknown>[]) ?? [])[0];
    if (!st) return;
    const at = checkedAtLabel(data!.checked_at as string);
    // Missing is its own answer: a document deleted or voided in QuickBooks
    // must not read as paid in full.
    if (st.missing) {
      setBalance({ text: "no longer in QuickBooks", at });
      setGone(true);
      return;
    }
    setGone(false);
    setBalance({ text: balanceLabel(st.entity as QboEntity, Number(st.balance), money), at });
  }

  async function push() {
    // THE DUPLICATE CHECK MOVED HERE, FROM PAGE LOAD (Mark, 2026-09-03: "just
    // check when the user clicks send… not when the page loads"). It only
    // applies to a first SEND — an already-linked bill has nothing to
    // duplicate, so `already` skips straight to the ordinary confirm below.
    //
    // FOUND MEANS STOP, NOT WARN. The old flow let you send anyway, past a
    // "makes a SECOND one" caveat in the confirm; this one doesn't reach the
    // confirm at all. `setProposal` is what swaps the button from Send to
    // Link (see the render below) — there is no path from here back to
    // sending once QuickBooks says it already has this bill, matching Mark's
    // "if the user doesn't want to link, we don't do anything."
    if (!already) {
      setCheckingDuplicate(true);
      const { data, message } = await invokeQbo(supabase, {
        mode: "find_bills",
        invoice_ids: [invoiceId],
      });
      setCheckingDuplicate(false);
      if (!message) {
        const found = proposeBillLink(
          {
            invoice_number: invoiceNumber,
            total,
            is_credit: isCredit,
            external_ref: ctx!.invoiceRef,
          },
          (data?.candidates as QboCandidate[]) ?? [],
          vendorRef,
          normalizeInvoiceNumber
        );
        if (found.ok) {
          setProposal(found);
          return;
        }
      }
      // No duplicate — or the lookup itself failed, which is a convenience
      // and not the screen's job to enforce — either way, fall through to
      // the ordinary send below exactly as if nothing had been checked.
    }

    const where = splitAccountName(account!.name).leaf || account!.ref;
    const ok = await confirmDialog({
      ...splitConfirmMessage(
        `${already ? "Update" : "Send"} this ${isCredit ? "credit" : "bill"} in QuickBooks?\n\n` +
          `${ctx!.vendorName} · ${invoiceNumber ?? "no number"} · $${Number(total).toFixed(2)}\n` +
          `Posts to ${where}${account!.source === "org" ? " (the org default)" : ""}` +
          `${tracking.location ? `\nLocation: ${tracking.location.name ?? tracking.location.ref}` : ""}` +
          `${tracking.klass ? `\nClass: ${tracking.klass.name ?? tracking.klass.ref}` : ""}`
      ),
      confirmLabel: already ? "Update" : "Send",
    });
    if (!ok) return;
    await sendToQuickBooks({ ctx: ctx!, billInvoice, account: account!, vendorRef, tracking });
  }

  /** Adopt the bill QuickBooks already has. Writes the SAME ref a push would,
   *  through the same definer, so everything downstream — attachments, the
   *  balance, the "In QuickBooks as…" line — cannot tell the two apart. */
  async function link(candidate: QboCandidate) {
    const ok = await confirmDialog({
      ...splitConfirmMessage(
        `Link this bill to the one already in QuickBooks?\n\n` +
          `${candidate.entity} ${candidate.doc_number ?? candidate.id} · ` +
          `${candidate.vendor_name ?? "unknown vendor"} · ` +
          `${candidate.txn_date ?? "no date"} · $${candidate.total.toFixed(2)}\n` +
          `Nothing is created in QuickBooks. This app stops offering to send it, ` +
          `and starts showing what it still owes.`
      ),
      confirmLabel: "Link",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    const { data: rec, error: refErr } = await supabase.rpc("record_accounting_push", {
      p_invoice: invoiceId,
      p_ref: linkedRef(candidate),
    });
    if (refErr || !Array.isArray(rec) || rec.length === 0) {
      setBusy(false);
      setError(refErr?.message ?? "That could not be recorded here, so nothing was linked.");
      return;
    }

    // THE BALANCE ARRIVED WITH THE CANDIDATE (Mark, 2026-09-03: "is it
    // possible to check to see if it's paid and set the status then, rather
    // than forcing the user to check in a separate step?"). `find_bills`
    // already asked QuickBooks for `Balance` on every candidate it offered
    // — that is the same fact `checkBalance` would go and fetch a second
    // time — so it is written here through the SAME plain update
    // `refresh_status` uses on 088's cache. Not through the definer: that
    // one exists to stop a purchaser INVENTING a QuickBooks id, and there is
    // no equivalent risk in recording a figure QuickBooks itself just
    // returned.
    //
    // Null only when QuickBooks answered with no `Balance` at all, which a
    // real Bill or VendorCredit does not do — left for `checkBalance` rather
    // than guessed at. And SOFT: the link itself already succeeded, so a
    // failure here is a warning, not a reason to report the whole thing as
    // having failed.
    if (candidate.balance !== null) {
      const checkedAt = new Date().toISOString();
      const { data: cached, error: balErr } = await supabase
        .from("vendor_invoices")
        .update({ qbo_balance: candidate.balance, qbo_checked_at: checkedAt })
        .eq("id", invoiceId)
        .select("id");
      if (balErr || !cached || cached.length === 0) {
        setWarnings((prev) => [
          ...prev,
          "Linked, but the balance could not be recorded here — press Check QuickBooks to see it.",
        ]);
      } else {
        setBalance({
          text: balanceLabel(candidate.entity, candidate.balance, money),
          at: checkedAtLabel(checkedAt),
        });
      }
    }

    setBusy(false);
    setProposal(null);
    setCtx(await readContext());
    onDone();
  }

  /**
   * Forget the QuickBooks document this bill claims to be.
   *
   * WITHOUT THIS THE BILL IS STUCK, which is how it was found (Mark,
   * 2026-09-02, having pushed one and then deleted it in QuickBooks): it cannot
   * update — the document is gone — it cannot create, because `pushMode` reads
   * the stored id and answers "update", and it cannot LINK, because the
   * proposal is only offered on an unlinked bill. Three doors, all shut by the
   * same dead id.
   *
   * IT IS A HUMAN ACT, NOT AN AUTO-CLEAR ON `missing`. Absence has more causes
   * than deletion, and a silent unlink followed by a push is how you get the
   * duplicate this whole module is arranged to avoid. So QuickBooks' answer is
   * reported and the person decides — the receiving screen's posture.
   *
   * A DIRECT UPDATE, not `record_accounting_push`, and the asymmetry is the
   * argument: that definer exists so a purchaser cannot INVENT a QuickBooks id,
   * and removing a claim is strictly safe where making one is not. It also
   * stamps `synced_at = now()`, which on an unlink would assert a sync that did
   * not happen.
   */
  async function unlink() {
    const ok = await confirmDialog({
      ...splitConfirmMessage(
        gone
          ? `Forget the QuickBooks link?\n\nQuickBooks no longer has the document this ` +
            `bill points at, so the link means nothing. Nothing is deleted anywhere. ` +
            `Afterwards this bill can be linked to the right one, or sent afresh.`
          : `Forget the QuickBooks link?\n\nThe document STAYS in QuickBooks — this only ` +
            `stops this bill pointing at it. Sending afterwards would create a SECOND one, ` +
            `so link it to the right document rather than sending, unless you mean to.`
      ),
      confirmLabel: "Forget it",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    // Its own row count: 025's update policy is purchaser+, so below that this
    // changes nothing and returns NO error — the cheerful-success trap.
    const { data: cleared, error: clearErr } = await supabase
      .from("vendor_invoices")
      .update({ external_ref: {}, synced_at: null })
      .eq("id", invoiceId)
      .select("id");
    setBusy(false);
    if (clearErr || !cleared || cleared.length === 0) {
      setError(clearErr?.message ?? "That could not be changed here, so nothing was unlinked.");
      return;
    }
    setBalance(null);
    setGone(false);
    setSent(null);
    // Re-reading is what makes this one step rather than two: the proposal
    // effect is gated on there being no link, so it runs again and offers the
    // right document by itself.
    setCtx(await readContext());
    onDone();
  }

  // TWO PACKED ROWS, not a 2x2 GRID (Mark, 2026-09-03, on the grid's own
  // gap: "the quickbooks buttons and prose together, not separated"). Equal
  // grid tracks put "Update in QuickBooks" and "Check QuickBooks" a whole
  // column-width apart, because each was right-aligned inside its OWN half
  // of the box rather than packed against its neighbour — the same fault
  // for "In QuickBooks as Bill X" and "Forget the link" below it.
  //
  // A flex row with `justify-end` packs its children against each other AND
  // the right edge in one motion, which is what a grid track cannot do
  // without knowing the content's width in advance:
  //
  //   [Update in QuickBooks] [Check QuickBooks]
  //   In QuickBooks as Bill X [Forget the link]
  //
  // Everything else — the proposal banner, the gone banner, refusals,
  // balance, sent, warnings, error — stays a stack of full-width lines below
  // both rows, since inlining a wrapped paragraph beside a button is what the
  // grid was already doing badly.
  return (
    <div className="flex flex-col items-end gap-1.5">
      {/* ROW 1 — every button that DOES something, packed together.
          SAME GAP AS THE ACTIONS ROW (`gap-x-3 gap-y-2`, Mark, 2026-09-03) —
          it had been `gap-2` throughout, which read as tighter than Void ·
          Delete · Withdraw approval beside it for no reason other than the
          two components never having compared notes. */}
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
        {/* IT IS ALREADY OVER THERE — found at the moment Send was
            clicked, not on load. SEND ITSELF IS HIDDEN once this is known
            (Mark, 2026-09-03: "hide the 'Send to Quickbooks' button so the
            user can only link"), because sending now would only ever create
            a second document — there is no reading of the button that still
            means "send" once QuickBooks says it already has this bill. */}
        {proposal?.ok && !already && canPush && (
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={busy}
            onClick={() => void link(proposal.candidate)}
          >
            {busy ? "Linking…" : "Link to QuickBooks"}
          </button>
        )}
        {canPush && !(proposal?.ok && !already) && (
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={busy || checkingDuplicate || refusals.length > 0}
            onClick={() => void push()}
          >
            {checkingDuplicate
              ? "Checking…"
              : busy
                ? "Sending…"
                : already
                  ? "Update in QuickBooks"
                  : `Send to QuickBooks`}
          </button>
        )}
        {/* SAME DRESS AS "Update in QuickBooks" (Mark, 2026-09-03) — it had
            been a quiet underline, which read as less of a real command than
            the button beside it, though pressing it does exactly the same
            kind of thing: talk to QuickBooks and report back what it said. */}
        {already && (
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={busy}
            onClick={() => void checkBalance()}
          >
            {busy ? "Checking…" : "Check QuickBooks"}
          </button>
        )}
      </div>

      {/* ROW 2 — what column 1 produced, packed against the one act that
          undoes it. */}
      {(already || (gone && canPush)) && (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-[13px]">
          {already && <span className="text-muted">{already}</span>}
          {already && canPush && !gone && (
            <button
              type="button"
              className="text-[13px] text-muted underline decoration-neutral-400 underline-offset-[3px] hover:text-ink hover:decoration-neutral-900 disabled:opacity-35"
              disabled={busy}
              onClick={() => void unlink()}
            >
              Forget the link
            </button>
          )}
          {/* THE DOCUMENT IS GONE AND THE BILL IS STUCK UNTIL THIS IS
              PRESSED — it can neither update, nor create, nor be linked
              while it points at a dead id. A full button, not the quiet
              underline above: this one is urgent. */}
          {gone && canPush && (
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={busy}
              onClick={() => void unlink()}
            >
              {busy ? "Forgetting…" : "Forget the link"}
            </button>
          )}
        </div>
      )}

      {/* EVERYTHING ELSE — full-width lines, stacked, right-aligned. */}
      <div className="w-full space-y-1 text-right text-[13px]">
        {/* THE PASSIVE HALF of Mark's ask — the ACTIVE half is `offerResync`,
            fired once from the effect above at the moment of re-approval.
            This is what covers a reload afterwards, when that moment has
            already passed: yellow, worth your eye, not an error — the same
            "Update in QuickBooks" button above already does exactly this. */}
        {already && stale && (
          <p className="bg-mark-fill px-2 py-1 text-ink">
            Edited since it was sent to QuickBooks — Update in QuickBooks to
            keep them in sync.
          </p>
        )}
        {/* Yellow, because this is not an error — it is the normal state
            during the Bill.com parallel run, and the thing worth your eye is
            that pressing Send would make a second copy. */}
        {proposal?.ok && !already && (
          <div className="space-y-1 bg-mark-fill px-2 py-1 text-right text-ink">
            <p>
              QuickBooks already has this as {proposal.candidate.entity}{" "}
              {proposal.candidate.doc_number ?? proposal.candidate.id} —{" "}
              {proposal.candidate.vendor_name ?? "unknown vendor"} ·{" "}
              {proposal.candidate.txn_date ?? "no date"} · $
              {proposal.candidate.total.toFixed(2)}.
            </p>
            {proposal.caveat && <p>{proposal.caveat}</p>}
          </div>
        )}
        {/* Red rather than the mark colour: this is not "worth your eye", the
            record here disagrees with QuickBooks and one of them is wrong. */}
        {gone && (
          <div className="space-y-1 border border-accent px-2 py-1 text-right text-ink">
            <p>
              QuickBooks no longer has{" "}
              {already?.replace("In QuickBooks as ", "") ?? "that document"}.
              It was deleted there, so this bill points at nothing and can be
              neither updated nor sent until the link is forgotten.
            </p>
          </div>
        )}
        {/* Why the button is off, in words. A disabled control explains
            itself only on hover, and the iPad has none. NOT THE APPROVAL
            REFUSAL — "Approve it first" earned its place while this block sat
            at the foot of the page; beside the Approve button itself it is a
            sentence explaining a button by pointing at the button next to
            it. */}
        {canPush && shownRefusal && <p className="text-muted">{shownRefusal}</p>}
        {!refusals.length && account && !already && (
          <p className="text-faint">
            Posts to {splitAccountName(account.name).leaf || account.ref}
            {account.source === "org" ? " (the org default)" : ""}.
          </p>
        )}
        {balance && (
          <p className="text-muted">
            {balance.text}{" "}
            <span className="text-faint">· as of {balance.at}</span>
          </p>
        )}
        {sent && <p className="text-muted">{sent}</p>}
        {/* The bill IS in QuickBooks — this is not an error. It is the coding
            QuickBooks accepted and then dropped, which it does with a 200 and
            no fault when the matching preference is off. Yellow: worth your
            eye, not something that went wrong. */}
        {warnings.map((w) => (
          <p key={w} className="bg-mark-fill px-2 py-1 text-ink">
            {w}
          </p>
        ))}
        {error && <p className="text-accent">{error}</p>}
      </div>
    </div>
  );
}
