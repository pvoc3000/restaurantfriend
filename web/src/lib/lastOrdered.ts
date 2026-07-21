// Last-ordered triage (brief §B). Buckets a per-location last-order date into
// staleness bands so the cleanup queue can filter "dead" catalog Mark can
// bulk-deactivate instead of hand-fixing.

export type StaleBucket = "never" | "over2y" | "1to2y" | "within1y";

export const STALE_ORDER: StaleBucket[] = ["never", "over2y", "1to2y", "within1y"];

export const STALE_LABEL: Record<StaleBucket, string> = {
  never: "Never ordered",
  over2y: "2+ years",
  "1to2y": "1–2 years",
  within1y: "Within a year",
};

/**
 * `lastOrderDate` is a YYYY-MM-DD string (or null = never ordered here).
 * `today` is passed in so the server computes it once per render.
 */
export function staleBucket(lastOrderDate: string | null, today: Date): StaleBucket {
  if (!lastOrderDate) return "never";

  const d = Date.parse(`${lastOrderDate}T00:00:00Z`);
  const oneYearAgo = Date.UTC(
    today.getUTCFullYear() - 1,
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const twoYearsAgo = Date.UTC(
    today.getUTCFullYear() - 2,
    today.getUTCMonth(),
    today.getUTCDate()
  );

  if (d < twoYearsAgo) return "over2y";
  if (d < oneYearAgo) return "1to2y";
  return "within1y";
}
