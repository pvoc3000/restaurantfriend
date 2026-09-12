"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { splitAccountName } from "@/lib/quickbooks";
import { PickList } from "@/components/ui/PickList";
import { money, HERE_BADGE_CLASS } from "@/lib/catalog";
import { DataTable, type DataColumn } from "./DataTable";
import { InlineValue } from "./InlineValue";
import { ActiveToggle } from "./ActiveToggle";
import { WeekdayPicker, WEEKDAY_PICKER_WIDTH } from "./WeekdayPicker";

// Sorting a weekday set on its canonical "1,3,5" string groups locations that
// share a schedule, which is what you're scanning for. Empty sorts last.
function daysKey(list: number[] | null) {
  if (!list || list.length === 0) return null;
  return [...list].sort((a, b) => a - b).join(",");
}

export type VendorLocationRow = {
  id: string;
  location_id: string;
  external_ref: { qbo?: { id?: string } } | null;
  expense_account_ref: string | null;
  expense_account_name: string | null;
  qbo_location_ref: string | null;
  qbo_location_name: string | null;
  qbo_class_ref: string | null;
  qbo_class_name: string | null;
  account_number: string | null;
  minimum_order: number | null;
  order_days: number[] | null;
  delivery_days: number[] | null;
  is_active: boolean;
  sales_rep: string | null;
  rep_phone: string | null;
  rep_email: string | null;
};

/**
 * Rep fields live behind the disclosure; this is what you see without opening.
 * Nothing is shown when there's no rep — a "none" on every row would cost the
 * width that makes the summary useful on the rows that do have one.
 */
function repSummary(row: VendorLocationRow) {
  // Falls back to the email: plenty of migrated rows have only that, and a row
  // with contact details must never look empty from the outside.
  const parts = [row.sales_rep, row.rep_phone].filter(Boolean);
  if (parts.length === 0 && row.rep_email) return row.rep_email;
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** A shop, and this vendor's config there — null until somebody sets one up. */
type Row = { location: Shop; vl: VendorLocationRow | null };

export type Shop = { id: string; code: string };

/**
 * A vendor's per-location config — account, minimum and days for each shop.
 * Editable in place (spec §4.8 puts this on the vendor screen); writes go
 * through RLS, which requires purchaser or above.
 *
 * ONE ROW PER SHOP, WHETHER OR NOT THE VENDOR IS SET UP THERE (Mark,
 * 2026-09-08: "I need to be able to edit its per location config", while adding
 * a trash-collection vendor so he could file its invoice and push it to
 * QuickBooks). It listed only the rows that already EXISTED, so a vendor
 * created here read "Not configured at any location yet" with nothing to press
 * — and every QuickBooks mapping a bill needs lives on this row (083), so a
 * vendor with none of them can be filed against and never pushed. Nothing was
 * missing but the door: 001 has had the insert policy all along, and every one
 * of the 56 rows at DF01 came out of the FileMaker load.
 *
 * `ItemLocationRows`' shape, and its rule: the Active cell holds the toggle for
 * a shop that IS set up and **Use here** for one that is not, because both
 * answer the same question about the row.
 *
 * IT ENUMERATES THE ACTIVE SHOPS PLUS ANY SHOP THAT ALREADY HAS A ROW. Design
 * rule 3 says `activeLocations` to enumerate — you do not start using a vendor
 * at a shop that is shut — but a row that EXISTS at a closed shop is real
 * config, and listing only the active ones would hide it. That is a latent
 * fault in `ItemLocationRows`, which maps over the active list alone.
 */
function VendorQboLink({
  rowId,
  value,
  options,
  placeholder,
}: {
  rowId: string;
  value: string | null;
  options: { id: string; name: string }[];
  placeholder: string;
}) {
  const supabase = createClient();
  const [picked, setPicked] = useState(value);
  const [error, setError] = useState<string | null>(null);

  async function pick(next: string | null) {
    setError(null);
    // The whole `qbo` branch as an OBJECT, so an id can never outlive what it
    // was chosen as — and so the column holds jsonb rather than a string that
    // merely looks like it.
    const { data, error: writeError } = await supabase
      .from("vendor_locations")
      .update({ external_ref: next ? { qbo: { id: next } } : {} })
      .eq("id", rowId)
      .select("id");
    if (writeError) {
      setError(writeError.message);
      return;
    }
    // Row count, not the absence of an error: below purchaser+ the policy
    // matches nothing and PostgREST still reports success.
    if (!data || data.length === 0) {
      setError("That wasn't saved — changing a vendor is open to purchasers and above.");
      return;
    }
    setPicked(next);
  }

  return (
    <>
      <PickList
        variant="inline"
        ariaLabel="Which QuickBooks vendor this is at this shop"
        value={picked}
        placeholder={placeholder}
        options={options.map((o) => ({ value: o.id, label: o.name }))}
        onPick={(next) => void pick(next)}
        clearable
        clearLabel="Not linked"
        panelMinWidth={320}
      />
      {error && <p className="text-[12px] text-accent">{error}</p>}
    </>
  );
}

export function VendorLocationsTable({
  qboConnected = false,
  rows,
  locations,
  vendorId,
  orgId,
  codeById,
  activeLocationId,
  leading,
  editable,
}: {
  /** The Page Permissions sheet's cell for /vendors — false renders values,
   *  no switch and no "Use here". */
  editable: boolean;
  rows: VendorLocationRow[];
  /** The shops you may set this vendor up at: `session.activeLocations`. */
  locations: Shop[];
  vendorId: string;
  orgId: string;
  /** Every shop's code, so a row at a CLOSED one still names itself. */
  codeById: Record<string, string>;
  activeLocationId: string | null;
  /** Whether to offer the QuickBooks settings at all. Read on the server, so
   *  a disconnected org never sees three pickers it cannot fill. */
  qboConnected?: boolean;
  /** Passed straight through to the table's strip — see DataTable's `leading`. */
  leading?: ReactNode;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [qbo, setQbo] = useState<{
    vendors: { id: string; name: string }[];
    accounts: { id: string; name: string }[];
    classes: { id: string; name: string }[];
    departments: { id: string; name: string }[];
    /** Whether QuickBooks will actually KEEP a DepartmentRef. The records
     *  existing is not the same as the feature being on, and when it is off
     *  QuickBooks drops the location with a 200 and no fault.
     *
     *  Deliberately NOT done for classes: the same Preferences call reported
     *  both class flags false on a company where a ClassRef demonstrably
     *  stored, so gating that picker on them would say "off" about something
     *  that works. For classes the post-push check is the honest mechanism. */
    departmentsEnabled: boolean;
  } | null>(null);

  // ONE fetch for the whole table rather than one per expanded row: the three
  // vocabularies are the same for every shop, and a picker that loads when you
  // open a row reads as broken for the second it takes.
  useEffect(() => {
    if (!qboConnected) return;
    let cancelled = false;
    void (async () => {
      const [a, c, d, v] = await Promise.all([
        invokeQbo(supabase, { mode: "accounts" }),
        invokeQbo(supabase, { mode: "classes" }),
        invokeQbo(supabase, { mode: "departments" }),
        invokeQbo(supabase, { mode: "vendors" }),
      ]);
      if (cancelled) return;
      setQbo({
        vendors: (v.data?.vendors ?? []) as { id: string; name: string }[],
        accounts: (a.data?.accounts ?? []) as { id: string; name: string }[],
        classes: (c.data?.classes ?? []) as { id: string; name: string }[],
        departments: (d.data?.departments ?? []) as { id: string; name: string }[],
        departmentsEnabled: d.data?.enabled === true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [qboConnected, supabase]);

  /**
   * What the trigger says when there is nothing to choose.
   *
   * An empty picker offering "None" is indistinguishable from a broken one —
   * the same failure the settings and vendor blocks already had. Class and
   * Location tracking are Plus features that must also be TURNED ON in
   * QuickBooks' own settings, so an empty list is usually a switch somebody
   * has not flipped rather than an error, and saying which saves the hunt.
   */
  function pickerPlaceholder(
    list: { id: string }[] | undefined,
    empty: string,
    resting: string
  ): string {
    if (!qbo) return "Reading QuickBooks…";
    return list && list.length > 0 ? resting : empty;
  }

  // Active shops first, in the order the session lists them, then any shop that
  // already carries a row — a closed one included. See the note above.
  const byLocation = new Map(rows.map((r) => [r.location_id, r]));
  const extras = rows
    .filter((r) => !locations.some((l) => l.id === r.location_id))
    .map((r) => ({ id: r.location_id, code: codeById[r.location_id] ?? "—" }));
  const tableRows: Row[] = [...locations, ...extras].map((location) => ({
    location,
    vl: byLocation.get(location.id) ?? null,
  }));

  /**
   * Start using this vendor at a shop — `ItemLocationRows.stockHere`, and the
   * same one click. NOT named `useHere`: any `use` prefix reads as a hook to
   * `react-hooks/rules-of-hooks`, which refuses it inside the click handler. Everything on the row is nullable, so the insert names only
   * what identifies it and the cells beside it are how the rest gets filled in.
   */
  async function startUsingHere(locationId: string) {
    setBusy(true);
    setAddError(null);
    // org_id EXPLICITLY: no table defaults it, and an insert policy's WITH
    // CHECK is evaluated BEFORE the NOT NULL, so omitting it reports an RLS
    // violation and sends you looking at roles (design rule 1).
    const { error } = await supabase
      .from("vendor_locations")
      .insert({ org_id: orgId, vendor_id: vendorId, location_id: locationId });
    setBusy(false);
    if (error) setAddError(error.message);
    else router.refresh();
  }

  const dash = <span className="text-faint">—</span>;

  const columns: DataColumn<Row>[] = [
    // Active leads on every catalog table (Mark, 2026-07-23).
    {
      key: "is_active",
      label: "Active",
      width: 95,
      // Set up and off, set up and on, not set up — which is also the order you
      // want them in when you sort by this column.
      sortValue: (r) => (r.vl ? (r.vl.is_active ? 0 : 1) : 2),
      render: (r) =>
        r.vl ? (
          // A SWITCH, matching the vendors LIST (Mark, 2026-09-11). The two
          // Active columns are the same question about the same supplier a
          // click apart — one org-wide, one per shop — so they must not be
          // two different shapes.
          <ActiveToggle
            readOnly={!editable}
            table="vendor_locations"
            id={r.vl.id}
            active={r.vl.is_active}
            control="switch"
            label="Vendor active at this location"
          />
        ) : !editable ? (
          dash
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void startUsingHere(r.location.id)}
            className="border border-ink px-2 py-0.5 text-xs text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
          >
            Use here
          </button>
        ),
    },
    {
      key: "location",
      // The row IS the location — never hideable.
      pinned: true,
      label: "Location",
      // Wide enough for the code, the "here" badge and the rep summary.
      width: 300,
      sortValue: (r) => r.location.code,
      render: (r) => (
        <>
          {r.location.code}
          {r.location.id === activeLocationId && (
            <span className={HERE_BADGE_CLASS}>
              here
            </span>
          )}
        </>
      ),
    },
    {
      key: "account",
      label: "Account",
      width: 170,
      sortValue: (r) => r.vl?.account_number ?? null,
      render: (r) =>
        r.vl ? (
          <InlineValue
            readOnly={!editable}
            table="vendor_locations"
            id={r.vl.id}
            column="account_number"
            value={r.vl.account_number}
          />
        ) : (
          dash
        ),
    },
    {
      key: "minimum",
      label: "Minimum",
      width: 140,
      align: "right",
      sortValue: (r) =>
        r.vl?.minimum_order == null ? null : Number(r.vl.minimum_order),
      render: (r) =>
        r.vl ? (
          <InlineValue
            readOnly={!editable}
            table="vendor_locations"
            id={r.vl.id}
            column="minimum_order"
            value={r.vl.minimum_order}
            kind="number"
            align="right"
            format={(v) => money(Number(v))}
          />
        ) : (
          dash
        ),
    },
    {
      key: "order_days",
      label: "Order days",
      width: WEEKDAY_PICKER_WIDTH,
      minWidth: WEEKDAY_PICKER_WIDTH,
      sortValue: (r) => daysKey(r.vl?.order_days ?? null),
      render: (r) =>
        r.vl ? (
          <WeekdayPicker
            readOnly={!editable}
            table="vendor_locations"
            id={r.vl.id}
            column="order_days"
            value={r.vl.order_days}
            label="Order day"
          />
        ) : (
          dash
        ),
    },
    {
      key: "delivery_days",
      label: "Delivery days",
      width: WEEKDAY_PICKER_WIDTH,
      minWidth: WEEKDAY_PICKER_WIDTH,
      sortValue: (r) => daysKey(r.vl?.delivery_days ?? null),
      render: (r) =>
        r.vl ? (
          <WeekdayPicker
            readOnly={!editable}
            table="vendor_locations"
            id={r.vl.id}
            column="delivery_days"
            value={r.vl.delivery_days}
            label="Delivery day"
          />
        ) : (
          dash
        ),
    },
  ];

  return (
    <>
      {addError && <p className="mb-2 text-sm text-accent">{addError}</p>}
    <DataTable
      rows={tableRows}
      columns={columns}
      rowKey={(r) => r.location.id}
      storageKey="rf.vendorLocations.columnWidths.v1"
      columnChooser
      leading={leading}
      defaultSort={{ key: "location" }}
      expand={{
        summary: (r) => (r.vl ? repSummary(r.vl) : null),
        render: (r) =>
          !r.vl ? (
            // The expansion is where the rep and every QuickBooks mapping live,
            // and all of them are columns on a row that does not exist yet. It
            // says the one thing that IS true rather than rendering an empty
            // form somebody would type into.
            <p className="text-sm text-muted">
              This vendor is not set up at {r.location.code} yet
              {editable ? " — press Use here to start." : "."}
            </p>
          ) : (
          <dl className="grid max-w-md grid-cols-[6rem_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="py-0.5 text-subtle">Sales rep</dt>
            <dd>
              <InlineValue
                readOnly={!editable}
                table="vendor_locations"
                id={r.vl.id}
                column="sales_rep"
                value={r.vl.sales_rep}
                placeholder="none"
              />
            </dd>
            <dt className="py-0.5 text-subtle">Phone</dt>
            <dd>
              <InlineValue
                readOnly={!editable}
                table="vendor_locations"
                id={r.vl.id}
                column="rep_phone"
                value={r.vl.rep_phone}
                placeholder="none"
              />
            </dd>
            <dt className="py-0.5 text-subtle">Email</dt>
            <dd>
              <InlineValue
                readOnly={!editable}
                table="vendor_locations"
                id={r.vl.id}
                column="rep_email"
                value={r.vl.rep_email}
                placeholder="none"
              />
            </dd>

            {/* Migration 083. Set here rather than on the vendor because a bill
                has to say WHICH SHOP it belongs to, and in one company file
                that is QuickBooks' Location and Class. Each writes its `_name`
                snapshot in the SAME statement, so renaming an account in
                QuickBooks cannot rewrite what this row says it posts to. */}
            {qboConnected && (
              <>
                <dt className="col-span-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  QuickBooks
                </dt>

                <dt className="py-0.5 text-subtle">Vendor</dt>
                <dd>
                  {/* 026's `external_ref`, which was added for a per-location
                      company file and had never had a reader. Mark, 2026-09-01:
                      every QuickBooks setting belongs on this row, the mapping
                      included. `vendors.external_ref` is now the unused one. */}
                  <VendorQboLink
                    rowId={r.vl.id}
                    value={r.vl.external_ref?.qbo?.id ?? null}
                    options={qbo?.vendors ?? []}
                    placeholder={pickerPlaceholder(
                      qbo?.vendors,
                      "No vendors in QuickBooks",
                      "Not linked"
                    )}
                  />
                </dd>

                <dt className="py-0.5 text-subtle">Account</dt>
                <dd>
                  <InlineValue
                    readOnly={!editable}
                    table="vendor_locations"
                    id={r.vl.id}
                    column="expense_account_ref"
                    value={r.vl.expense_account_ref}
                    kind="pick"
                    clearable
                    placeholder={pickerPlaceholder(
                      qbo?.accounts,
                      "No expense accounts in QuickBooks",
                      "Use the org default"
                    )}
                    ariaLabel="Expense account for this vendor at this shop"
                    options={(qbo?.accounts ?? []).map((a) => {
                      const { parent, leaf } = splitAccountName(a.name);
                      return { value: a.id, label: leaf, group: parent ?? "Top level" };
                    })}
                    alsoUpdate={(next) => ({
                      expense_account_name:
                        qbo?.accounts.find((a) => a.id === next)?.name ?? null,
                    })}
                  />
                </dd>

                <dt className="py-0.5 text-subtle">Location</dt>
                <dd>
                  <InlineValue
                    readOnly={!editable}
                    table="vendor_locations"
                    id={r.vl.id}
                    column="qbo_location_ref"
                    value={r.vl.qbo_location_ref}
                    kind="pick"
                    clearable
                    placeholder={
                      qbo && !qbo.departmentsEnabled
                        ? "Track locations is off in QuickBooks"
                        : pickerPlaceholder(
                            qbo?.departments,
                            "No locations in QuickBooks",
                            "None"
                          )
                    }
                    ariaLabel="QuickBooks location for bills from this vendor at this shop"
                    options={(qbo?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
                    alsoUpdate={(next) => ({
                      qbo_location_name:
                        qbo?.departments.find((d) => d.id === next)?.name ?? null,
                    })}
                  />
                </dd>

                <dt className="py-0.5 text-subtle">Class</dt>
                <dd>
                  <InlineValue
                    readOnly={!editable}
                    table="vendor_locations"
                    id={r.vl.id}
                    column="qbo_class_ref"
                    value={r.vl.qbo_class_ref}
                    kind="pick"
                    clearable
                    placeholder={pickerPlaceholder(
                      qbo?.classes,
                      "Class tracking is off in QuickBooks",
                      "None"
                    )}
                    ariaLabel="QuickBooks class for bills from this vendor at this shop"
                    options={(qbo?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))}
                    alsoUpdate={(next) => ({
                      qbo_class_name: qbo?.classes.find((c) => c.id === next)?.name ?? null,
                    })}
                  />
                </dd>
              </>
            )}
          </dl>
        ),
      }}
      empty={<p className="text-sm text-muted">No shops to configure.</p>}
    />
    </>
  );
}
