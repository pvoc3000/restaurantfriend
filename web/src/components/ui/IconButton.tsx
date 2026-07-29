import Link from "next/link";

// Square icon controls for the masthead's utility cluster — the old system's
// home and gear, the two of its four icons that survive on the web (its back
// button is the browser's, and its record navigator has no found set to walk).
//
// These are the first drawn marks in the product: everything else is type or a
// glyph. Kept in the system's idiom — 16px, currentColor, 1.5px square-capped
// strokes, no fill, no radius — so they read as rules rather than as pictures.

export function HomeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden focusable="false">
      <path
        d="M2 6.5 8 2l6 4.5V14H2V6.5Z M6.25 14V9.25h3.5V14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
        <circle cx="8" cy="8" r="2.25" />
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06" />
      </g>
    </svg>
  );
}

/**
 * A 24px square target around a 16px icon. `title` as well as `aria-label`:
 * with no text beside them these need a hover explanation, not only a
 * screen-reader one.
 */
export function IconButton({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="grid h-6 w-6 place-items-center text-white/60 no-underline hover:text-white"
    >
      {children}
    </Link>
  );
}
