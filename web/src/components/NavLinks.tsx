"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/order-guide", label: "Order guide" },
  { href: "/items", label: "Inventory" },
  { href: "/vendors", label: "Vendors" },
  { href: "/purchase-orders", label: "Orders" },
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
            // A bottom BORDER, not text-decoration: Safari places an
            // underline-offset rule inconsistently against the header's own
            // border and it can vanish. The transparent border on inactive
            // links keeps every item the same height.
            className={`border-b-2 pb-0.5 ${
              active
                ? "border-neutral-900 font-semibold text-neutral-900"
                : "border-transparent text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
