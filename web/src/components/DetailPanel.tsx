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
export function DetailPanel({
  typeLabel,
  children,
}: {
  typeLabel: string;
  children: React.ReactNode;
}) {
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
      {/* Backdrop: dim the page hard enough to read "layered", no blur. */}
      <div
        className="absolute inset-0 bg-black/55"
        onClick={() => router.back()}
        aria-hidden
      />
      {/* Wide and edge-anchored — dense tables, not a dialog. Full width on
          phones; the sliver of page left visible keeps the "layered" read.
          Depth is edges, never a shadow: 2px black on the left against the
          dimmed page, 2px grey on top so the type strip doesn't merge into
          the black masthead directly above it (Mark, 2026-07-25). */}
      <div className="absolute inset-y-0 right-0 flex w-full flex-col border-l-2 border-t-2 border-l-ink border-t-subtle bg-white sm:w-[68%]">
        {/* The black strip carries the record TYPE — the panel hides
            breadcrumbs, so this is the only cue to what kind of record is
            open. */}
        <div className="flex items-center justify-between gap-4 bg-ink px-6 py-3 text-white">
          <span className="text-[12px] uppercase tracking-[0.12em] text-white/60">
            {typeLabel}
          </span>
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Close"
            title="Close (Esc)"
            className="px-1 text-[17px] leading-none text-white hover:text-white/70"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>
  );
}
