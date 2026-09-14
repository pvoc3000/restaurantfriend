"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { NewVendorItem } from "./NewVendorItem";
import { openWindowNow, showBlob } from "@/lib/poProcessing";
import { packLabel, packageDivisor } from "@/lib/catalog";
import type { Crumb } from "@/lib/breadcrumbs";
import type { VendorListData, VendorListGroup, VendorListRow } from "./pdf/VendorItemListPdf";

type ReportRow = {
  id: string;
  product_id: string | null;
  brand: string | null;
  description: string | null;
  package_content: number | string | null;
  price: number | string | null;
  pack_count: number | string | null;
  pack_size: number | string | null;
  pack_unit: string | null;
  inventory_items: { name: string; category: string | null; base_unit: string } | null;
  vendor_item_location_prices: { location_id: string; price: number | string | null }[];
};

const num = (v: number | string | null) => (v === null ? null : Number(v));

/**
 * The vendor record's Items tab commands (Mark, 2026-09-14): New Vendor Item…
 * (write roles only; `NewVendorItem` keeps its dialog and hands out the row)
 * and Vendor List Report, a PDF price list of the vendor's active items to show
 * another vendor. The report is a read, so every role that can open the tab
 * gets it.
 *
 * THE WINDOW OPENS SYNCHRONOUSLY inside the click — `ActionMenu` runs
 * `onSelect` in the gesture — because a `window.open` after an await is
 * silently blocked.
 */
export function VendorItemsCommandMenu({
  orgId,
  orgName,
  vendor,
  existingProductIds,
  from,
  canCreate,
  locationId,
  locationCode,
}: {
  orgId: string;
  orgName: string;
  vendor: { id: string; name: string };
  existingProductIds: string[];
  from: Crumb;
  canCreate: boolean;
  /** The working shop, whose price override (design rule 6) the report uses. */
  locationId: string | null;
  locationCode: string | null;
}) {
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  function report() {
    setFailed(null);
    const win = openWindowNow();
    start(async () => {
      try {
        // Paginated on a unique order: PostgREST truncates at 1,000 rows
        // without a word, and some vendors carry hundreds of items.
        const rows: ReportRow[] = [];
        for (let fromRow = 0; ; fromRow += 1000) {
          const { data, error } = await supabase
            .from("vendor_items")
            .select(
              `id, product_id, brand, description, package_content, price,
               pack_count, pack_size, pack_unit,
               inventory_items ( name, category, base_unit ),
               vendor_item_location_prices ( location_id, price )`
            )
            .eq("vendor_id", vendor.id)
            .eq("is_active", true)
            .order("id")
            .range(fromRow, fromRow + 999);
          if (error) throw new Error(error.message);
          rows.push(...((data ?? []) as unknown as ReportRow[]));
          if (!data || data.length < 1000) break;
        }

        const byType = new Map<string, VendorListRow[]>();
        for (const r of rows) {
          const baseUnit = r.inventory_items?.base_unit ?? null;
          const override = locationId
            ? r.vendor_item_location_prices.find((p) => p.location_id === locationId)
            : undefined;
          const price =
            override && override.price !== null ? Number(override.price) : num(r.price);
          const pack = {
            package_content: num(r.package_content),
            pack_count: num(r.pack_count),
            pack_size: num(r.pack_size),
            pack_unit: r.pack_unit,
          };
          const divisor = baseUnit ? packageDivisor(pack, baseUnit) : null;
          const type = r.inventory_items?.category || "No type";
          const list = byType.get(type) ?? [];
          list.push({
            item: r.inventory_items?.name ?? r.description ?? "(unlinked)",
            productId: r.product_id,
            brand: r.brand,
            description: r.description,
            pack: baseUnit ? packLabel(pack, baseUnit) : null,
            price,
            unitPrice: price !== null && divisor ? price / divisor : null,
            baseUnit,
          });
          byType.set(type, list);
        }
        const compare = (a: string, b: string) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
        const groups: VendorListGroup[] = [...byType.entries()]
          .sort(([a], [b]) =>
            a === "No type" ? 1 : b === "No type" ? -1 : compare(a, b)
          )
          .map(([type, list]) => ({
            type,
            rows: list.sort((a, b) => compare(a.item, b.item)),
          }));

        const now = new Date();
        const data: VendorListData = {
          orgName,
          vendorName: vendor.name,
          locationCode,
          dateLabel: now.toLocaleDateString("en-US"),
          groups,
          itemCount: rows.length,
        };

        const [{ pdf }, { VendorItemListPdf }] = await Promise.all([
          import("@react-pdf/renderer"),
          import("./pdf/VendorItemListPdf"),
        ]);
        const blob = await pdf(<VendorItemListPdf data={data} />).toBlob();
        showBlob(win, blob, `${vendor.name} price list ${now.toISOString().slice(0, 10)}.pdf`);
      } catch (e) {
        win?.close();
        setFailed(e instanceof Error ? e.message : "The report could not be built.");
      }
    });
  }

  const reportItem: ActionMenuItem = {
    label: "Vendor List Report",
    onSelect: report,
    disabled: pending,
  };

  const menu = (createItems: ActionMenuItem[]) => (
    <ActionMenu
      label={pending ? "Building…" : "Actions"}
      ariaLabel={`Actions for ${vendor.name}'s items`}
      disabled={pending}
      minWidth={220}
      items={[
        ...createItems,
        { ...reportItem, separatorBefore: createItems.length > 0 },
      ]}
    />
  );

  return (
    <div className="flex flex-col items-end gap-2">
      {canCreate ? (
        <NewVendorItem
          orgId={orgId}
          vendor={vendor}
          existingProductIds={existingProductIds}
          from={from}
        >
          {(open) => menu([{ label: "New Vendor Item…", onSelect: open }])}
        </NewVendorItem>
      ) : (
        menu([])
      )}
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}
    </div>
  );
}
