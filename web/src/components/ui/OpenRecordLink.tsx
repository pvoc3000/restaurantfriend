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
export function OpenRecordLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="absolute left-full top-1/2 ml-1 grid h-9 w-8 -translate-y-1/2 place-items-center text-muted no-underline transition-colors hover:bg-neutral-100 hover:text-ink"
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
