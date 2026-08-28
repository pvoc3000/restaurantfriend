"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PickList } from "@/components/ui/PickList";
import { Checkbox } from "@/components/ui/Checkbox";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import type { Location } from "@/lib/session";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Seven slots whatever the column held. */
function seven(list: (string | null)[] | null): (string | null)[] {
  return Array.from({ length: 7 }, (_, i) => list?.[i] ?? null);
}

/**
 * Which location PRODUCES for this one (per weekday), and which locations this
 * one BUYS for.
 *
 * Both are recorded, not read — nothing in the app consults them yet, and the
 * heading above says so. They're here because FileMaker kept them on the
 * location screen, the facts are real (DF02's donuts are made at DF01 Monday
 * to Wednesday and at DF02 the rest of the week), and losing them a second
 * time would mean re-deriving them from a thirteen-year-old export.
 *
 * Per weekday because the answer genuinely differs by day; `shops_for` is a
 * plain set, so it's checkboxes.
 */
export function ProductionMapping({
  locationId,
  locations,
  kitchenByWeekday,
  shopsFor,
  editable,
}: {
  locationId: string;
  /** Every location, closed ones included — a closed shop can still be the one
   *  a live shop was produced at, and hiding it would silently blank the cell. */
  locations: Location[];
  kitchenByWeekday: (string | null)[] | null;
  shopsFor: string[] | null;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [kitchen, setKitchen] = useState<(string | null)[]>(seven(kitchenByWeekday));
  const [shops, setShops] = useState<string[]>(shopsFor ?? []);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const options = locations.map((l) => ({
    value: l.id,
    label: l.code,
    hint: l.is_active ? l.name : `${l.name} · inactive`,
  }));
  const codeById = new Map(locations.map((l) => [l.id, l.code]));

  function write(patch: Record<string, unknown>, revert: () => void) {
    setFailed(null);
    startTransition(async () => {
      const { error } = await supabase.from("locations").update(patch).eq("id", locationId);
      if (error) {
        revert();
        setFailed(error.message);
        return;
      }
      router.refresh();
    });
  }

  function setKitchenAt(index: number, next: string | null) {
    const previous = kitchen;
    const list = [...kitchen];
    list[index] = next;
    setKitchen(list);
    // All-null says nothing; store null rather than seven nulls, which is what
    // the column's "is null or exactly 7" check exists for.
    write({ kitchen_by_weekday: list.some(Boolean) ? list : null }, () =>
      setKitchen(previous)
    );
  }

  function toggleShop(id: string) {
    const previous = shops;
    const next = shops.includes(id) ? shops.filter((s) => s !== id) : [...shops, id];
    setShops(next);
    write({ shops_for: next }, () => setShops(previous));
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-subtle">Produced at</p>
        <table className="text-sm">
          <tbody>
            {DAYS.map((day, i) => (
              <tr key={day}>
                <td className="w-32 py-1 pr-6">{day}</td>
                <td className="py-1">
                  {editable ? (
                    <div className="w-40">
                      <PickList
                        value={kitchen[i]}
                        options={options}
                        disabled={pending}
                        boxed={BOXED_FIELDS}
                        placeholder="none"
                        ariaLabel={`${day}: produced at`}
                        onPick={(next) => setKitchenAt(i, next === "" ? null : next)}
                      />
                    </div>
                  ) : (
                    <span className={kitchen[i] ? "" : "text-faint"}>
                      {(kitchen[i] && codeById.get(kitchen[i]!)) ?? "none"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-subtle">Shops for</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {locations.map((l) => (
            <Checkbox
              key={l.id}
              checked={shops.includes(l.id)}
              size={18}
              disabled={!editable || pending}
              onChange={() => toggleShop(l.id)}
            >
              <span className={`text-sm ${l.is_active ? "" : "text-faint"}`}>{l.code}</span>
            </Checkbox>
          ))}
        </div>
      </div>

      {failed && <p className="text-xs text-accent">Could not save: {failed}</p>}
    </div>
  );
}
