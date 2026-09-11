"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/anchoredPanel";
import {
  formatRange,
  matchingPreset,
  monthStart,
  normalizeRange,
  resolvePreset,
  type DateRange,
  type RangePresetSpec,
} from "@/lib/dateRange";
import { formatTypedDate, parseTypedDate } from "@/lib/dateInput";
import { CalendarIcon } from "@/components/ui/DateField";
import { CalendarGrid } from "@/components/ui/CalendarGrid";
import { BOXED_FIELD_BORDER } from "@/components/ui/fieldMetrics";
import { MacTitleBar } from "@/components/ui/MacTitleBar";

/**
 * A RANGE of dates, for filtering a list by them (Mark, 2026-09-08).
 *
 * At rest it is a boxed field with a calendar glyph, the dress `DateField`
 * wears `boxed` — so beside a search box and a date box it reads as the same
 * kind of thing. Pressed, it opens a panel: a calendar on the LEFT with a Start
 * and an End box under it, and a column of preset buttons on the RIGHT. A
 * preset sets the range in one tap; the calendar sets it in two — the first tap
 * is the start, the second the end — and either way THE MOMENT THE RANGE IS
 * COMPLETE the picker applies it and closes. There is no OK button, because
 * there is nothing left to say.
 *
 * THE TWO BOXES ARE THE CALENDAR'S TWO TAPS, TYPED (Mark, 2026-09-10: "the
 * user should be able to enter dates directly into the rangepicker"). They read
 * `lib/dateInput`, so they take exactly what every `DateField` takes, and they
 * commit on blur or Enter for `DateField`'s reason — `9/1/2026` passes through
 * `9/` on its way to being a date. Committing START is the first tap: the
 * calendar turns to that month and waits for an end. Committing END with a
 * start in place is the second tap, and applies — on Enter always, and on
 * leaving the box only when the range has actually CHANGED, or tabbing through
 * an untouched pair would close the panel under you. Enter in Start applies too
 * when End already holds a date. Unreadable text puts the box back and writes
 * nothing. A calendar tap writes its date into the box, so the two routes are
 * one state and never disagree.
 *
 * WHICH PRESETS is the caller's, per instance: `presets` names them in the
 * order they should read, from `lib/dateRange`'s vocabulary or as the
 * caller's own `RangePreset` for a word that vocabulary lacks.
 *
 * `today` is PASSED IN and is the org's calendar day (`lib/today`) — the
 * presets are functions of it, and a "Today" computed off the browser's clock
 * on a UTC host is the drift that module exists to keep out.
 *
 * Two things the calendar does that are easy to lose in a rewrite:
 *
 * TWO TAPS IN EITHER ORDER MAKE A RANGE. Tapping the 8th and then the 1st is
 * the 1st to the 8th, not a refusal — `normalizeRange` — because a person
 * reaching for "last week" from its end is not making a mistake. Typed dates
 * the wrong way round are swapped the same way.
 *
 * A HALF-PICKED RANGE IS ABANDONED ON CLOSE, never applied. Escape, a click
 * away or a scroll leaves the stored value exactly as it was; the caller only
 * ever hears a finished pair. What that costs is that a first tap and then a
 * wander off is a tap lost, which is the cheaper of the two mistakes.
 *
 * The panel portals and positions through `useAnchoredPanel`, so it escapes
 * scroll panes, flips above the field near the foot of the window and closes
 * on scroll — `PickList`'s own behaviour, not re-derived.
 */
export function RangePicker({
  value,
  onChange,
  presets,
  today,
  ariaLabel,
  placeholder = "Any date",
  clearable = true,
  disabled = false,
  boxed = false,
  className = "",
}: {
  /** The range in force, or null for no filter. */
  value: DateRange | null;
  /** Fires once, with a finished range — or null when the ✕ clears it. */
  onChange: (next: DateRange | null) => void;
  /** The buttons down the right, in reading order. */
  presets: readonly RangePresetSpec[];
  /** The org's calendar day, ISO. */
  today: string;
  ariaLabel: string;
  /** What the field says with no range set. */
  placeholder?: string;
  /** Offer a ✕ that sets the value back to null. */
  clearable?: boolean;
  disabled?: boolean;
  /**
   * `PickSet`'s prop and its two dresses: a FILTER ROW wants the standing
   * black rule the search box and the vendor picker wear (the default — Mark,
   * 2026-09-08: "a solid border"), a detail FIELD wants the hairline that
   * blackens on hover.
   */
  boxed?: boolean;
  /** For width — the box is `w-full` of whatever it is put in. */
  className?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  /** The month the grid shows, as any ISO day inside it. */
  const [month, setMonth] = useState(() => monthStart(value?.to ?? today));
  /** The first tap (or a committed Start), while waiting for the end. */
  const [start, setStart] = useState<string | null>(null);
  /** The day under the pointer, so the range-to-be shows before the second tap. */
  const [hover, setHover] = useState<string | null>(null);
  /** What the two boxes last COMMITTED to — the dates behind the text. */
  const [draftFrom, setDraftFrom] = useState<string | null>(null);
  const [draftTo, setDraftTo] = useState<string | null>(null);
  /** What the two boxes say right now, which may be half-typed. */
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");

  const close = useCallback(() => {
    setOpen(false);
    setStart(null);
    setHover(null);
  }, []);

  const box = useAnchoredPanel({ open, triggerRef, panelRef, onClose: close });

  const openPanel = () => {
    // Open on the month the range ENDS in, else today's. The end, not the
    // start: a "90 days" window starts three months back, and a calendar
    // opening on June when you came to tap a day this week is a page-turn
    // before every custom range. For every preset the end IS today.
    setMonth(monthStart(value?.to ?? today));
    setStart(null);
    setHover(null);
    setDraftFrom(value?.from ?? null);
    setDraftTo(value?.to ?? null);
    setFromText(formatTypedDate(value?.from ?? null));
    setToText(formatTypedDate(value?.to ?? null));
    setOpen(true);
  };

  const apply = (next: DateRange | null) => {
    onChange(next);
    close();
  };

  const tapDay = (iso: string) => {
    if (start === null) {
      setStart(iso);
      setDraftFrom(iso);
      setFromText(formatTypedDate(iso));
      setDraftTo(null);
      setToText("");
      return;
    }
    // The second tap fills End too (Mark, 2026-09-10: "clicking on a date in
    // the calendar should enter it into the corresponding date box"). Both
    // boxes follow the SORTED pair, so tapping the 8th then the 1st reads
    // Start 1st · End 8th, which is the range that is applied.
    const next = normalizeRange(start, iso);
    setDraftFrom(next.from);
    setFromText(formatTypedDate(next.from));
    setDraftTo(next.to);
    setToText(formatTypedDate(next.to));
    apply(next);
  };

  /** Read the Start box. `enter` is whether this came from the Enter key. */
  const commitFrom = (enter: boolean) => {
    const parsed = parseTypedDate(fromText);
    if (parsed.status === "invalid") {
      setFromText(formatTypedDate(draftFrom));
      return;
    }
    const iso = parsed.status === "empty" ? null : parsed.iso;
    setFromText(formatTypedDate(iso));
    if (enter && iso !== null && draftTo !== null) {
      apply(normalizeRange(iso, draftTo));
      return;
    }
    if (iso !== draftFrom) {
      setDraftFrom(iso);
      setStart(iso);
      if (iso !== null) setMonth(monthStart(iso));
    }
    // Enter with no end yet is "next box", the order the two are read in.
    if (enter) endRef.current?.focus();
  };

  /** Read the End box — the second tap. */
  const commitTo = (enter: boolean) => {
    const parsed = parseTypedDate(toText);
    if (parsed.status === "invalid") {
      setToText(formatTypedDate(draftTo));
      return;
    }
    const iso = parsed.status === "empty" ? null : parsed.iso;
    setToText(formatTypedDate(iso));
    if (iso !== null && draftFrom !== null) {
      const next = normalizeRange(draftFrom, iso);
      const unchanged = value !== null && next.from === value.from && next.to === value.to;
      if (enter || !unchanged) {
        apply(next);
        return;
      }
    }
    if (iso !== draftTo) {
      setDraftTo(iso);
      if (iso !== null) setMonth(monthStart(iso));
    }
  };

  const preset = matchingPreset(value, presets, today);
  // A preset's NAME where the range is one — "All time" for a null value if
  // the caller offers such a preset — else the dates, else the placeholder.
  const face = preset?.label ?? (value ? formatRange(value) : null);

  /**
   * What the grid paints as the range: the pending pair while picking (the
   * pointer standing in for the end, else a typed End), else the two boxes,
   * else the value.
   */
  const painted: DateRange | null =
    start !== null
      ? normalizeRange(start, hover ?? draftTo ?? start)
      : draftFrom !== null && draftTo !== null
        ? normalizeRange(draftFrom, draftTo)
        : value;

  return (
    <>
      <span
        // `h-9`, not `BOXED_FIELD`'s `min-h-9`: this box never wraps, and a
        // minimum lets the 36px button inside push the border out to 38 —
        // measured 2px taller than the PickSet beside it. 36 is the app's own
        // button height (`BUTTON_CLASS`), which is what a filter row lines up on.
        className={`flex h-9 w-full items-center ${
          // The filter-row dress carries the Mac look (`styles/mac-look.css`);
          // the boxed detail-field dress does not.
          boxed ? `rf-press ${BOXED_FIELD_BORDER}` : "mac-control border border-ink"
        } bg-white ${
          disabled ? "opacity-35" : ""
        } ${className}`}
      >
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => (open ? close() : openPanel())}
          className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-sm hover:bg-neutral-100 disabled:hover:bg-white"
        >
          <span className={`min-w-0 flex-1 truncate tabular-nums ${face ? "" : "text-faint"}`}>
            {face ?? placeholder}
          </span>
          {/* The glyph rides inside the button: on a range field the whole box
              is the control, and a second button for "open the calendar"
              beside one that opens the calendar is two ways to do one thing. */}
          <span className="shrink-0 text-muted">
            <CalendarIcon />
          </span>
        </button>
        {clearable && value && !disabled && (
          <button
            type="button"
            aria-label={`Clear ${ariaLabel}`}
            title="Clear"
            // `TextInput`'s ✕: untabbable, so Tab goes to the next filter.
            tabIndex={-1}
            onClick={() => onChange(null)}
            className="h-full shrink-0 px-2 text-xs text-muted hover:text-ink"
          >
            ✕
          </button>
        )}
      </span>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={ariaLabel}
            style={{ top: box.top, left: box.left }}
            // Layout only — the colours are stated here, not inherited:
            // `position: fixed` moves the box and not its place in the DOM, so
            // a trigger sitting in a black band would otherwise paint white
            // type into this panel (the Generate-POs lesson).
            // A Mac window (Mark, 2026-09-10): `ui/TimePicker`'s frame, hard
            // shadow and ruled title bar. The close box is a close — a
            // half-picked range is abandoned, as on any other way out.
            className="fixed z-[70] border-2 border-ink bg-white text-ink whitespace-normal shadow-[4px_4px_0_0_#000]"
          >
            <MacTitleBar
              title={ariaLabel.charAt(0).toUpperCase() + ariaLabel.slice(1)}
              onClose={close}
            />
            <div className="flex gap-4 p-3">
            <div className="w-[15.5rem] shrink-0 any-pointer-coarse:w-[21rem]">
              <CalendarGrid
                month={month}
                today={today}
                painted={painted}
                onMonth={setMonth}
                onTap={tapDay}
                onHover={setHover}
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <TypedDate
                  label="Start"
                  ariaLabel={`${ariaLabel}, start date`}
                  text={fromText}
                  onText={setFromText}
                  onCommit={commitFrom}
                />
                <TypedDate
                  ref={endRef}
                  label="End"
                  ariaLabel={`${ariaLabel}, end date`}
                  text={toText}
                  onText={setToText}
                  onCommit={commitTo}
                />
              </div>
            </div>
            {/* gap-2, not gap-1: each preset is raised on a 3px shadow, and
                4px between them left the shadow touching the next button. */}
            <div className="flex w-40 shrink-0 flex-col gap-2" role="group" aria-label="Preset ranges">
              {presets.map((spec) => {
                const p = resolvePreset(spec);
                const current = preset?.key === p.key && start === null;
                return (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={current}
                    onClick={() => apply(p.range(today))}
                    // The app's one button weight (`BUTTON_CLASS` at h-8 and
                    // left-aligned) in the Mac look, with the range in force
                    // marked the way a set filter is: filled black, keeping its
                    // own hover (`mac-own-hover`) so it never greys out.
                    className={`mac-control inline-flex h-8 items-center whitespace-nowrap border border-ink px-3 any-pointer-coarse:h-11 text-[12px] font-semibold uppercase tracking-[0.06em] ${
                      current ? "mac-own-hover bg-ink text-white" : "bg-white text-ink"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * One typed end of the range, captioned the way a filter row captions a
 * control (`ui/ControlField`'s dress). 16px type, because below it iOS Safari
 * zooms the page when a field takes focus — and a zoom counts as a scroll to
 * nothing here, but it does to the reader.
 */
function TypedDate({
  ref,
  label,
  ariaLabel,
  text,
  onText,
  onCommit,
}: {
  ref?: React.Ref<HTMLInputElement>;
  label: string;
  ariaLabel: string;
  text: string;
  onText: (next: string) => void;
  onCommit: (enter: boolean) => void;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="text-xs uppercase tracking-[0.12em] text-subtle">{label}</span>
      <input
        ref={ref}
        type="text"
        value={text}
        aria-label={ariaLabel}
        autoComplete="off"
        // Not `inputMode="numeric"` — `DateField`'s reason: iOS's digit pad
        // has no `/`.
        placeholder="mm/dd/yyyy"
        onChange={(e) => onText(e.target.value)}
        onBlur={() => onCommit(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(true);
          }
        }}
        // `ui/TimePicker`'s entry-box dress: a 1px black edge that reads 2px
        // under the pointer and while typing, drawn inside so nothing moves.
        className="h-9 w-full min-w-0 border border-ink bg-white px-2 any-pointer-coarse:h-11 text-[16px] tabular-nums outline-none placeholder:text-faint hover:shadow-[inset_0_0_0_1px_#000] focus:shadow-[inset_0_0_0_1px_#000]"
      />
    </span>
  );
}
