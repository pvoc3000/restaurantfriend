"use client";

import Link from "next/link";
import { useRecordPosition } from "@/lib/recordSet";

/**
 * FileMaker's book, on a detail screen: |‹ ‹ 4 of 61 › ›|
 *
 * It walks the FOUND SET — the rows the list you came from is showing, in the
 * order it's showing them (see `lib/recordSet`). Going back to the list to open
 * the next record is the thing this exists to stop, and the count is half the
 * point: it tells you how much of the pile is left, which is why it's stated
 * rather than implied by the buttons greying out.
 *
 * It renders NOTHING when there's no found set — a pasted URL, a reload, or a
 * record reached from somewhere that isn't a list. That's deliberate: a book
 * that walks a set you can't see is worse than no book.
 */
export function RecordNav({ listKey, id }: { listKey: string | null; id: string }) {
  const position = useRecordPosition(listKey, id);
  if (!position) return null;

  return (
    <nav
      aria-label="Record navigation"
      className="flex shrink-0 items-center gap-1 tabular-nums"
    >
      <Step href={position.first} label="First record" glyph={FIRST_PAGE} />
      <Step href={position.previous} label="Previous record" glyph={CHEVRON_LEFT} />
      <span className="px-1 text-[11px] uppercase tracking-[0.12em] text-subtle">
        {position.index} of {position.total}
      </span>
      <Step href={position.next} label="Next record" glyph={CHEVRON_RIGHT} />
      <Step href={position.last} label="Last record" glyph={LAST_PAGE} />
    </nav>
  );
}

/**
 * Material Symbols Outlined at wght 300 (Apache 2.0), the same source and the
 * same weight as the Columns eye — asked for by Mark (2026-07-31) once he saw
 * that these four had shipped as TYPED CHARACTERS (`|‹ ‹ › ›|`, angle quotation
 * marks beside a pipe) while the eye was real artwork. Two families of arrow in
 * one app is the sort of thing you can't unsee, and a quotation mark pressed
 * into service as an arrow never quite sits on the baseline anyway.
 *
 * `first_page` / `chevron_left` / `chevron_right` / `last_page` — the canonical
 * four for exactly this control, and the same shapes FMP's book used.
 */
const FIRST_PAGE = "M250-250v-460h60v460h-60Zm430-3.85L453.85-480 680-706.15 722.15-664l-184 184 184 184L680-253.85Z";
const CHEVRON_LEFT = "M560-253.85 333.85-480 560-706.15 602.15-664l-184 184 184 184L560-253.85Z";
const CHEVRON_RIGHT = "m517.85-480-184-184L376-706.15 602.15-480 376-253.85 333.85-296l184-184Z";
const LAST_PAGE = "M280-253.85 237.85-296l184-184-184-184L280-706.15 506.15-480 280-253.85ZM650-250v-460h60v460h-60Z";

/**
 * One of the four. At the ends of the set it stays in place as a dead button
 * rather than disappearing — the cluster keeping its shape is what makes it
 * readable at a glance, and a control that moves as you page through it is the
 * thing you end up mis-clicking.
 *
 * These keep their boxes where the Columns eye has none, and the difference is
 * the job: that one is a quiet view control you touch now and then, this is a
 * cluster of four you press repeatedly and at the ends of which two must read
 * as unavailable. A border is what makes "dead" visible.
 */
function Step({
  href,
  label,
  glyph,
}: {
  href: string | null;
  label: string;
  glyph: string;
}) {
  // 1.5px, the receiving steppers' weight (Mark, 2026-07-31: "a bit heavier").
  // BOTH states carry it, live and dead — a border that changed width between
  // them would move the other three buttons by a pixel as you paged to an end,
  // which is the one thing this cluster must never do. The dead one says so in
  // colour instead.
  const shape = "grid h-8 w-8 place-items-center border-[1.5px]";
  if (!href) {
    return (
      <span aria-hidden="true" className={`${shape} border-hairline text-faint`}>
        <Glyph path={glyph} />
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`${shape} border-ink text-ink no-underline transition-colors hover:bg-ink hover:text-white`}
    >
      <Glyph path={glyph} />
    </Link>
  );
}

/** 20px inside a 32px box — the eye's 24-in-32 proportion would leave these
 *  arrows touching their borders, since an arrow fills its box edge to edge
 *  where an eye sits in the middle of one. `currentColor`, so the hover invert
 *  carries the glyph with it. */
function Glyph({ path }: { path: string }) {
  return (
    <svg width="20" height="20" viewBox="0 -960 960 960" aria-hidden="true">
      <path fill="currentColor" d={path} />
    </svg>
  );
}
