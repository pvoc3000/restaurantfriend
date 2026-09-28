"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

import { alertDialog, confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { readInvoiceTerms } from "@/lib/customerInvoices";
import { cancelConfirmMessage, cancelSpecialOrder, readCancelContext } from "@/lib/specialOrderWrites";

/**
 * CANCEL ORDER, the whole act, for both doors — the record's Actions menu and
 * the list's `⋯` (2026-09-28). Read what cancelling touches, ask, write, then
 * say whatever the person still has to do. The words and the writes are
 * `lib/specialOrderWrites`; this is only their order, so the two doors cannot
 * drift into asking different questions.
 *
 * Resolves `cancelled` only when the status was written — the caller refreshes
 * then — and `error` for a refusal the caller shows in its own place.
 */
export async function runCancelOrder(
  supabase: SupabaseClient,
  order: { id: string; number: string }
): Promise<{ cancelled: boolean } | { error: string }> {
  const { data: org } = await supabase.from("orgs").select("settings").maybeSingle();
  const { prefix } = readInvoiceTerms((org?.settings ?? {}) as Record<string, unknown>);

  const ctx = await readCancelContext(supabase, order.id, prefix);
  if ("error" in ctx) return { error: ctx.error };

  const ok = await confirmDialog({
    ...splitConfirmMessage(cancelConfirmMessage(order.number, ctx)),
    confirmLabel: "Cancel the order",
    tone: "danger",
  });
  if (!ok) return { cancelled: false };

  const result = await cancelSpecialOrder(supabase, order.id, ctx);
  if ("error" in result) return result;
  if (result.notes.length) {
    await alertDialog({ title: `Order ${order.number} is cancelled`, body: result.notes.join("\n\n") });
  }
  return { cancelled: true };
}
