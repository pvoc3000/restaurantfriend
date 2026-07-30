"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";

/**
 * The composed name, offered rather than imposed: FileMaker's own 168 rows
 * disagree about the dash ("02 Walk In R1 S1" at DF01, "02 Storage - R1 S3" at
 * DF02), so the field stays editable and whatever you type wins.
 */
function compose(sort: string, area: string, subArea: string): string {
  const prefix = sort.trim();
  const tail = [area.trim(), subArea.trim()].filter(Boolean).join(" - ");
  return [prefix, tail].filter(Boolean).join(" ");
}

/**
 * Add a shelf to this shop's walk order.
 *
 * `display_name` is unique per location (migration 017) — it is the identity
 * the order guide groups by — so a duplicate is refused by the database and
 * reported here rather than quietly splitting a shelf in two.
 */
export function AddShopSection({
  orgId,
  locationId,
  areas,
}: {
  orgId: string;
  locationId: string;
  areas: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [sort, setSort] = useState("");
  const [area, setArea] = useState("");
  const [subArea, setSubArea] = useState("");
  const [name, setName] = useState("");
  const [touchedName, setTouchedName] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  // Until you edit it yourself, the name follows the other three fields.
  const displayName = touchedName ? name : compose(sort, area, subArea);
  // Empty is NOT zero here. A blank field would insert sort_order 0 and put the
  // new shelf at the head of the walk, which is a position nobody chose.
  const sortValue = sort.trim() === "" ? NaN : Number(sort);
  const ready = area.trim() !== "" && displayName.trim() !== "" && Number.isFinite(sortValue);

  function add() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      const { error } = await supabase.from("shop_sections").insert({
        org_id: orgId,
        location_id: locationId,
        area: area.trim(),
        sub_area: subArea.trim() || null,
        display_name: displayName.trim(),
        sort_order: sortValue,
      });
      if (error) {
        setFailed(
          error.code === "23505"
            ? `"${displayName.trim()}" already exists at this location.`
            : error.message
        );
        return;
      }
      // Everything but the area, which is usually the same for the next shelf.
      setSort("");
      setSubArea("");
      setName("");
      setTouchedName(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 border-t-2 border-ink pt-4">
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
        Add a section
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Sort">
          <TextInput
            value={sort}
            onValueChange={setSort}
            inputMode="decimal"
            aria-label="Sort order"
            className="w-24"
          />
        </Field>
        <Field label="Area">
          <div className="w-48">
            <PickList
              value={area || null}
              options={areas.map((a) => ({ value: a, label: a }))}
              allowNew
              placeholder="choose or type"
              ariaLabel="Area"
              onPick={setArea}
            />
          </div>
        </Field>
        <Field label="Sub area">
          <TextInput
            value={subArea}
            onValueChange={setSubArea}
            aria-label="Sub area"
            className="w-40"
          />
        </Field>
        <Field label="Display name">
          <TextInput
            value={displayName}
            onValueChange={(next) => {
              setTouchedName(true);
              setName(next);
            }}
            aria-label="Display name"
            className="w-72"
          />
        </Field>
        <button
          type="button"
          disabled={!ready || pending}
          onClick={add}
          className="h-[38px] border-2 border-ink bg-ink px-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-35"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {failed && <p className="text-sm text-accent">{failed}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] uppercase tracking-[0.12em] text-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}
