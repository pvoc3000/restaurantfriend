"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/vendors", label: "Vendors" },
  { href: "/items", label: "Inventory" },
  { href: "/order-guide", label: "Order Guide" },
  { href: "/purchase-orders", label: "POs" },
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
    <nav className="flex items-center gap-6 text-[12px] font-semibold uppercase tracking-[0.06em]">
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
            className={`border-b-2 pb-0.5 no-underline ${
              active
                ? "border-[var(--rf-yellow-500)] text-[var(--rf-yellow-500)]"
                : "border-transparent text-white/70 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
