"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { MENU_ITEM_CLASS, MENU_PANEL_CLASS, useAnchoredPanel } from "@/lib/anchoredPanel";
import { Checkbox } from "@/components/ui/Checkbox";

/**
 * OTHER THINGS A TABLE SHOWS THAT ARE NOT COLUMNS — a second button beside the
 * columns eye, with its own glyph and its own checklist (Mark, 2026-10-10, on
 * the special orders list's calendar bands: blackout dates, notes, subscribed
 * calendars).
 *
 * THEY WERE IN THE EYE FOR A DAY, under a heading at the bottom of its menu,
 * and outgrew it: every column, two commands, a heading, three kinds and then
 * a line per subscribed calendar. Sharing also needed two rules to stop the
 * halves blurring — "Show all" meaning columns only, the eye going black for
 * columns only. Two buttons need neither: the eye is columns, this is whatever
 * the caller names it.
 *
 * So it is the eye's twin and behaves like it: the same 32px square, the same
 * panel, INK when something is hidden and muted when nothing is — which gives
 * a hidden calendar the visible trace it did not have.
 *
 * ALWAYS DRAWN. A button that comes and goes with the data is a button people
 * stop trusting; when there is nothing to choose between, `note` says so in
 * the menu instead.
 *
 * The caller owns the state and where it is stored; this only draws it.
 */
export type ChooserExtras = {
  /** What the button is, for its tooltip and a screen reader — "Calendar". */
  label: string;
  /** The 24px glyph. */
  icon: ReactNode;
  items: {
    key: string;
    label: string;
    on: boolean;
    onToggle: (next: boolean) => void;
    /** A CHILD of the item above it — drawn indented beneath it. */
    nested?: boolean;
    /** Shown but not changeable — a child whose parent is switched off. */
    disabled?: boolean;
  }[];
  /**
   * SWITCHES THAT ARE NOT THINGS TO SHOW, under a rule of their own (Mark,
   * 2026-10-13, "Active Days Only") — off at rest, where an item is on, so one
   * left off is not counted as something hidden. One switched ON does turn the
   * button ink: it is narrowing what the list shows.
   */
  options?: { key: string; label: string; on: boolean; onToggle: (next: boolean) => void }[];
  /** A line under the checklist — "Nothing from the calendar in these dates". */
  note?: string | null;
  /** Where the thing itself lives — "Open calendar". */
  link?: { label: string; href: string };
};

export function ExtrasMenu({ extras }: { extras: ChooserExtras }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const box = useAnchoredPanel({ open, triggerRef, panelRef, align: "right", onClose: close });

  // A disabled child is off because its PARENT is, which is already counted.
  const hidden = extras.items.filter((i) => !i.on && !i.disabled).length;
  const narrowed = hidden > 0 || (extras.options ?? []).some((o) => o.on);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={extras.label}
        onClick={() => setOpen((v) => !v)}
        title={hidden > 0 ? `${extras.label} — ${hidden} hidden` : `${extras.label} — choose what this list shows`}
        // `ColumnsMenu`'s trigger, class for class.
        className={`grid h-8 w-8 shrink-0 place-items-center transition-colors hover:bg-neutral-100 hover:text-ink ${
          narrowed ? "text-ink" : "text-muted"
        }`}
      >
        {extras.icon}
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={extras.label}
            style={{ top: box.top, left: box.left, transform: "translateX(-100%)", minWidth: 240 }}
            className={MENU_PANEL_CLASS}
          >
            {extras.items.map((item) => (
              <label
                key={item.key}
                // A nested item is indented under its parent by exactly a
                // checkbox and its gap, so its box sits under the parent's
                // label and the pair reads as one thing with parts.
                className={`${MENU_ITEM_CLASS} flex items-center gap-3 ${item.nested ? "pl-10" : ""} ${
                  item.disabled ? "text-faint" : "cursor-pointer hover:bg-neutral-100"
                }`}
              >
                <Checkbox
                  checked={item.on}
                  disabled={item.disabled}
                  onChange={() => item.onToggle(!item.on)}
                  label={`Show ${item.label}`}
                />
                <span className="min-w-0 truncate">{item.label}</span>
              </label>
            ))}
            {extras.options?.map((option, i) => (
              <label
                key={option.key}
                className={`${MENU_ITEM_CLASS} flex cursor-pointer items-center gap-3 hover:bg-neutral-100 ${
                  i === 0 ? "border-t border-hairline" : ""
                }`}
              >
                <Checkbox
                  checked={option.on}
                  onChange={() => option.onToggle(!option.on)}
                  label={option.label}
                />
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            ))}
            {extras.note && (
              <p className="border-t border-hairline px-3 py-2 text-[12px] text-muted">{extras.note}</p>
            )}
            {extras.link && (
              <Link
                href={extras.link.href}
                onClick={close}
                className="block w-full border-t border-hairline px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink hover:bg-neutral-100"
              >
                {extras.link.label}
              </Link>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * A calendar with one day marked — "things on particular days" (Mark chose it
 * from eight, 2026-10-10). The mark is what tells it from the plain calendar
 * on every date field, which means "pick a date"; this one never does.
 *
 * Material Symbols' `event` at `wght300` — THE EYE'S OWN WEIGHT. It shipped as
 * the classic filled `event`, whose 2px strokes sat visibly heavier beside the
 * eye's 1.5 (Mark, the same day). A Material weight is a different PATH, not a
 * stroke width, so matching a neighbour means fetching the same weight's
 * artwork — `ColumnsIcon` says the same.
 */
export function CalendarEventIcon() {
  return (
    <svg width="24" height="24" viewBox="0 -960 960 960" aria-hidden="true">
      <path
        fill="currentColor"
        d="M522.27-266.88q-26.88-26.89-26.88-65.43 0-38.54 26.88-65.42 26.88-26.88 65.42-26.88 38.54 0 65.43 26.88Q680-370.85 680-332.31q0 38.54-26.88 65.43Q626.23-240 587.69-240q-38.54 0-65.42-26.88ZM212.31-100Q182-100 161-121q-21-21-21-51.31v-535.38Q140-738 161-759q21-21 51.31-21h55.38v-84.61h61.54V-780h303.08v-84.61h60V-780h55.38Q778-780 799-759q21 21 21 51.31v535.38Q820-142 799-121q-21 21-51.31 21H212.31Zm0-60h535.38q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46v-375.38H200v375.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85ZM200-607.69h560v-100q0-4.62-3.85-8.46-3.84-3.85-8.46-3.85H212.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v100Zm0 0V-720v112.31Z"
      />
    </svg>
  );
}
