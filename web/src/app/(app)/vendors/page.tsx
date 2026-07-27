import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/itemFilters";
import { parseVendorFilters } from "@/lib/vendorFilters";
import { VendorsList } from "@/components/catalog/VendorsList";

type VendorLocationConfig = {
  account_number: string | null;
  minimum_order: number | null;
  order_days: number[] | null;
  delivery_days: number[] | null;
  is_active: boolean;
};

export type VendorRow = {
  id: string;
  name: string;
  vendor_type: string | null;
  order_type: string;
  url: string | null;
  is_active: boolean;
  vendor_locations: VendorLocationConfig[];
};

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const initialFilters = parseVendorFilters(await searchParams);
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
      <p className="text-sm text-accent">
        Could not load vendors: {error.message}
      </p>
    );
  }

  const vendors = (data ?? []) as VendorRow[];
  const types = [
    ...new Set(vendors.map((v) => v.vendor_type).filter((t): t is string => !!t)),
  ].sort();

  return (
    <VendorsList
      vendors={vendors}
      types={types}
      activeLocationCode={session.activeLocation?.code ?? null}
      initialFilters={initialFilters}
    />
  );
}
