"use client";

import type { ReactNode } from "react";
import { PickList } from "@/components/ui/PickList";
import {
  FILTER_ALL,
  activeFilterCount,
  clearedFilters,
  filterCounts,
  type FilterDimension,
  type FilterValues,
} from "@/lib/filterMenus";

/**
 * A ROW OF POPUP MENUS THAT COMBINE — the app's second filter idiom, for a list
 * with more than one question to ask of it (Mark, 2026-08-09).
 *
 * Reach for `ui/TabPicker` while a list filters on ONE dimension: every option
 * is on screen, the set one is black, and choosing costs no clicks. Reach for
 * this when there are three or more. Fifteen cells across four wrapped rows
 * cannot be read at a glance, which is the thing a TabPicker is for, and no
 * number of them can express "uncosted AND on the weekly bake" — a TabPicker
 * holds one answer, and these are an AND.
 *
 * Each menu is a `PickList variant="field"`, so this introduces no new control:
 * same panel, same keyboard, same searchable-past-eight-options, same 36px box
 * as the search field beside it.
 *
 * THREE THINGS IT DOES THAT A ROW OF HAND-WIRED PICKLISTS WOULDN'T, each
 * answering a way a popup menu is worse than a visible row of chips:
 *
 * 1. **"All" is supplied, never declared.** A dimension lists what it filters
 *    TO; the unset option is this component's business. A caller that forgot
 *    it would ship a filter you cannot take off.
 *
 * 2. **Counts ride on the options**, conditioned on the other menus
 *    (`filterCounts`). With one TabPicker the counts were decoration; with four
 *    combining menus they are how you find out that a combination is empty
 *    BEFORE you pick it and stare at a blank list.
 *
 * 3. **The result count and a Clear are part of the bar.** A collapsed menu
 *    hides its own state — four of them can narrow a list to nothing while the
 *    screen looks unfiltered — so the bar always says how many of how many, and
 *    offers one gesture back. That is the same failure the empty-table fix was
 *    about: never leave someone looking at nothing with no way out.
 */
export function FilterMenus<T>({
  rows,
  dimensions,
  values,
  onChange,
  total,
  noun = "rows",
  leading,
  trailing,
}: {
  /**
   * The rows BEFORE these menus, but after anything else that narrows the list
   * — the search box, typically. Passing the pre-search rows would make the
   * counts disagree with the list under them.
   */
  rows: T[];
  dimensions: FilterDimension<T>[];
  values: FilterValues;
  onChange: (next: FilterValues) => void;
  /** The unfiltered population, for "158 of 470". Defaults to `rows`. */
  total?: number;
  /** Plural, lower case: "elements". Only ever read in that sentence. */
  noun?: string;
  /**
   * Goes at the head of the menu row — the list's search box, in practice.
   *
   * It belongs INSIDE this component rather than beside it because the summary
   * line below has to span the whole row: a search box laid out as a sibling of
   * this block would be bottom-aligned against that line instead of against the
   * menus, and the row would come out visibly crooked. Owning the row is also
   * what lets a caller wrap the whole filter bar in one thing.
   */
  leading?: ReactNode;
  /**
   * RIGHT-ALIGNED at the end of the menu row — the list's create command, in
   * practice ("New special order").
   *
   * The same slot and the same reasoning as `EmployeesList`, which had it
   * before this control existed: a list's create command belongs in its filter
   * row (CLAUDE.md's create template), and it is `ml-auto shrink-0` so it hugs
   * the right edge and, when the row wraps, goes with the last line rather
   * than being crushed between two menus.
   *
   * Deliberately NOT the place for a view control — those are menus, and a
   * menu goes in `dimensions` where its count can be conditioned like every
   * other one.
   */
  trailing?: ReactNode;
}) {
  const counts = filterCounts(rows, dimensions, values);
  const active = activeFilterCount(dimensions, values);
  const shown = rows.filter((row) =>
    dimensions.every((d) => {
      const chosen = values[d.key] ?? FILTER_ALL;
      return chosen === FILTER_ALL || d.matches(row, chosen);
    })
  ).length;
  const population = total ?? rows.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        {leading}
        {dimensions.map((dimension) => {
          const forThis = counts[dimension.key] ?? {};
          return (
            // The label sits ABOVE the menu, which is the rule a filter's
            // caption already follows here (the inventory list's "Last
            // ordered"): beside it, each menu would start at a different left
            // edge and the row would stop reading as a row.
            <div key={dimension.key} className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                {dimension.label}
              </span>
              <PickList
                variant="field"
                ariaLabel={dimension.label}
                value={values[dimension.key] ?? FILTER_ALL}
                onPick={(next) => onChange({ ...values, [dimension.key]: next })}
                options={[
                  {
                    value: FILTER_ALL,
                    label: dimension.allLabel ?? "All",
                    hint: String(forThis[FILTER_ALL] ?? 0),
                  },
                  ...dimension.options.map((option) => ({
                    ...option,
                    // The count REPLACES a declared hint rather than joining
                    // it: two greys after a two-word label is a cluttered
                    // menu, and on a filter the number is the useful one.
                    hint: String(forThis[option.value] ?? 0),
                  })),
                ]}
                // 160px, measured rather than chosen: at 176 a bar of five
                // menus plus the search box wanted 1196px against the 1121 a
                // 1280 window gives, so Price wrapped to a line of its own and
                // read as a mistake. At 160 the same bar is 1084 and the row
                // holds. The panel is sized to its own contents, so a long
                // option ("Granulated Sugar") is still read in full where it is
                // chosen; only the resting trigger truncates.
                className="w-40"
              />
            </div>
          );
        })}
        {trailing ? <div className="ml-auto shrink-0">{trailing}</div> : null}
      </div>

      {/* Always stated, never only when filtered: "470 of 470" is a fact worth
          having, and a line that appears and disappears moves the table under
          it every time you touch a menu. */}
      <p className="text-[13px] text-muted">
        {shown === population
          ? `${population.toLocaleString()} ${noun}`
          : `${shown.toLocaleString()} of ${population.toLocaleString()} ${noun}`}
        {active > 0 ? (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => onChange(clearedFilters(dimensions))}
              className="underline underline-offset-2 hover:text-ink"
            >
              Clear {active === 1 ? "filter" : `${active} filters`}
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}
