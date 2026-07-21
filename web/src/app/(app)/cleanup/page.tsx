import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { computeProblems, type CleanupRow, type ProblemKind } from "@/lib/cleanup";
import { staleBucket, type StaleBucket } from "@/lib/lastOrdered";
import { CleanupQueue } from "@/components/cleanup/CleanupQueue";

const SELECT = `
  id, location_id, default_par, default_vendor_item_id, inventory_item_id,
  inventory_items!inner ( id, name, category, base_unit ),
  vendor_items ( id, description, brand, package_desc, package_content, price, is_active,
                 vendors ( id, name, is_active ) )
`;

export type QueueItem = CleanupRow & {
  location_code: string;
  problems: ProblemKind[];
  last_order_date: string | null;
  stale: StaleBucket;
};

export default async function CleanupPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { scope } = await searchParams;
  const allLocations = scope === "all";

  const session = await getAppSession();
  const supabase = await createClient();

  // "All locations" means all *active* locations — the ones you can actually
  // work at (the header switcher lists the same set). Default is the active one.
  const activeLocationIds = session.locations.map((l) => l.id);
  const targetIds = allLocations
    ? activeLocationIds
    : session.activeLocation
      ? [session.activeLocation.id]
      : [];

  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  // Fetch active item-location rows (active item enforced by !inner), paginated
  // — PostgREST caps a page at 1000.
  const rows: CleanupRow[] = [];
  if (targetIds.length > 0) {
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("item_locations")
        .select(SELECT)
        .eq("is_active", true)
        // brief P1: only active item_locations joined to ACTIVE items. !inner
        // guarantees the item exists; this filters out deactivated ones — and
        // makes "deactivate item everywhere" burn the row off the queue.
        .eq("inventory_items.is_active", true)
        .in("location_id", targetIds)
        .order("id")
        .range(from, from + 999);
      if (error) {
        return (
          <p className="text-sm text-red-700">
            Could not load the cleanup queue: {error.message}
          </p>
        );
      }
      rows.push(...((data ?? []) as unknown as CleanupRow[]));
      if (!data || data.length < 1000) break;
      from += 1000;
    }
  }

  // Last-ordered dates (brief §B), one query over the view — not N+1. Degrades
  // gracefully if migration 004 isn't applied yet: no dates, chips just read 0.
  const lastOrderedByIl = new Map<string, string | null>();
  if (targetIds.length > 0) {
    const { data: lo, error: loErr } = await supabase
      .from("v_item_last_ordered")
      .select("item_location_id, last_order_date")
      .in("location_id", targetIds);
    if (loErr) {
      console.warn("v_item_last_ordered unavailable (apply migration 004):", loErr.message);
    } else {
      for (const r of lo ?? [])
        lastOrderedByIl.set(r.item_location_id, r.last_order_date);
    }
  }

  const today = new Date();

  // Only rows with at least one problem enter the queue.
  const items: QueueItem[] = [];
  for (const row of rows) {
    const problems = computeProblems(row);
    if (problems.length === 0) continue;
    const last_order_date = lastOrderedByIl.get(row.id) ?? null;
    items.push({
      ...row,
      location_code: codeById.get(row.location_id) ?? "?",
      problems,
      last_order_date,
      stale: staleBucket(last_order_date, today),
    });
  }

  return (
    <CleanupQueue
      items={items}
      orgId={session.membership.org_id}
      allLocations={allLocations}
      activeLocationCode={session.activeLocation?.code ?? null}
    />
  );
}
