import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { VENDOR_ITEM_SELECT } from "@/lib/catalog";
import type { RawSearchParams } from "@/lib/itemFilters";
import { crumbPath, currentQuery, parseTrail } from "@/lib/breadcrumbs";
import { staleBucket } from "@/lib/lastOrdered";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { VendorLocationsTable } from "@/components/catalog/VendorLocationsTable";
import {
  VendorItemsTable,
  type VendorItemWithItem,
} from "@/components/catalog/VendorItemsTable";
import { AddVendorReminder } from "@/components/purchasing/Reminders";
import { guideToday, serverTimeZone } from "@/lib/orderGuide";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SectionNav } from "@/components/ui/SectionNav";
import { VendorFields } from "@/components/catalog/VendorFields";
import { VENDOR_TABS, VENDOR_TAB_LABEL, parseVendorTab, vendorTabHref } from "@/lib/vendors";
import { canEditPage } from "@/lib/pageAccess";

type VendorLocationRow = {
  id: string;
  location_id: string;
  account_number: string | null;
  minimum_order: number | null;
  order_days: number[] | null;
  delivery_days: number[] | null;
  is_active: boolean;
  sales_rep: string | null;
  rep_phone: string | null;
  rep_email: string | null;
};

type Vendor = {
  id: string;
  name: string;
  vendor_type: string | null;
  description: string | null;
  order_type: string;
  url: string | null;
  notes: string | null;
  is_active: boolean;
  vendor_locations: VendorLocationRow[];
};

/**
 * The vendor detail's whole body. Its own full-screen page (Mark, 2026-07-30);
 * the body stays split out from the page shell, like ItemDetail.
 */
export async function VendorDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  // The trail follows the route actually taken (the list's filters ride along
  // inside the recorded href), falling back to the section for a pasted URL.
  const trail = parseTrail(rawParams, { href: "/vendors", label: "Vendors" });
  const queryString = currentQuery(rawParams);
  const session = await getAppSession();
  const supabase = await createClient();

  // WHICH TAB, and therefore WHAT TO FETCH. That is half the point of splitting
  // the record: Info stops paying for a vendor's whole item catalog and the two
  // last-ordered round trips that hang off it (Chefs Warehouse has 227 vendor
  // items), and Items stops paying for the type list only the Type picker reads.
  //
  // `SKIP` stands in for a query that isn't wanted, so the destructuring keeps
  // its shape. Promise.all takes plain values happily — EmployeeDetail's idiom.
  const tab = parseVendorTab(rawParams.tab);
  const SKIP = { data: null, error: null, count: null };
  const wantsItems = tab === "items";

  // Every location's config is listed (not just the active one) — the vendor's
  // account number and minimum differ per shop, and seeing them together is the
  // point of the detail screen.
  const [
    { data: vendor, error },
    { data: vendorItems, error: viError },
    { data: typeRows },
    { data: qboRows },
    { data: locationQbo },
  ] =
    await Promise.all([
      supabase
        .from("vendors")
        .select(
          `id, name, vendor_type, description, order_type, url, notes, is_active,
           vendor_locations ( id, location_id, account_number, minimum_order,
                              order_days, delivery_days, is_active,
                              sales_rep, rep_phone, rep_email )`
        )
        .eq("id", id)
        .maybeSingle(),
      wantsItems
        ? supabase
            .from("vendor_items")
            .select(`${VENDOR_ITEM_SELECT}, inventory_items ( id, name, base_unit, category )`)
            .eq("vendor_id", id)
            .order("is_active", { ascending: false })
            .order("description")
        : SKIP,
      // What the Type picker offers — every vendor_type already in use, fired
      // alongside the other two so it costs no extra round trip (the same
      // move ItemDetail makes for the item category picker).
      wantsItems ? SKIP : supabase.from("vendors").select("vendor_type"),
      supabase.rpc("accounting_connection_status", { p_org: session.membership.org_id }),
      // SEPARATE, and allowed to fail: these columns arrive with migration 083,
      // and folding them into the vendor select above would take the whole
      // record down until it is applied rather than just the QuickBooks
      // pickers. `vendors.external_ref` and `vendors.expense_account_ref` are
      // deliberately NOT read — every QuickBooks setting is on the row below.
      supabase
        .from("vendor_locations")
        .select(
          "id, external_ref, expense_account_ref, expense_account_name, qbo_location_ref, qbo_location_name, qbo_class_ref, qbo_class_name"
        )
        .eq("vendor_id", id),
    ]);

  if (error) {
    return <p className="text-sm text-accent">Could not load vendor: {error.message}</p>;
  }
  if (!vendor) notFound();

  const v = vendor as unknown as Vendor;
  const items = (vendorItems ?? []) as unknown as VendorItemWithItem[];
  // The org-wide account this vendor's own may override (082). Null when
  // QuickBooks is not connected, which is what makes the block say so rather
  // than offering pickers that cannot be filled.
  const qboRow = Array.isArray(qboRows)
    ? (qboRows[0] as { status?: string; bill_expense_account_ref?: string | null;
                       bill_expense_account_name?: string | null } | undefined)
    : undefined;
  const qboDefault =
    qboRow?.status === "connected"
      ? {
          ref: qboRow.bill_expense_account_ref ?? null,
          name: qboRow.bill_expense_account_name ?? null,
        }
      : null;

  // Merged onto the rows rather than selected with them, so an unapplied 083
  // costs the QuickBooks pickers and nothing else.
  const qboByRow = Object.fromEntries(
    ((locationQbo ?? []) as Record<string, unknown>[]).map((r) => [r.id as string, r])
  );

  const vendorTypes = [
    ...new Set(
      ((typeRows ?? []) as { vendor_type: string | null }[])
        .map((r) => r.vendor_type)
        .filter((t): t is string => t !== null && t !== "")
    ),
  ].sort((a, b) => a.localeCompare(b));

  // Last-ordered for the age filter. Semantics match the Inventory list: when
  // the linked ITEM was last ordered at the active location, from any vendor —
  // not "last ordered from this vendor", which would need a per-vendor-item
  // view. Bounded to this vendor's items so it stays two small queries.
  const itemIds = [
    ...new Set(items.map((vi) => vi.inventory_items?.id).filter((x): x is string => !!x)),
  ];
  const lastOrderedByItem = new Map<string, string | null>();

  if (wantsItems && session.activeLocation && itemIds.length > 0) {
    const { data: locationRows } = await supabase
      .from("inventory_item_locations")
      .select("id, inventory_item_id")
      .eq("location_id", session.activeLocation.id)
      .in("inventory_item_id", itemIds);

    const itemByLocationRow = new Map(
      (locationRows ?? []).map((r) => [r.id, r.inventory_item_id])
    );

    if (itemByLocationRow.size > 0) {
      const { data: lastOrdered, error: loError } = await supabase
        .from("v_item_last_ordered")
        .select("item_location_id, last_order_date")
        .in("item_location_id", [...itemByLocationRow.keys()]);

      if (loError) {
        console.warn("v_item_last_ordered unavailable:", loError.message);
      } else {
        for (const row of lastOrdered ?? []) {
          const itemId = itemByLocationRow.get(row.item_location_id);
          if (itemId) lastOrderedByItem.set(itemId, row.last_order_date);
        }
      }
    }
  }

  const today = new Date();
  const itemsWithAge: VendorItemWithItem[] = items.map((vi) => {
    const last = vi.inventory_items ? lastOrderedByItem.get(vi.inventory_items.id) ?? null : null;
    return { ...vi, last_order_date: last, stale: staleBucket(last, today) };
  });
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));
  // Links out of this page come back here, with the trail so far intact.
  const here = { href: `/vendors/${id}${queryString}`, label: v.name };
  // The Page Permissions sheet: staff and supervisors READ a vendor.
  const editable = canEditPage(session.membership.role, "/vendors");

  // Built once and rendered twice — see the two navs below.
  const tabOptions = VENDOR_TABS.map((t) => ({
    key: t,
    label: VENDOR_TAB_LABEL[t],
    href: vendorTabHref(id, t, rawParams),
  }));

  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={trail}
        current={v.name}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      {/* ---- who this vendor is, ABOVE the split ----------------------- */}
      {/* The name is the record's identity, so it stays put while the sections
          change under it — the employee record's shape, which is what this is
          copied from rather than re-derived.

          INDENTED TO THE CONTENT COLUMN, not to the page margin: `lg:ml-48` is
          exactly the sidebar's `lg:w-40` plus the row's `lg:gap-8` (10rem +
          2rem), so the name starts on the same left edge as everything under
          it. THOSE THREE VALUES ARE COUPLED — change the sidebar's width and
          this has to move with it. Below `lg` there is no sidebar to clear. */}
      <div className="flex flex-wrap items-baseline gap-3 lg:ml-48">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">{v.name}</h1>
        {!v.is_active && <span className="text-sm text-subtle">Inactive</span>}

        {/* "Next time we order from these people…" — recorded where the
            thought happens rather than remembered until Monday. It surfaces
            on the ACTIVE location's guide, which is the one you'd be
            walking. Above the split with the name, because it is about the
            vendor rather than about either section. */}
        {session.activeLocation &&
          editable && (
            <span className="ml-auto">
              <AddVendorReminder
                vendorId={v.id}
                vendorName={v.name}
                locationId={session.activeLocation.id}
                orgId={session.membership.org_id}
                today={guideToday(session.orgSettings.timezone ?? serverTimeZone()).date}
              />
            </span>
          )}
      </div>

      {/* ---- the record's two sections --------------------------------- */}
      {/* Below `lg` it STACKS, bar above content: a 160px column beside a table
          at iPad-portrait width leaves neither enough room, and a horizontal bar
          is what this control is anyway. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        {/* TWO renderings of one control, wrapped rather than switched with a
            responsive `display` utility on the control itself: Tailwind resolves
            competing utilities by STYLESHEET order, not class-string order, so a
            `hidden` passed in `className` would not reliably beat the component's
            own `flex`. A wrapper div has no such argument to lose. */}
        <div
          className="hidden lg:sticky lg:block lg:w-40 lg:shrink-0"
          // Under the masthead, which MEASURES itself — it wraps to two or three
          // rows at iPad widths, so any constant here would be wrong at some width.
          style={{ top: "calc(var(--rf-header-h) + 1.5rem)" }}
        >
          <SectionNav ariaLabel="Which part of this record" value={tab} items={tabOptions} />
        </div>
        <div className="lg:hidden">
          <SectionNav
            orientation="horizontal"
            ariaLabel="Which part of this record"
            value={tab}
            items={tabOptions}
          />
        </div>

        {/* space-y-16, not 6 (Mark, 2026-08-01, twice — 10 wasn't enough): with
            each table's heading and filters now sitting ON the table, 4px from
            its column headers, the gap BETWEEN the blocks is the only thing left
            saying where one ends and the next begins. It has to beat the gaps
            inside them by a wide margin or the blocks read as one run. */}
        <div className="min-w-0 flex-1 space-y-16">
          {tab === "info" && (
            <>
              <VendorFields vendor={v} vendorTypes={vendorTypes} editable={editable} />


              {/* The heading rides in the table's own strip, opposite the columns
                  eye (Mark, 2026-08-01: it "could come closer to the table") — the
                  strip was an empty 32px band otherwise, which is what held the
                  two apart. */}
              <section>
                <VendorLocationsTable
                  rows={v.vendor_locations.map((row) => ({
                    ...row,
                    external_ref:
                      (qboByRow[row.id]?.external_ref as { qbo?: { id?: string } } | null) ?? null,
                    expense_account_ref: (qboByRow[row.id]?.expense_account_ref as string | null) ?? null,
                    expense_account_name: (qboByRow[row.id]?.expense_account_name as string | null) ?? null,
                    qbo_location_ref: (qboByRow[row.id]?.qbo_location_ref as string | null) ?? null,
                    qbo_location_name: (qboByRow[row.id]?.qbo_location_name as string | null) ?? null,
                    qbo_class_ref: (qboByRow[row.id]?.qbo_class_ref as string | null) ?? null,
                    qbo_class_name: (qboByRow[row.id]?.qbo_class_name as string | null) ?? null,
                  }))}
                  qboConnected={qboDefault !== null}
                  editable={editable}
                  codeById={Object.fromEntries(codeById)}
                  activeLocationId={session.activeLocation?.id ?? null}
                  leading={<SectionHeading>Per-location config</SectionHeading>}
                />
              </section>
            </>
          )}

          {tab === "items" && (
            <section className="space-y-2">
              <SectionHeading count={vendorItems?.length ?? 0}>Vendor items</SectionHeading>
              {viError ? (
                <p className="text-sm text-accent">
                  Could not load vendor items: {viError.message}
                </p>
              ) : (
                <VendorItemsTable
                  vendorItems={itemsWithAge}
                  showItem
                  scroll
                  from={here}
                  filters
                  showLastOrdered={session.activeLocation !== null}
                  canEdit={editable}
                />
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
