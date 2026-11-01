"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

import { docOrgFrom, usDate } from "@/lib/specialOrderDocs";
import {
  CREDIT_MEMO_KIND_LABEL,
  creditMemoFileName,
  fetchCreditMemoView,
  memoSettlementSentence,
  paperLine,
  type CreditMemoView,
} from "@/lib/creditMemos";
import type { CreditMemoDoc } from "./pdf/CreditMemoPdf";

/** The memo as its paper reads it, from the record's own read. */
export function creditMemoDoc(view: CreditMemoView): CreditMemoDoc {
  return {
    number: view.label,
    kindLabel: CREDIT_MEMO_KIND_LABEL[view.memo.kind],
    reason: view.memo.reason_code,
    note: view.memo.note,
    issued_on: view.memo.issued_on,
    invoice: view.invoice?.label ?? null,
    order: view.order ? [view.order.number, view.order.title].filter(Boolean).join(" · ") : null,
    customer: { name: view.customer.name, phone: view.customer.phone, email: view.customer.email },
    lines: view.lines.map(paperLine),
    total: view.total,
    settlement: memoSettlementSentence(view, usDate),
    void: Boolean(view.memo.voided_at),
  };
}

/** The memo as a PDF, rendered in the browser — what Preview, Download and
 *  Email all hand on. */
export async function renderCreditMemoPdf(supabase: SupabaseClient, id: string) {
  const [{ data: org }, { pdf }, { CreditMemoPdf }] = await Promise.all([
    supabase.from("orgs").select("name, settings").maybeSingle(),
    import("@react-pdf/renderer"),
    import("./pdf/CreditMemoPdf"),
  ]);
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const view = await fetchCreditMemoView(supabase, id, settings);
  if (!view) throw new Error("That credit memo is gone.");
  const doc = docOrgFrom((org?.name as string) ?? "", settings);
  const blob = await pdf(<CreditMemoPdf memo={creditMemoDoc(view)} org={doc} />).toBlob();
  return { blob, view, settings, doc, filename: creditMemoFileName(view.label, view.memo.issued_on) };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
