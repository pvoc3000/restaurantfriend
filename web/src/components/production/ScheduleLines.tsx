"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { Checkbox } from "@/components/ui/Checkbox";
import { TabPicker } from "@/components/ui/TabPicker";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { formatBatches, tallyBoxes, type RollType, type ScheduleLine } from "@/lib/productionSchedule";

export type ScheduleLineRow = ScheduleLine & {
  planned_par: number | null;
  par_source: string;
  tray_band: string | null;
  note: string | null;
  unit_cost: number | null;
  unit_price: number | null;
  cost_unresolved: number | null;
  costed_at: string | null;
};

type Grouping = "type" | "tray" | "none";

/**
 * The night's items.
 *
 * Every cell a human may legitimately change is editable in place — decision 2
 * of the 2026-08-07 conversation, which is the purchase-order call ("a working
 * document, not a frozen record") applied here. What is NOT editable:
 *
 *   * the item's NAME and taxonomy, which are the line's own SNAPSHOT — change
 *     them on the item, and a rename must not rewrite a printed document (038);
 *   * `planned_par`, which is what the plans said and exists precisely so the
 *     row can explain its own number;
 *   * the cost snapshot, which the Recost command writes from the live graph.
 *
 * Editing `par` also writes `par_source = 'manual'`, in ONE update. Two writes
 * would let the pair half-succeed, and a par that disagrees with the plan while
 * still claiming to have come from it is the one outcome worth preventing.
 */
export function ScheduleLines({
  rows,
  rolled,
  editable,
  add,
}: {
  rows: ScheduleLineRow[];
  rolled: RollType[];
  editable: boolean;
  add: React.ReactNode;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [grouping, setGrouping] = useState<Grouping>("type");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const batchByType = useMemo(
    () => new Map(rolled.map((t) => [t.itemType, t.batches])),
    [rolled]
  );

  const sorted = useMemo(() => {
    const byName = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    const key = (r: ScheduleLineRow) =>
      grouping === "type"
        ? `${r.item_type ?? ""}|${r.size ?? ""}|${r.subtype ?? ""}`
        : grouping === "tray"
          ? r.tray_number ?? "￿"
          : "";
    return [...rows].sort(
      (a, b) => byName(key(a), key(b)) || byName(a.item_name, b.item_name)
    );
  }, [rows, grouping]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allChecked = sorted.length > 0 && sorted.every((r) => checked.has(r.id));

  async function removeChecked() {
    const victims = sorted.filter((r) => checked.has(r.id));
    const counted = victims.filter((r) => r.made !== null || r.leftover !== null);
    const names = victims.slice(0, 6).map((r) => r.item_name).join(", ");
    const message =
      `Take ${victims.length} ${victims.length === 1 ? "item" : "items"} off this schedule?\n\n` +
      `${names}${victims.length > 6 ? `, and ${victims.length - 6} more` : ""}` +
      (counted.length
        ? `\n\n${counted.length} of them ${counted.length === 1 ? "has" : "have"} a counted quantity, which will be discarded.`
        : "") +
      `\n\nRegenerating this day would bring back anything the plans still carry.`;
    if (!window.confirm(message)) return;

    setBusy(true);
    setError(null);
    // `.select()` its own result: a delete matching no policy removes zero rows
    // and PostgREST returns NO error, so a bare delete reports a cheerful
    // success (the employee-delete lesson).
    const { data, error: err } = await supabase
      .from("production_schedule_items")
      .delete()
      .in("id", [...checked])
      .select("id");
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    if ((data ?? []).length === 0) {
      setError("Nothing was removed — you may not have permission to change this schedule.");
      return;
    }
    setChecked(new Set());
    router.refresh();
  }

  const columns: DataColumn<ScheduleLineRow>[] = [
    ...(editable
      ? [
          {
            key: "select",
            label: "",
            width: 50,
            pinned: true,
            header: (
              <Checkbox
                checked={allChecked}
                onChange={() =>
                  setChecked(allChecked ? new Set() : new Set(sorted.map((r) => r.id)))
                }
                label="Select every item"
                size={18}
              />
            ),
            render: (r: ScheduleLineRow) => (
              <Checkbox
                checked={checked.has(r.id)}
                onChange={() => toggle(r.id)}
                label={`Select ${r.item_name}`}
                size={18}
              />
            ),
          } as DataColumn<ScheduleLineRow>,
        ]
      : []),
    {
      key: "item",
      label: "Item",
      width: 260,
      pinned: true,
      wrap: true,
      sortValue: (r) => r.item_name,
      // Read-only, deliberately: this is the line's snapshot, not a join.
      render: (r) => (
        <span className="block">
          <span className="font-medium">{r.item_name}</span>
          <span className="block text-[12px] text-muted">
            {[r.subtype, r.finish].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
      ),
    },
    {
      key: "type",
      label: "Type",
      width: 110,
      sortValue: (r) => r.item_type ?? "",
      render: (r) => <span className="text-muted">{r.item_type ?? "—"}</span>,
    },
    {
      key: "size",
      label: "Size",
      width: 90,
      sortValue: (r) => r.size ?? "",
      hideWhenCompact: true,
      render: (r) => <span className="text-muted">{r.size ?? "—"}</span>,
    },
    {
      key: "tray",
      label: "Tray",
      width: 80,
      sortValue: (r) => r.tray_number ?? "",
      hideWhenCompact: true,
      render: (r) =>
        r.tray_number ? (
          <span className="text-muted">{r.tray_number}</span>
        ) : (
          // An addition has no tray — the override key can't reference a slot
          // without making additions inexpressible.
          <span className="text-faint" title="Added rather than planned onto a tray">
            —
          </span>
        ),
    },
    {
      key: "par",
      label: "To make",
      width: 120,
      align: "right",
      sortValue: (r) => r.par,
      render: (r) =>
        editable ? (
          <InlineValue
            table="production_schedule_items"
            id={r.id}
            column="par"
            kind="number"
            align="right"
            nullable={false}
            value={r.par}
            // ONE update, so the pair can't half-succeed: a par that disagrees
            // with the plan while still claiming to have come from it is the
            // outcome worth preventing.
            alsoUpdate={() => ({ par_source: "manual" })}
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>{r.par}</span>
        ),
    },
    {
      key: "planned",
      label: "Planned",
      width: 110,
      align: "right",
      sortValue: (r) => r.planned_par ?? -1,
      // The row explains its own number. Yellow where it differs — worth an
      // eye, not wrong; a hand-changed par is a decision somebody made.
      render: (r) => {
        if (r.par_source === "plan") return <span className="text-faint">—</span>;
        return (
          <span className="tabular-nums text-mark" title={sourceTitle(r)}>
            {r.planned_par === null ? "not planned" : r.planned_par}
          </span>
        );
      },
    },
    {
      key: "boxes",
      label: "Boxes",
      width: 90,
      align: "right",
      sortValue: (r) => tallyBoxes(r.par, r.tally_box_size).filled,
      hideWhenCompact: true,
      // What the printed strip will shade, so the screen and the paper agree
      // before anybody presses print.
      render: (r) => {
        const { filled } = tallyBoxes(r.par, r.tally_box_size);
        return (
          <span className="tabular-nums text-muted" title={`${r.tally_box_size} to a box`}>
            {filled} × {r.tally_box_size}
          </span>
        );
      },
    },
    {
      key: "made",
      label: "Made",
      width: 90,
      align: "right",
      sortValue: (r) => r.made ?? -1,
      // Phase 5 owns these. Read-only until the batch screen exists, because a
      // supervisor writing them needs column-scoped access this table's RLS
      // deliberately doesn't give (029's `report_pooled_tips` shape).
      render: (r) =>
        r.made === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>{r.made}</span>
        ),
    },
    {
      key: "leftover",
      label: "Left over",
      width: 100,
      align: "right",
      sortValue: (r) => r.leftover ?? -1,
      hideWhenCompact: true,
      render: (r) =>
        r.leftover === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>{r.leftover}</span>
        ),
    },
    {
      key: "note",
      label: "Note",
      width: 200,
      wrap: true,
      sortValue: (r) => r.note ?? "",
      render: (r) =>
        editable ? (
          <InlineValue
            table="production_schedule_items"
            id={r.id}
            column="note"
            value={r.note}
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} text-muted`}>{r.note ?? "—"}</span>
        ),
    },
  ];

  const group: DataGroup<ScheduleLineRow> | undefined =
    grouping === "none"
      ? undefined
      : {
          label:
            grouping === "type"
              ? (r) => [r.item_type || "(no type)", r.size].filter(Boolean).join(" · ")
              : (r) => (r.tray_number ? `Tray ${r.tray_number}` : "Not on a tray"),
          summary: (run) => {
            const total = run.reduce((n, r) => n + r.par, 0);
            const batches =
              grouping === "type" ? batchByType.get(run[0]?.item_type ?? "") : undefined;
            return {
              par: <span className="tabular-nums">{total.toLocaleString()}</span>,
              ...(batches && formatBatches(batches)
                ? { boxes: <span className="text-[11px]">{formatBatches(batches)} batches</span> }
                : {}),
            };
          },
        };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SectionHeading count={rows.length}>Items</SectionHeading>
        {add}
      </div>

      {error ? <p className="text-sm text-accent">{error}</p> : null}

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="production-schedule-lines"
        compactBelow={1200}
        columnChooser
        group={group}
        empty={
          <p className="text-sm text-muted">
            Nothing on this schedule. Add an item, or regenerate the day if the
            plans have changed.
          </p>
        }
        leading={
          <div className="space-y-1.5">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Group by
            </span>
            <TabPicker
              ariaLabel="Group the items"
              value={grouping}
              onChange={setGrouping}
              options={[
                { key: "type" as Grouping, label: "Type" },
                { key: "tray" as Grouping, label: "Tray" },
                { key: "none" as Grouping, label: "None" },
              ]}
            />
          </div>
        }
      />

      {editable && checked.size > 0 ? (
        <div className="flex flex-wrap items-center gap-4 border border-ink bg-white px-4 py-3 text-sm">
          <span className="font-medium">
            {checked.size} {checked.size === 1 ? "item" : "items"} selected
          </span>
          <button
            type="button"
            onClick={removeChecked}
            disabled={busy}
            className={DANGER_BUTTON_CLASS}
          >
            {busy ? "Removing…" : "Remove from this schedule"}
          </button>
          <button
            type="button"
            onClick={() => setChecked(new Set())}
            className="ml-auto text-muted underline underline-offset-[3px] hover:text-ink"
          >
            Clear
          </button>
        </div>
      ) : null}
    </section>
  );
}

function sourceTitle(r: ScheduleLineRow): string {
  switch (r.par_source) {
    case "override":
      return "A par override was written for this day";
    case "manual":
      return "Changed by hand on this schedule";
    case "special_order":
      return "From a special order";
    default:
      return "From the plans";
  }
}
