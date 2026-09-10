"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { useRecordNavSeat } from "@/lib/recordNavSlot";
import { carryQuery, useRecordPosition } from "@/lib/recordSet";
import { BAR_CELL, BAR_CELL_DEAD } from "./barCell";
import {
  BarLabel,
  ICON_CHEVRON_LEFT,
  ICON_CHEVRON_RIGHT,
  ICON_FIRST_PAGE,
  ICON_LAST_PAGE,
} from "./BarLabel";

/**
 * The record book, in the bar. `ui/RecordNav` on the page publishes which
 * list and which record (`lib/recordNavSlot`) and renders nothing under the
 * tablet shell; this reads the seat and walks the same found set through the
 * same `useRecordPosition` and `carryQuery`, so the book behaves identically —
 * the tab you are on is kept, the ends go dead in place — at a size a thumb
 * can use. Absent entirely when no page has taken the seat, or the seat has
 * no found set (a pasted URL): a book that walks a set you cannot see is
 * worse than no book.
 */
export function BarRecordNav() {
  const seat = useRecordNavSeat();
  const current = useSearchParams();
  const position = useRecordPosition(seat?.listKey ?? null, seat?.id ?? "");
  if (!seat || !position) return null;

  const step = (href: string | null) => (href ? carryQuery(href, current, seat.carry) : null);

  return (
    <nav aria-label="Record navigation" className="flex items-center tabular-nums">
      <Cell href={step(position.first)} label="First" icon={ICON_FIRST_PAGE} />
      <Cell href={step(position.previous)} label="Previous" icon={ICON_CHEVRON_LEFT} />
      <span className="px-2 text-[12px] font-bold uppercase tracking-[0.08em] text-white/70">
        {position.index} of {position.total}
      </span>
      <Cell href={step(position.next)} label="Next" icon={ICON_CHEVRON_RIGHT} />
      <Cell href={step(position.last)} label="Last" icon={ICON_LAST_PAGE} />
    </nav>
  );
}

function Cell({ href, label, icon }: { href: string | null; label: string; icon: string }) {
  if (!href) {
    return (
      <span aria-hidden="true" className={BAR_CELL_DEAD}>
        <BarLabel icon={icon} word={label} />
      </span>
    );
  }
  return (
    <Link href={href} className={BAR_CELL}>
      <BarLabel icon={icon} word={label} />
    </Link>
  );
}
