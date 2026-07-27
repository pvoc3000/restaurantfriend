/**
 * What a screen shows while its server component is still working.
 *
 * This exists because the guide's first paint is ~3.5s of server time (five
 * sequential Supabase round trips, one of them 877 rows), and until a route
 * has a `loading.tsx` Next holds the PREVIOUS page on screen for that whole
 * wait with no acknowledgement that the click landed. A `loading.tsx` re-exports
 * this and the navigation becomes instant.
 *
 * Deliberately not a skeleton: fake rows imply a shape we don't know yet, and
 * the design system rules them out. A rule, a moving bar, and the name of what
 * you're waiting for.
 */
export function PageLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite">
      <div className="h-0.5 w-full overflow-hidden bg-hairline">
        <div className="rf-progress-bar h-full w-1/4 animate-[rf-progress-slide_1.1s_linear_infinite] bg-ink" />
      </div>
      <p className="mt-4 text-[12px] uppercase tracking-[0.12em] text-muted">
        Loading {label}&hellip;
      </p>
    </div>
  );
}
