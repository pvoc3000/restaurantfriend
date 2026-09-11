"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/anchoredPanel";
import {
  composeTime,
  formatTypedTime,
  parseTypedTime,
  timeParts,
  type Meridiem,
} from "@/lib/timeInput";
import { BOXED_FIELD, BOXED_FIELD_BORDER } from "@/components/ui/fieldMetrics";
import { MacTitleBar } from "@/components/ui/MacTitleBar";

/** A clock, drawn in `DateField`'s calendar glyph's own dress. */
export function ClockIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.25V8l2.5 1.75" />
    </svg>
  );
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const pad = (n: number) => String(n).padStart(2, "0");

/** The panel's own buttons — the Mac look's raised dress. */
const PANEL_BUTTON =
  "mac-control inline-flex h-9 shrink-0 items-center justify-center border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink any-pointer-coarse:h-11";

/**
 * A TIME OF DAY, CHOSEN FROM A SMALL MAC WINDOW OR TYPED (Mark, 2026-09-10:
 * "let's create our own time picker control that fits this macos design
 * aesthetic. make sure to have a field at the bottom of it where the user can
 * enter a time directly").
 *
 * The box shows the time in twelve-hour form beside a clock. Pressing it opens
 * an anchored panel — a classic ruled Mac title bar, a 2px frame and the
 * calculator's hard shadow — holding a grid of hours, a grid of minutes in fives, AM/PM, and at
 * the bottom a field that takes ANY time typed (`lib/timeInput`: `9:30p`,
 * `2130`, `noon`), which is also how a minute off the five-minute grid is
 * reached. The grids are ruled in black like a classic Mac list, the chosen cell
 * filled black.
 *
 * ------------------------------------------------------------------------
 * WHEN IT COMMITS. A time is three choices, so a pick is a DRAFT rather than a
 * write — committing each would write 3:00 AM on the way to 3:30 PM. The draft
 * is committed by Set, by Enter in the field, and by CLICKING AWAY, which is
 * `ui/CalcPad`'s rule: leaving is the commit, so picks are never lost to a
 * click on the next field. ESCAPE is the one way out that discards.
 *
 * ESCAPE IS HEARD IN THE CAPTURE PHASE, and that is load-bearing. The panel hook
 * closes on a `window` keydown in the bubble phase, and closing commits — so
 * the discard has to happen first. A handler on the panel is not enough: in
 * Safari clicking a button does not focus it, so after tapping an hour the
 * keydown's target is the body and never passes through the panel.
 *
 * The draft lives in a REF as well as state, because the close is fired from
 * the hook's listener and must read the draft as of that instant, not as of the
 * render that created the callback.
 */
export function TimePicker({
  value,
  onChange,
  disabled = false,
  required = false,
  ariaLabel,
  boxed = false,
  className = "",
}: {
  /** `HH:MM` or `HH:MM:SS` (what a Postgres `time` column reads back), or null. */
  value: string | null;
  /** Fires with a finished `HH:MM`, or null for a cleared time. */
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /** A required time offers no Clear and does not accept an empty field. */
  required?: boolean;
  ariaLabel: string;
  /** Wear the shared bounding box — `DateField`'s own `boxed`. */
  boxed?: boolean;
  className?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const stored = timeParts(value) ? value!.trim().slice(0, 5) : null;

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(stored);
  const [typed, setTyped] = useState("");
  const [typedBad, setTypedBad] = useState(false);
  const draftRef = useRef<string | null>(stored);

  // The newest props, for the close that the hook fires from outside React.
  const latest = useRef({ stored, onChange });
  useEffect(() => {
    latest.current = { stored, onChange };
  });

  const setBoth = (next: string | null) => {
    draftRef.current = next;
    setDraft(next);
    setTyped(formatTypedTime(next));
    setTypedBad(false);
  };

  const commitAndClose = useCallback(() => {
    setOpen(false);
    const next = draftRef.current;
    if (next !== latest.current.stored) latest.current.onChange(next);
  }, []);

  // Escape discards — see the header for why this is CAPTURE. It is DECLARED
  // BEFORE the panel hook, too: a key event dispatched at `window` itself runs
  // its listeners in the order they were added, capture or not, so registering
  // after the hook would let its close (and so the commit) go first.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") draftRef.current = latest.current.stored;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const box = useAnchoredPanel({
    open,
    triggerRef,
    panelRef,
    onClose: commitAndClose,
  });

  const openPanel = () => {
    setBoth(stored);
    setOpen(true);
  };

  /** A cell: change one part, keep the other two (noon when nothing is set). */
  const pick = (change: { hour12?: number; minute?: number; meridiem?: Meridiem }) => {
    const base = timeParts(draftRef.current ?? "12:00")!;
    const next = composeTime(
      change.hour12 ?? base.hour12,
      change.minute ?? base.minute,
      change.meridiem ?? base.meridiem
    );
    if (next) setBoth(next);
  };

  /** The field, as typed. A readable time becomes the draft at once, so a click
   *  away commits it even before the field has blurred. */
  const type = (text: string) => {
    setTyped(text);
    setTypedBad(false);
    const parsed = parseTypedTime(text);
    if (parsed.status === "time") {
      draftRef.current = parsed.hhmm;
      setDraft(parsed.hhmm);
    } else if (parsed.status === "empty" && !required) {
      draftRef.current = null;
      setDraft(null);
    }
  };

  const enter = () => {
    const parsed = parseTypedTime(typed);
    if (parsed.status === "time" || (parsed.status === "empty" && !required)) {
      draftRef.current = parsed.status === "time" ? parsed.hhmm : null;
      commitAndClose();
    } else {
      setTypedBad(true);
    }
  };

  const parts = timeParts(draft);
  const cell = (selected: boolean) =>
    `flex h-8 items-center justify-center text-[13px] tabular-nums any-pointer-coarse:h-11 any-pointer-coarse:text-[15px] ${
      selected ? "bg-ink font-semibold text-white" : "bg-white text-ink hover:bg-[#c0c0c0]"
    }`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? commitAndClose() : openPanel())}
        className={`items-center gap-2 px-1 py-0.5 text-left tabular-nums hover:bg-neutral-100 disabled:opacity-35 ${
          boxed ? `rf-typed flex ${BOXED_FIELD_BORDER} ${BOXED_FIELD}` : "inline-flex"
        } ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate ${stored ? "" : "text-faint"}`}>
          {stored ? formatTypedTime(stored) : boxed ? " " : "—"}
        </span>
        <span className="text-muted">
          <ClockIcon />
        </span>
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`Choose ${ariaLabel}`}
            style={{ top: box.top, left: box.left }}
            // Colours stated, not inherited — `DateField`'s panel note.
            className="fixed z-[70] w-[17rem] whitespace-normal border-2 border-ink bg-white text-ink shadow-[4px_4px_0_0_#000] any-pointer-coarse:w-[21rem]"
          >
            {/* The close box does what a click away does — `ui/CalcPad`'s close
                box rule — so it commits. */}
            <MacTitleBar
              title={ariaLabel.charAt(0).toUpperCase() + ariaLabel.slice(1)}
              onClose={commitAndClose}
            />
            <div className="space-y-3 p-3">
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">
                  Hour
                </div>
                <div role="group" aria-label="Hour" className="grid grid-cols-6 gap-px border border-ink bg-ink">
                  {HOURS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={parts?.hour12 === h}
                      onClick={() => pick({ hour12: h })}
                      className={cell(parts?.hour12 === h)}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">
                  Minute
                </div>
                <div role="group" aria-label="Minute" className="grid grid-cols-6 gap-px border border-ink bg-ink">
                  {MINUTES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={parts?.minute === m}
                      onClick={() => pick({ minute: m })}
                      className={cell(parts?.minute === m)}
                    >
                      {pad(m)}
                    </button>
                  ))}
                </div>
              </div>
              <div role="group" aria-label="AM or PM" className="grid grid-cols-2 gap-px border border-ink bg-ink">
                {(["am", "pm"] as const).map((md) => (
                  <button
                    key={md}
                    type="button"
                    aria-pressed={parts?.meridiem === md}
                    onClick={() => pick({ meridiem: md })}
                    className={cell(parts?.meridiem === md)}
                  >
                    {md.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* THE ENTRY FIELD — any time, typed. 16px, the threshold below
                  which iOS Safari zooms the page on focus. */}
              <div className="border-t border-ink pt-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={typed}
                    onChange={(e) => type(e.target.value)}
                    onBlur={() => {
                      const parsed = parseTypedTime(typed);
                      if (parsed.status === "time") setTyped(formatTypedTime(parsed.hhmm));
                      else if (parsed.status === "invalid") setTypedBad(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        enter();
                      }
                    }}
                    aria-label={`Type ${ariaLabel}`}
                    aria-invalid={typedBad}
                    placeholder="9:30 PM"
                    autoComplete="off"
                    className={`h-9 min-w-0 flex-1 border bg-white px-2 text-[16px] tabular-nums outline-none placeholder:text-faint hover:shadow-[inset_0_0_0_1px_#000] focus:shadow-[inset_0_0_0_1px_#000] any-pointer-coarse:h-11 ${
                      typedBad ? "border-accent" : "border-ink"
                    }`}
                  />
                  {!required && draft !== null && (
                    <button type="button" onClick={() => type("")} className={PANEL_BUTTON}>
                      Clear
                    </button>
                  )}
                  <button type="button" onClick={commitAndClose} className={PANEL_BUTTON}>
                    Set
                  </button>
                </div>
                {typedBad && (
                  <p className="mt-1 text-[12px] text-accent">Type a time like 9:30 PM or 21:30.</p>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
