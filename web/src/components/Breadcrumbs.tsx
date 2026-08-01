import Link from "next/link";
import type { Crumb } from "@/lib/breadcrumbs";

/**
 * The path you took to get here. The last crumb is the current page and isn't a
 * link; everything before it is, so any step is one click away — including the
 * vendor you came through, which the browser Back button is otherwise the only
 * way to reach.
 *
 * `trailing` is the row's right-hand end, and it exists for the record book
 * (`ui/RecordNav`). The two belong on one line: this trail says which pile
 * you're in, the book says where in the pile — and putting the book anywhere
 * else would have it move about from screen to screen, since no two detail
 * bodies share a first row.
 */
export function Breadcrumbs({
  trail,
  current,
  trailing,
}: {
  trail: Crumb[];
  current: string;
  trailing?: React.ReactNode;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-4 text-[12px] uppercase tracking-[0.12em]"
    >
      <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-3 text-subtle">
        {/* Keyed by POSITION, not href. A trail follows the route you took, and
            a route can legitimately revisit a page — vendor → item → that same
            vendor — so hrefs are not unique and keying on one makes React drop
            a crumb. The list is short, ordered, and never reordered in place,
            which is exactly when an index key is the right one. */}
        {trail.map((crumb, i) => (
          <li key={`${i}-${crumb.href}`} className="flex items-center gap-3">
            <Link
              href={crumb.href}
              className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
            >
              {crumb.label}
            </Link>
            <span aria-hidden className="text-neutral-300">
              /
            </span>
          </li>
        ))}
        <li className="max-w-xs truncate text-body" aria-current="page">
          {current}
        </li>
      </ol>
      {trailing}
    </nav>
  );
}
