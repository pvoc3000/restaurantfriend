import Link from "next/link";
import type { Crumb } from "@/lib/breadcrumbs";

/**
 * The path you took to get here. The last crumb is the current page and isn't a
 * link; everything before it is, so any step is one click away — including the
 * vendor you came through, which the browser Back button is otherwise the only
 * way to reach.
 */
export function Breadcrumbs({ trail, current }: { trail: Crumb[]; current: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="text-[12px] uppercase tracking-[0.12em]"
    >
      <ol className="flex flex-wrap items-center gap-3 text-subtle">
        {trail.map((crumb) => (
          <li key={crumb.href} className="flex items-center gap-3">
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
    </nav>
  );
}
