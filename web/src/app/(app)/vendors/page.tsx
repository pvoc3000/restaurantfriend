import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { VendorActiveToggle } from "@/components/VendorActiveToggle";

// ISO weekdays: 1 = Monday … 7 = Sunday.
const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function days(list: number[] | null) {
  if (!list || list.length === 0) return "—";
  return [...list]
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d - 1] ?? d)
    .join(" ");
}

function money(value: number | null) {
  if (value === null || value === undefined) return "—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

type VendorLocationConfig = {
  account_number: string | null;
  minimum_order: number | null;
  order_days: number[] | null;
  delivery_days: number[] | null;
  is_active: boolean;
};

type VendorRow = {
  id: string;
  name: string;
  vendor_type: string | null;
  order_type: string;
  url: string | null;
  is_active: boolean;
  vendor_locations: VendorLocationConfig[];
};

export default async function VendorsPage() {
  const session = await getAppSession();
  const supabase = await createClient();

  // The per-location config (account, minimum, days) is embedded and filtered
  // to the active location — spec §4.8: vendor config is per location.
  let query = supabase
    .from("vendors")
    .select(
      `id, name, vendor_type, order_type, url, is_active,
       vendor_locations(account_number, minimum_order, order_days, delivery_days, is_active)`
    )
    .order("name");

  if (session.activeLocation) {
    query = query.eq("vendor_locations.location_id", session.activeLocation.id);
  }

  const { data, error } = await query;

  if (error) {
    return (
      <p className="text-sm text-red-700">
        Could not load vendors: {error.message}
      </p>
    );
  }

  const vendors = (data ?? []) as VendorRow[];

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">Vendors</h1>
        <span className="text-sm text-neutral-500">
          {vendors.length} {vendors.length === 1 ? "vendor" : "vendors"}
          {session.activeLocation ? ` · ${session.activeLocation.code}` : ""}
        </span>
      </div>

      {vendors.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No vendors yet — the catalog arrives with the FileMaker migration.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-600">
                <th className="px-2 py-1 font-medium">Name</th>
                <th className="px-2 py-1 font-medium">Type</th>
                <th className="px-2 py-1 font-medium">Order via</th>
                <th className="px-2 py-1 font-medium">Account</th>
                <th className="px-2 py-1 font-medium text-right">Minimum</th>
                <th className="px-2 py-1 font-medium">Order days</th>
                <th className="px-2 py-1 font-medium">Delivery days</th>
                <th className="px-2 py-1 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => {
                const config = v.vendor_locations[0] ?? null;
                return (
                  <tr
                    key={v.id}
                    className={`border-b border-neutral-100 hover:bg-neutral-50 ${
                      v.is_active ? "" : "text-neutral-400"
                    }`}
                  >
                    <td className="px-2 py-1">
                      {v.url ? (
                        <a
                          href={v.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 hover:underline"
                        >
                          {v.name}
                        </a>
                      ) : (
                        v.name
                      )}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {v.vendor_type ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">{v.order_type}</td>
                    <td className="px-2 py-1 text-neutral-600">
                      {config?.account_number ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-neutral-600">
                      {money(config?.minimum_order ?? null)}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-neutral-600">
                      {days(config?.order_days ?? null)}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-neutral-600">
                      {days(config?.delivery_days ?? null)}
                    </td>
                    <td className="px-2 py-1">
                      <VendorActiveToggle vendorId={v.id} active={v.is_active} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
