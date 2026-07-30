"use client";

import { STALE_ORDER, STALE_LABEL, type StaleBucket } from "@/lib/lastOrdered";
import { TextInput } from "@/components/ui/TextInput";

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
        <TextInput
          value={term}
          onValueChange={onTerm}
          placeholder={placeholder}
          clearLabel="Clear the search"
          className="h-9 w-72 text-sm"
        />

        {categories && onCategory && (
          <select
            value={category ?? ""}
            onChange={(e) => onCategory(e.target.value)}
            className="h-9 border border-ink bg-white px-2 text-sm"
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
          // FilterTabs: an underline marker, not a black fill — filters change
          // what you see, commands change the data.
          <div className="flex items-center gap-4 text-[12px] font-semibold uppercase tracking-[0.06em]">
            {ACTIVE_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => onActive(t.key)}
                className={`border-b-2 px-1 pb-0.5 ${
                  active === t.key
                    ? "border-ink text-ink"
                    : "border-transparent text-muted hover:text-ink"
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
          <span className="text-xs uppercase tracking-[0.12em] text-subtle">
            Last ordered
          </span>
          {(["any", ...STALE_ORDER] as StaleFilter[]).map((t) => {
            const count = t === "any" ? totalCount ?? 0 : staleCounts?.[t] ?? 0;
            const label = t === "any" ? "Any age" : STALE_LABEL[t];
            const on = stale === t;
            // "Any age" selected is a neutral black fill; a selected AGE
            // bucket is yellow — the "look at this" accent, since a stale
            // filter is on and hiding everything fresh.
            const selected =
              t === "any"
                ? "border-ink bg-ink text-white"
                : "border-ink bg-[var(--rf-yellow-500)] text-ink";
            return (
              <button
                key={t}
                onClick={() => onStale(t)}
                className={`border px-3 py-1 text-sm ${
                  on
                    ? selected
                    : "border-ink text-body hover:bg-neutral-100"
                }`}
              >
                {label}
                <span className={`ml-1.5 ${on && t === "any" ? "text-white/60" : "text-faint"}`}>
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
