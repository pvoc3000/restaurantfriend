/**
 * A "!" ON A YELLOW FILL beside a tab's label — something on that tab wants
 * reading (Mark, 2026-10-02: a note from an /inquiry on an order's Notes tab).
 * Yellow is a fill here, never an ink, so it reads on the white tab and on the
 * black one alike. `label` is what a screen reader hears instead of the mark.
 */
export function AlertMark({ label }: { label: string }) {
  return (
    <span
      title={label}
      className="inline-flex h-4 min-w-4 items-center justify-center bg-mark-fill px-1 text-[11px] font-bold leading-none text-ink"
    >
      <span aria-hidden>!</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
