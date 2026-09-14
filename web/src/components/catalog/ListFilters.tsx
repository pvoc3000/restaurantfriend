"use client";

import { STALE_ORDER, STALE_LABEL, type StaleBucket } from "@/lib/lastOrdered";
import { TextInput } from "@/components/ui/TextInput";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { PickList } from "@/components/ui/PickList";
import { ControlField } from "@/components/ui/ControlField";

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
 * everywhere it is used. Each filter is optional; pass only the ones a screen
 * actually has data for.
 *
 * ONE CAPTIONED ROW OF PICKLISTS (Mark, 2026-09-14), replacing a row of typing
 * controls over a row of two TabPickers: Show and Last ordered sit to the right
 * of Category. A collapsed picker needs its caption — its face shows a value,
 * not what it filters — and `items-end` levels the uncaptioned search box with
 * the fields.
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
    <div className="flex min-w-0 flex-wrap items-end gap-3">
      <TextInput
        value={term}
        onValueChange={onTerm}
        aria-label={placeholder}
        clearLabel="Clear the search"
        search
        icon={<SearchGlyph />}
      />

      {categories && onCategory && (
        <ControlField label="Category">
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
        </ControlField>
      )}

      {active && onActive && (
        <ControlField label="Show">
          <PickList
            variant="field"
            fit
            ariaLabel="Active state"
            value={active}
            onPick={(v) => onActive(v as ActiveFilter)}
            options={ACTIVE_TABS.map((t) => ({ value: t.key, label: t.label }))}
          />
        </ControlField>
      )}

      {stale && onStale && (
        <ControlField label="Last ordered">
          <PickList
            variant="field"
            fit
            ariaLabel="Last ordered"
            value={stale}
            onPick={(v) => onStale(v as StaleFilter)}
            options={(["any", ...STALE_ORDER] as StaleFilter[]).map((t) => ({
              value: t,
              label: t === "any" ? "Any age" : STALE_LABEL[t],
              hint: String(t === "any" ? totalCount ?? 0 : staleCounts?.[t] ?? 0),
            }))}
          />
        </ControlField>
      )}
    </div>
  );
}
