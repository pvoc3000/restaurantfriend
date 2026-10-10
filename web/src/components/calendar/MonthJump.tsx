"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/anchoredPanel";
import { MacTitleBar } from "@/components/ui/MacTitleBar";
import { monthLabel } from "@/lib/dateRange";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STEP =
  "mac-control flex h-8 w-8 items-center justify-center border border-ink bg-white text-lg leading-none hover:bg-neutral-100 any-pointer-coarse:h-11 any-pointer-coarse:w-11";

/**
 * The calendar's month, as a label you press to jump (Mark, 2026-10-10:
 * "clicking on the label of the widget should pop up a box where you can
 * choose the year and month to display").
 *
 * ‹ and › beside it move a month at a time; this is for "next March" — a year
 * to step, twelve months to press, and the press is the commit. The panel is
 * `ui/DateField`'s: a Mac window on `lib/anchoredPanel`, portalled and fixed so
 * nothing can clip it, closed by Escape, a click away or its close box.
 *
 * The year it opens on is the one on screen, and stepping it changes NOTHING
 * until a month is pressed — so looking at 2028 and backing out leaves you
 * where you were.
 */
export function MonthJump({
  month,
  today,
  onPick,
}: {
  /** The first day of the month on screen. */
  month: string;
  today: string;
  /** Called with the first day of the chosen month. */
  onPick: (monthIso: string) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  const close = useCallback(() => setOpen(false), []);
  const box = useAnchoredPanel({ open, triggerRef, panelRef, onClose: close });

  const shownYear = Number(month.slice(0, 4));
  const shownMonth = Number(month.slice(5, 7));
  const thisYear = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${monthLabel(month)} — choose another month`}
        onClick={() => {
          setYear(shownYear);
          setOpen((was) => !was);
        }}
        // The month IS this screen's subject, so it is set at the size of a
        // page title — 26px against the heading's 28. A fixed width, so ‹ and
        // › do not move under the pointer between "May" and "September".
        //
        // BOXED (Mark, 2026-10-10: a border "around the month and year area"):
        // a raised `mac-control` box like the ‹ › beside it, which is also what
        // says it can be pressed. 34px of line inside a 1px border is the
        // arrows' 36, so the three sit level.
        className="mac-control w-[17rem] border border-ink bg-white text-center text-[26px] font-bold leading-[34px] tracking-[-0.02em] hover:bg-neutral-100"
      >
        {monthLabel(month)}
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Choose a month"
            style={{ top: box.top, left: box.left }}
            // Colours stated, not inherited — `position: fixed` moves the box
            // and not its place in the DOM (`ui/DateField`'s note).
            className="fixed z-[70] w-[17rem] border-2 border-ink bg-white text-ink shadow-[4px_4px_0_0_#000]"
          >
            <MacTitleBar title="Go to month" onClose={close} />
            <div className="space-y-3 p-3">
              <div className="flex items-center">
                <button type="button" aria-label="Previous year" onClick={() => setYear((y) => y - 1)} className={STEP}>
                  ‹
                </button>
                <span className="flex-1 text-center text-base font-semibold tabular-nums">{year}</span>
                <button type="button" aria-label="Next year" onClick={() => setYear((y) => y + 1)} className={STEP}>
                  ›
                </button>
              </div>
              {/* `ui/CalendarGrid`'s ruled grid: a hairline of ink between
                  cells, the month on screen filled, this month bold. */}
              <div className="grid grid-cols-3 gap-px border border-ink bg-ink">
                {MONTHS.map((name, i) => {
                  const n = i + 1;
                  const current = year === shownYear && n === shownMonth;
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={current}
                      onClick={() => {
                        close();
                        onPick(`${String(year).padStart(4, "0")}-${String(n).padStart(2, "0")}-01`);
                      }}
                      className={`h-10 text-sm any-pointer-coarse:h-12 any-pointer-coarse:text-base ${
                        current ? "bg-ink font-semibold text-white" : "bg-white text-ink hover:bg-[#c0c0c0]"
                      } ${year === thisYear && n === thisMonth ? "font-bold" : ""}`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
