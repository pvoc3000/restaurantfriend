"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { splitAccountName } from "@/lib/quickbooks";
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
    accounts: { id: string; name: string }[];
    classes: { id: string; name: string }[];
    departments: { id: string; name: string }[];
  } | null>(null);

  // ONE fetch for the whole table rather than one per expanded row: the three
  // vocabularies are the same for every shop, and a picker that loads when you
  // open a row reads as broken for the second it takes.
  useEffect(() => {
    if (!qboConnected) return;
    let cancelled = false;
    void (async () => {
      const [a, c, d] = await Promise.all([
        invokeQbo(supabase, { mode: "accounts" }),
        invokeQbo(supabase, { mode: "classes" }),
        invokeQbo(supabase, { mode: "departments" }),
      ]);
      if (cancelled) return;
      setQbo({
        accounts: (a.data?.accounts ?? []) as { id: string; name: string }[],
        classes: (c.data?.classes ?? []) as { id: string; name: string }[],
        departments: (d.data?.departments ?? []) as { id: string; name: string }[],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [qboConnected, supabase]);

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

                <dt className="py-0.5 text-subtle">Account</dt>
                <dd>
                  <InlineValue
                    table="vendor_locations"
                    id={r.id}
                    column="expense_account_ref"
                    value={r.expense_account_ref}
                    kind="pick"
                    clearable
                    placeholder={qbo ? "Use the vendor's" : "Reading QuickBooks…"}
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
                    placeholder={qbo ? "None" : "Reading QuickBooks…"}
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
                    placeholder={qbo ? "None" : "Reading QuickBooks…"}
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
