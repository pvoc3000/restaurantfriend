import type { createClient } from "@/lib/supabase/client";

/**
 * Deleting a night, from either door — the record's own Delete and the
 * schedules list's selection bar (Mark, 2026-09-09: "in the box that appears
 * when selecting multiple schedules … add a delete button").
 *
 * ONE IMPLEMENTATION, TAKING THE IDS AS A PARAMETER, which is the PO list's
 * rule and its reason: what gets remembered in one copy and forgotten in the
 * other is the `.select()` discipline and what the confirm NAMES, and both of
 * those are here.
 */

/** Just enough of a schedule for the confirm to say what is being lost. */
export type DeletableSchedule = {
  schedule_date: string;
  sellsCode: string;
  source: string;
  lineCount: number;
  countedLines: number;
};

/**
 * What the confirm says, for one night or for a selection.
 *
 * PURE, so the sentence is fixture-tested where a component is not — and so
 * the two doors cannot drift into describing the same act differently.
 *
 * ONE NIGHT NAMES ITSELF, a selection is counted. From a record you already
 * know which schedule you are on and the date is the useful fact; from a bar
 * over fifteen ticked rows "the 2026-09-14 schedule for DF02" would be a worse
 * answer than "15 schedules", which is the PO list's own finding in reverse.
 *
 * THE LAST LINE IS SOURCE-AWARE, because on a special-order schedule the plan
 * sentence is simply FALSE — regenerating rebuilds nothing (the generator only
 * ever touches `source = 'plan'`) and this route bypasses
 * `unschedule_special_order`'s printed/counted guard. The FK's `set null`
 * clears the order's `production_schedule_id` while its `order_scheduled_at` is
 * left claiming production is scheduled. A MIXED selection gets both sentences:
 * dropping either would be a true statement about some of what is going and a
 * silent omission about the rest.
 */
export function deleteSchedulesMessage(rows: readonly DeletableSchedule[]): string {
  const lines = rows.reduce((n, r) => n + r.lineCount, 0);
  const counted = rows.reduce((n, r) => n + r.countedLines, 0);
  const orders = rows.filter((r) => r.source === "special_order").length;

  const what =
    rows.length === 1
      ? `Delete the ${rows[0].schedule_date} schedule for ${rows[0].sellsCode}?`
      : `Delete ${rows.length} schedules?`;

  const going =
    `${lines} ${lines === 1 ? "item" : "items"} go with ${rows.length === 1 ? "it" : "them"}` +
    (counted ? `, including counted quantities somebody entered` : "") +
    `.`;

  // THREE BRANCHES, NOT TWO. Keying the singular sentence on
  // `orders === rows.length` reads correctly on one night and then says "This
  // came from a special order" over a selection of five, which is the sort of
  // thing that only shows up when somebody ticks five — a fixture caught it.
  const after: string[] = [];
  if (orders) {
    const which =
      rows.length === 1
        ? `This came from a special order.`
        : orders === rows.length
          ? `These all came from special orders.`
          : `${orders} of them came from special orders.`;
    const back =
      rows.length === 1
        ? `Unscheduling it from the order is the ordinary way back`
        : `Unscheduling them from the order is the ordinary way back`;
    after.push(
      `${which} ${back} — that also clears the order's Production scheduled date, and refuses if the night has been printed or counted.`
    );
  }
  if (orders < rows.length) {
    after.push(
      rows.length === 1
        ? `Generating the day again would rebuild it from the plans.`
        : `Generating those days again would rebuild them from the plans.`
    );
  }

  return [what, going, ...after].join("\n\n");
}

/**
 * The write. Returns how many rows actually went, or the failure.
 *
 * `.select()`s its own result, which is not bookkeeping: a delete matching no
 * RLS policy removes ZERO rows and PostgREST returns NO error, so a bare
 * `.delete()` reports a cheerful success — and on the record that success also
 * NAVIGATES, which reads as the schedule having been deleted. The employee
 * delete taught this and the PO list's batch delete shipped without it.
 */
export async function deleteSchedules(
  supabase: ReturnType<typeof createClient>,
  ids: readonly string[]
): Promise<{ deleted: number } | { error: string }> {
  if (!ids.length) return { deleted: 0 };
  const { data, error } = await supabase
    .from("production_schedules")
    .delete()
    .in("id", ids)
    .select("id");
  if (error) return { error: error.message };
  const deleted = (data ?? []).length;
  if (deleted === 0) {
    return { error: "Nothing was deleted — you may not have permission." };
  }
  return { deleted };
}
