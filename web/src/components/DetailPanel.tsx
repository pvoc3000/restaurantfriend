"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The slide-over shell for detail views opened from within the app (the
 * @panel intercepting routes). The page you were on stays mounted underneath
 * — an 883-line guide keeps its scroll, filter, and search — and the URL is
 * still the detail's own, so refresh or share lands on the dedicated page.
 *
 * Close = router.back(): the panel is a history entry, so Back and the ✕ are
 * the same move. Wide, not centered — these are dense tables, not dialogs.
 */
export function DetailPanel({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // The panel starts exactly below the header, MEASURED rather than assumed:
  // the header wraps to two or three rows on a narrow window, so any hardcoded
  // offset is wrong at some width and silently covers the nav again.
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const measure = () => setHeaderHeight(header.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    // Starts below the sticky header and sits under it (z-40 vs the header's
    // z-50), so the nav stays visible and clickable while a detail is open —
    // clicking a nav link navigates, and the @panel catch-all closes the panel
    // on the way. aria-modal is deliberately absent: this is a slide-over that
    // leaves the app chrome usable, not a modal.
    <div
      className="fixed inset-x-0 bottom-0 z-40"
      style={{ top: headerHeight }}
      role="dialog"
    >
      {/* Backdrop: dim just enough to read "layered", keep the walk visible. */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={() => router.back()}
        aria-hidden
      />
      {/* 75% of the viewport (Mark, 2026-07-23) — full width on phones. The
          sliver of page left visible keeps the "layered" read; the tables
          inside get the room they were designed for. */}
      <div className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl sm:w-3/4">
        <div className="flex items-center justify-end border-b border-neutral-200 px-4 py-2">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Close"
            title="Close (Esc)"
            className="rounded px-2 py-0.5 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
