import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canResolveRequests } from "@/lib/roles";
import { serverTimeZone } from "@/lib/today";
import { parseFilterSearch, type RawSearchParams } from "@/lib/filterMenus";
import {
  PurchaseRequestsList,
  type PurchaseRequestRow,
} from "@/components/purchasing/PurchaseRequestsList";
import type { RequestPriority, RequestStatus } from "@/lib/purchaseRequests";

/** The most recent requests we'll load. See `capped` below. */
const LIMIT = 500;

/**
 * What the shop has asked for.
 *
 * `purchase_requests` was the last table migration 001 created that had never
 * had a writer — spec §4.7 has wanted this since the beginning, and until
 * migration 059 the only trace of it in the app was a dead nav stub.
 *
 * Location-scoped, like the guide and the purchase orders it feeds: a request
 * is about one shop's shelves. Anyone may file one and purchaser+ resolves
 * them, which is 001's own RLS — so this page gates nothing and lets each
 * control decide.
 */
export default async function PurchaseRequestsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getAppSession();
  const supabase = await createClient();
  const active = session.activeLocation;
  const params = await searchParams;

  if (!active) {
    return <p className="text-sm text-muted">No location is set up for this org yet.</p>;
  }

  const [{ data: requests, error }, { data: members }] = await Promise.all([
    supabase
      .from("purchase_requests")
      .select(
        "id, request_text, priority, status, requested_by, inventory_item_id, resolution_note, created_at"
      )
      .eq("location_id", active.id)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    // `requested_by` points at `auth.users`, so there is no FK to embed
    // through — the names come from `org_members`, which any member may read.
    supabase.from("org_members").select("user_id, display_name"),
  ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load purchase requests: {error.message}
        {/priority|inventory_item_id|resolution_note/.test(error.message) ? (
          <span className="mt-2 block text-muted">
            If this names a missing column, migration 059 has not been applied
            yet.
          </span>
        ) : null}
      </p>
    );
  }

  const rows = requests ?? [];

  // The linked items' names, in one query rather than an embed: the link is
  // sparse (most requests never resolve to a catalog item) and an embed would
  // be a join on every row to serve a few.
  const itemIds = [
    ...new Set(rows.map((r) => r.inventory_item_id as string | null).filter(Boolean)),
  ] as string[];
  const { data: items } = itemIds.length
    ? await supabase.from("inventory_items").select("id, name").in("id", itemIds)
    : { data: [] };

  const itemName = new Map(
    (items ?? []).map((i) => [i.id as string, i.name as string])
  );
  const memberName = new Map(
    (members ?? []).map((m) => [
      m.user_id as string,
      (m.display_name as string | null) ?? null,
    ])
  );

  const list: PurchaseRequestRow[] = rows.map((r) => {
    const by = (r.requested_by as string | null) ?? null;
    return {
      id: r.id as string,
      request_text: r.request_text as string,
      priority: (r.priority as RequestPriority) ?? "normal",
      status: r.status as RequestStatus,
      requested_by: by,
      /**
       * Somebody whose app access was later revoked has no `org_members` row at
       * all, and `display_name` is null until they have signed in once — so
       * both fall through to a word rather than a blank cell, which would read
       * as nobody having asked for it.
       */
      requesterName: (by ? memberName.get(by) : null) ?? (by ? "Someone" : "—"),
      inventory_item_id: (r.inventory_item_id as string | null) ?? null,
      itemName: r.inventory_item_id
        ? (itemName.get(r.inventory_item_id as string) ?? null)
        : null,
      resolution_note: (r.resolution_note as string | null) ?? null,
      created_at: r.created_at as string,
    };
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Requests
        </h1>
        <p className="max-w-[72ch] text-sm text-muted">
          What {active.code} has asked for. Anyone can file one; whoever does the
          ordering marks it ordered or says why not. Nothing here is deleted —
          the two answers are the record.
        </p>
      </div>

      {/* Keyed for the reason /shop-sections is: switching location is a
          navigation to this same route, so without it the search box and the
          status tab keep the state you set against the other shop's queue. */}
      <PurchaseRequestsList
        key={active.id}
        rows={list}
        orgId={session.membership.org_id}
        locationId={active.id}
        locationCode={active.code}
        userId={session.userId}
        canResolve={canResolveRequests(session.membership.role)}
        timeZone={session.orgSettings.timezone ?? serverTimeZone()}
        capped={rows.length === LIMIT}
        initialFilters={params}
        initialSearch={parseFilterSearch(params)}
      />
    </div>
  );
}
