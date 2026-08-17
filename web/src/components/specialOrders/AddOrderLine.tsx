"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { money } from "@/lib/specialOrders";
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
}: {
  orderId: string;
  orgId: string;
  existing: OrderLineRow[];
  /** Priced on the server — see `MenuItem`. */
  menu: MenuItem[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const items = menu;

  const onOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of existing) {
      if (!l.production_item_id) continue;
      m.set(l.production_item_id, (m.get(l.production_item_id) ?? 0) + Number(l.qty ?? 0));
    }
    return m;
  }, [existing]);

  const shown = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 60);
    return items
      .filter((i) =>
        [i.name, i.item_type, i.subtype, i.finish, i.size].some((v) =>
          (v ?? "").toLowerCase().includes(q)
        )
      )
      .slice(0, 60);
  }, [items, search]);

  // The next sort number, so an added line lands LAST rather than jumping to
  // the top past every null (the `ItemComponents` arithmetic, read the other
  // way: these lines DO carry sort numbers, because FileMaker's slots did).
  const nextSort = existing.reduce((a, l) => Math.max(a, l.sort ?? 0), 0) + 1;

  function add(item: MenuItem) {
    const amount = Number(qty[item.id] ?? "1");
    if (!Number.isFinite(amount) || amount <= 0) return;
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_order_items")
        .insert({
          // Explicit, always — design rule 1. Omitting it reports an RLS
          // violation, which sends you looking at roles.
          org_id: orgId,
          order_id: orderId,
          sort: nextSort,
          production_item_id: item.id,
          // The SNAPSHOT. Every one of these is editable on the row afterwards,
          // which is the whole of decision 5.
          name: item.name,
          item_donut: item.name,
          item_type: item.item_type,
          item_cut: item.subtype,
          item_finish: item.finish,
          item_size: item.size,
          qty: amount,
          unit_price: item.price ?? 0,
          taxable: true,
        })
        .select("id");
      if (e) {
        setError(e.message);
        return;
      }
      if (!data?.length) {
        setError("Nothing was added — the database refused the insert and said nothing.");
        return;
      }
      setQty((prev) => ({ ...prev, [item.id]: "" }));
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

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BUTTON_CLASS} onClick={() => setOpen(true)}>
          Add item
        </button>
        <button
          type="button"
          className="text-[13px] text-muted underline underline-offset-2 hover:text-ink disabled:opacity-35"
          onClick={addBlank}
          disabled={pending}
        >
          Add a line by hand
        </button>
        <span className="text-[12px] text-muted">
          A hand-typed line carries no production item, so it cannot be scheduled.
        </span>
        {error ? <p className="w-full text-[13px] text-accent">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 border border-hairline p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Find an item
          </span>
          <TextInput
            value={search}
            onValueChange={setSearch}
            placeholder="Angry Samoa, Bismark, mini…"
            aria-label="Find a production item"
            clearLabel="Clear the search"
            className="w-72"
            autoFocus
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto text-[13px] text-muted underline underline-offset-2 hover:text-ink"
        >
          Done
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-[13px] text-muted">
          No active production items — the menu is where these come from.
        </p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full border-collapse text-[14px]">
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
                          <span className="text-mark"> · {already} already on this order</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="w-24 py-2 pr-3 text-right tabular-nums text-muted">
                      {item.price === null ? "—" : money(item.price)}
                    </td>
                    <td className="w-20 py-2 pr-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={qty[item.id] ?? ""}
                        onChange={(e) => setQty((p) => ({ ...p, [item.id]: e.target.value }))}
                        placeholder="1"
                        aria-label={`How many ${item.name}`}
                        className="h-8 w-full border border-hairline px-2 text-right text-[14px] tabular-nums focus:border-ink focus:outline-none"
                      />
                    </td>
                    <td className="w-24 py-2">
                      <button
                        type="button"
                        onClick={() => add(item)}
                        disabled={pending}
                        className="h-8 w-full border border-ink bg-white px-2 text-[12px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white disabled:opacity-35"
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 ? (
                <tr>
                  <td className="py-4 text-sm text-muted">Nothing matches “{search}”.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {!search && items.length > 60 ? (
            <p className="pt-2 text-[12px] text-muted">
              Showing the first 60 of {items.length} — search to narrow it.
            </p>
          ) : null}
        </div>
      )}

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
    </div>
  );
}
