"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/items", label: "Inventory" },
  { href: "/vendors", label: "Vendors" },
  { href: "/cleanup", label: "Cleanup" },
];

/**
 * Header nav with the current section marked. Detail routes count as their
 * section — /items/<id> keeps Inventory lit — so the match is a prefix test for
 * everything except Home, which would otherwise match every page.
 */
export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-3 text-sm">
      {NAV.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "font-semibold text-neutral-900 underline decoration-neutral-900 decoration-2 underline-offset-8"
                : "text-neutral-600 hover:text-neutral-900 hover:underline hover:underline-offset-8"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
