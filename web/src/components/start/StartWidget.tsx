"use client";

import Link from "next/link";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { tintFill, type Span, type TintKey } from "@/lib/startLayout";

/** A widget's width on the grid. One column below `md`; a 3-wide widget is
 *  2-wide where the grid has two. Whole literals, so Tailwind ships them. */
const SPAN_CLASS: Record<Span, string> = {
  1: "",
  2: "md:col-span-2",
  3: "md:col-span-2 xl:col-span-3",
};

/**
 * ONE WIDGET'S FRAME on the desk start page: the 1px black rule the cards
 * always wore, a title that links to the list behind it, and its tint.
 *
 * The frame is the `@container`, so what the body shows follows the tile's
 * real width — a 3-wide widget on a two-column screen reads its width, not its
 * setting.
 *
 * IN EDIT MODE the title stops being a link (a drag that ended on it would
 * navigate), a grip appears before it and the corner ⋯ after it, and the edge
 * gains a dashed outline so the page reads as "being arranged". At rest
 * nothing of that is drawn: the page looks as it did before widgets.
 */
export function StartWidget({
  kind,
  title,
  href,
  span,
  tint,
  editing,
  dimmed,
  onGrip,
  menu,
  children,
}: {
  kind: string;
  title: string;
  href: string;
  span: Span;
  tint: TintKey | null;
  editing: boolean;
  /** The tile being dragged, shown faded where it was. */
  dimmed: boolean;
  onGrip: (event: ReactPointerEvent) => void;
  menu: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-tile={kind} className={`min-w-0 ${SPAN_CLASS[span]} ${dimmed ? "opacity-40" : ""}`}>
      <section
        className={`@container flex h-full flex-col gap-3 border border-ink px-5 py-4 ${tintFill(tint)} ${
          editing ? "outline-1 outline-offset-4 outline-neutral-400 outline-dashed" : ""
        }`}
      >
        <div className="flex min-h-6 items-center gap-2">
          {editing && (
            <button
              type="button"
              aria-label={`Drag to move ${title}`}
              title="Drag to move"
              onPointerDown={onGrip}
              className="-ml-2 grid h-7 w-6 cursor-grab touch-none place-items-center text-[16px] leading-none text-muted hover:bg-neutral-100 hover:text-ink"
            >
              ⠿
            </button>
          )}
          <h2 className="min-w-0 truncate text-[16px] font-bold uppercase tracking-[0.08em]">
            {editing ? (
              title
            ) : (
              <Link href={href} className="text-ink no-underline hover:underline">
                {title}
              </Link>
            )}
          </h2>
          {editing && <span className="-my-2 -mr-3 ml-auto">{menu}</span>}
        </div>
        {children}
      </section>
    </div>
  );
}
