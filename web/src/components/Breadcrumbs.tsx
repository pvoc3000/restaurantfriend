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
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1 text-neutral-500">
        {trail.map((crumb) => (
          <li key={crumb.href} className="flex items-center gap-1">
            <Link href={crumb.href} className="text-blue-700 hover:underline">
              {crumb.label}
            </Link>
            <span aria-hidden className="text-neutral-300">
              /
            </span>
          </li>
        ))}
        <li className="max-w-xs truncate text-neutral-700" aria-current="page">
          {current}
        </li>
      </ol>
    </nav>
  );
}
