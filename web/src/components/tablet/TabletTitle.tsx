"use client";

import { usePathname } from "next/navigation";

import { tabletTitle } from "@/lib/tablet/landing";

/** The screen's name, centred in the bar — the menu's own label for it. */
export function TabletTitle() {
  const pathname = usePathname();
  const title = tabletTitle(pathname);
  return (
    <h1 className="min-w-0 flex-1 truncate text-center text-[16px] font-bold uppercase tracking-[0.08em] text-white">
      {title}
    </h1>
  );
}
