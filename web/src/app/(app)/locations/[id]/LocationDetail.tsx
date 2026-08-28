import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { LOCATIONS_CRUMB } from "@/lib/locations";
import type { RawSearchParams } from "@/lib/itemFilters";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { InlineValue } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { AddressFields } from "@/components/location/AddressFields";
import { OperationsFields } from "@/components/location/OperationsFields";
import { OperatingHours } from "@/components/location/OperatingHours";
import { ProductionMapping } from "@/components/location/ProductionMapping";
import { WorkingHere } from "@/components/location/WorkingHere";
import { SectionHeading } from "@/components/ui/SectionHeading";

/** The columns migration 017 added, plus what 001 always had. */
type LocationRecord = {
  id: string;
  code: string;
  name: string;
  public_name: string | null;
  kind: "physical" | "virtual";
  is_active: boolean;
  address: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  tax_rate: number | null;
  labor_rate: number | null;
  register_count: number | null;
  open_days: number[] | null;
  open_time_by_weekday: (string | null)[] | null;
  close_time_by_weekday: (string | null)[] | null;
  kitchen_by_weekday: (string | null)[] | null;
  shops_for: string[] | null;
};

type EmailProvider = { kind?: string; from?: string; reply_to?: string; secret_ref?: string };

// Was a local copy of the section-heading style; it's `ui/SectionHeading` now,
// so this screen's headings change with everyone else's.
const Heading = SectionHeading;

/**
 * Everything the app knows about ONE location — any of them, not just the one
 * you're working at (Mark, 2026-08-01). It used to be singular and id-less,
 * reached only by switching the working location in the masthead; the Locations
 * list is its parent now, so it takes an id and carries breadcrumbs and the
 * record book like every other detail screen.
 *
 * FileMaker split this over three tabs. INFO2 was SMTP credentials (replaced by
 * the edge function's provider layer, and they must never be shown), commuter
 * benefit, shift-report pages and production schedules — three unbuilt modules
 * — and REQUESTS was three more. What's actually ours today fits one page.
 */
export async function LocationDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  const session = await getAppSession();
  const supabase = await createClient();

  // Writes on `locations` need purchaser+ (the generic policy from 001). Below
  // that every field renders as plain text rather than offering an edit the
  // database will refuse.
  const editable = canWriteCatalog(session.membership.role);

  const [
    { data: row, error },
    { count: sectionCount },
    { count: vendorCount },
    { count: itemCount },
    { count: poCount },
  ] = await Promise.all([
    supabase
      .from("locations")
      .select(
        `id, code, name, public_name, kind, is_active, address, settings,
         tax_rate, labor_rate, register_count, open_days,
         open_time_by_weekday, close_time_by_weekday,
         kitchen_by_weekday, shops_for`
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("shop_sections")
      .select("id", { count: "exact", head: true })
      .eq("location_id", id),
    supabase
      .from("vendor_locations")
      .select("id", { count: "exact", head: true })
      .eq("location_id", id)
      .eq("is_active", true),
    supabase
      .from("inventory_item_locations")
      .select("id", { count: "exact", head: true })
      .eq("location_id", id)
      .eq("is_active", true),
    supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("location_id", id),
  ]);

  if (error) {
    return <p className="text-sm text-accent">Could not load the location: {error.message}</p>;
  }
  if (!row) {
    return <p className="text-sm text-accent">This location no longer exists.</p>;
  }

  const location = row as unknown as LocationRecord;
  const trail = parseTrail(rawParams, LOCATIONS_CRUMB);

  // Three tiers, the same order `send-po-email` resolves them in: this
  // location's own override, then the org's, then the app's default sender.
  const locationProvider = (location.settings?.email_provider ?? null) as EmailProvider | null;
  const orgProvider = (session.orgSettings.email_provider ?? null) as EmailProvider | null;
  const provider = locationProvider ?? orgProvider;
  const providerTier = locationProvider
    ? "this location"
    : orgProvider
      ? "the org"
      : "the app default";

  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={trail}
        current={location.code}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      {/* ---- who this is ---------------------------------------------- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {editable ? (
              <InlineValue
                boxed={BOXED_FIELDS}
                table="locations"
                id={location.id}
                column="name"
                value={location.name}
                nullable={false}
                placeholder="Untitled location"
                className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]"
              />
            ) : (
              location.name
            )}
          </h1>
          <span className="flex items-center gap-2 text-sm text-muted">
            {editable && (
              <ActiveToggle
                table="locations"
                id={location.id}
                active={location.is_active}
                label="Location active"
              />
            )}
            {location.is_active ? "Active" : "Inactive"}
          </span>
          {/* The same control the list carries, so a record you've just opened
              can be adopted without walking back to pick it. */}
          <WorkingHere
            locationId={location.id}
            isWorking={location.id === session.activeLocation?.id}
            isActive={location.is_active}
          />
        </div>

        <dl className="grid max-w-md grid-cols-[6rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <dt className="text-subtle">Code</dt>
          <dd>
            {/* The PO number's location segment is the trailing digits of this
                (migration 006), and every FMP-era join was on it. Editable, but
                it is the one field here with consequences elsewhere. */}
            {editable ? (
              <InlineValue
                boxed={BOXED_FIELDS}
                table="locations"
                id={location.id}
                column="code"
                value={location.code}
                nullable={false}
              />
            ) : (
              location.code
            )}
          </dd>
          <dt className="text-subtle">Public name</dt>
          <dd>
            {/* WHAT A CUSTOMER SEES — the inquiry form's shop list, and
                whatever else ever faces outward. `name` is internal and says
                so: the real ones read "DONUT FRIEND 01 HIGHLAND PARK", a
                numbering scheme that means nothing to somebody choosing where
                to collect a box of donuts.

                Empty is a real state, not a gap to fill: it FALLS BACK to
                `name`, which is why the placeholder shows the name rather than
                an em dash — the cell tells you what the public would see right
                now, whether or not anybody has set it. */}
            {editable ? (
              <InlineValue
                boxed={BOXED_FIELDS}
                table="locations"
                id={location.id}
                column="public_name"
                value={location.public_name}
                placeholder={location.name}
                ariaLabel="Public name"
              />
            ) : (
              location.public_name ?? location.name
            )}
          </dd>
          <dt className="text-subtle">Kind</dt>
          <dd>
            {editable ? (
              <InlineValue
                boxed={BOXED_FIELDS}
                table="locations"
                id={location.id}
                column="kind"
                value={location.kind}
                kind="pick"
                nullable={false}
                options={[
                  { value: "physical", label: "physical", hint: "a shop with shelves" },
                  { value: "virtual", label: "virtual", hint: "offsite events, no address" },
                ]}
              />
            ) : (
              location.kind
            )}
          </dd>
        </dl>
      </div>

      {/* ---- what hangs off this location ------------------------------ */}
      {/* First after the identity (Mark, 2026-08-02). It's the fastest read on
          the screen — four numbers that say how much of the business is at this
          shop — and it answers "is this location real yet?" before you start
          into the fields. Everything below it is detail you go looking for. */}
      <section className="space-y-2">
        <Heading>In the system</Heading>
        {/* Figures, not links (Mark, 2026-08-01: "drop the links, but keep the
            info. It's handy."). Every one of those screens is scoped to the
            WORKING location, so a link from this record was only ever right by
            coincidence — and wrong on the five records that aren't it. */}
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <Count label="Shop sections" value={sectionCount} />
          <Count label="Vendors here" value={vendorCount} />
          <Count label="Items stocked" value={itemCount} />
          <Count label="Purchase orders" value={poCount} />
        </div>
      </section>

      {/* ---- addresses ------------------------------------------------ */}
      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-2">
          <Heading>Shipping address</Heading>
          <AddressFields
            locationId={location.id}
            address={location.address}
            group="shipping"
            editable={editable}
          />
          <p className="max-w-md text-xs text-subtle">
            This is the <strong>Ship to</strong>{" "}block printed on every vendor
            purchase order — it&rsquo;s where the delivery goes.
          </p>
        </section>

        <section className="space-y-2">
          <Heading>Billing address</Heading>
          <AddressFields
            locationId={location.id}
            address={location.address}
            group="billing"
            editable={editable}
          />
          <p className="max-w-md text-xs text-subtle">
            Kept per location, but a PO&rsquo;s <strong>bill to</strong>{" "}comes from
            the organisation&rsquo;s billing entity, not from here.
          </p>
        </section>
      </div>

      {/* ---- hours ---------------------------------------------------- */}
      <section className="space-y-2">
        <Heading>Operating hours</Heading>
        <OperatingHours
          locationId={location.id}
          openDays={location.open_days}
          openTimes={location.open_time_by_weekday}
          closeTimes={location.close_time_by_weekday}
          editable={editable}
        />
      </section>

      {/* ---- the numbers ---------------------------------------------- */}
      <section className="space-y-2">
        <Heading>Operations</Heading>
        <OperationsFields
          locationId={location.id}
          taxRate={location.tax_rate}
          laborRate={location.labor_rate}
          registerCount={location.register_count}
          editable={editable}
        />
      </section>

      {/* ---- production ----------------------------------------------- */}
      <section className="space-y-2">
        <Heading>Production</Heading>
        <p className="max-w-[72ch] text-xs text-subtle">
          Recorded here, read by nothing yet — the Production module will want
          them, and they came out of the old system with the rest of this record.
        </p>
        <ProductionMapping
          locationId={location.id}
          locations={session.locations}
          kitchenByWeekday={location.kitchen_by_weekday}
          shopsFor={location.shops_for}
          editable={editable}
        />
      </section>

      {/* ---- who POs come from ----------------------------------------- */}
      <section className="space-y-2">
        <Heading>Email sending</Heading>
        <dl className="grid max-w-xl grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <dt className="text-subtle">Configured by</dt>
          <dd>{providerTier}</dd>
          <dt className="text-subtle">Sends as</dt>
          <dd>
            {provider?.from ?? <span className="text-faint">the app&rsquo;s default sender</span>}
          </dd>
          <dt className="text-subtle">Transport</dt>
          <dd>{provider?.kind ?? "resend"}</dd>
        </dl>
        <p className="max-w-[72ch] text-xs text-subtle">
          Purchase orders emailed from this location go out through whichever of
          the three tiers answers first — this location, then the organisation,
          then the app&rsquo;s own sender. Credentials live in edge-function
          secrets and are never stored in the database, so there is nothing here
          to edit; changing the transport is a settings change.
        </p>
      </section>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <span className="block text-[28px] font-bold leading-none tabular-nums">
        {value ?? "—"}
      </span>
      <span className="mt-1 block text-[11px] uppercase tracking-[0.12em] text-subtle">
        {label}
      </span>
    </div>
  );
}
