import Link from "next/link";

/**
 * A glyph that goes to the record a field POINTS AT — the inventory item a
 * vendor item or a production element is linked to (Mark, 2026-10-01: "add
 * the 'open' button to the right of it. Make the 'open' button a glyph").
 *
 * A separate control rather than the field itself, `TakenBy`'s reasoning: the
 * field's job is to change the answer, this one's is to go and read it.
 *
 * IT HANGS OUTSIDE THE FIELD'S COLUMN, so the field is exactly as wide as its
 * neighbours: the caller wraps the field in `relative` and this positions
 * itself just past that wrapper's right edge. A flex sibling would take its
 * width out of the field, which is what the "Open" word did.
 *
 * The arrow is drawn in `IconButton`'s idiom — 16px, currentColor, 1.5px
 * square-capped strokes — inside a target the field's own 36px tall, and it
 * fills grey on hover like every control you press.
 */
export function OpenRecordLink({
  href,
  label,
  placement = "outside",
}: {
  href: string;
  label: string;
  /**
   * `outside` hangs past a `relative` wrapper's right edge — a detail record's
   * field. `inline` is a flex sibling, 24px, for a TABLE cell (Mark,
   * 2026-10-01, the vendor items grid's Item column), where outside would be
   * on top of the next column.
   */
  placement?: "outside" | "inline";
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`grid shrink-0 place-items-center text-muted no-underline transition-colors hover:bg-neutral-100 hover:text-ink ${
        placement === "outside"
          ? "absolute left-full top-1/2 ml-1 h-9 w-8 -translate-y-1/2"
          : "h-6 w-6"
      }`}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden focusable="false">
        <path
          d="M4.5 11.5 11.5 4.5 M6 4.5h5.5V10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </svg>
    </Link>
  );
}
