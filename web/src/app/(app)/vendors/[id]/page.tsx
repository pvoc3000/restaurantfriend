import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { money, VENDOR_ITEM_SELECT } from "@/lib/catalog";
import {
  VendorItemsTable,
  type VendorItemWithItem,
} from "@/components/catalog/VendorItemsTable";

// ISO weekdays, 1 = Monday (CLAUDE.md).
const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function days(list: number[] | null) {
  if (!list || list.length === 0) return "—";
  return [...list].sort((a, b) => a - b).map((d) => DAY_LABELS[d - 1] ?? d).join(" ");
}

type VendorLocationRow = {
  location_id: string;
  account_number: string | null;
  minimum_order: number | null;
  order_days: number[] | null;
  delivery_days: number[] | null;
  is_active: boolean;
};

type Vendor = {
  id: string;
  name: string;
  vendor_type: string | null;
  order_type: string;
  url: string | null;
  is_active: boolean;
  vendor_locations: VendorLocationRow[];
};

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAppSession();
  const supabase = await createClient();

  // Every location's config is listed (not just the active one) — the vendor's
  // account number and minimum differ per shop, and seeing them together is the
  // point of the detail screen.
  const [{ data: vendor, error }, { data: vendorItems, error: viError }] =
    await Promise.all([
      supabase
        .from("vendors")
        .select(
          `id, name, vendor_type, order_type, url, is_active,
           vendor_locations ( location_id, account_number, minimum_order,
                              order_days, delivery_days, is_active )`
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("vendor_items")
        .select(`${VENDOR_ITEM_SELECT}, inventory_items ( id, name, base_unit )`)
        .eq("vendor_id", id)
        .order("is_active", { ascending: false })
        .order("description"),
    ]);

  if (error) {
    return <p className="text-sm text-red-700">Could not load vendor: {error.message}</p>;
  }
  if (!vendor) notFound();

  const v = vendor as unknown as Vendor;
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/vendors" className="text-blue-700 hover:underline">
          ← Vendors
        </Link>
      </div>

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">{v.name}</h1>
        <span className="text-sm text-neutral-500">
          {v.vendor_type ?? "—"} · orders via {v.order_type}
          {v.is_active ? "" : " · inactive"}
        </span>
        {v.url && (
          <a
            href={v.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-blue-700 hover:underline"
          >
            website
          </a>
        )}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Per-location config
        </h2>
        {v.vendor_locations.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Not configured at any location yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-300 text-left text-neutral-600">
                  <th className="px-2 py-1 font-medium">Location</th>
                  <th className="px-2 py-1 font-medium">Account</th>
                  <th className="px-2 py-1 font-medium text-right">Minimum</th>
                  <th className="px-2 py-1 font-medium">Order days</th>
                  <th className="px-2 py-1 font-medium">Delivery days</th>
                  <th className="px-2 py-1 font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {v.vendor_locations.map((vl) => (
                  <tr key={vl.location_id} className="border-b border-neutral-100">
                    <td className="px-2 py-1">
                      {codeById.get(vl.location_id) ?? "—"}
                      {vl.location_id === session.activeLocation?.id && (
                        <span className="ml-1.5 rounded bg-blue-100 px-1 text-xs text-blue-800">
                          here
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {vl.account_number ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-neutral-600">
                      {money(vl.minimum_order)}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-neutral-600">
                      {days(vl.order_days)}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-neutral-600">
                      {days(vl.delivery_days)}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {vl.is_active ? "yes" : "no"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Vendor items{" "}
          <span className="font-normal normal-case tracking-normal text-neutral-400">
            {vendorItems?.length ?? 0}
          </span>
        </h2>
        {viError ? (
          <p className="text-sm text-red-700">
            Could not load vendor items: {viError.message}
          </p>
        ) : (
          <VendorItemsTable
            vendorItems={(vendorItems ?? []) as unknown as VendorItemWithItem[]}
            showItem
          />
        )}
      </section>
    </div>
  );
}
