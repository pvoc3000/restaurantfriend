"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { WeekdayPicker } from "@/components/catalog/WeekdayPicker";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { RowMenu } from "@/components/ui/RowMenu";
import { Switch } from "@/components/ui/Switch";
import { Dialog, DIALOG_CANCEL_CLASS } from "@/components/ui/Dialog";
import { confirmDialog } from "@/lib/confirm";
import { weekdaySetLabel, type ResponseType } from "@/lib/checklists";

const WIDTHS_KEY = "rf.checklistTemplateItems.columnWidths.v2";

export type TemplateItemRow = {
  id: string;
  shop_section_id: string | null;
  section_name: string;
  sort: number;
  prompt: string;
  response_type: ResponseType;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  choices: string[] | null;
  equipment_id: string | null;
  requires_photo: boolean;
  weekdays: number[] | null;
  is_active: boolean;
  /** 078: how you know it is done, and whose job it is. Both optional. */
  guidance: string | null;
  position: string | null;
};

const ASKS: { value: ResponseType; label: string; hint: string }[] = [
  { value: "check", label: "Tick", hint: "looked at, or not" },
  { value: "number", label: "Number", hint: "a temperature, a count" },
  { value: "text", label: "Text", hint: "something written down" },
  { value: "choice", label: "Choice", hint: "one of a short list" },
];

/**
 * What this template asks, in walk order.
 *
 * Grouped by SHOP SECTION and sorted by the section's own walk order then the
 * item's `sort` — the same route through the building the order guide takes, so
 * a supervisor learns one path.
 *
 * The heading and the Add command share the table's `leading` strip, which is
 * this app's convention for a heading over a `DataTable` and the reason that
 * strip stopped being an empty 32px band.
 */
export function TemplateItemsTable({
  rows,
  editable,
  sections,
  equipment,
  positions,
}: {
  rows: TemplateItemRow[];
  editable: boolean;
  sections: { id: string; display_name: string }[];
  equipment: { id: string; name: string }[];
  positions: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [daysFor, setDaysFor] = useState<TemplateItemRow | null>(null);
  const [, startTransition] = useTransition();

  // Walk order: the section's position first, then the item's own sort. Both
  // are needed — `sort` is per item and says nothing about which shelf comes
  // first, and a grouping can only band what the ORDER already groups.
  const sectionOrder = useMemo(
    () => new Map(sections.map((s, i) => [s.id, i])),
    [sections],
  );
  const ordered = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const sa = a.shop_section_id ? (sectionOrder.get(a.shop_section_id) ?? 9e9) : 9e9;
        const sb = b.shop_section_id ? (sectionOrder.get(b.shop_section_id) ?? 9e9) : 9e9;
        if (sa !== sb) return sa - sb;
        if (a.sort !== b.sort) return a.sort - b.sort;
        return a.prompt < b.prompt ? -1 : 1;
      }),
    [rows, sectionOrder],
  );

  // "No section" is a real option with an EMPTY value, not the absence of one —
  // without it there is no way to take an item off a shelf.
  const sectionOptions = [
    { value: "", label: "No section" },
    ...sections.map((s) => ({ value: s.id, label: s.display_name })),
  ];
  const equipmentOptions = [
    { value: "", label: "Nothing in particular" },
    ...equipment.map((e) => ({ value: e.id, label: e.name })),
  ];

  async function remove(row: TemplateItemRow) {
    const ok = await confirmDialog({
      title: "Remove this item?",
      body:
        `“${row.prompt}” comes off this list. Walks already recorded keep their ` +
        "own copy of the question, so nothing that has been walked changes.",
      tone: "danger",
      confirmLabel: "Remove it",
    });
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("checklist_template_items")
        .delete()
        .eq("id", row.id)
        .select("id");
      if (error) return setFailed(error.message);
      if (!data || data.length === 0) {
        return setFailed("Nothing was removed — you may not have permission.");
      }
      router.refresh();
    });
  }

  async function setPhoto(row: TemplateItemRow, next: boolean) {
    setFailed(null);
    const { data, error } = await supabase
      .from("checklist_template_items")
      .update({ requires_photo: next })
      .eq("id", row.id)
      .select("id");
    if (error || !data || data.length === 0) {
      setFailed(error?.message ?? "That change was not saved.");
      return;
    }
    router.refresh();
  }

  const columns: DataColumn<TemplateItemRow>[] = [
    {
      key: "is_active",
      label: "Active",
      width: 80,
      render: (r) =>
        editable ? (
          <ActiveToggle table="checklist_template_items" id={r.id} active={r.is_active} />
        ) : (
          <span className="text-muted">{r.is_active ? "Active" : "Inactive"}</span>
        ),
      sortValue: (r) => (r.is_active ? 0 : 1),
    },
    {
      key: "sort",
      label: "Sort",
      width: 70,
      align: "right",
      sortValue: (r) => r.sort,
      render: (r) =>
        editable ? (
          <InlineValue
            table="checklist_template_items"
            id={r.id}
            column="sort"
            value={r.sort}
            kind="number"
            align="right"
            nullable={false}
            ariaLabel={`Sort for ${r.prompt}`}
          />
        ) : (
          <span className="tabular-nums">{r.sort}</span>
        ),
    },
    {
      key: "prompt",
      label: "What it asks",
      width: 320,
      pinned: true,
      sortValue: (r) => r.prompt,
      render: (r) =>
        editable ? (
          <InlineValue
            table="checklist_template_items"
            id={r.id}
            column="prompt"
            value={r.prompt}
            nullable={false}
            ariaLabel="What it asks"
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.prompt}</span>
        ),
    },
    {
      key: "section",
      label: "Section",
      width: 200,
      sortValue: (r) => r.section_name,
      render: (r) =>
        editable ? (
          <InlineValue
            table="checklist_template_items"
            id={r.id}
            column="shop_section_id"
            value={r.shop_section_id ?? ""}
            kind="pick"
            options={sectionOptions}
            ariaLabel={`Section for ${r.prompt}`}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.section_name}</span>
        ),
    },
    {
      key: "response_type",
      label: "Answer",
      width: 110,
      sortValue: (r) => r.response_type,
      render: (r) =>
        editable ? (
          <InlineValue
            table="checklist_template_items"
            id={r.id}
            column="response_type"
            value={r.response_type}
            kind="pick"
            nullable={false}
            options={ASKS}
            ariaLabel={`Answer type for ${r.prompt}`}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>
            {ASKS.find((a) => a.value === r.response_type)?.label ?? r.response_type}
          </span>
        ),
    },
    {
      key: "expected",
      label: "Expected",
      width: 200,
      hideWhenCompact: true,
      // The range is only meaningful for a number, and the whole point of it is
      // that an out-of-range reading raises the issue by itself. On any other
      // kind of item the cell says nothing rather than offering three boxes
      // that would never be read.
      render: (r) => {
        if (r.response_type !== "number") return <span className="text-faint">—</span>;
        if (!editable) {
          const lo = r.min_value ?? "";
          const hi = r.max_value ?? "";
          const range = lo === "" && hi === "" ? "any" : `${lo}–${hi}`;
          return (
            <span className={READ_ONLY_VALUE}>
              {range}
              {r.unit ? ` ${r.unit}` : ""}
            </span>
          );
        }
        return (
          <div className="flex items-center gap-1">
            <InlineValue
              table="checklist_template_items"
              id={r.id}
              column="min_value"
              value={r.min_value}
              kind="number"
              align="right"
              className="w-14"
              ariaLabel={`Lowest acceptable value for ${r.prompt}`}
            />
            <span className="text-faint">–</span>
            <InlineValue
              table="checklist_template_items"
              id={r.id}
              column="max_value"
              value={r.max_value}
              kind="number"
              align="right"
              className="w-14"
              ariaLabel={`Highest acceptable value for ${r.prompt}`}
            />
            <InlineValue
              table="checklist_template_items"
              id={r.id}
              column="unit"
              value={r.unit}
              className="w-12"
              ariaLabel={`Unit for ${r.prompt}`}
            />
          </div>
        );
      },
    },
    {
      key: "position",
      label: "Who",
      width: 150,
      sortValue: (r) => r.position ?? "",
      // The ROSTER vocabulary — Baker, Fryer, Supervisor — not org_members.role.
      // `allowNew` because the next position must not need a migration, and a
      // list offers the spelling before somebody types a second one.
      render: (r) =>
        editable ? (
          <InlineValue
            table="checklist_template_items"
            id={r.id}
            column="position"
            value={r.position}
            kind="pick"
            allowNew
            ariaLabel={`Who does ${r.prompt}`}
            options={positions.map((p) => ({ value: p, label: p }))}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.position ?? ""}</span>
        ),
    },
    {
      key: "guidance",
      label: "How you know",
      width: 280,
      sortValue: (r) => r.guidance ?? "",
      render: (r) =>
        editable ? (
          <InlineValue
            table="checklist_template_items"
            id={r.id}
            column="guidance"
            value={r.guidance}
            multiline
            ariaLabel={`How you know ${r.prompt} is done`}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.guidance ?? ""}</span>
        ),
    },
    {
      key: "equipment_id",
      label: "About",
      width: 180,
      hideWhenCompact: true,
      sortValue: (r) => equipment.find((e) => e.id === r.equipment_id)?.name ?? "",
      render: (r) =>
        editable ? (
          <InlineValue
            table="checklist_template_items"
            id={r.id}
            column="equipment_id"
            value={r.equipment_id ?? ""}
            kind="pick"
            options={equipmentOptions}
            ariaLabel={`Equipment for ${r.prompt}`}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>
            {equipment.find((e) => e.id === r.equipment_id)?.name ?? ""}
          </span>
        ),
    },
    {
      key: "requires_photo",
      label: "Photo",
      width: 90,
      hideWhenCompact: true,
      sortValue: (r) => (r.requires_photo ? 0 : 1),
      render: (r) =>
        editable ? (
          <Switch
            size="sm"
            on={r.requires_photo}
            ariaLabel={`Require a photo for ${r.prompt}`}
            onToggle={() => void setPhoto(r, !r.requires_photo)}
          />
        ) : (
          <span className="text-muted">{r.requires_photo ? "Required" : ""}</span>
        ),
    },
    {
      key: "weekdays",
      label: "Days",
      width: 150,
      hideWhenCompact: true,
      sortValue: (r) => weekdaySetLabel(r.weekdays),
      // A LABEL here rather than a `WeekdayPicker`, which needs 300px and would
      // be clipped in a column this table cannot afford to give it. Almost every
      // item is "every run", so the rare edit goes in the row menu where it has
      // room — a control that is clipped is worse than one that is a click away.
      render: (r) => (
        <span className={r.weekdays ? "" : "text-muted"}>
          {r.weekdays ? weekdaySetLabel(r.weekdays) : "Every run"}
        </span>
      ),
    },
    {
      key: "menu",
      label: "",
      width: 50,
      render: (r) =>
        editable ? (
          <RowMenu
            label={`Commands for ${r.prompt}`}
            items={[
              { label: "Days…", onSelect: () => setDaysFor(r) },
              { label: "Remove", onSelect: () => void remove(r), danger: true },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <div className="space-y-2">
      {failed && <p className="text-sm text-accent">{failed}</p>}

      <DataTable
        rows={ordered}
        columns={columns}
        rowKey={(r) => r.id}
        compactBelow={1440}
        storageKey={WIDTHS_KEY}
        columnChooser
        // Rendered in walk order and never re-sorted by the table: the ORDER IS
        // THE DOCUMENT here, so `group` bands what `ordered` already grouped.
        group={{ label: (r) => r.section_name }}
        // Add item moved up to the record's command row (Mark, 2026-08-30), so
        // this strip is a heading again — which is what `leading` is for.
        leading={<SectionHeading count={rows.length}>Items</SectionHeading>}
        empty={
          <p className="max-w-[72ch] text-sm text-muted">
            Nothing on this list yet. Items are grouped by shop section, so a
            walk follows the same route through the building as the order guide.
          </p>
        }
      />

      {daysFor && (
        <Dialog
          title={`Which days — ${daysFor.prompt}`}
          onClose={() => setDaysFor(null)}
          width="max-w-lg"
          footer={
            <div className="flex justify-end">
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                onClick={() => setDaysFor(null)}
              >
                Done
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <WeekdayPicker
              table="checklist_template_items"
              id={daysFor.id}
              column="weekdays"
              value={daysFor.weekdays ?? []}
              label="Days this item is asked for"
            />
            <p className="max-w-[52ch] text-[13px] text-muted">
              Leave every day off and the item is asked for on <strong>every
              run</strong> of this list — which is what almost all of them want.
              Set days only for something that happens weekly or monthly, like a
              deep clean.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
