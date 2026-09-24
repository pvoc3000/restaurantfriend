import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeQbo } from "@/lib/qboClient";
import {
  attachableFromResponse,
  attachableMetadata,
  attachmentRefusal,
  attachmentsToSend,
  buildBillPayload,
  withAttachments,
  type AccountingRef,
  type PushableBill,
  type QboEntity,
  type QboRefValue,
  type ResolvedAccount,
  type VendorLocationAccounting,
} from "@/lib/quickbooks";

/**
 * SENDING A BILL TO QUICKBOOKS, ONE IMPLEMENTATION BEHIND TWO DOORS — the
 * bill record's Send/Update (`PushToQuickBooks`) and the list's batch Push
 * to QuickBooks (`BillBatchActions`, Mark, 2026-09-16). What gets remembered
 * in one copy and forgotten in the other is exactly what lives here: the scan
 * going up only once (QuickBooks has no upsert), a refused attachment arriving
 * as HTTP 200, and the ref being recorded through 081's definer with the token
 * from AFTER the attachment.
 *
 * Client-side, not `lib/`: it takes the browser client and calls the edge
 * function, and `lib/quickbooks` must stay pure for the fixture run.
 */

export type BillPushContext = {
  connected: boolean;
  orgAccount: { ref: string | null; name: string | null } | null;
  vendorName: string;
  /** `orgs.name`, for the memo on the QuickBooks bill. */
  orgName: string;
  /** 083's row for THIS invoice's shop. Null when nobody has configured the
   *  vendor there — or when the migration is not applied yet. */
  atShop: VendorLocationAccounting | null;
  schemaError: string | null;
  billRef: AccountingRef | null;
  /** What is filed on this bill. The `invoice` ones go up with it (Mark,
   *  2026-09-02) — a two-page scan is two rows and QuickBooks should get both. */
  documents: {
    id: string;
    kind: string | null;
    file_name: string | null;
    content_type: string | null;
    storage_path: string;
  }[];
};

export async function readBillPushContext(
  supabase: SupabaseClient,
  ids: { orgId: string; vendorId: string; locationId: string; billId: string }
): Promise<BillPushContext> {
  const { orgId, vendorId, locationId, billId } = ids;
  const [conn, vendor, invoice, atShop, docs, org] = await Promise.all([
    supabase.rpc("accounting_connection_status", { p_org: orgId }),
    supabase.from("vendors").select("name").eq("id", vendorId).maybeSingle(),
    supabase.from("vendor_bills").select("external_ref").eq("id", billId).maybeSingle(),
    // Separate and allowed to fail: these columns arrive with 083, and folding
    // them into a query the rest depends on would take the whole thing down
    // until it is applied.
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
      .eq("bill_id", billId),
    supabase.from("orgs").select("name").eq("id", orgId).maybeSingle(),
  ]);

  const row = Array.isArray(conn.data)
    ? (conn.data[0] as
        | {
            status?: string;
            bill_expense_account_ref?: string | null;
            bill_expense_account_name?: string | null;
          }
        | undefined)
    : undefined;

  return {
    connected: row?.status === "connected",
    orgAccount: row
      ? { ref: row.bill_expense_account_ref ?? null, name: row.bill_expense_account_name ?? null }
      : null,
    vendorName: (vendor.data?.name as string) ?? "this vendor",
    orgName: (org.data?.name as string | undefined) ?? "",
    atShop: (atShop.data ?? null) as VendorLocationAccounting | null,
    schemaError: atShop.error?.message ?? null,
    billRef: (invoice.data?.external_ref ?? null) as AccountingRef | null,
    documents: (docs.data ?? []) as BillPushContext["documents"],
  };
}

export type BillSendResult =
  | { ok: false; message: string }
  | {
      ok: true;
      entity: QboEntity;
      /** What QuickBooks calls it — its DocNumber, or its Id without one. */
      label: string;
      updated: boolean;
      warnings: string[];
    };

/**
 * THE SEND, with no confirm of its own — every caller confirms first, in its
 * own words, and checks for a duplicate before a first send (`find_bills`).
 */
export async function sendBillToQuickBooks(
  supabase: SupabaseClient,
  input: {
    billId: string;
    ctx: BillPushContext;
    bill: PushableBill;
    account: ResolvedAccount;
    vendorRef: string | null;
    tracking: { location: QboRefValue | null; klass: QboRefValue | null };
  }
): Promise<BillSendResult> {
  const { billId, ctx, bill, account, vendorRef, tracking } = input;
  const qboRefId = ctx.billRef?.qbo?.id ?? null;
  const { entity, body: payload } = buildBillPayload({
    bill: bill,
    vendorRef,
    vendorName: ctx.vendorName,
    orgName: ctx.orgName,
    accountRef: account.ref,
    department: tracking.location,
    klass: tracking.klass,
  });

  // THE SCAN GOES WITH THE BILL (Mark, 2026-09-02). Only what is filed as an
  // `invoice`, and only what is not already up there: a second upload of the
  // same file makes a SECOND attachment — QuickBooks has no upsert, measured.
  const warnings: string[] = [];
  const files = attachmentsToSend(ctx.documents, ctx.billRef)
    .filter((d) => {
      const no = attachmentRefusal(d.content_type, d.file_name);
      if (no) warnings.push(no);
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
    bill_id: billId,
    entity,
    payload,
    ...(files.length ? { attachments: files } : {}),
  });
  if (message) return { ok: false, message };

  // A refusal arrives as HTTP 200 with a Fault inside the item, so the status
  // said nothing — the pure rule reads it.
  const added: Record<string, string> = {};
  for (const r of (data?.attachment_results as { key: string; response?: unknown; error?: string }[]) ??
    []) {
    if (r.error) {
      warnings.push(r.error);
      continue;
    }
    const read = attachableFromResponse(r.response);
    if (read.ok) added[r.key] = read.id;
    else warnings.push(`The invoice scan was not attached: ${read.message}`);
  }
  if (Object.keys(added).length > 0) {
    // Recorded through 081's definer, like the push itself — `external_ref` is
    // writable straight through PostgREST otherwise, which is the whole reason
    // that function exists. Its merge replaces the `qbo` branch whole, so the
    // full branch goes back.
    // THE REF THE SERVER RECORDED, added to — never rebuilt from parts. Its
    // `sync_token` is the one AFTER the attachment, because attaching a file
    // bumps the bill's own token and the push response predates that.
    const ref = withAttachments(data!.ref as AccountingRef, added);
    const { data: rec, error: refErr } = await supabase.rpc("record_accounting_push", {
      p_bill: billId,
      p_ref: ref,
    });
    if (refErr || !Array.isArray(rec) || rec.length === 0) {
      warnings.push(
        "The scan went up but was not recorded, so pushing again would attach a second copy."
      );
    }
  }

  return {
    ok: true,
    entity,
    label: String((data?.doc_number as string) ?? (data?.qbo_id as string) ?? ""),
    updated: Boolean(data?.updated),
    warnings: [...((data?.warnings as string[]) ?? []), ...warnings],
  };
}
