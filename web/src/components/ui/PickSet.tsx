"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MENU_CARET,
  MENU_ITEM_CLASS,
  MENU_PANEL_CLASS,
  menuItemState,
  useAnchoredPanel,
} from "@/lib/anchoredPanel";
import { Checkbox } from "@/components/ui/Checkbox";
import { BOXED_FIELD_BORDER } from "./fieldMetrics";

export type PickSetOption = {
  value: string;
  label: string;
  /** Said quietly beside the label — a count, a shop's full name. */
  hint?: string;
};

/**
 * CHOOSING SEVERAL THINGS FROM A KNOWN VOCABULARY — `PickList`'s plural.
 *
 * Built as a SIBLING over `lib/anchoredPanel` rather than by teaching PickList
 * a second mode, which is `MenuButton`'s precedent and its argument: that file
 * is 507 lines with `value: string | null` and `onPick: (next: string)` running
 * through all of it, and a union type on both would touch every one of its
 * callers to serve one screen. What is genuinely worth sharing is the panel —
 * two-pass placement, the flip near the foot of the window, closing on a scroll
 * that is not its own, `z-[70]` so a dialog cannot cover it — and that is
 * exactly what the hook and the MENU_* classes already are.
 *
 * WHY NOT A `TabPicker`. That control is the app's one-of-N, and it is right
 * until the vocabulary outgrows a row: `/sales` began with two shops and now
 * has five, so the bar was six cells wide and could only ever say ONE of them.
 * A set is a different question and gets a different control.
 *
 * AN EMPTY SET MEANS ALL, which is `lib/filterMenus`' `FILTER_ALL` convention
 * in a plural form. Unticking the last option therefore widens the view rather
 * than emptying the screen — a filter that can hide everything is one people
 * get stuck inside, and "none" is not a question anybody asks of a shop filter.
 * The trigger says "All shops" so the state is never a mystery.
 */
export function PickSet({
  options,
  value,
  onChange,
  allLabel,
  label,
  noun,
  disabled = false,
  align = "left",
  boxed = false,
  minWidth = 220,
  className = "",
}: {
  options: PickSetOption[];
  /** The chosen values. EMPTY MEANS ALL — see above. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** What the trigger says when nothing is chosen — "All shops". */
  allLabel: string;
  /** What this picker is FOR, for screen readers. */
  label: string;
  /** Pluralised in the trigger past two — "3 shops". */
  noun: string;
  disabled?: boolean;
  /**
   * The detail-field dress: a hairline that blackens on hover, instead of the
   * standing black rule a filter row wants. `ui/PickList`'s prop, same name and
   * same meaning, so a column holding one of each matches.
   */
  boxed?: boolean;
  align?: "left" | "right";
  minWidth?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const box = useAnchoredPanel({ open, triggerRef, panelRef, align, onClose: close });

  const chosen = options.filter((o) => value.includes(o.value));

  // NAMES UP TO TWO, COUNTS PAST THAT. "DF01 + DF02" is worth the width because
  // it answers the question outright; "DF01 + DF02 + DF03 + EVENT" is a wall
  // that pushes the rest of the filter row around every time you tick one more.
  const summary =
    chosen.length === 0
      ? allLabel
      : chosen.length <= 2
        ? chosen.map((o) => o.label).join(" + ")
        : `${chosen.length} ${noun}`;

  function toggle(v: string) {
    // The panel STAYS OPEN — picking several things is the whole point, and a
    // panel that shut on each tick would make choosing three a three-gesture
    // job. It closes by clicking away, pressing Escape, or the trigger again,
    // all of which `useAnchoredPanel` already handles.
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        // `boxed` is `ui/PickList`'s prop, doing PickList's job, so the two
        // read as one control when they sit in the same column: a FILTER row
        // wants the black rule its neighbours have, a detail FIELD wants the
        // hairline that blackens on hover. Mark, 2026-08-29 — Works at and
        // Role were a black border beside a grey one.
        //
        // THE GREY WASH ON HOVER IS THE APP'S ONE "you can press this" CUE, and
        // this control shipped without it (Mark, 2026-09-04: Kind "fills grey
        // and the border becomes black", Shifts only got the border). A border
        // that darkens is the BOXED dress's own resting cue and says nothing
        // about pressing — every button and every `PickList` trigger fills.
        //
        // `w-full` when boxed, for the other half of the same report ("not as
        // wide as the other fields"): a boxed field fills its track, which is
        // what `BOXED_FIELD` says and what every `InlineValue` beside this one
        // does. Unboxed it stays content-sized, because a filter row packs its
        // controls rather than stretching them.
        className={`flex h-9 items-center gap-2 bg-white px-3 text-[13px] hover:bg-neutral-100 disabled:opacity-40 ${
          boxed ? `${BOXED_FIELD_BORDER} w-full` : "border border-ink"
        } ${className}`}
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden className="ml-auto shrink-0 text-[9px] text-muted">
          {MENU_CARET}
        </span>
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-multiselectable
            aria-label={label}
            style={{
              top: box.top,
              left: box.left,
              ...(align === "right" ? { transform: "translateX(-100%)" } : {}),
              // A DEFINITE width, not a min-width, and that is the fix for a
              // real bug rather than a preference. `MENU_ITEM_CLASS` carries
              // `w-full`, and a percentage width inside a SHRINK-TO-FIT fixed
              // panel is circular — the browser resolved it against an
              // ancestor and every row came out 468px wide on ~87px of
              // content. Given a definite width the percentage has something
              // to resolve against.
              //
              // Clamped like PickList's, and for its reason: wide enough for
              // the longest code, capped so a wide trigger cannot drag a list
              // of five short labels out to a third of the screen.
              width: Math.min(Math.max(box.width, minWidth), 320),
            }}
            className={MENU_PANEL_CLASS}
          >
            {/* The explicit way back to everything. Ticked when nothing is,
                because that IS the state — not a command that clears, which
                would read as an action among a list of values. */}
            <Checkbox
              size={18}
              checked={value.length === 0}
              onChange={() => onChange([])}
              className={`${MENU_ITEM_CLASS} w-full ${menuItemState(value.length === 0)}`}
            >
              <span>{allLabel}</span>
            </Checkbox>

            <div className="my-1 border-t border-hairline" />

            {options.map((o) => {
              const on = value.includes(o.value);
              return (
                <Checkbox
                  key={o.value}
                  size={18}
                  checked={on}
                  onChange={() => toggle(o.value)}
                  className={`${MENU_ITEM_CLASS} w-full ${menuItemState(on)}`}
                >
                  <span>{o.label}</span>
                  {o.hint && <span className="ml-auto pl-3 text-xs text-muted">{o.hint}</span>}
                </Checkbox>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
