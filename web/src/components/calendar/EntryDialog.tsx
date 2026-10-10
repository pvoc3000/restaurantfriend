"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
  DIALOG_DANGER_CLASS,
} from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { DateField } from "@/components/ui/DateField";
import { PickSet } from "@/components/ui/PickSet";
import { Checkbox } from "@/components/ui/Checkbox";
import { confirmDialog } from "@/lib/confirm";
import { ColorSwatches } from "@/components/calendar/ColorSwatches";
import { isCalendarColor, type CalendarColor } from "@/lib/calendarColors";
import {
  BLACKOUT_SWITCHES,
  entryAppliesTo,
  isBlackout,
  type BlackoutColumn,
  type CalendarEntry,
} from "@/lib/blackoutDates";

export type EntryLocation = { id: string; code: string; name: string };

type Switches = Record<BlackoutColumn, boolean>;

const NO_SWITCHES: Switches = {
  no_special_orders: false,
  no_standing_orders: false,
  no_production: false,
  shop_closed: false,
};

/** What is already on the dates a blackout is about to cover. */
type Existing = { orders: number; schedules: number };

/**
 * A calendar entry — new, or the one that was tapped.
 *
 * ONE DIALOG FOR BOTH (migration 181's one table): a note is an entry with no
 * switch on, a blackout is the same entry with one or more on. The switches
 * are offered only to someone who may set them (`canSetBlackouts`), and an
 * existing blackout opens READ-ONLY for anyone else — 181's policies would
 * refuse the write, and a form that saves nothing is worse than one that says
 * it cannot.
 *
 * A BLACKOUT NEVER CHANGES WHAT EXISTS, so before it is saved the dialog counts
 * the orders and schedules already on those dates and says so. That count is
 * the whole of what the person needs to go and deal with by hand.
 */
export function EntryDialog({
  orgId,
  locations,
  entry,
  initialDate,
  canWrite,
  canSetBlackouts,
  onClose,
}: {
  orgId: string;
  locations: EntryLocation[];
  /** The entry being edited; omit for a new one. */
  entry?: CalendarEntry | null;
  /** The day a new entry starts on — the cell that was tapped. */
  initialDate?: string | null;
  canWrite: boolean;
  canSetBlackouts: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState(entry?.title ?? "");
  const [from, setFrom] = useState<string | null>(entry?.starts_on ?? initialDate ?? null);
  const [through, setThrough] = useState<string | null>(entry?.ends_on ?? initialDate ?? null);
  const [shops, setShops] = useState<string[]>(entry?.location_ids ?? []);
  const [note, setNote] = useState(entry?.note ?? "");
  const [color, setColor] = useState<CalendarColor | null>(
    isCalendarColor(entry?.color) ? entry.color : null,
  );
  const [switches, setSwitches] = useState<Switches>(
    entry
      ? {
          no_special_orders: entry.no_special_orders,
          no_standing_orders: entry.no_standing_orders,
          no_production: entry.no_production,
          shop_closed: entry.shop_closed,
        }
      : NO_SWITCHES,
  );
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [existing, setExisting] = useState<Existing | null>(null);

  // An existing blackout is a manager's to change; everything else follows the
  // page's own write flag.
  const editable = canWrite && (canSetBlackouts || !entry || !isBlackout(entry));
  const blackout = isBlackout(switches);
  const ordered = from !== null && through !== null && through >= from;
  const ready = editable && title.trim() !== "" && ordered;

  // Count what is already there, once the dates and a switch are both set.
  const countOrders = switches.no_special_orders || switches.no_standing_orders;
  const countSchedules = switches.no_production;
  const shopsKey = shops.join(",");
  useEffect(() => {
    if (!editable || !ordered || !(countOrders || countSchedules)) return;
    let stale = false;
    const scope = { location_ids: shopsKey === "" ? [] : shopsKey.split(",") };
    void (async () => {
      const [orders, schedules] = await Promise.all([
        countOrders
          ? supabase
              .from("special_orders")
              .select("id, location_id, kitchen_location_id")
              .eq("kind", "order")
              .neq("status", "cancelled")
              .gte("event_date", from)
              .lte("event_date", through)
              .order("id")
              .limit(1000)
          : null,
        countSchedules
          ? supabase
              .from("production_schedules")
              .select("id, location_id, kitchen_location_id")
              .gte("schedule_date", from)
              .lte("schedule_date", through)
              .order("id")
              .limit(1000)
          : null,
      ]);
      if (stale) return;
      const covered = (rows: { location_id: unknown; kitchen_location_id: unknown }[] | null) =>
        (rows ?? []).filter((r) =>
          entryAppliesTo(scope, [r.location_id as string | null, r.kitchen_location_id as string | null]),
        ).length;
      setExisting({
        orders: covered(orders?.data ?? null),
        schedules: covered(schedules?.data ?? null),
      });
    })();
    return () => {
      stale = true;
    };
  }, [supabase, editable, ordered, countOrders, countSchedules, from, through, shopsKey]);

  const shown = ordered && (countOrders || countSchedules) ? existing : null;

  function save() {
    if (!ready || !from || !through) return;
    setFailed(null);
    const values = {
      title: title.trim(),
      starts_on: from,
      ends_on: through,
      location_ids: shops,
      note: note.trim() === "" ? null : note.trim(),
      // A blackout is always drawn dark, so it keeps no colour of its own.
      color: isBlackout(switches) ? null : color,
      ...switches,
    };
    startTransition(async () => {
      // `org_id` EXPLICITLY on the insert — design rule 1: a WITH CHECK runs
      // before NOT NULL, so leaving it out reads as a role problem.
      const { error } = entry
        ? await supabase.from("calendar_entries").update(values).eq("id", entry.id)
        : await supabase.from("calendar_entries").insert({ org_id: orgId, ...values });
      if (error) {
        setFailed(error.message);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  async function remove() {
    if (!entry || !editable) return;
    const ok = await confirmDialog({
      title: `Delete “${entry.title}”?`,
      body: isBlackout(entry)
        ? "The dates it covers go back to normal. Nothing that was skipped while it stood is made up for until the next top-up or generate."
        : "This cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete it",
    });
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      const { error } = await supabase.from("calendar_entries").delete().eq("id", entry.id);
      if (error) {
        setFailed(error.message);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      title={entry ? (isBlackout(entry) ? "Blackout" : "Calendar entry") : "New calendar entry"}
      onClose={() => {
        if (!pending) onClose();
      }}
      busy={pending}
      width="max-w-2xl"
      onSubmit={ready && !pending ? save : undefined}
      footer={
        <>
          {entry && editable && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={pending}
              className={`${DIALOG_DANGER_CLASS} mr-auto`}
            >
              Delete
            </button>
          )}
          <button type="button" onClick={onClose} disabled={pending} className={DIALOG_CANCEL_CLASS}>
            {editable ? "Cancel" : "Close"}
          </button>
          {editable && (
            <button
              type="button"
              onClick={save}
              disabled={!ready || pending}
              className={DIALOG_COMMIT_CLASS}
            >
              {pending ? "Saving…" : entry ? "Save" : "Add entry"}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Title" required>
          <TextInput
            value={title}
            onValueChange={setTitle}
            aria-label="Title"
            autoFocus={!entry}
            disabled={!editable}
            fullWidth
            className="w-full"
          />
        </Field>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Field label="From" required>
            <DateField
              value={from}
              onChange={(next) => {
                setFrom(next);
                // A one-day entry is the common case: Through follows From
                // until somebody sets it apart.
                if (next && (through === null || through === from || through < next)) {
                  setThrough(next);
                }
              }}
              ariaLabel="From"
              boxed
              required
              disabled={!editable}
            />
          </Field>
          <Field label="Through" required>
            <DateField
              value={through}
              onChange={setThrough}
              ariaLabel="Through"
              boxed
              required
              disabled={!editable}
            />
          </Field>
          <Field label="Shops">
            <PickSet
              options={locations.map((l) => ({ value: l.id, label: l.code, hint: l.name }))}
              value={shops}
              onChange={setShops}
              allLabel="All shops"
              label="Which shops this is about"
              noun="shops"
              boxed
              disabled={!editable}
            />
          </Field>
        </div>

        <Field label="Note">
          <TextInput
            value={note}
            onValueChange={setNote}
            aria-label="Note"
            disabled={!editable}
            fullWidth
            className="w-full"
          />
        </Field>

        {/* A colour of its own (migration 188) — for a note or an event. A
            blackout has none: a closed day looks the same every time. */}
        {!blackout && (
          <div className="space-y-1">
            <span className="block text-[11px] uppercase tracking-[0.12em] text-subtle">Colour</span>
            <ColorSwatches
              value={color}
              onChange={setColor}
              ariaLabel="Colour"
              name="entry-colour"
              allowDefault
              disabled={!editable}
            />
          </div>
        )}

        {(canSetBlackouts || blackout) && (
          <fieldset>
            <legend className="mb-2 block text-[11px] uppercase tracking-[0.12em] text-subtle">
              On these dates
            </legend>
            {/* ONE PER LINE. A `ui/Checkbox` is an inline box, so a `space-y`
                on the fieldset did nothing and the labels ran together in a
                row (Mark, 2026-10-10). A column, in a `div` — a fieldset is
                not a reliable flex container. */}
            <div className="flex flex-col items-start gap-2">
              {BLACKOUT_SWITCHES.map((s) => (
                <Checkbox
                  key={s.column}
                  checked={switches[s.column]}
                  disabled={!editable || !canSetBlackouts}
                  onChange={(next) => setSwitches((prev) => ({ ...prev, [s.column]: next }))}
                >
                  {s.label}
                </Checkbox>
              ))}
            </div>
          </fieldset>
        )}

        {switches.no_special_orders && (
          <p className="max-w-[60ch] text-sm text-muted">
            The inquiry form shows the title to customers.
          </p>
        )}
        {shown && shown.orders + shown.schedules > 0 && (
          <p className="border border-ink bg-mark-fill px-3 py-2 text-sm text-ink">
            {existingSentence(shown)}
          </p>
        )}
        {from !== null && through !== null && through < from && (
          <p className="text-sm text-accent">Through is before From.</p>
        )}
        {failed && <p className="text-sm text-accent">{failed}</p>}
      </div>
    </Dialog>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function existingSentence(existing: Existing): string {
  const parts: string[] = [];
  if (existing.orders > 0) parts.push(plural(existing.orders, "special order", "special orders"));
  if (existing.schedules > 0) {
    parts.push(plural(existing.schedules, "production schedule", "production schedules"));
  }
  const total = existing.orders + existing.schedules;
  return `${parts.join(" and ")} already ${total === 1 ? "exists" : "exist"} on these dates. ${
    total === 1 ? "It is" : "They are"
  } not changed.`;
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] uppercase tracking-[0.12em] text-subtle">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </label>
  );
}
