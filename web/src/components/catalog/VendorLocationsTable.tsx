"use client";

import { useEffect, useState, type ReactNode } from "react";
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

/**
 * A vendor's per-location config — account, minimum and days for each shop.
 * Editable in place (spec §4.8 puts this on the vendor screen); writes go
 * through RLS, which requires purchaser or above.
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
  codeById,
  activeLocationId,
  leading,
}: {
  rows: VendorLocationRow[];
  codeById: Record<string, string>;
  activeLocationId: string | null;
  /** Whether to offer the QuickBooks settings at all. Read on the server, so
   *  a disconnected org never sees three pickers it cannot fill. */
  qboConnected?: boolean;
  /** Passed straight through to the table's strip — see DataTable's `leading`. */
  leading?: ReactNode;
}) {
  const supabase = createClient();
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

  const columns: DataColumn<VendorLocationRow>[] = [
    // Active leads on every catalog table (Mark, 2026-07-23).
    {
      key: "is_active",
      label: "Active",
      width: 95,
      sortValue: (r) => (r.is_active ? 0 : 1),
      render: (r) => (
        <ActiveToggle
          table="vendor_locations"
          id={r.id}
          active={r.is_active}
          label="Vendor active at this location"
        />
      ),
    },
    {
      key: "location",
      // The row IS the location — never hideable.
      pinned: true,
      label: "Location",
      // Wide enough for the code, the "here" badge and the rep summary.
      width: 300,
      sortValue: (r) => codeById[r.location_id] ?? null,
      render: (r) => (
        <>
          {codeById[r.location_id] ?? "—"}
          {r.location_id === activeLocationId && (
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
      sortValue: (r) => r.account_number,
      render: (r) => (
        <InlineValue
          table="vendor_locations"
          id={r.id}
          column="account_number"
          value={r.account_number}
        />
      ),
    },
    {
      key: "minimum",
      label: "Minimum",
      width: 140,
      align: "right",
      sortValue: (r) => (r.minimum_order === null ? null : Number(r.minimum_order)),
      render: (r) => (
        <InlineValue
          table="vendor_locations"
          id={r.id}
          column="minimum_order"
          value={r.minimum_order}
          kind="number"
          align="right"
          format={(v) => money(Number(v))}
        />
      ),
    },
    {
      key: "order_days",
      label: "Order days",
      width: WEEKDAY_PICKER_WIDTH,
      sortValue: (r) => daysKey(r.order_days),
      render: (r) => (
        <WeekdayPicker
          table="vendor_locations"
          id={r.id}
          column="order_days"
          value={r.order_days}
          label="Order day"
        />
      ),
    },
    {
      key: "delivery_days",
      label: "Delivery days",
      width: WEEKDAY_PICKER_WIDTH,
      sortValue: (r) => daysKey(r.delivery_days),
      render: (r) => (
        <WeekdayPicker
          table="vendor_locations"
          id={r.id}
          column="delivery_days"
          value={r.delivery_days}
          label="Delivery day"
        />
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.location_id}
      storageKey="rf.vendorLocations.columnWidths.v1"
      columnChooser
      leading={leading}
      defaultSort={{ key: "location" }}
      expand={{
        summary: repSummary,
        render: (r) => (
          <dl className="grid max-w-md grid-cols-[6rem_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="py-0.5 text-subtle">Sales rep</dt>
            <dd>
              <InlineValue
                table="vendor_locations"
                id={r.id}
                column="sales_rep"
                value={r.sales_rep}
                placeholder="none"
              />
            </dd>
            <dt className="py-0.5 text-subtle">Phone</dt>
            <dd>
              <InlineValue
                table="vendor_locations"
                id={r.id}
                column="rep_phone"
                value={r.rep_phone}
                placeholder="none"
              />
            </dd>
            <dt className="py-0.5 text-subtle">Email</dt>
            <dd>
              <InlineValue
                table="vendor_locations"
                id={r.id}
                column="rep_email"
                value={r.rep_email}
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
                    rowId={r.id}
                    value={r.external_ref?.qbo?.id ?? null}
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
                    table="vendor_locations"
                    id={r.id}
                    column="expense_account_ref"
                    value={r.expense_account_ref}
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
                    table="vendor_locations"
                    id={r.id}
                    column="qbo_location_ref"
                    value={r.qbo_location_ref}
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
                    table="vendor_locations"
                    id={r.id}
                    column="qbo_class_ref"
                    value={r.qbo_class_ref}
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
      empty={
        <p className="text-sm text-muted">Not configured at any location yet.</p>
      }
    />
  );
}
