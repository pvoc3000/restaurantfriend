"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { NewVendorItem } from "./NewVendorItem";
import { AddVendorReminder } from "@/components/purchasing/Reminders";
import { createEmptyPurchaseOrder } from "@/components/purchasing/createPurchaseOrder";
import { openWindowNow, showBlob } from "@/lib/poProcessing";
import { packLabel, packageDivisor } from "@/lib/catalog";
import { withFrom, type Crumb } from "@/lib/breadcrumbs";
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
 * The vendor record's commands, ONE Actions menu in the title row where Add
 * reminder… stood (Mark, 2026-09-14):
 *
 *   New Purchase Order… · New Vendor Item… · Add Reminder… | Vendor List Report
 *
 * New Purchase Order… creates an EMPTY draft for this vendor at the working
 * shop — `createEmptyPurchaseOrder`, the PO list's own implementation — and
 * lands on it with Add Item… already open (`?add=1`). The two dialogs keep
 * owning their writes and hand out rows through render props. The report is a
 * read, so every role that can open the record gets it.
 *
 * THE REPORT'S WINDOW OPENS SYNCHRONOUSLY inside the click — `ActionMenu` runs
 * `onSelect` in the gesture — because a `window.open` after an await is
 * silently blocked.
 */
export function VendorCommandMenu({
  orgId,
  orgName,
  vendor,
  existingProductIds,
  from,
  canEditVendor,
  canCreatePo,
  locationId,
  locationCode,
  today,
}: {
  orgId: string;
  orgName: string;
  vendor: { id: string; name: string };
  existingProductIds: string[];
  from: Crumb;
  /** The Page Permissions cell for /vendors — vendor items and reminders. */
  canEditVendor: boolean;
  /** The cell for /purchase-orders. */
  canCreatePo: boolean;
  /** The working shop: whose price the report shows, where a PO and a
   *  reminder land. Null leaves those two commands out. */
  locationId: string | null;
  locationCode: string | null;
  /** The org's calendar day — a new PO's order date. */
  today: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  function newPurchaseOrder() {
    if (!locationId) return;
    setFailed(null);
    setBusyLabel("Creating…");
    start(async () => {
      const result = await createEmptyPurchaseOrder(supabase, {
        orgId,
        locationId,
        vendorId: vendor.id,
        today,
      });
      if ("error" in result) {
        setBusyLabel(null);
        setFailed(result.error);
        return;
      }
      router.push(withFrom(`/purchase-orders/${result.id}?add=1`, from));
    });
  }

  function report() {
    setFailed(null);
    setBusyLabel("Building…");
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
          .sort(([a], [b]) => (a === "No type" ? 1 : b === "No type" ? -1 : compare(a, b)))
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
      } finally {
        setBusyLabel(null);
      }
    });
  }

  const menu = (openItem: (() => void) | null, openReminder: (() => void) | null) => {
    const create: ActionMenuItem[] = [];
    if (canCreatePo && locationId) {
      create.push({ label: "New Purchase Order…", onSelect: newPurchaseOrder, disabled: pending });
    }
    if (openItem) create.push({ label: "New Vendor Item…", onSelect: openItem });
    if (openReminder) create.push({ label: "Add Reminder…", onSelect: openReminder });
    return (
      <ActionMenu
        label={pending && busyLabel ? busyLabel : "Actions"}
        ariaLabel={`Actions for ${vendor.name}`}
        disabled={pending}
        minWidth={220}
        items={[
          ...create,
          {
            label: "Vendor List Report",
            onSelect: report,
            disabled: pending,
            separatorBefore: create.length > 0,
          },
        ]}
      />
    );
  };

  const withReminder = (openItem: (() => void) | null) =>
    canEditVendor && locationId ? (
      <AddVendorReminder
        vendorId={vendor.id}
        vendorName={vendor.name}
        locationId={locationId}
        orgId={orgId}
        today={today}
      >
        {(openReminder) => menu(openItem, openReminder)}
      </AddVendorReminder>
    ) : (
      menu(openItem, null)
    );

  return (
    <div className="flex flex-col items-end gap-2">
      {canEditVendor ? (
        <NewVendorItem
          orgId={orgId}
          vendor={vendor}
          existingProductIds={existingProductIds}
          from={from}
        >
          {(openItem) => withReminder(openItem)}
        </NewVendorItem>
      ) : (
        withReminder(null)
      )}
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}
    </div>
  );
}
