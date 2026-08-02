"use client";

import { STALE_ORDER, STALE_LABEL, type StaleBucket } from "@/lib/lastOrdered";
import { TextInput } from "@/components/ui/TextInput";
import { TabPicker } from "@/components/ui/TabPicker";
import { PickList } from "@/components/ui/PickList";

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
    // `w-fit` so the block is exactly as wide as its widest row — the controls
    // below — and `max-w-full` so it still gives way on a narrow screen. That's
    // what lets the stale bar match the row above it (Mark, 2026-08-01): the
    // wrapper takes the top row's width and the bar fills the wrapper, with no
    // measuring and no magic number to keep in step.
    <div className="w-fit max-w-full space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          value={term}
          onValueChange={onTerm}
          placeholder={placeholder}
          clearLabel="Clear the search"
          className="h-9 w-72 text-sm"
        />

        {categories && onCategory && (
          <PickList
            variant="field"
            ariaLabel="Category"
            value={category ?? ""}
            onPick={onCategory}
            options={[
              { value: "", label: "All categories" },
              ...categories.map((c) => ({ value: c, label: c })),
            ]}
            className="w-56"
          />
        )}

        {active && onActive && (
          <TabPicker
            ariaLabel="Active state"
            value={active}
            onChange={onActive}
            options={ACTIVE_TABS}
          />
        )}
      </div>

      {/* No "Last ordered" caption (Mark, 2026-08-01): every cell already says
          an age — "Never ordered", "2+ years", "Within a year" — so the label
          was repeating what the bar spells out. It survives as the group's
          `ariaLabel`, which is the reader who genuinely can't see the cells. */}
      {stale && onStale && (
        <TabPicker
          stretch
          ariaLabel="Last ordered"
          value={stale}
          onChange={onStale}
          options={(["any", ...STALE_ORDER] as StaleFilter[]).map((t) => ({
            key: t,
            label: t === "any" ? "Any age" : STALE_LABEL[t],
            count: t === "any" ? totalCount ?? 0 : staleCounts?.[t] ?? 0,
          }))}
        />
      )}
    </div>
  );
}
