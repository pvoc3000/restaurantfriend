"use client";

import { STALE_ORDER, STALE_LABEL, type StaleBucket } from "@/lib/lastOrdered";

export type ActiveFilter = "active" | "inactive" | "all";
export type StaleFilter = StaleBucket | "any";

export const ACTIVE_TABS: { key: ActiveFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "all", label: "All" },
];

/**
 * The catalog filter bar — search, category, active state, last-ordered age.
 * Rendered identically wherever it appears so the controls mean the same thing
 * on Inventory and on a vendor's item list. Each filter is optional; pass only
 * the ones a screen actually has data for.
 */
export function ListFilters({
  term,
  onTerm,
  placeholder = "Search…",
  categories,
  category,
  onCategory,
  active,
  onActive,
  stale,
  onStale,
  staleCounts,
  totalCount,
}: {
  term: string;
  onTerm: (value: string) => void;
  placeholder?: string;
  categories?: string[];
  category?: string;
  onCategory?: (value: string) => void;
  active?: ActiveFilter;
  onActive?: (value: ActiveFilter) => void;
  stale?: StaleFilter;
  onStale?: (value: StaleFilter) => void;
  staleCounts?: Record<string, number>;
  totalCount?: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={term}
          onChange={(e) => onTerm(e.target.value)}
          placeholder={placeholder}
          className="w-72 rounded border border-neutral-300 px-2 py-1 text-sm"
        />

        {categories && onCategory && (
          <select
            value={category ?? ""}
            onChange={(e) => onCategory(e.target.value)}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        {active && onActive && (
          <div className="flex items-center gap-1 text-sm">
            {ACTIVE_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => onActive(t.key)}
                className={`rounded px-2 py-1 ${
                  active === t.key
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {stale && onStale && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-neutral-400">
            Last ordered
          </span>
          {(["any", ...STALE_ORDER] as StaleFilter[]).map((t) => {
            const count = t === "any" ? totalCount ?? 0 : staleCounts?.[t] ?? 0;
            const label = t === "any" ? "Any age" : STALE_LABEL[t];
            const on = stale === t;
            return (
              <button
                key={t}
                onClick={() => onStale(t)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  on
                    ? "border-amber-700 bg-amber-700 text-white"
                    : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                {label}
                <span className={`ml-1.5 ${on ? "text-amber-200" : "text-neutral-400"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
