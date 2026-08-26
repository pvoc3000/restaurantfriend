"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { FilterMenus } from "@/components/ui/FilterMenus";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { sortRows } from "@/lib/tableSort";
import { withFrom } from "@/lib/breadcrumbs";
import { employeeTabHref } from "@/lib/employees";
import {
  applyListFilters,
  filterCounts,
  filterHref,
  parseFilterSearch,
  parseFilterValues,
  parseListSort,
  urlFilterParams,
  type FilterDimension,
  type FilterValues,
  type ListSort,
  type RawSearchParams,
} from "@/lib/filterMenus";
import {
  AD_HOC_EVENT_KINDS,
  EVENT_KIND_LABEL,
  RATING_WINDOWS,
  RATING_WINDOW_LABEL,
  RATING_WINDOW_SINCE,
  SHIFT_SLOT_LABEL,
  eventSummaryLine,
  isDisciplinary,
  withRatingWindow,
  type EventKind,
  type RatingWindowKey,
  type ShiftSlot,
} from "@/lib/employeeEvents";

export type TeamEventRow = {
  id: string;
  employee_id: string;
  /** Resolved on the server from the roster; null only if that query failed. */
  employeeName: string | null;
  occurred_on: string;
  kind: EventKind;
  score: number | null;
  shift: ShiftSlot | null;
  position: string | null;
  headline: string | null;
  detail: string | null;
  outcome: string | null;
  /** The linked author's name, or FileMaker's own string. */
  author: string | null;
  locationCode: string | null;
};

/** This list's own address. */
const PATH = "/events";

/**
 * Every column you can sort by — `columns` below, minus the ones with no
 * `sortValue`. KEEP THE TWO IN STEP: a key missing from here sorts perfectly
 * well and is silently forgotten on the way back from a record screen.
 */
const SORT_KEYS = ["date", "who", "kind", "where", "shift", "score", "note", "by"] as const;

/**
 * The resting order. It cannot be `DataTable`'s `defaultSort`, which a list that
 * controls its own sort ignores — so the table is TOLD this while the `sort`
 * STATE stays null, keeping one canonical address for the plain list.
 */
const NATURAL_SORT: ListSort = { key: "date", dir: "desc" };

/** The Kind menu's one derived option: warnings and incidents together. */
const DISCIPLINARY = "disciplinary";

/** "Not set" / "Not recorded" — a real answer, so it needs a real token. */
const NONE = "none";

const TIERS = ["narrative", "shifts", "all"] as const;
type Tier = (typeof TIERS)[number];

const TIER_LABEL: Record<Tier, string> = {
  narrative: "Notes & warnings",
  shifts: "Shift ratings",
  all: "All",
};

const LINK =
  "text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900";

/**
 * The whole team's events.
 *
 * TWO POPULATIONS FETCHED UNDER DIFFERENT RULES, and the tier picker is the only
 * place the screen can say so: notes and warnings are complete back to 2014
 * (2,635 rows), while shift ratings are bounded by the window (43,918 exist).
 * That is also why the tier defaults to `narrative` — the record screen's
 * reason, which is worse org-wide: a decade of warnings buried under forty-four
 * thousand ratings, 89% of which are a 5.
 *
 * KIND IS A SEPARATE MENU whose options are the ten narrative kinds only. The
 * tier says which population, Kind says which of the ten inside it, and no label
 * appears in both — otherwise the two controls would be saying the same thing
 * three inches apart.
 *
 * There is no `usePublishRecordSet`: this screen has no detail route, and the
 * record it links out to belongs to `/employees`' found set. Publishing here
 * would overwrite the roster's book with a set of events.
 */
export function EventsList({
  rows,
  windowKey,
  initialSearch,
  initialFilters,
  nameError,
}: {
  rows: TeamEventRow[];
  /** What the server fetched. A PROP, never state — see `changeWindow`. */
  windowKey: RatingWindowKey;
  initialSearch: string;
  initialFilters: RawSearchParams;
  nameError: string | null;
}) {
  const router = useRouter();

  const dimensions = useMemo<FilterDimension<TeamEventRow>[]>(() => {
    const codes = [...new Set(rows.map((r) => r.locationCode).filter((c): c is string => !!c))].sort();
    const authors = [...new Set(rows.map((r) => r.author).filter((a): a is string => !!a))].sort();

    return [
      {
        // Driven by the TabPicker below rather than by a menu, because it is the
        // one control that has to explain that one half is complete and the
        // other is a window. It rides here so it lands in the URL and its counts
        // condition like every other dimension.
        key: "tier",
        label: "Tier",
        defaultValue: "narrative",
        options: TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] })),
        matches: (r, v) =>
          v === "all" ? true : v === "shifts" ? r.kind === "shift" : r.kind !== "shift",
      },
      {
        key: "kind",
        label: "Kind",
        options: [
          // The question this screen actually gets asked. No kind is named
          // "disciplinary", so the token cannot collide with one.
          { value: DISCIPLINARY, label: "Disciplinary", hint: "warnings and incidents" },
          ...AD_HOC_EVENT_KINDS.map((k) => ({ value: k, label: EVENT_KIND_LABEL[k] })),
          { value: "document_note", label: EVENT_KIND_LABEL.document_note, hint: "filed in FileMaker" },
        ],
        matches: (r, v) => (v === DISCIPLINARY ? isDisciplinary(r.kind) : r.kind === v),
      },
      {
        // Essential on the shifts tier, where 43,917 of 43,918 rows carry a shop.
        // On notes and warnings it reads "Not set" for 2,382 of 2,635, because
        // 035 recovers the shop from the shift report and only ratings have one.
        // The conditioned counts say that out loud rather than hiding it.
        key: "where",
        label: "Shop",
        options: [...codes.map((c) => ({ value: c, label: c })), { value: NONE, label: "Not set" }],
        matches: (r, v) => (v === NONE ? !r.locationCode : r.locationCode === v),
      },
      {
        key: "by",
        label: "By",
        options: [
          ...authors.map((a) => ({ value: a, label: a })),
          { value: NONE, label: "Not recorded" },
        ],
        matches: (r, v) => (v === NONE ? !r.author : r.author === v),
      },
      {
        // 89% of scored ratings are a 5 — the measurement the whole schema was
        // built on. The other 11% is the entire information content of forty-four
        // thousand rows, and this menu is the only way to reach it.
        key: "score",
        label: "Score",
        options: [
          { value: "low", label: "Under 4", hint: "and the zeros" },
          { value: "high", label: "4 or better" },
          { value: "unscored", label: "Not scored" },
        ],
        matches: (r, v) =>
          v === "unscored" ? r.score === null : r.score !== null && (v === "low" ? r.score < 4 : r.score >= 4),
      },
    ];
  }, [rows]);

  // Seeded from the ADDRESS BAR where it names this path, falling back to the
  // server's own props. `history.replaceState` moves the URL without rewriting
  // the RSC payload cached against that history entry, so a Back that restored
  // the props alone would come back with the filters you first arrived with.
  const [search, setSearch] = useState(() => {
    const live = urlFilterParams(PATH);
    return live ? parseFilterSearch(live) : initialSearch;
  });
  const [filters, setFilters] = useState<FilterValues>(() =>
    parseFilterValues(dimensions, urlFilterParams(PATH) ?? initialFilters),
  );
  const [sort, setSort] = useState<ListSort | null>(() =>
    parseListSort(urlFilterParams(PATH) ?? initialFilters, SORT_KEYS),
  );

  /**
   * Every href on this screen goes through `withRatingWindow`, because
   * `filterQuery` rebuilds the query string FROM SCRATCH and so drops a
   * parameter it has never heard of — leaving the address bar claiming 90 days
   * while the rows on screen are 30.
   */
  function href(f: FilterValues, q: string, s: ListSort | null, w: RatingWindowKey = windowKey) {
    return withRatingWindow(filterHref(PATH, dimensions, f, q, s), w);
  }
  function writeUrl(f: FilterValues, q: string, s: ListSort | null) {
    window.history.replaceState(null, "", href(f, q, s));
  }
  const changeFilters = (next: FilterValues) => {
    setFilters(next);
    writeUrl(next, search, sort);
  };
  const changeSearch = (next: string) => {
    setSearch(next);
    writeUrl(filters, next, sort);
  };
  const changeSort = (next: ListSort) => {
    setSort(next);
    writeUrl(filters, search, next);
  };
  const changeTier = (next: Tier) => changeFilters({ ...filters, tier: next });
  /**
   * THE ONE CONTROL THAT RE-FETCHES. The window decides which shift ratings the
   * server loaded, so it is a `router.push` where every filter above is a
   * `replaceState` — `/sales`' split. And it is why `windowKey` is a prop rather
   * than state: a local copy would survive the push and start lying.
   */
  const changeWindow = (next: RatingWindowKey) => router.push(href(filters, search, sort, next));

  const tier = (filters.tier ?? "narrative") as Tier;

  // Search first, so every count below describes the list you are looking at.
  // This is also what stands in for a Who menu: 445 people is a directory rather
  // than a menu, and substring beats exact-one-of-445 for "the Kim who worked
  // here".
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.employeeName ?? "").toLowerCase().includes(q) ||
        (r.headline ?? "").toLowerCase().includes(q) ||
        (r.detail ?? "").toLowerCase().includes(q) ||
        (r.outcome ?? "").toLowerCase().includes(q) ||
        (r.author ?? "").toLowerCase().includes(q) ||
        (r.position ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const visible = useMemo(
    () => applyListFilters(searched, dimensions, filters),
    [searched, dimensions, filters],
  );
  const tierCounts = filterCounts(searched, dimensions, filters).tier;

  /**
   * THE TIER IS A DIMENSION AND NOT A MENU. It rides in `dimensions` so it lands
   * in the URL, is parsed back, and narrows `visible` like everything else — but
   * it is DRAWN as the TabPicker above, so the menu row must not offer it too.
   * A second control saying the same thing three inches away is one of them
   * being wrong the moment they disagree.
   *
   * The bar is therefore handed the rows ALREADY narrowed by the tier, which is
   * what keeps its option counts conditioned on it: "Attendance 876" while you
   * are reading shift ratings would be a count of rows the list cannot show.
   */
  const menuDimensions = useMemo(() => dimensions.filter((d) => d.key !== "tier"), [dimensions]);
  const tiered = useMemo(
    () => applyListFilters(searched, dimensions.slice(0, 1), filters),
    [searched, dimensions, filters],
  );

  const listHref = href(filters, search, sort);

  const columns: DataColumn<TeamEventRow>[] = [
    {
      // FIRST, so it carries the expand chevron — which joins cell zero and
      // applies `truncate` there, so this slot must hold something that never
      // needs to wrap.
      key: "date",
      label: "Date",
      // 155, measured rather than chosen: the expand chevron rides in this cell
      // and takes 34px of it (a 22px slot plus the gap), so at 130 the cell had
      // 67px for a date that wants 76 and clipped it to "2026-08-0".
      width: 155,
      sortValue: (r) => r.occurred_on,
      sortTiebreaks: [(r) => r.employeeName ?? ""],
      render: (r) => <span className="tabular-nums text-muted">{r.occurred_on}</span>,
    },
    {
      // The column that IS the row on an org-wide list, so nobody may hide it.
      key: "who",
      label: "Who",
      width: 190,
      pinned: true,
      wrap: true,
      sortValue: (r) => r.employeeName ?? "",
      sortTiebreaks: [(r) => r.occurred_on],
      render: (r) =>
        r.employeeName ? (
          <Link
            href={withFrom(employeeTabHref(r.employee_id, "events"), {
              href: listHref,
              label: "Events",
            })}
            className={LINK}
          >
            {r.employeeName}
          </Link>
        ) : (
          <span className="text-accent" title={nameError ?? undefined}>
            {nameError ? "unreadable" : "—"}
          </span>
        ),
    },
    {
      // PLAIN TEXT, never a coloured chip: colour means record STATE in this
      // design system and a written warning is a record TYPE. Weight is the
      // whole of the emphasis, exactly as the record screen does it.
      key: "kind",
      label: "Kind",
      width: 140,
      sortValue: (r) => EVENT_KIND_LABEL[r.kind] ?? r.kind,
      sortTiebreaks: [(r) => r.occurred_on],
      render: (r) => (
        <span className={isDisciplinary(r.kind) ? "font-semibold" : undefined}>
          {EVENT_KIND_LABEL[r.kind] ?? r.kind}
        </span>
      ),
    },
    {
      key: "where",
      label: "Shop",
      width: 70,
      hideWhenCompact: true,
      sortValue: (r) => r.locationCode,
      render: (r) => <span className="text-muted">{r.locationCode ?? "—"}</span>,
    },
    {
      key: "shift",
      label: "Shift",
      // 130: the cell carries the shift AND the position after it, and at 100 a
      // real roster clipped "Opening Sr…" and "Closing Sc…" mid-word, which
      // reads as a rendering fault rather than as a detail that ran out of room.
      width: 130,
      hideWhenCompact: true,
      sortValue: (r) => (r.shift ? SHIFT_SLOT_LABEL[r.shift] : null),
      render: (r) =>
        r.shift || r.position ? (
          <span>
            {r.shift ? SHIFT_SLOT_LABEL[r.shift] : null}
            {r.position ? (
              <span className="text-[12px] text-muted">
                {r.shift ? " " : ""}
                {r.position}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "score",
      label: "Score",
      // 80: the label is a single word, so it cannot wrap to a second line the
      // way a two-word one does — at 70 the header itself read "SCO…".
      width: 80,
      align: "right",
      // -1 rather than null so unscored rows stay out of the top of a
      // descending sort, which is the record screen's own choice.
      sortValue: (r) => r.score ?? -1,
      render: (r) =>
        r.score === null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="tabular-nums">{r.score.toFixed(2)}</span>
        ),
    },
    {
      // `eventSummaryLine` finally has a reader. The record screen cannot use it
      // — its cell is an editor bound to `headline`, so the rows carrying only a
      // detail or an outcome render there as an em dash.
      key: "note",
      label: "Note",
      width: 325,
      wrap: true,
      sortValue: (r) => eventSummaryLine(r),
      render: (r) => {
        const line = eventSummaryLine(r);
        return line ? <span>{line}</span> : <span className="text-muted">—</span>;
      },
    },
    {
      key: "by",
      label: "By",
      width: 140,
      hideWhenCompact: true,
      sortValue: (r) => r.author,
      render: (r) => <span className="text-muted">{r.author ?? "—"}</span>,
    },
  ];

  // Each band appears only when its column is the sort — a grouping can only
  // band what the ORDER already groups. Not `who`: 445 values over ~3,000 rows
  // is a heading above nearly every row.
  const groups: DataGroup<TeamEventRow>[] = [
    { sortKey: "date", label: (r) => r.occurred_on.slice(0, 4) },
    { sortKey: "kind", label: (r) => EVENT_KIND_LABEL[r.kind] ?? r.kind },
    { sortKey: "where", label: (r) => r.locationCode ?? "No shop" },
  ];

  const sorted = sortRows(visible, columns, sort ?? NATURAL_SORT);

  const shiftsShown = tier === "narrative" ? 0 : searched.filter((r) => r.kind === "shift").length;

  return (
    <DataTable
      rows={sorted}
      sort={sort ?? NATURAL_SORT}
      onSortChange={changeSort}
      columns={columns}
      group={groups}
      rowKey={(r) => r.id}
      storageKey="events.v1"
      compactBelow={1280}
      columnChooser
      expand={{
        canExpand: (r) => Boolean(r.detail || r.outcome),
        render: (r) => (
          <div className="space-y-2 px-4 py-3 text-sm">
            {r.detail ? <p className="max-w-[90ch] whitespace-pre-line">{r.detail}</p> : null}
            {r.outcome ? (
              <p className="text-muted">
                <span className="text-[11px] uppercase tracking-[0.12em] text-subtle">
                  Action taken
                </span>{" "}
                {r.outcome}
              </p>
            ) : null}
          </div>
        ),
      }}
      empty={
        <p className="text-sm text-muted">
          {rows.length === 0
            ? "No events have been recorded."
            : tier !== "narrative" && shiftsShown === 0
              ? `No shift ratings ${RATING_WINDOW_SINCE[windowKey]}. Widen the window above to look further back.`
              : "No events match these filters."}
        </p>
      }
      leading={
        <div className="space-y-3">
          {/* BOTH PICKERS ON ONE ROW, tier first (Mark, 2026-08-26).

              The order is what keeps the row still: the window is only offered
              on two of the three tiers, so with it leading, every switch to
              Shift ratings shoved the tier picker down a line and back up again.

              NEITHER IS CAPTIONED (Mark: "you don't need 'how far back', it's
              obvious from the choices"). Every cell names itself, which is the
              same reason the vendor screen's age filter lost its label — and it
              is what makes the row a constant 36px, so the tier picker and the
              whole table under it no longer move by the height of a caption
              that existed on two tiers of three. The `ariaLabel`s stay: "7 days"
              read aloud on its own names nothing. */}
          <div className="flex flex-wrap items-end gap-3">
            <TabPicker
              ariaLabel="Which events"
              value={tier}
              onChange={changeTier}
              options={TIERS.map((t) => ({ key: t, label: TIER_LABEL[t], count: tierCounts[t] }))}
            />
            {tier === "narrative" ? null : (
              // Hidden on the notes tier, where it changes nothing on screen — a
              // control that does nothing is a control people stop trusting.
              <TabPicker
                ariaLabel="How far back to read shift ratings"
                value={windowKey}
                onChange={changeWindow}
                options={RATING_WINDOWS.map((k) => ({ key: k, label: RATING_WINDOW_LABEL[k] }))}
              />
            )}
          </div>
          <FilterMenus
            rows={tiered}
            total={rows.length}
            noun="events"
            dimensions={menuDimensions}
            values={filters}
            // The bar's own Clear resets the dimensions IT knows about, and the
            // tier is not one of them — so put it back, or "Clear 2 filters"
            // would also throw you from Shift ratings to Notes & warnings while
            // counting itself as two.
            onChange={(next) => changeFilters({ tier, ...next })}
            leading={
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Search
                </span>
                <TextInput
                  value={search}
                  onValueChange={changeSearch}
                  placeholder="Name, note, supervisor…"
                  className="w-64"
                  aria-label="Search events"
                  clearLabel="Clear the search"
                />
              </div>
            }
          />
          {tier === "narrative" ? null : (
            // A WINDOW statement, not a row count: this list is bounded by a
            // date rather than by `.range()`, so the honest sentence names the
            // date. It never appears on the tier that is complete.
            <p className="text-[13px] text-subtle">
              Shift ratings {RATING_WINDOW_SINCE[windowKey]} ({shiftsShown.toLocaleString()}). Every
              note and warning is here, back to 2014.
            </p>
          )}
          {nameError ? (
            <p className="text-[12px] text-accent">Names could not be loaded: {nameError}</p>
          ) : null}
        </div>
      }
    />
  );
}
