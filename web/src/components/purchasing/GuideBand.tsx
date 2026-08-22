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
 * **The tones are not decoration.** Yellow is this app's "worth your eye", and
 * a reminder has earned it: it is dated, it can be overdue, and it is a thing
 * somebody deliberately put in front of you for today. An open request is a
 * TO-DO, not an alarm — it sits until it is answered and nothing about it gets
 * worse at 3pm — so its band is plain and the marks INSIDE it carry what state
 * there is (a high priority, in the same yellow). Painting both bands yellow
 * would spend the alert colour on the half of the screen that is merely a list,
 * which is how a colour stops meaning anything.
 */
export function GuideBand({
  title,
  action,
  tone = "plain",
  children,
}: {
  /** Already pluralised by the caller — it knows its own count. */
  title: string;
  /** A quiet command at the right of the header row. */
  action?: ReactNode;
  tone?: "alert" | "plain";
  children: ReactNode;
}) {
  return (
    <div
      className={`space-y-2 border-2 border-ink px-4 py-3 ${
        tone === "alert" ? "bg-[var(--rf-yellow-200)]" : "bg-white"
      }`}
    >
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

/** What a band says when it has nothing in it but is holding its column open. */
export function BandEmpty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}
