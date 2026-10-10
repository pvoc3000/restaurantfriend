"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/anchoredPanel";
import { MacTitleBar } from "@/components/ui/MacTitleBar";
import { CalendarGrid } from "@/components/ui/CalendarGrid";
import { monthStart } from "@/lib/dateRange";
import { longDate } from "@/lib/calendar";

/**
 * The day view's date, as a label you press to jump — `MonthJump`'s twin, in
 * the same box, opening the app's own month grid (`ui/CalendarGrid`, the one
 * every date picker draws) so a day is chosen here the way it is everywhere.
 * A tap is the commit.
 */
export function DayJump({
  date,
  today,
  onPick,
}: {
  date: string;
  today: string;
  onPick: (iso: string) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthStart(date));
  const close = useCallback(() => setOpen(false), []);
  const box = useAnchoredPanel({ open, triggerRef, panelRef, onClose: close });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${longDate(date)} — choose another day`}
        onClick={() => {
          setMonth(monthStart(date));
          setOpen((was) => !was);
        }}
        // `MonthJump`'s box and type, wider: "Wednesday, September 30, 2026"
        // is the longest thing it has to hold.
        className="mac-control w-[28rem] max-w-full border border-ink bg-white text-center text-[26px] font-bold leading-[34px] tracking-[-0.02em] hover:bg-neutral-100"
      >
        {longDate(date)}
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Choose a day"
            style={{ top: box.top, left: box.left }}
            className="fixed z-[70] border-2 border-ink bg-white text-ink shadow-[4px_4px_0_0_#000]"
          >
            <MacTitleBar title="Go to day" onClose={close} />
            <div className="p-3">
              <CalendarGrid
                month={month}
                today={today}
                painted={{ from: date, to: date }}
                onMonth={setMonth}
                onTap={(iso) => {
                  close();
                  onPick(iso);
                }}
                autoFocusIso={date}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
