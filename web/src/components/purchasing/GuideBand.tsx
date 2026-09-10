import type { ReactNode } from "react";

/**
 * ONE FRAME FOR THE TWO BANDS ABOVE THE ORDER GUIDE — what's due, and what the
 * shop has asked for (Mark, 2026-08-22: "let's try splitting it into two
 * columns, one for the reminders, and the other for purchase requests").
 *
 * It exists because they sit SIDE BY SIDE. Two hand-rolled frames a column
 * apart is the `ui/Dialog` story again — they drift, and here the drift is
 * measured in pixels the reader can see in one glance, because the two rules
 * are supposed to read as one line across the screen.
 *
 * **NO BORDER, A YELLOW FILL, AND NO BAND AT ALL WHEN THE LIST IS EMPTY**
 * (Mark, 2026-09-10: "remove the borders around the reminders and requests
 * areas. Use a yellow fill instead, but only when there is a reminder or
 * request to display", then "if there are no reminders or requests, you don't
 * need to say it on screen"). So every band that renders has something in it,
 * and the callers return null for an empty list.
 */
export function GuideBand({
  title,
  action,
  children,
}: {
  /** Already pluralised by the caller — it knows its own count. */
  title: string;
  /** A quiet command at the right of the header row. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 bg-[var(--rf-yellow-200)] px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink">
          {title}
        </h2>
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * The quiet command in a band's header, and the one under it when a band has
 * nothing to show. Shared so "Add reminder" and "All requests" cannot come out
 * two different weights beside each other.
 *
 * Two inks, because the bands have two grounds: on the yellow one a
 * `text-subtle` grey goes muddy.
 */
export const BAND_LINK_CLASS =
  "text-[12px] uppercase tracking-[0.12em] underline underline-offset-[3px]";
export const BAND_LINK_ON_ALERT = `${BAND_LINK_CLASS} text-ink decoration-neutral-500 hover:decoration-ink`;
export const BAND_LINK_ON_PLAIN = `${BAND_LINK_CLASS} text-subtle decoration-neutral-400 hover:decoration-neutral-900`;
