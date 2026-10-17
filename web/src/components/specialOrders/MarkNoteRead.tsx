"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Opening the Notes tab READS the customer's /inquiry note, which takes the
 * yellow "!" off the tab FOR YOU (migration 169, Mark, 2026-10-02: "the alert
 * can be removed once the user has viewed the tab"; per person since 206,
 * 2026-10-17).
 *
 * Rendered only on the Notes tab of an order whose note you have not read, so
 * the insert runs once per order per person. A failure is not worth interrupting anybody
 * over: the mark simply shows again next time.
 */
export function MarkNoteRead({ orderId, orgId, userId }: { orderId: string; orgId: string; userId: string }) {
  useEffect(() => {
    void createClient()
      .from("special_order_note_reads")
      .upsert(
        { order_id: orderId, org_id: orgId, read_by: userId },
        { onConflict: "order_id,read_by", ignoreDuplicates: true }
      );
  }, [orderId, orgId, userId]);
  return null;
}
