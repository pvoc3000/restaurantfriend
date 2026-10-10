"use client";

import Link from "next/link";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { CALENDAR_LAYERS, type CalendarItem } from "@/lib/calendar";
import { chipClass, itemText } from "@/components/calendar/MonthView";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Friday, December 25, 2026". UTC arithmetic, so it cannot slip a day. */
function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

const LAYER_LABEL = Object.fromEntries(CALENDAR_LAYERS.map((l) => [l.key, l.label]));

/**
 * Everything on one day — what a cell had no room to say.
 *
 * The cell shows four lines and a count; this is the whole list, each with its
 * second phrase (the customer, the vendor, the note) and the shops it is about.
 * It is also where a new entry for that day starts.
 */
export function DayPanel({
  date,
  items,
  shopCodes,
  canWrite,
  onEntry,
  onNew,
  onClose,
}: {
  date: string;
  items: readonly CalendarItem[];
  /** location id → code, to say which shop a line is about. */
  shopCodes: ReadonlyMap<string, string>;
  canWrite: boolean;
  onEntry: (entryId: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={longDate(date)}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" onClick={onClose} className={DIALOG_CANCEL_CLASS}>
            Close
          </button>
          {canWrite && (
            <button type="button" onClick={onNew} className={DIALOG_COMMIT_CLASS}>
              New entry
            </button>
          )}
        </>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing on this day.</p>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {items.map((item) => {
            const shops = item.locationIds
              .map((id) => shopCodes.get(id))
              .filter((code): code is string => Boolean(code))
              .join(", ");
            const line = (
              <span className="flex items-baseline gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className={`rounded-[4px] px-1.5 py-0.5 font-medium ${chipClass(item)}`}>
                    {itemText(item)}
                  </span>
                  {item.detail && <span className="mt-1 block text-muted">{item.detail}</span>}
                </span>
                <span className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-subtle">
                  {[shops, LAYER_LABEL[item.layer]].filter(Boolean).join(" · ")}
                </span>
              </span>
            );
            return (
              <li key={item.key}>
                {item.entryId ? (
                  <button
                    type="button"
                    onClick={() => onEntry(item.entryId!)}
                    className="block w-full text-left hover:bg-neutral-100"
                  >
                    {line}
                  </button>
                ) : item.href ? (
                  <Link href={item.href} className="block hover:bg-neutral-100">
                    {line}
                  </Link>
                ) : (
                  line
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
