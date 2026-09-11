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
import { RowMenu } from "@/components/ui/RowMenu";
import { planDeviation, type ScheduleLine } from "@/lib/productionSchedule";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

export type ScheduleLineRow = ScheduleLine & {
  planned_par: number | null;
  par_source: string;
  tray_band: string | null;
  note: string | null;
  unit_cost: number | null;
  unit_price: number | null;
  cost_unresolved: number | null;
  costed_at: string | null;
  /** From `v_production_schedule_lines`, never computed here — see the Sold
   *  column. Null until something has been counted. */
  sold: number | null;
  /** When somebody last counted this line. 044 stores the author beside it;
   *  the date is the half worth showing without a second query for names. */
  counted_at: string | null;
};

/**
 * `made` or `leftover`, written through migration 044's definer function.
 *
 * NOT `.from("production_schedule_items").update(…)`, and the difference is
 * invisible until it bites: RLS filters ROWS, and "a supervisor may set these
 * two and nothing else" is a COLUMN rule, so the table's own UPDATE policy
 * names purchaser+ only. A direct write by a supervisor matches zero rows and
 * PostgREST returns NO error — the cell would report success and the number
 * would vanish on the next refresh. The function RAISES instead, so a refusal
 * arrives as a sentence in the cell.
 *
 * `countable` is deliberately a different gate from the screen's `editable`:
 * everything else on this table is purchaser+, and these two cells are the only
 * ones a supervisor may touch.
 */
function ActualCell({
  row,
  column,
  countable,
}: {
  row: ScheduleLineRow;
  column: "made" | "leftover";
  countable: boolean;
}) {
  const supabase = createClient();
  const value = row[column];
  const counted = row.counted_at
    ? `Counted ${row.counted_at.slice(0, 10)}`
    : undefined;

  if (!countable) {
    return value === null ? (
      <span className="text-faint">—</span>
    ) : (
      <span className={`${READ_ONLY_VALUE} tabular-nums`} title={counted}>
        {value}
      </span>
    );
  }

  return (
    <InlineValue
      table="production_schedule_items"
      id={row.id}
      column={column}
      kind="number"
      align="right"
      value={value}
      ariaLabel={`${column === "made" ? "Made" : "Left over"}, ${row.item_name}`}
      onWrite={async (next) => {
        const { error } = await supabase.rpc("set_schedule_actual", {
          p_line_id: row.id,
          p_column: column,
          p_value: next,
        });
        return { error: error ? error.message : null };
      }}
    />
  );
}

export type TaxonomyVocabulary = {
  item_type: string[];
  size: string[];
  subtype: string[];
  finish: string[];
};

/**
 * One of the four snapshot descriptors — Type, Size, Cut, Finish.
 *
 * EDITABLE since 2026-09-07 (Mark: "allow editing of the type, size, cut and
 * finish on a generated production schedule. use picklists to replace the
 * value"), where the note above this table had them read-only as "the line's
 * own SNAPSHOT ... a rename must not rewrite a printed document".
 *
 * Both halves of that are still true and neither argues against this: it is
 * BECAUSE these are the line's own copy that editing one is safe. Nothing here
 * touches `production_items`, so tonight's sheet can say `Letter - "H"` without
 * the catalog learning anything, which is the purchase order's "a working
 * document, not a frozen record" reaching the last four cells that had not had
 * it. What must not be edited is the item's NAME, which is the line's identity
 * and stays read-only.
 *
 * A PICKLIST rather than a text box, per the ask and per the app's own rule
 * that a known vocabulary is chosen and never typed — the four columns are a
 * closed set in practice, and free text would spell "Mini" three ways by
 * Thursday. `allowNew` because the set is only closed in practice.
 */
function TaxonomyCell({
  row,
  column,
  label,
  options,
  editable,
}: {
  row: ScheduleLineRow;
  column: "item_type" | "size" | "subtype" | "finish";
  label: string;
  options: string[];
  editable: boolean;
}) {
  const value = row[column] ?? null;
  if (!editable) {
    return <span className="text-muted">{value ?? "—"}</span>;
  }
  return (
    <InlineValue
      table="production_schedule_items"
      id={row.id}
      column={column}
      kind="pick"
      value={value}
      options={options.map((o) => ({ value: o, label: o }))}
      allowNew
      clearable
      ariaLabel={`${label}, ${row.item_name}`}
    />
  );
}

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
 *   * the cost snapshot, which the Recost command writes from the live graph.
 *
 * Editing `par` also writes `par_source = 'manual'`, in ONE update. Two writes
 * would let the pair half-succeed, and a par that disagrees with the plan while
 * still claiming to have come from it is the one outcome worth preventing.
 */
export function ScheduleLines({
  rows,
  orgId,
  scheduleId,
  editable,
  countable,
  vocabulary,
}: {
  rows: ScheduleLineRow[];
  /** For the one write here that INSERTS — see `duplicateLine`. */
  orgId: string;
  scheduleId: string;
  /** Purchaser+ — the par, the note, adding and striking lines. */
  editable: boolean;
  /** Supervisor and up — the two counting cells, and only those. */
  countable: boolean;
  /**
   * What the catalog already calls these things, per column — the options for
   * the four taxonomy cells. `allowNew` on top, because a night can want a cut
   * nothing has been made in yet, and because 069's letters ARE cuts: a
   * special-order line carries `Letter - "H"`, which no `production_items` row
   * has ever held.
   */
  vocabulary: TaxonomyVocabulary;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [grouping, setGrouping] = useState<Grouping>("type");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const sorted = useMemo(() => {
    const byName = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    const key = (r: ScheduleLineRow) =>
      grouping === "type"
        ? `${r.item_type ?? ""}|${r.size ?? ""}|${r.subtype ?? ""}|${r.finish ?? ""}`
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

  /**
   * ONE IMPLEMENTATION BEHIND BOTH DOORS — the selection bar and a row's own ⋯
   * menu — taking the ids as a parameter, which is the PO list's lesson: the
   * confirm and the row-count check are exactly the things remembered in one
   * copy and forgotten in the other.
   */
  async function removeLines(ids: string[]) {
    const victims = sorted.filter((r) => ids.includes(r.id));
    const counted = victims.filter((r) => r.made !== null || r.leftover !== null);
    const names = victims.slice(0, 6).map((r) => r.item_name).join(", ");
    // NAME the one line when there is one: from a row menu "1 item" is a worse
    // answer to "which one?" than the name on the row you just pressed.
    const message =
      (victims.length === 1
        ? `Take ${victims[0].item_name} off this schedule?\n\n`
        : `Take ${victims.length} items off this schedule?\n\n${names}${
            victims.length > 6 ? `, and ${victims.length - 6} more` : ""
          }`) +
      (counted.length
        ? `\n\n${counted.length} of them ${counted.length === 1 ? "has" : "have"} a counted quantity, which will be discarded.`
        : "") +
      `\n\nRegenerating this day would bring back anything the plans still carry.`;
    if (!(await confirmDialog({ ...splitConfirmMessage(message), confirmLabel: "Take off schedule", tone: "danger" }))) return;

    setBusy(true);
    setError(null);
    // `.select()` its own result: a delete matching no policy removes zero rows
    // and PostgREST returns NO error, so a bare delete reports a cheerful
    // success (the employee-delete lesson).
    const { data, error: err } = await supabase
      .from("production_schedule_items")
      .delete()
      .in("id", ids)
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

  /**
   * Copy a line — same item, same par, same descriptors and note, ready to be
   * edited into the thing you actually wanted.
   *
   * THE COPY IS `manual` UNLESS IT CAME FROM AN ORDER, and that is migration
   * 096's index rather than a preference: the key is now
   * `unique (schedule_id, item_id) where par_source in ('plan', 'override')`,
   * so the rows the GENERATOR owns are still one per item — which is the
   * doubling 040 was written against — and anything else may repeat. A copy
   * that kept `plan` would be refused by the very index it is trying to stay
   * inside; `manual` is also the truthful answer, since a person made this row.
   * A copy of an ORDER's line stays `special_order`, which is equally true and
   * equally outside the key.
   *
   * What that means at regeneration, and it is the point rather than a cost:
   * the plan's own line is restored to the plan's number and the copy is left
   * alone (the delete-stale pass skips `manual` by name), so the item is made
   * once for each line. Proved on the harness — `manual_kept: 2` with the plan
   * line back at its own par.
   *
   * No `planned_par`: the plan never carried this row, which `planDeviation`
   * then reads as ADDED rather than as a par that disagrees.
   */
  async function duplicateLine(row: ScheduleLineRow) {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("production_schedule_items")
      .insert({
        // EXPLICITLY — design rule 1. Nothing defaults it, and an omitted one
        // fails the insert policy's WITH CHECK and is reported as an RLS
        // refusal rather than as the missing column it is.
        org_id: orgId,
        schedule_id: scheduleId,
        item_id: row.item_id,
        item_name: row.item_name,
        item_type: row.item_type,
        size: row.size,
        subtype: row.subtype,
        finish: row.finish,
        tray_number: row.tray_number,
        tally_box_size: row.tally_box_size,
        tray_capacity: row.tray_capacity,
        par: row.par,
        par_source: row.par_source === "special_order" ? "special_order" : "manual",
        note: row.note,
      })
      .select("id");
    setBusy(false);
    if (err) {
      setError(
        /production_schedule_items_generated_line/.test(err.message)
          ? "This schedule already has a generated line for that item."
          : err.message
      );
      return;
    }
    if ((data ?? []).length === 0) {
      setError("Nothing was added — you may not have permission to change this schedule.");
      return;
    }
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
              />
            ),
            render: (r: ScheduleLineRow) => (
              <Checkbox
                checked={checked.has(r.id)}
                onChange={() => toggle(r.id)}
                label={`Select ${r.item_name}`}
              />
            ),
          } as DataColumn<ScheduleLineRow>,
        ]
      : []),
    {
      key: "type",
      label: "Type",
      width: 110,
      sortValue: (r) => r.item_type ?? "",
      render: (r) => (
        <TaxonomyCell
          row={r}
          column="item_type"
          label="Type"
          options={vocabulary.item_type}
          editable={editable}
        />
      ),
    },
    {
      key: "size",
      label: "Size",
      width: 90,
      sortValue: (r) => r.size ?? "",
      hideWhenCompact: true,
      render: (r) => (
        <TaxonomyCell
          row={r}
          column="size"
          label="Size"
          options={vocabulary.size}
          editable={editable}
        />
      ),
    },
    {
      key: "cut",
      label: "Cut",
      width: 150,
      sortValue: (r) => r.subtype ?? "",
      // THE COLUMN THE LETTERS LIVE IN, which is why it is wide and why it is
      // never dropped when the table goes compact. Migration 067 keys a
      // schedule line on (item, cut) precisely because one generic `Letter`
      // production item per flavour means the cut is the only thing telling
      // `Letter - "H"` from `Letter - "A"` — so a table without it shows twelve
      // identical-looking rows.
      render: (r) => (
        <TaxonomyCell
          row={r}
          column="subtype"
          label="Cut"
          options={vocabulary.subtype}
          editable={editable}
        />
      ),
    },
    {
      key: "finish",
      label: "Finish",
      width: 120,
      sortValue: (r) => r.finish ?? "",
      hideWhenCompact: true,
      render: (r) => (
        <TaxonomyCell
          row={r}
          column="finish"
          label="Finish"
          options={vocabulary.finish}
          editable={editable}
        />
      ),
    },
    {
      key: "item",
      label: "Name",
      width: 220,
      pinned: true,
      wrap: true,
      sortValue: (r) => r.item_name,
      // Read-only, deliberately: this is the line's snapshot, not a join.
      //
      // It carried `subtype · finish` on a second line until 2026-08-27. Both
      // are columns of their own now, so repeating them here would be the same
      // two facts twice on one row.
      render: (r) => <span className="font-medium">{r.item_name}</span>,
    },
    {
      key: "par",
      label: "Par",
      // 20px wider than it was, which is what the mark costs. It comes out of
      // Name (240 → 220), the one column with slack at this width: it WRAPS,
      // so what it loses is a wrap point rather than any of its text.
      width: 120,
      align: "right",
      sortValue: (r) => r.par,
      /**
       * THE PAR SAYS WHEN IT DISAGREES WITH THE PLAN, and what the plan said
       * (Mark, 2026-09-07). The record has carried "N lines differ from the
       * plan" since 040 and `planned_par` has been on every row since, rendered
       * nowhere — so the badge sent you down 64 rows comparing a number against
       * one you could not see.
       *
       * A FILL, not `text-mark`: yellow on white is 1.43:1. And a mark rather
       * than a colour on the number itself, because the figure is right — it is
       * what somebody decided — and what is worth an eye is that it was decided
       * rather than derived.
       *
       * `planDeviation` is the same function the badge counts with, so the two
       * cannot disagree about how many there are.
       */
      render: (r) => {
        const off = planDeviation(r);
        const mark = off ? (
          <span
            className="bg-mark-fill px-1 text-[11px]"
            title={
              off.kind === "changed"
                ? `The plan says ${off.planned}`
                : "Added by hand — the plan does not carry this line"
            }
          >
            {off.kind === "changed" ? `plan ${off.planned}` : "added"}
          </span>
        ) : null;
        return (
          <span className="flex items-center justify-end gap-1">
            {mark}
            {editable ? (
              <InlineValue
                table="production_schedule_items"
                id={r.id}
                column="par"
                kind="number"
                align="right"
                nullable={false}
                value={r.par}
                // ONE update, so the pair can't half-succeed: a par that
                // disagrees with the plan while still claiming to have come
                // from it is the outcome worth preventing.
                alsoUpdate={() => ({ par_source: "manual" })}
                className="w-auto"
              />
            ) : (
              <span className={`${READ_ONLY_VALUE} tabular-nums`}>{r.par}</span>
            )}
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
      render: (r) => <ActualCell row={r} column="made" countable={countable} />,
    },
    {
      key: "leftover",
      label: "Left over",
      width: 100,
      align: "right",
      sortValue: (r) => r.leftover ?? -1,
      hideWhenCompact: true,
      render: (r) => <ActualCell row={r} column="leftover" countable={countable} />,
    },
    {
      key: "sold",
      label: "Sold",
      width: 90,
      align: "right",
      sortValue: (r) => r.sold ?? -1,
      // DERIVED, and read-only for the reason it has no column: made − leftover
      // is computed by `v_production_schedule_lines` and nowhere else, so there
      // is one definition of it and one place for a POS feed to land later.
      //
      // It can go NEGATIVE, and it is shown that way rather than clamped:
      // yesterday's carryover counted into today's leftovers is a real thing
      // that happens, and a floor at zero would hide it.
      render: (r) =>
        r.sold === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span
            className={`${READ_ONLY_VALUE} tabular-nums ${r.sold < 0 ? "bg-mark-fill px-1" : ""}`}
            title={r.sold < 0 ? "More left over than made — carried over from another day?" : undefined}
          >
            {r.sold}
          </span>
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
    ...(editable
      ? ([
          {
            key: "actions",
            label: "",
            // 36px button + the cell's own px-3, the same arithmetic every ⋯
            // column uses. Unlabelled, so the Columns menu never offers it: it
            // is a control, not a field.
            width: 60,
            align: "right",
            render: (r: ScheduleLineRow) => (
              <span className="flex justify-end">
                <RowMenu
                  label={`Actions for ${r.item_name}`}
                  items={[
                    {
                      label: "Duplicate line",
                      /**
                       * ON EVERY LINE since migration 096 (Mark, 2026-09-07:
                       * "let's relax the index so plan lines can duplicate
                       * too"). It was special-order-only for one commit,
                       * because 069's key covered every line the generator did
                       * NOT write as well as the ones it did — which was never
                       * what 040 keyed the table for.
                       *
                       * The hint says what the copy will BE rather than what it
                       * copies: on a plan line it lands as a hand-added line,
                       * which is what survives a regeneration and what the Par
                       * column then marks as "added".
                       */
                      hint:
                        r.par_source === "special_order"
                          ? "Same item and par, ready to be edited"
                          : "A copy of this line, added by hand",
                      disabled: busy,
                      onSelect: () => void duplicateLine(r),
                    },
                    {
                      label: "Delete line",
                      hint:
                        r.made !== null || r.leftover !== null
                          ? "It carries a counted quantity"
                          : "Takes it off tonight's sheet",
                      danger: true,
                      disabled: busy,
                      onSelect: () => void removeLines([r.id]),
                    },
                  ]}
                />
              </span>
            ),
          },
        ] as DataColumn<ScheduleLineRow>[])
      : []),
  ];

  const group: DataGroup<ScheduleLineRow> | undefined =
    grouping === "none"
      ? undefined
      : {
          label:
            grouping === "type"
              ? (r) => [r.item_type || "(no type)", r.size].filter(Boolean).join(" · ")
              : (r) => (r.tray_number ? `Tray ${r.tray_number}` : "Not on a tray"),
          summary: (run) => ({
            par: (
              <span className="tabular-nums">
                {run.reduce((n, r) => n + r.par, 0).toLocaleString()}
              </span>
            ),
          }),
        };

  return (
    <section className="space-y-3">
      {/* Add item… moved up to the record's command row (Mark, 2026-08-27), so
          this is a heading and nothing else. */}
      <SectionHeading count={rows.length}>Items</SectionHeading>

      {error ? <p className="text-sm text-accent">{error}</p> : null}

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="production-schedule-lines.v2"
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
            onClick={() => void removeLines([...checked])}
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
