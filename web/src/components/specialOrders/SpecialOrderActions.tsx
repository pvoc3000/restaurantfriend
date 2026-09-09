"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { alertDialog, confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import {
  deleteConfirmMessage,
  deleteRefusal,
  deleteSpecialOrder,
  duplicateSpecialOrder,
  readDeleteContext,
} from "@/lib/specialOrderWrites";
import { RowMenu } from "@/components/ui/RowMenu";

/**
 * A special order's row menu — Duplicate and Delete (Mark, 2026-09-08).
 *
 * `InventoryItemActions`' template, and every rule it encodes lives in
 * `lib/specialOrderWrites` rather than here, because the RECORD's own command
 * row does the same two things: a delete on this table has three separate
 * refusals and a confirm that counts what goes, and those are precisely what a
 * second copy would get subtly wrong.
 *
 * WHAT IT DOES NOT DO IS PRE-COMPUTE. The list's row carries no line count, no
 * schedule link and no `standing_order_id`, so Delete reads what it needs when
 * it is pressed — one indexed read for one click, against widening the list's
 * own query with three columns every row pays for and one row in fifty uses.
 *
 * The column renders only for a Write role: both entries write, so below that
 * the menu would be an empty panel — unlike the PO list's, which keeps "Open
 * purchase order" for everybody.
 */
export function SpecialOrderActions({
  id,
  number,
  onChanged,
}: {
  id: string;
  number: string;
  /**
   * Called after a successful delete. The LIST refreshes in place; the record
   * screen navigates away instead, which is why the destination is the
   * caller's business and not this component's.
   */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<"duplicate" | "delete" | null>(null);
  const [pending, start] = useTransition();

  function duplicate() {
    setBusy("duplicate");
    start(async () => {
      const result = await duplicateSpecialOrder(supabase, id, number);
      setBusy(null);
      if ("error" in result) {
        void alertDialog({
          title: "The copy was not made",
          body: result.error,
        });
        return;
      }
      // LANDS ON THE COPY, the app's create convention and the record's own
      // behaviour: you duplicated it in order to work on it.
      router.refresh();
      router.push(`/special-orders/${result.id}`);
    });
  }

  function remove() {
    setBusy("delete");
    start(async () => {
      const ctx = await readDeleteContext(supabase, id);
      if ("error" in ctx) {
        setBusy(null);
        void alertDialog({
          title: `Order ${number} could not be read`,
          body: ctx.error,
        });
        return;
      }
      /**
       * A NOTICE, not a line in the cell. `InventoryItemActions` prints its
       * errors under the `⋯` and can afford to: these are three-sentence
       * refusals, and this column is 74 weights — about 65px — so in flow they
       * would wrap to twenty lines and push the table apart. `alertDialog` is
       * `lib/confirm`'s own answer for "an error the reader must see".
       */
      const refusal = deleteRefusal(ctx);
      if (refusal) {
        setBusy(null);
        void alertDialog({
          title: `Order ${number} cannot be deleted`,
          body: refusal,
        });
        return;
      }
      const ok = await confirmDialog({
        ...splitConfirmMessage(deleteConfirmMessage(ctx)),
        confirmLabel: "Delete",
        tone: "danger",
      });
      if (!ok) {
        setBusy(null);
        return;
      }
      const result = await deleteSpecialOrder(supabase, id);
      setBusy(null);
      if ("error" in result) {
        void alertDialog({
          title: `Order ${number} was not deleted`,
          body: result.error,
        });
        return;
      }
      router.refresh();
      onChanged?.();
    });
  }

  return (
    <RowMenu
      label={`Actions for order ${number}`}
      items={[
        {
          label: busy === "duplicate" ? "Duplicating…" : "Duplicate",
          hint: "A copy with its lines, as a new lead",
          disabled: busy !== null || pending,
          onSelect: duplicate,
        },
        {
          label: "Delete…",
          hint: "Shows what would go with it",
          danger: true,
          disabled: busy !== null || pending,
          onSelect: remove,
        },
      ]}
    />
  );
}
