import type { ReactNode } from "react";

/**
 * The heading over a section of a detail screen — "Per-location config",
 * "Vendor items", "Paperwork".
 *
 * Larger and bold (Mark, 2026-08-01). These were 12px semibold grey, the same
 * size and weight as a table's own column labels, so a heading that owns a
 * whole block of the page read as one more caption inside it. At 16px bold
 * black there's a clear step down from the screen's h1 (28px) and a clear step
 * up from the 11–12px labels underneath, which is the hierarchy a detail screen
 * needs to be skimmable.
 *
 * Tracking eases to 0.08em: the 0.12em the small caps use is there to open up
 * text that's nearly too small to read, and at 16px it just looks loose.
 *
 * A component rather than an exported class string, so `count` has somewhere to
 * live and every section on every detail screen changes together — the same
 * reason `DataTable` and `TabPicker` exist.
 */
export function SectionHeading({
  children,
  count,
}: {
  children: ReactNode;
  /** A tally beside the heading — how many rows the section holds. */
  count?: number;
}) {
  return (
    <h2 className="text-[16px] font-bold uppercase tracking-[0.08em] text-ink">
      {children}
      {count !== undefined && (
        <span className="ml-2 text-[13px] font-normal tracking-normal text-faint normal-case">
          {count}
        </span>
      )}
    </h2>
  );
}
