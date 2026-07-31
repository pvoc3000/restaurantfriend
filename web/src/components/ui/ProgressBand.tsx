/**
 * Something slow is happening on a screen that is already on screen.
 *
 * `PageLoading` covers the wait BEFORE a route paints; this covers the wait
 * after, and the case that forced it is having an invoice read — an Opus call
 * over a document that runs 30 seconds or more. That used to be a word inside a
 * button's label, which is indistinguishable from nothing happening (Mark,
 * 2026-07-31: "there's no clear indication that something is happening").
 *
 * A BAND and not a `ui/Dialog`, deliberately: the point of reading the invoice
 * is to receive the delivery, and a modal would stop you counting for half a
 * minute to watch a bar. Nothing behind it is disabled except the controls that
 * would collide with the work in flight.
 *
 * Same indeterminate bar as PageLoading, which is the one place the design
 * system's "no spinners, no skeletons" is relaxed — it says "still going"
 * without claiming to know how far along it is.
 */
export function ProgressBand({ label, note }: { label: string; note?: string }) {
  return (
    <div role="status" aria-live="polite" className="border border-ink px-4 py-3">
      <div className="h-0.5 w-full overflow-hidden bg-hairline">
        <div className="rf-progress-bar h-full w-1/4 animate-[rf-progress-slide_1.1s_linear_infinite] bg-ink" />
      </div>
      <p className="mt-3 text-[12px] uppercase tracking-[0.12em] text-ink">{label}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}
