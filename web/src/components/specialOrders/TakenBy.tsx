"use client";

import { useEffect, useState } from "react";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import type { PickOption } from "@/components/ui/PickList";

/**
 * WHO TOOK THE ORDER — a link to an employee, chosen from the roster (Mark,
 * 2026-08-19: "'taken by' should be a link to an employee").
 *
 * TWO COLUMNS AND BOTH ARE RIGHT. `taken_by_employee_id` (migration 053) is the
 * link; `taken_by` is FileMaker's text and is what 7,944 migrated orders carry.
 * History is deliberately NOT backfilled — 30% of those names match more than
 * one employee (five Amandas, four Sarahs, three Adams, two Marks), so a
 * migration resolving them would have attributed 558 orders to whichever Adam
 * sorted first. See 053's header.
 *
 * So this renders whichever it has: the linked employee's name where there is
 * one, and the raw text where there is not. A reader can tell them apart —
 * one is a link — which is the honest way to show that we know exactly who took
 * yesterday's order and only roughly who took one in 2019.
 *
 * THE ROSTER COMES FROM A DEFINER, never from `employees`. 020 gates that table
 * to owner/admin and special orders are supervisor+, so a supervisor reading an
 * order cannot read the table that knows the name — `special_order_takers`
 * returns the id and the name and nothing else. It is fetched ON MOUNT rather
 * than passed down because only this one field needs it, and a page that never
 * looks at Taken by should not pay for a roster.
 *
 * A client component because `InlineValue`'s `options` are derived here — and
 * because a server component cannot pass the function props this needs anyway.
 */
export function TakenBy({
  orderId,
  orgId,
  employeeId,
  legacyName,
  canWrite,
}: {
  orderId: string;
  orgId: string;
  employeeId: string | null;
  /** FileMaker's text — shown only when there is no link. */
  legacyName: string | null;
  canWrite: boolean;
}) {
  const supabase = createClient();
  const [roster, setRoster] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("special_order_takers", { p_org_id: orgId }).then(({ data }) => {
      if (!cancelled) setRoster((data as { id: string; name: string }[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, orgId]);

  const linked = roster?.find((r) => r.id === employeeId) ?? null;

  /**
   * The roster, plus the CURRENT employee if they are not on it.
   *
   * `special_order_takers` returns active people only, and an order taken by
   * somebody who has since left must still show their name rather than an
   * unrecognised uuid. Without this the cell would render blank on exactly the
   * orders where the answer matters most.
   */
  const options: PickOption[] = [
    ...(roster ?? []).map((r) => ({ value: r.id, label: r.name })),
    ...(employeeId && !linked
      ? [{ value: employeeId, label: "Somebody who has left", group: "No longer here" }]
      : []),
  ];

  if (!canWrite) {
    return employeeId ? (
      <Link
        href={`/employees/${employeeId}`}
        className={`${READ_ONLY_VALUE} underline underline-offset-2 hover:text-ink`}
      >
        {linked?.name ?? "—"}
      </Link>
    ) : (
      <span className={READ_ONLY_VALUE}>{legacyName ?? "—"}</span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <InlineValue
        boxed={BOXED_FIELDS}
        table="special_orders"
        id={orderId}
        column="taken_by_employee_id"
        kind="pick"
        value={employeeId}
        options={options}
        // THE TEXT IS CLEARED IN THE SAME STATEMENT. Two columns saying who
        // took the order, one of them stale, is the drift the whole module
        // avoids — and once there is a link the text has nothing left to say.
        alsoUpdate={(next) => (next ? { taken_by: null } : null)}
        ariaLabel="Who took the order"
        // The legacy name where there is no link yet, so the cell is not blank
        // on 7,944 orders that DO know who took them.
        placeholder={legacyName ?? "—"}
      />
      {/* The link is a SEPARATE control, not the cell itself: the cell's job is
          to change the answer and this one's is to go and read the person's
          record. `/employees/[id]` is owner/admin, so below that it opens a
          screen that says so in a sentence — which is the app's rule for a
          gated screen everywhere else. */}
      {employeeId ? (
        <Link
          href={`/employees/${employeeId}`}
          title="Open their employee record"
          className="text-[12px] text-subtle underline underline-offset-2 hover:text-ink"
        >
          ↗
        </Link>
      ) : null}
    </span>
  );
}
