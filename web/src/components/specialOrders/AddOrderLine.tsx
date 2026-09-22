"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS, SMALL_BUTTON_CLASS } from "@/components/ui/buttons";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { PickList } from "@/components/ui/PickList";
import { ControlField } from "@/components/ui/ControlField";
import { STICKY_HEAD_ROW_IN_PANE } from "@/lib/tableHead";
import { money } from "@/lib/specialOrders";
import {
  LETTER_CHARACTERS,
  LETTER_HINT,
  addedLineName,
  letterCut,
  needsLetterChoice,
  parseLetters,
} from "@/lib/specialOrderLines";
import type { OrderLineRow } from "./OrderLines";

/**
 * A menu item, already PRICED.
 *
 * The price is resolved on the SERVER through `resolveItemPrice` — item
 * override → this shop's grid cell → the org grid (design rule 6's shape,
 * decision 10's grid). It cannot be done here: `price_override` lives on
 * `production_item_locations`, not on the item, so a client that selected the
 * item alone would find no price column and quietly offer every donut at zero.
 */
/** A column label: the app's small caps, with room above the first row. */
const HEAD = "pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted";

type FilterKey = "item_type" | "size" | "subtype";
const FILTERS: { key: FilterKey; label: string; all: string }[] = [
  { key: "item_type", label: "Type", all: "All types" },
  { key: "size", label: "Size", all: "All sizes" },
  { key: "subtype", label: "Cut", all: "All cuts" },
];
const FILTER_KEYS = FILTERS.map((f) => f.key);

export type MenuItem = {
  id: string;
  name: string;
  item_type: string | null;
  subtype: string | null;
  finish: string | null;
  size: string | null;
  price: number | null;
};

/**
 * THE DONUT CHOOSER — decision 5's "add a line from a production item".
 *
 * It STAYS OPEN after each add, because adding six things is the shape of the
 * task (`AddPoLines`' rule, and for the same reason). Each row shows what is
 * already on the order, so the arithmetic is visible.
 *
 * ADDING THE SAME ITEM AGAIN MAKES A SECOND LINE, which is the OPPOSITE of what
 * `AddPoLines` does — and deliberately. A purchase order line is a SKU and two
 * lines of the same SKU is a mistake; a special-order line is a customized
 * thing, and "12 Angry Samoa spelling WERE, 12 spelling PREGNANT" is two lines
 * that start from one menu item and diverge the moment you type. Raising the
 * first would silently merge two different donuts.
 *
 * The price is a SNAPSHOT taken at add time, from the price grid, and then the
 * line owns it — 013's rule for a PO line, applied to revenue. Editing the menu
 * price next month must not reprice a quote already sent.
 */
export function AddOrderLine({
  orderId,
  orgId,
  existing,
  menu,
  beside,
}: {
  orderId: string;
  orgId: string;
  existing: OrderLineRow[];
  /** Priced on the server — see `MenuItem`. */
  menu: MenuItem[];
  /** Drawn after Add item and Add Line — `OrderLines`' Clear items. */
  beside?: ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // TYPE · SIZE · CUT beside the search (Mark, 2026-09-16). "" is All. Kept
  // for as long as the panel is open, like the search.
  const [filters, setFilters] = useState<Record<FilterKey, string>>({ item_type: "", size: "", subtype: "" });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** A letter donut waiting for its character (Mark, 2026-09-16), with the
   *  amount that was typed when Add was pressed. */
  const [asking, setAsking] = useState<{ item: MenuItem; amount: number } | null>(null);
  const [otherLetter, setOtherLetter] = useState("");
  /** A letter typed on the row itself (Mark, 2026-09-16), which skips the
   *  "Which letter?" box. Blank still asks. Several, comma-separated, add a
   *  line each (2026-09-22) — `parseLetters`. */
  const [rowLetter, setRowLetter] = useState<Record<string, string>>({});

  const items = menu;

  const onOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of existing) {
      if (!l.production_item_id) continue;
      m.set(l.production_item_id, (m.get(l.production_item_id) ?? 0) + Number(l.qty ?? 0));
    }
    return m;
  }, [existing]);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      [i.name, i.item_type, i.subtype, i.finish, i.size].some((v) =>
        (v ?? "").toLowerCase().includes(q)
      )
    );
  }, [items, search]);

  /** Passes every picker EXCEPT `skip` — so each picker's counts are
   *  conditioned on the others and never on itself (lib/filterMenus' rule). */
  const passes = (i: MenuItem, skip: FilterKey | null) =>
    FILTER_KEYS.every((k) => k === skip || filters[k] === "" || (i[k] ?? "") === filters[k]);

  const filtered = useMemo(
    () => searched.filter((i) => passes(i, null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searched, filters]
  );
  const shown = filtered.slice(0, 60);

  function optionsFor(key: FilterKey, all: string) {
    const counts = new Map<string, number>();
    for (const i of items) {
      const v = i[key];
      if (v) counts.set(v, 0);
    }
    for (const i of searched) {
      const v = i[key];
      if (v && passes(i, key)) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    // A chosen value stays offered at 0, or nothing on screen could clear it.
    if (filters[key] && !counts.has(filters[key])) counts.set(filters[key], 0);
    const total = searched.filter((i) => passes(i, key)).length;
    return [
      { value: "", label: all, hint: String(total) },
      ...[...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([value, n]) => ({ value, label: value, hint: String(n) })),
    ];
  }

  // The next sort number, so an added line lands LAST rather than jumping to
  // the top past every null (the `ItemComponents` arithmetic, read the other
  // way: these lines DO carry sort numbers, because FileMaker's slots did).
  const nextSort = existing.reduce((a, l) => Math.max(a, l.sort ?? 0), 0) + 1;

  function add(item: MenuItem) {
    // A blank box still means ONE — its "1" hint is gone (Mark, 2026-09-13:
    // "empty should be blank"), and a box cleared after an add ("") used to
    // read as 0 and do nothing at all.
    const typed = (qty[item.id] ?? "").trim();
    const amount = typed === "" ? 1 : Number(typed);
    if (!Number.isFinite(amount) || amount <= 0) return;
    // A LETTER DONUT ASKS WHICH LETTER FIRST (Mark, 2026-09-16) — only a bare
    // `Letter` cut; nothing is written until the character is chosen, so
    // Cancel means nothing was added.
    if (needsLetterChoice(item.subtype)) {
      const typedLetters = parseLetters(rowLetter[item.id] ?? "");
      if (typedLetters.length > 0) {
        insert(item, amount, typedLetters);
        return;
      }
      setOtherLetter("");
      setAsking({ item, amount });
      return;
    }
    insert(item, amount, [null]);
  }

  function chooseLetter(typed: string) {
    const letters = parseLetters(typed);
    if (!asking || letters.length === 0) return;
    const { item, amount } = asking;
    setAsking(null);
    insert(item, amount, letters);
  }

  /** One line per character, in the order given — `[null]` is one line with
   *  no letter. ONE insert for all of them, so a refusal adds none of the word
   *  rather than half of it. */
  function insert(item: MenuItem, amount: number, characters: (string | null)[]) {
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_order_items")
        .insert(characters.map((character, i) => ({
          // Explicit, always — design rule 1. Omitting it reports an RLS
          // violation, which sends you looking at roles.
          org_id: orgId,
          order_id: orderId,
          // Consecutive, so the lines keep the word's sequence.
          sort: nextSort + i,
          production_item_id: item.id,
          // The SNAPSHOT. Every one of these is editable on the row afterwards,
          // which is the whole of decision 5. The NAME carries a Mini or Giant
          // size and the letter (Mark, 2026-09-16); the CUT carries the letter
          // in `letterCut`'s canonical spelling, which the row's letter picker
          // and production scheduling both read.
          name: addedLineName(item, character),
          item_donut: item.name,
          item_type: item.item_type,
          item_cut: character ? letterCut(character) : item.subtype,
          item_finish: item.finish,
          item_size: item.size,
          qty: amount,
          unit_price: item.price ?? 0,
          taxable: true,
          // THE LETTER IN QUOTES ON THE NOTE (Mark, 2026-09-16) — `"A"`, which
          // is how FileMaker's letter lines have always carried it, and the
          // note is what travels onto the production schedule line (069).
          ...(character ? { notes: `"${character}"` } : {}),
        })))
        .select("id");
      if (e) {
        setError(e.message);
        return;
      }
      if ((data?.length ?? 0) < characters.length) {
        setError("Nothing was added — the database refused the insert and said nothing.");
        return;
      }
      setQty((prev) => ({ ...prev, [item.id]: "" }));
      setRowLetter((prev) => ({ ...prev, [item.id]: "" }));
      router.refresh();
      // Deliberately NOT closing: see the header.
    });
  }

  function addBlank() {
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_order_items")
        .insert({
          org_id: orgId,
          order_id: orderId,
          sort: nextSort,
          name: "New item",
          qty: 1,
          unit_price: 0,
          taxable: true,
        })
        .select("id");
      if (e) setError(e.message);
      else if (!data?.length) setError("Nothing was added — the database refused it silently.");
      else router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => {
            setOpen(true);
            // The menu is rendered with the page, so an item created or renamed
            // since this order was opened is not in it (Mark, 2026-09-16: a
            // just-duplicated donut would not come up). Refreshing on open
            // re-reads it; the panel shows the list it has meanwhile.
            router.refresh();
          }}
        >
          Add item
        </button>
        {/* SMALL, between Add item and Clear items (Mark, 2026-09-22) — it
            was an underlined "Add a line by hand" after both. */}
        <button type="button" className={SMALL_BUTTON_CLASS} onClick={addBlank} disabled={pending}>
          Add Line
        </button>
        {beside}
        {error && !open ? <p className="w-full text-[13px] text-accent">{error}</p> : null}
      </div>

      {/* A PANEL OVERLAY (Mark, 2026-09-13), where it opened inline under the
          lines and pushed the page down. `ui/Dialog` pins the search in its
          toolbar and Done in its footer, and scrolls only the list — the
          `AddScheduleItems` shape. It still STAYS OPEN after each add. */}
      {/* PORTALLED (2026-09-16): the Add item button now lives in a pinned
          footer (`fixed`, z-30), and a `ui/Dialog` rendered inside it would be
          capped at that layer — under the masthead. On the body it is z-60 as
          everywhere else. */}
      {open ? createPortal(
        <Dialog
          title="Add items to this order"
          onClose={() => setOpen(false)}
          width="max-w-3xl"
          // No top padding: the column labels pin to the top of this scroller,
          // and a sticky cell stops at the padding edge — with it, rows would
          // show above the labels as they scroll.
          bodyClassName="px-6 pb-6"
          height="h-[80vh]"
          toolbar={
            // The search FLEXES and the three pickers sit beside it (Mark,
            // 2026-09-16), each captioned — a collapsed picker shows one value,
            // so it has to name its own dimension (`ui/ControlField`).
            // `items-end` puts the uncaptioned search on the pickers' line.
            // `flex-1` on the row: the Dialog's toolbar is itself a flex row, so
            // without it this one is content-sized and the search cannot grow.
            <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
              <div className="min-w-[12rem] flex-1">
                <TextInput
                  value={search}
                  onValueChange={setSearch}
                  aria-label="Find a production item"
                  clearLabel="Clear the search"
                  fullWidth
                  search
                  autoFocus
                  icon={<SearchGlyph />}
                />
              </div>
              {FILTERS.map((f) => (
                <ControlField key={f.key} label={f.label}>
                  <PickList
                    value={filters[f.key]}
                    onPick={(next) => setFilters((p) => ({ ...p, [f.key]: next }))}
                    variant="field"
                    ariaLabel={`Filter by ${f.label.toLowerCase()}`}
                    options={optionsFor(f.key, f.all)}
                    fit
                  />
                </ControlField>
              ))}
            </div>
          }
          footer={
            // BLACK — the panel-commit exception (Mark, 2026-08-19): the one
            // way out of a panel whose outcome is lines added.
            <button type="button" onClick={() => setOpen(false)} className={DIALOG_COMMIT_CLASS}>
              Done
            </button>
          }
        >
          {items.length === 0 ? (
            <p className="pt-6 text-[13px] text-muted">
              No active production items — the menu is where these come from.
            </p>
          ) : (
            <div>
              <table className="w-full border-collapse text-[14px]">
                {/* COLUMN LABELS (Mark, 2026-09-16), pinned while the list
                    scrolls — `lib/tableHead`'s in-pane dress. */}
                <thead>
                  <tr className={STICKY_HEAD_ROW_IN_PANE}>
                    <th className={`${HEAD} pr-3 text-left`}>Item</th>
                    <th className={`${HEAD} pr-3 text-right`}>Price</th>
                    <th className={`${HEAD} pr-2 text-right`}>Qty</th>
                    <th className={`${HEAD} pr-2 text-left`}>Letter</th>
                    <th className={HEAD}>
                      <span className="sr-only">Add</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((item) => {
                    const already = onOrder.get(item.id);
                    return (
                      <tr key={item.id} className="border-b border-hairline last:border-0 hover:bg-neutral-50">
                        <td className="py-2 pr-3">
                          <span className="block">{item.name}</span>
                          <span className="block text-[12px] text-subtle">
                            {[item.size, item.item_type, item.subtype, item.finish]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                            {already ? (
                              <span className="bg-mark-fill px-1">{already} already on this order</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="w-24 py-2 pr-3 text-right tabular-nums text-muted">
                          {item.price === null ? "—" : money(item.price)}
                        </td>
                        <td className="w-20 py-2 pr-2">
                          {/* A solid black border (Mark, 2026-09-13) — `rf-typed`,
                              the app's typed-field dress, h-9 to match the
                              action button beside it. */}
                          <input
                            type="text"
                            inputMode="decimal"
                            value={qty[item.id] ?? ""}
                            onChange={(e) => setQty((p) => ({ ...p, [item.id]: e.target.value }))}
                            aria-label={`How many ${item.name}`}
                            className="rf-typed h-9 w-full border border-ink bg-white px-2 text-right text-[14px] tabular-nums focus:outline-none"
                          />
                        </td>
                        <td className="w-40 py-2 pr-2">
                          {/* THE LETTER, on letter-cut rows only; the cell is
                              kept on every row so the columns line up. */}
                          {needsLetterChoice(item.subtype) ? (
                            <input
                              type="text"
                              value={rowLetter[item.id] ?? ""}
                              onChange={(e) =>
                                setRowLetter((p) => ({ ...p, [item.id]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  add(item);
                                }
                              }}
                              autoCapitalize="characters"
                              autoComplete="off"
                              aria-label={`Letter for ${item.name}`}
                              className="rf-typed h-9 w-full border border-ink bg-white px-2 text-[16px] font-semibold uppercase focus:outline-none"
                            />
                          ) : null}
                        </td>
                        <td className="w-24 py-2">
                          <button
                            type="button"
                            onClick={() => add(item)}
                            disabled={pending}
                            className={`${BUTTON_CLASS} w-full px-2`}
                          >
                            Add
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-4 text-sm text-muted">Nothing matches.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              {filtered.length > 60 ? (
                <p className="pt-2 text-[12px] text-muted">
                  Showing the first 60 of {filtered.length} — search or filter to narrow it.
                </p>
              ) : null}
            </div>
          )}

          {error ? <p className="pt-3 text-[13px] text-accent">{error}</p> : null}
        </Dialog>,
        document.body
      ) : null}

      {/* WHICH LETTER — a sibling of the panel, not nested inside it, so it
          paints over it and takes Escape alone (`ui/Dialog`'s stack). One tap
          on a character adds the line; the box is for the rare ones ("OP"),
          and takes a comma-separated list like the row's own box. */}
      {asking ? createPortal(
        <Dialog
          title="Which letter?"
          onClose={() => setAsking(null)}
          width="max-w-lg"
          onSubmit={otherLetter.trim() ? () => chooseLetter(otherLetter) : undefined}
          footer={
            <div className="flex items-center justify-end gap-3">
              <button type="button" onClick={() => setAsking(null)} className={DIALOG_CANCEL_CLASS}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => chooseLetter(otherLetter)}
                disabled={otherLetter.trim() === ""}
                className={DIALOG_COMMIT_CLASS}
              >
                Add
              </button>
            </div>
          }
        >
          <p className="pb-3 text-[14px]">
            {asking.amount} × {addedLineName(asking.item, null)}
          </p>
          <div className="grid grid-cols-6 gap-2">
            {LETTER_CHARACTERS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => chooseLetter(c)}
                title={LETTER_HINT[c]}
                aria-label={LETTER_HINT[c] ?? `Letter ${c}`}
                className={`${BUTTON_CLASS} w-full px-0 text-[16px] font-bold`}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="mt-4 block text-[12px] uppercase tracking-[0.12em] text-muted">
            Something else
            <input
              type="text"
              value={otherLetter}
              onChange={(e) => setOtherLetter(e.target.value)}
              className="rf-typed mt-1 block h-9 w-full border border-ink bg-white px-2 text-[16px] normal-case tracking-normal text-ink focus:outline-none"
            />
          </label>
        </Dialog>,
        document.body
      ) : null}
    </>
  );
}
