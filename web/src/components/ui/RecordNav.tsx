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
      <Step href={position.first} label="First record" glyph="|‹" />
      <Step href={position.previous} label="Previous record" glyph="‹" />
      <span className="px-1 text-[11px] uppercase tracking-[0.12em] text-subtle">
        {position.index} of {position.total}
      </span>
      <Step href={position.next} label="Next record" glyph="›" />
      <Step href={position.last} label="Last record" glyph="›|" />
    </nav>
  );
}

/**
 * One of the four. At the ends of the set it stays in place as a dead button
 * rather than disappearing — the cluster keeping its shape is what makes it
 * readable at a glance, and a control that moves as you page through it is the
 * thing you end up mis-clicking.
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
  const shape =
    "grid h-8 min-w-8 place-items-center border px-1 text-[13px] leading-none";
  if (!href) {
    return (
      <span aria-hidden="true" className={`${shape} border-hairline text-faint`}>
        {glyph}
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
      {glyph}
    </Link>
  );
}
