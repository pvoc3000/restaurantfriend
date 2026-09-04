"use client";

import { useMemo, useState, useTransition } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue } from "@/components/catalog/InlineValue";
import { TextInput } from "@/components/ui/TextInput";
import { AddShopSection } from "./AddShopSection";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

const SECTION_WIDTHS_KEY = "rf.shopSections.columnWidths.v1";

export type ShopSectionRow = {
  id: string;
  area: string;
  sub_area: string | null;
  display_name: string;
  sort_order: number;
  /** Item-locations pointing at this section, at this location. */
  item_count: number;
};

/**
 * The walk order, editable at last.
 *
 * A shop section is a shelf: "31 Storage - R1 S1" is rack 1 shelf 1 of the
 * storage room. `sort_order` is the order you walk them in and `display_name`
 * is what the order guide groups by and the in-person shopping list prints —
 * so these 168 rows have been shaping every Monday's ordering while living
 * only in the loader.
 *
 * Location-scoped like every other screen: these are THIS shop's shelves.
 */
export function ShopSectionsTable({
  rows,
  orgId,
  locationId,
  locationCode,
  editable,
}: {
  rows: ShopSectionRow[];
  orgId: string;
  locationId: string;
  locationCode: string;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  // The areas already in use here — a known vocabulary that legitimately grows
  // (a new walk-in), which is exactly what `allowNew` is for. It's also how
  // "BOH Uknown" got in, and a list offers the spelling before you type it.
  const areas = useMemo(
    () => [...new Set(rows.map((r) => r.area).filter(Boolean))].sort(),
    [rows]
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.display_name} ${r.area} ${r.sub_area ?? ""}`.toLowerCase().includes(q)
    );
  }, [rows, search]);

  async function remove(row: ShopSectionRow) {
    const warning =
      row.item_count > 0
        ? `Delete "${row.display_name}"?\n\n${row.item_count} item${
            row.item_count === 1 ? "" : "s"
          } here will move to "No section" on the order guide. Nothing is deleted with it.`
        : `Delete "${row.display_name}"?`;
    if (!(await confirmDialog({ ...splitConfirmMessage(warning), confirmLabel: "Delete", tone: "danger" }))) return;

    setFailed(null);
    startTransition(async () => {
      const { error } = await supabase.from("shop_sections").delete().eq("id", row.id);
      if (error) {
        setFailed(error.message);
        return;
      }
      router.refresh();
    });
  }

  const columns: DataColumn<ShopSectionRow>[] = [
    {
      key: "sort_order",
      label: "Sort",
      width: 110,
      align: "right",
      sortValue: (r) => Number(r.sort_order),
      render: (r) =>
        editable ? (
          <InlineValue
            table="shop_sections"
            id={r.id}
            column="sort_order"
            value={r.sort_order}
            kind="number"
            align="right"
            nullable={false}
          />
        ) : (
          <span className="tabular-nums">{r.sort_order}</span>
        ),
    },
    {
      key: "area",
      label: "Area",
      width: 220,
      hideWhenCompact: true,
      sortValue: (r) => r.area,
      render: (r) =>
        editable ? (
          <InlineValue
            table="shop_sections"
            id={r.id}
            column="area"
            value={r.area}
            kind="pick"
            allowNew
            nullable={false}
            options={areas.map((a) => ({ value: a, label: a }))}
          />
        ) : (
          r.area
        ),
    },
    {
      key: "sub_area",
      label: "Sub area",
      width: 200,
      hideWhenCompact: true,
      sortValue: (r) => r.sub_area,
      render: (r) =>
        editable ? (
          <InlineValue
            table="shop_sections"
            id={r.id}
            column="sub_area"
            value={r.sub_area}
            placeholder="none"
          />
        ) : (
          (r.sub_area ?? "—")
        ),
    },
    {
      key: "display_name",
      label: "Display name",
      width: 340,
      pinned: true,
      sortValue: (r) => r.display_name,
      render: (r) =>
        editable ? (
          <InlineValue
            table="shop_sections"
            id={r.id}
            column="display_name"
            value={r.display_name}
            nullable={false}
          />
        ) : (
          r.display_name
        ),
    },
    {
      key: "item_count",
      label: "Items",
      width: 100,
      align: "right",
      sortValue: (r) => r.item_count,
      render: (r) => (
        <span className={`tabular-nums ${r.item_count === 0 ? "text-faint" : ""}`}>
          {r.item_count}
        </span>
      ),
    },
    ...(editable
      ? [
          {
            key: "delete",
            label: "",
            width: 90,
            render: (r: ShopSectionRow) => (
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(r)}
                className="text-xs text-subtle underline decoration-neutral-400 underline-offset-[3px] hover:text-accent hover:decoration-current disabled:opacity-35"
              >
                Delete
              </button>
            ),
          } satisfies DataColumn<ShopSectionRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* The count moved into the heading, which is where every list states it
          now — it used to sit beside the search box. */}
      <PageHeading
        title="Shop sections"
        code={locationCode}
        visible={shown.length}
        total={rows.length}
        noun="shop sections"
      />

      {/* THE COMMAND SITS IN THE FILTER ROW, right-aligned (Mark, 2026-09-03:
          the action buttons "are all over the place… I think they should be in
          line with the search field and filter tabpickers"). One place across
          the app, so nothing has to be hunted for. */}
      <div className="flex flex-wrap items-end gap-4">
        <TextInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search sections"
          aria-label="Search shop sections"
          clearLabel="Clear the search"
          className="w-72"
        />
        {editable ? (
          <div className="ml-auto">
            <AddShopSection orgId={orgId} locationId={locationId} areas={areas} />
          </div>
        ) : null}
      </div>

      {failed && <p className="text-sm text-accent">Could not delete: {failed}</p>}

      <DataTable
        rows={shown}
        columns={columns}
        rowKey={(r) => r.id}
        // Below xl this sheds Area and Sub area — 1060px down to 640, which
        // fits a portrait iPad. They're the two halves of Display name
        // ("31 Storage - R1 S1"), so the identity survives without them.
        // My choice, not Mark's — the other three lists' sets are his.
        compactBelow={1280}
        storageKey={SECTION_WIDTHS_KEY}
        columnChooser
        defaultSort={{ key: "sort_order" }}
        empty={
          <p className="text-sm text-muted">
            No shop sections at {locationCode} yet. Items without one land in
            &ldquo;No section&rdquo; on the order guide.
          </p>
        }
      />
    </div>
  );
}
