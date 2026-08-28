"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Checkbox } from "@/components/ui/Checkbox";
import { BOXED_FIELD, BOXED_FIELD_BORDER, BOXED_FIELDS } from "@/components/ui/fieldMetrics";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Postgres hands back "10:00:00"; `<input type="time">` wants "10:00". */
const toInput = (t: string | null) => (t ? t.slice(0, 5) : "");
const fromInput = (t: string) => (t.trim() === "" ? null : `${t}:00`);

/** Seven slots whatever the column held — null, or (from a hand edit) short. */
function seven(list: (string | null)[] | null): (string | null)[] {
  return Array.from({ length: 7 }, (_, i) => list?.[i] ?? null);
}

/**
 * When the shop opens, per weekday.
 *
 * Two facts kept apart, the way FileMaker kept them: WHICH days it opens
 * (`open_days`, the same ISO smallint[] `WeekdayPicker` writes) and WHAT TIME
 * (`open_time_by_weekday` / `close_time_by_weekday`, seven slots each, slot n =
 * weekday n — migration 009's array convention). So a seasonal closure doesn't
 * destroy the hours, and hours can be recorded before the day is opened.
 *
 * Not a `WeekdayPicker` + two rows of boxes: three facts about Tuesday belong
 * on Tuesday's line, and the seven-across strip has nowhere to put a time.
 *
 * Optimistic like the other inline controls, reverting on failure — the whole
 * array is rewritten on every edit, so a silent no-op would leave you believing
 * a closing time was saved.
 */
export function OperatingHours({
  locationId,
  openDays,
  openTimes,
  closeTimes,
  editable,
}: {
  locationId: string;
  openDays: number[] | null;
  openTimes: (string | null)[] | null;
  closeTimes: (string | null)[] | null;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [days, setDays] = useState<number[]>(openDays ?? []);
  const [opens, setOpens] = useState<(string | null)[]>(seven(openTimes));
  const [closes, setCloses] = useState<(string | null)[]>(seven(closeTimes));
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

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

  function toggleDay(weekday: number) {
    const previous = days;
    const next = days.includes(weekday)
      ? days.filter((d) => d !== weekday)
      : [...days, weekday].sort((a, b) => a - b);
    setDays(next);
    write({ open_days: next }, () => setDays(previous));
  }

  function setTime(which: "open" | "close", index: number, raw: string) {
    const current = which === "open" ? opens : closes;
    const value = fromInput(raw);
    if (current[index] === value) return;
    const previous = current;
    const next = [...current];
    next[index] = value;
    const setter = which === "open" ? setOpens : setCloses;
    setter(next);
    write(
      { [which === "open" ? "open_time_by_weekday" : "close_time_by_weekday"]: next },
      () => setter(previous)
    );
  }

  return (
    <div className="space-y-2">
      <table className="text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em] text-subtle">
            <th className="py-1 pr-6 text-left font-semibold">Day</th>
            <th className="py-1 pr-6 text-left font-semibold">Open</th>
            <th className="py-1 pr-6 text-left font-semibold">Opens</th>
            <th className="py-1 text-left font-semibold">Closes</th>
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day, i) => {
            const weekday = i + 1;
            const on = days.includes(weekday);
            return (
              <tr key={day}>
                <td className={`py-1 pr-6 ${on ? "" : "text-faint"}`}>{day}</td>
                <td className="py-1 pr-6">
                  <Checkbox
                    checked={on}
                    size={18}
                    disabled={!editable || pending}
                    label={`${day}: open`}
                    onChange={() => toggleDay(weekday)}
                  />
                </td>
                <td className="py-1 pr-6">
                  <TimeCell
                    value={opens[i]}
                    editable={editable}
                    disabled={pending}
                    label={`${day} opening time`}
                    onCommit={(raw) => setTime("open", i, raw)}
                  />
                </td>
                <td className="py-1">
                  <TimeCell
                    value={closes[i]}
                    editable={editable}
                    disabled={pending}
                    label={`${day} closing time`}
                    onCommit={(raw) => setTime("close", i, raw)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {failed && <p className="text-xs text-accent">Could not save: {failed}</p>}
    </div>
  );
}

/** `<input type="time">` draws the browser's own control, which is why the
 *  hours block is the one place a raw input is right — TextInput's clear button
 *  would sit on top of it, and the picker already offers an empty state. */
function TimeCell({
  value,
  editable,
  disabled,
  label,
  onCommit,
}: {
  value: string | null;
  editable: boolean;
  disabled: boolean;
  label: string;
  onCommit: (raw: string) => void;
}) {
  if (!editable) {
    return <span className={value ? "" : "text-faint"}>{toInput(value) || "—"}</span>;
  }
  return (
    <input
      type="time"
      aria-label={label}
      disabled={disabled}
      defaultValue={toInput(value)}
      key={toInput(value)}
      onBlur={(e) => onCommit(e.target.value)}
      // The record's own field height. This block already wore a box; what it
      // did not do was wear the SAME one, so a 30px time input sat beside 36px
      // fields two blocks down. `w-auto` because a time input has a natural
      // width and there is no grid track here to fill.
      className={`${
        BOXED_FIELDS ? `${BOXED_FIELD} ${BOXED_FIELD_BORDER} !w-auto px-2` : "border border-hairline px-2 py-1"
      } tabular-nums disabled:opacity-35`}
    />
  );
}
