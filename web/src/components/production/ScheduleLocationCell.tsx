"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLatestWrite } from "@/lib/latestWrite";
import { PickList, type PickOption } from "@/components/ui/PickList";

/**
 * A schedule's Sells at or Made at, picked in its `/schedules` row (Mark,
 * 2026-09-30: "editable, borderless picklists" — `variant="inline"`) and on
 * its record, where it is `boxed` like the record's other fields.
 *
 * Shows the pick on the tap and writes behind it (`lib/latestWrite`); a failure
 * puts back the last SAVED shop and says why — through `onError` in a list
 * row, which has no room for it, or under the picker on the record. The likely failure is 040's
 * `production_schedules_plan_day` key: a plan schedule already exists for that
 * shop, date and kitchen, and two would be the double night the key forbids.
 *
 * The options are the ACTIVE shops. A row already at a closed one keeps its
 * shop on the list, sunk as inactive, so the cell still names it.
 */
export function ScheduleLocationCell({
  scheduleId,
  column,
  value,
  code,
  locations,
  ariaLabel,
  className = "",
  boxed = false,
  onError,
}: {
  scheduleId: string;
  column: "location_id" | "kitchen_location_id";
  value: string;
  /** The current shop's code, for a row whose shop is not in `locations`. */
  code: string;
  locations: { id: string; code: string }[];
  ariaLabel: string;
  className?: string;
  /** A detail screen's box — `InlineValue`'s `boxed`, passed through. */
  boxed?: boolean;
  /**
   * Where a failure is reported. Omitted — the schedule record, a server
   * component that cannot hand a client one a function — it is said under the
   * picker instead.
   */
  onError?: (message: string | null) => void;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(value);
  // What the database was last known to hold.
  const confirmed = useRef(value);
  // Fresh props with no write in flight replace the held pick.
  const [failed, setFailed] = useState<string | null>(null);
  const report = (message: string | null) => (onError ? onError(message) : setFailed(message));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setPicked(value);
  }

  const push = useLatestWrite<string>(
    async (next) => {
      const { data, error } = await createClient()
        .from("production_schedules")
        .update({ [column]: next })
        .eq("id", scheduleId)
        .select("id");
      if (error) {
        return error.code === "23505"
          ? "A plan schedule for that shop, date and kitchen already exists."
          : error.message;
      }
      if (!data?.length) return "That schedule could not be changed.";
      confirmed.current = next;
      return null;
    },
    (error) => {
      if (error) setPicked(confirmed.current);
      report(error);
      router.refresh();
    }
  );

  const options: PickOption[] = locations.map((l) => ({ value: l.id, label: l.code }));
  if (!locations.some((l) => l.id === value)) {
    options.push({ value, label: code, inactive: true });
  }

  const picker = (
    <PickList
      variant="inline"
      boxed={boxed}
      value={picked}
      options={options}
      ariaLabel={ariaLabel}
      className={className}
      onPick={(next) => {
        if (!next || next === picked) return;
        setPicked(next);
        report(null);
        push(next);
      }}
    />
  );
  if (onError) return picker;
  return (
    <>
      {picker}
      {failed ? <p className="mt-1 text-xs text-accent">{failed}</p> : null}
    </>
  );
}
