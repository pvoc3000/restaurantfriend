"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { TabPicker } from "@/components/ui/TabPicker";
import { DateField } from "@/components/ui/DateField";
import { formatCents } from "@/lib/tipPool";
import {
  SALES_RANGES,
  SALES_RANGE_LABEL,
  formatFraction,
  tipFraction,
  rollUpByDate,
  type DateRange,
  type SalesDay,
  type SalesRangeKey,
} from "@/lib/sales";
import type { RawSearchParams } from "@/lib/filterMenus";
import { SyncFromSquare } from "./SyncFromSquare";

type Row = SalesDay & { id: string };

/**
 * The daily table, its view controls, and the sync command.
 *
 * VIEW STATE LIVES IN THE URL, per the app's standing rule — the range, the
 * shop and the sort are all shareable and all survive a trip to another screen
 * and back. Written with `history.replaceState` rather than `router.replace`
 * for the usual reason: a replace re-runs the server component, and this page's
 * query spans a year.
 */
export function SalesScreen({
  days,
  range,
  rangeKey,
  shops,
  locationFilter,
  canSync,
  today,
  params,
}: {
  days: SalesDay[];
  allDays: SalesDay[];
  range: DateRange;
  rangeKey: SalesRangeKey;
  shops: { id: string; code: string }[];
  locationFilter: string;
  canSync: boolean;
  today: string;
  params: RawSearchParams;
}) {
  const router = useRouter();
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);

  const rows: Row[] = useMemo(
    () =>
      days
        .filter((d) => d.business_date >= range.from && d.business_date <= range.to)
        .map((d) => ({ ...d, id: `${d.location_id}|${d.business_date}` })),
    [days, range.from, range.to]
  );

  // Both shops folded into one figure per date, for the Combined view. A day
  // where one shop was shut is still that date's real takings.
  const combined = useMemo(() => rollUpByDate(rows), [rows]);

  function go(next: Record<string, string | null>) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const s = Array.isArray(v) ? v[0] : v;
      if (s) q.set(k, s);
    }
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") q.delete(k);
      else q.set(k, v);
    }
    router.push(`/sales${q.toString() ? `?${q}` : ""}`);
  }

  const columns: DataColumn<Row>[] = [
    {
      key: "date",
      label: "Date",
      width: 200,
      pinned: true,
      sortValue: (r) => r.business_date,
      sortTiebreaks: [(r) => r.locationCode],
      render: (r) => <span className="tabular-nums">{r.business_date}</span>,
    },
    {
      key: "shop",
      label: "Shop",
      width: 140,
      sortValue: (r) => r.locationCode,
      sortTiebreaks: [(r) => r.business_date],
      render: (r) => r.locationCode,
    },
    {
      key: "net",
      label: "Net sales",
      width: 200,
      align: "right",
      sortValue: (r) => r.netSalesCents,
      render: (r) => (
        <span className={`tabular-nums ${r.netSalesCents < 0 ? "text-accent" : ""}`}>
          {formatCents(r.netSalesCents)}
        </span>
      ),
    },
    {
      key: "tips",
      label: "Tips",
      width: 180,
      align: "right",
      sortValue: (r) => r.tipsCents,
      render: (r) => <span className="tabular-nums">{formatCents(r.tipsCents)}</span>,
    },
    {
      key: "share",
      label: "Tip %",
      width: 140,
      align: "right",
      sortValue: (r) =>
        tipFraction({ netSalesCents: r.netSalesCents, tipsCents: r.tipsCents, days: 1 }) ?? -1,
      render: (r) => (
        <span className="tabular-nums">
          {formatFraction(
            tipFraction({ netSalesCents: r.netSalesCents, tipsCents: r.tipsCents, days: 1 })
          )}
        </span>
      ),
    },
    {
      key: "synced",
      label: "Pulled",
      width: 180,
      hideWhenCompact: true,
      sortValue: (r) => r.syncedAt ?? "",
      render: (r) => (
        <span className="text-muted tabular-nums">
          {r.syncedAt ? r.syncedAt.slice(0, 10) : "—"}
        </span>
      ),
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Field label="Period">
          <TabPicker
            options={SALES_RANGES.map((k) => ({ key: k, label: SALES_RANGE_LABEL[k] }))}
            value={rangeKey}
            onChange={(k) => go({ range: k === "period" ? null : k })}
            ariaLabel="Which period to show"
          />
        </Field>

        {shops.length > 1 ? (
          <Field label="Shop">
            <TabPicker
              options={[
                { key: "", label: "All shops" },
                ...shops.map((s) => ({ key: s.code, label: s.code })),
              ]}
              value={locationFilter}
              onChange={(code) => go({ location: code || null })}
              ariaLabel="Which shop to show"
            />
          </Field>
        ) : null}

        {rangeKey === "custom" ? (
          <Field label="From / to">
            {/* `DateField` fires onChange only on a COMPLETE date, so there is
                no half-typed state to wait out and no blur to hook — navigating
                straight from the change is safe. `resolveSalesRange` falls back
                per END, so setting one and not the other is a working view
                rather than an error. */}
            <div className="flex items-center gap-2">
              <DateField
                value={customFrom}
                onChange={(v) => {
                  setCustomFrom(v ?? "");
                  go({ from: v, to: customTo });
                }}
                variant="field"
                ariaLabel="From"
              />
              <span className="text-muted">–</span>
              <DateField
                value={customTo}
                onChange={(v) => {
                  setCustomTo(v ?? "");
                  go({ from: customFrom, to: v });
                }}
                variant="field"
                ariaLabel="To"
              />
            </div>
          </Field>
        ) : null}

        {canSync ? (
          <div className="ml-auto">
            <SyncFromSquare today={today} />
          </div>
        ) : null}
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="sales.daily.v1"
        defaultSort={{ key: "date", dir: "desc" }}
        columnChooser
        compactBelow={1024}
        empty={
          <span>
            No sales for this period.{" "}
            {canSync ? "Pull them from Square with the button above." : null}
          </span>
        }
        group={{
          label: (r) => r.business_date,
          sortKey: "date",
          summary: (band) => {
            const net = band.reduce((a, r) => a + r.netSalesCents, 0);
            const tips = band.reduce((a, r) => a + r.tipsCents, 0);
            return {
              net: <Money cents={net} />,
              tips: <Money cents={tips} />,
              share: (
                <span className="tabular-nums">
                  {formatFraction(tipFraction({ netSalesCents: net, tipsCents: tips, days: 0 }))}
                </span>
              ),
            };
          },
        }}
        totals={(shown) => {
          // Handed the rows the table is SHOWING, so the figure agrees with
          // whatever is filtered rather than reporting the whole set.
          const net = shown.reduce((a, r) => a + r.netSalesCents, 0);
          const tips = shown.reduce((a, r) => a + r.tipsCents, 0);
          return {
            date: <span className="text-muted">{combined.size} days</span>,
            net: <Money cents={net} />,
            tips: <Money cents={tips} />,
            share: (
              <span className="tabular-nums">
                {formatFraction(tipFraction({ netSalesCents: net, tipsCents: tips, days: 0 }))}
              </span>
            ),
          };
        }}
      />
    </section>
  );
}

function Money({ cents }: { cents: number }) {
  return (
    <span className={`tabular-nums ${cents < 0 ? "text-accent" : ""}`}>{formatCents(cents)}</span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}
