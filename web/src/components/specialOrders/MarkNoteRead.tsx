"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Opening the Notes tab READS the customer's /inquiry note, which takes the
 * yellow "!" off the tab for everybody (migration 169, Mark, 2026-10-02: "the
 * alert can be removed once the user has viewed the tab").
 *
 * Rendered only on the Notes tab of an order whose note is unread, so the
 * insert runs once per order. A failure is not worth interrupting anybody
 * over: the mark simply shows again next time.
 */
export function MarkNoteRead({ orderId, orgId }: { orderId: string; orgId: string }) {
  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await supabase
        .from("special_order_note_reads")
        .upsert(
          { order_id: orderId, org_id: orgId, read_by: user?.id ?? null },
          { onConflict: "order_id", ignoreDuplicates: true }
        );
    })();
  }, [orderId, orgId]);
  return null;
}
