"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * PAINTING WEEKDAYS (Mark, 2026-09-18: "clicking and holding on a day, then
 * swiping across other days toggles the first day and makes the swiped over
 * days match it").
 *
 * The pure half. `withDay` sets one weekday on or off and keeps the array
 * sorted, which is the canonical stored shape. `paintStroke` is the whole
 * gesture as arithmetic: the FIRST day of a stroke decides the target (the
 * opposite of what it was) and every day the stroke has crossed, the first
 * included, is set to it — so a stroke starting on an ON day switches the days
 * it crosses OFF, and one starting on an OFF day switches them ON. Crossing a
 * day twice changes nothing; a day the stroke never touched is untouched.
 */
export function withDay(days: number[], weekday: number, on: boolean): number[] {
  const has = days.includes(weekday);
  if (on === has) return days;
  return on
    ? [...days, weekday].sort((a, b) => a - b)
    : days.filter((d) => d !== weekday);
}

/**
 * The days a stroke covers moving from `from` to `to`, `from` excluded. The
 * strip is LINEAR, so a pointer that was over Tuesday and is now over Friday
 * went across Wednesday and Thursday whether or not a sample landed on them —
 * a fast flick on a touch screen delivers a handful of moves for the whole
 * strip and can skip a day between two of them. Filling the span is what makes
 * a swipe mean "these days" rather than "the days the samples happened to hit".
 */
export function spanDays(from: number, to: number): number[] {
  const step = to > from ? 1 : -1;
  const out: number[] = [];
  for (let d = from + step; step > 0 ? d <= to : d >= to; d += step) out.push(d);
  return out;
}

export function paintStroke(days: number[], crossed: number[]): number[] {
  if (crossed.length === 0) return days;
  const target = !days.includes(crossed[0]);
  return crossed.reduce((acc, wd) => withDay(acc, wd, target), days);
}

/** The attribute a day button carries so a stroke can find it under the pointer. */
export const DAY_ATTR = "data-weekday";

/**
 * The hook. Renders `days` while idle and the stroke's draft while painting;
 * commits ONCE, on release, with the painted array — one write for a swipe
 * across five days rather than five, which is what `WeekdayPicker`'s array
 * write and the favorites strip's insert-and-delete both want.
 *
 * Pointer events, never mouse or touch handlers: one code path for the desk and
 * the iPad. The button that took the press CAPTURES the pointer, so the moves
 * keep arriving at it wherever the finger goes, and the day under the pointer
 * is read with `elementFromPoint` off `DAY_ATTR` — the buttons are siblings, so
 * no event ever bubbles from one to another.
 *
 * A keyboard "click" (Enter or Space) has no pointer sequence, so the button's
 * `onClick` still toggles for `e.detail === 0` and ignores the pointer's own
 * click, which the press already answered. A `pointercancel` (the browser took
 * the touch for a scroll) DISCARDS the draft: nothing was released, so nothing
 * is written.
 */
export function useDayPaint({
  days,
  disabled,
  commit,
}: {
  days: number[];
  disabled: boolean;
  commit: (next: number[]) => void;
}) {
  const [draft, setDraft] = useState<number[] | null>(null);
  const stroke = useRef<{ pointerId: number; crossed: number[] } | null>(null);

  const cross = useCallback(
    (weekday: number) => {
      const s = stroke.current;
      if (!s) return;
      const last = s.crossed[s.crossed.length - 1];
      const reached = last === undefined ? [weekday] : spanDays(last, weekday);
      const fresh = reached.filter((d) => !s.crossed.includes(d));
      if (fresh.length === 0) return;
      s.crossed.push(...fresh);
      setDraft(paintStroke(days, s.crossed));
    },
    [days]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, weekday: number) => {
      if (disabled || stroke.current) return;
      // A right or middle button is not a press on a day.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault(); // no text selection while dragging across labels
      e.currentTarget.setPointerCapture(e.pointerId);
      stroke.current = { pointerId: e.pointerId, crossed: [] };
      cross(weekday);
    },
    [disabled, cross]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      const s = stroke.current;
      if (!s || e.pointerId !== s.pointerId) return;
      const under = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>(`[${DAY_ATTR}]`);
      const wd = under ? Number(under.getAttribute(DAY_ATTR)) : NaN;
      if (Number.isInteger(wd)) cross(wd);
    },
    [cross]
  );

  const end = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, write: boolean) => {
      const s = stroke.current;
      if (!s || e.pointerId !== s.pointerId) return;
      stroke.current = null;
      const next = paintStroke(days, s.crossed);
      setDraft(null);
      if (write && next !== days) commit(next);
    },
    [days, commit]
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => end(e, true),
    [end]
  );
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => end(e, false),
    [end]
  );

  /** Keyboard only — a pointer's click was answered by its press. */
  const onKeyboardClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, weekday: number) => {
      if (disabled || e.detail !== 0) return;
      commit(withDay(days, weekday, !days.includes(weekday)));
    },
    [disabled, days, commit]
  );

  /** Spread onto each day button, with `DAY_ATTR` set to its weekday. */
  function dayProps(weekday: number) {
    return {
      [DAY_ATTR]: weekday,
      onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => onPointerDown(e, weekday),
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => onKeyboardClick(e, weekday),
    };
  }

  return { shown: draft ?? days, painting: draft !== null, dayProps };
}
