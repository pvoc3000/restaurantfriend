"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TextInput } from "@/components/ui/TextInput";
import { Dialog, DIALOG_CANCEL_CLASS } from "@/components/ui/Dialog";

export type AddableItem = {
  id: string;
  name: string;
  item_type: string | null;
  subtype: string | null;
  finish: string | null;
  size: string | null;
  tally_box_size: number;
  tray_capacity: number;
};

/**
 * Add an item to a night that doesn't have it — `AddPoLines`' panel, and its
 * one non-obvious behaviour: IT STAYS OPEN AFTER EACH ADD, because adding four
 * things is the shape of the task.
 *
 * The line SNAPSHOTS the catalog exactly the way generation does, so a
 * hand-added item is indistinguishable from a generated one on the printed
 * sheet — except for `par_source = 'manual'`, which is what tells the next
 * regeneration to leave it alone.
 */
export function AddScheduleItems({
  scheduleId,
  orgId,
  items,
}: {
  scheduleId: string;
  orgId: string;
  items: AddableItem[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    const left = items.filter((i) => !added.has(i.id));
    if (!q) return left.slice(0, 60);
    return left
      .filter((i) =>
        [i.name, i.item_type, i.subtype, i.finish, i.size]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 60);
  }, [items, term, added]);

  async function add(item: AddableItem) {
    const par = Number(qty[item.id]);
    if (!Number.isFinite(par) || par <= 0) {
      setError(`Enter how many ${item.name} to make.`);
      return;
    }
    setBusy(item.id);
    setError(null);

    const { data, error: err } = await supabase
      .from("production_schedule_items")
      .insert({
        // Every insert passes org_id EXPLICITLY. No table defaults it, and a
        // WITH CHECK is evaluated before the NOT NULL — so omitting it reports
        // as an RLS violation and sends you looking at roles.
        org_id: orgId,
        schedule_id: scheduleId,
        item_id: item.id,
        item_name: item.name,
        item_type: item.item_type,
        subtype: item.subtype,
        finish: item.finish,
        size: item.size,
        tally_box_size: item.tally_box_size,
        tray_capacity: item.tray_capacity,
        par,
        // No `planned_par`: nothing planned it. The row says so rather than
        // copying the par across and implying the plans agreed.
        par_source: "manual",
      })
      .select("id")
      .single();

    setBusy(null);
    if (err) {
      setError(err.message);
      return;
    }
    if (!data) {
      setError("The item was not added — you may not have permission.");
      return;
    }
    setAdded((prev) => new Set(prev).add(item.id));
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
          setAdded(new Set());
          setTerm("");
          setQty({});
        }}
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white"
      >
        Add item…
      </button>

      {open && (
        <Dialog
          title="Add an item to this night"
          onClose={() => setOpen(false)}
          width="max-w-2xl"
          height="h-[80vh]"
          toolbar={
            <TextInput
              value={term}
              onValueChange={setTerm}
              placeholder="Search the menu…"
              aria-label="Search items"
              className="w-full"
            />
          }
          footer={
            <button type="button" onClick={() => setOpen(false)} className={DIALOG_CANCEL_CLASS}>
              {added.size ? `Done — ${added.size} added` : "Close"}
            </button>
          }
        >
          {error ? <p className="mb-3 text-sm text-accent">{error}</p> : null}

          {shown.length === 0 ? (
            <p className="text-sm text-muted">
              {term
                ? "Nothing on the menu matches that."
                : "Every active item is already on this schedule."}
            </p>
          ) : (
            <ul className="divide-y divide-hairline border border-ink">
              {shown.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {[item.item_type, item.subtype, item.finish, item.size]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={qty[item.id] ?? ""}
                    onChange={(e) => setQty((p) => ({ ...p, [item.id]: e.target.value }))}
                    aria-label={`How many ${item.name}`}
                    className="h-9 w-20 border border-ink px-2 text-right tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => add(item)}
                    disabled={busy === item.id}
                    className="h-9 shrink-0 border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white disabled:opacity-35"
                  >
                    {busy === item.id ? "Adding…" : "Add"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
    </>
  );
}
