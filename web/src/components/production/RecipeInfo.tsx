"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Switch } from "@/components/ui/Switch";
import { spaceBelow, useViewportAtLeast } from "@/lib/tableHead";
import { unresolvedSummary } from "@/lib/productionCost";
import { recipeHref } from "@/lib/recipes";
import { scaleColumns } from "@/lib/production";
import { recipeCostMatrix, defaultColumn, type CostLine } from "@/lib/recipeCosts";
import { RecipeCosts } from "./RecipeCosts";
import type { SheetVersion } from "./RecipeVersionSheet";

/**
 * The recipe's Info tab — everything about this version that isn't the making
 * of it, which is FileMaker's own split between its INFO and RECIPE tabs.
 *
 * IT IS ONE SCREEN, and that is the layout's whole brief (Mark, 2026-08-08:
 * "ideally everything should display on a single screen. Notes and versions
 * should scroll"). The fields sit at their natural height; below them a frame
 * takes whatever is left, holding NOTES down the left and VERSIONS over COSTS
 * down the right (Mark's arrangement, 2026-08-08). Notes and Versions each
 * scroll their own contents, so a recipe with 38 versions and a page of testing
 * notes fills the same frame as one with two lines of each.
 *
 * THE COLUMN BOUNDARY IS THE SAME HALF-AND-HALF as the fields above it, which is
 * the point of the two columns rather than three stacked blocks: one rule runs
 * straight down the page instead of each block finding its own edge.
 *
 * The height is MEASURED, never a CSS constant — `useExactViewportHeight`, the
 * same reason the receiving screen measures its own: what sits above varies with
 * the masthead's wrapping and with how long the description runs, so every
 * constant is wrong at some width. Below `xl` the two columns stack and the
 * floor takes over, which is the receiving screen's rule too: nothing hidden, no
 * panes too short to read.
 */
export function RecipeInfo({
  recipeId,
  version,
  versions,
  laborRate,
  locationCode,
  editable,
  params,
}: {
  recipeId: string;
  version: SheetVersion;
  versions: SheetVersion[];
  laborRate: number | null;
  locationCode: string | null;
  editable: boolean;
  params: Record<string, string | string[] | undefined>;
}) {
  // THE ROW IS SIZED BY THE RIGHT COLUMN, NOT BY THE WINDOW (Mark, 2026-08-08:
  // "versions doesn't need to be so tall. It could probably be the same height
  // as Costs, and then Notes can be tall enough so its bottom is aligned with
  // the bottom of costs"). Filling the viewport meant SOMETHING had to absorb
  // the leftover, and the only block in the column that could give was the
  // versions list — so a family with 38 versions got a 505px pane of 44px rows
  // and the two columns ended level with the foot of the SCREEN rather than
  // with the last line of the matrix.
  //
  // Two measurements, both one-directional, which is what keeps this from
  // oscillating the way a self-referential height does:
  //   1. VERSIONS IS CAPPED TO THE HEIGHT OF COSTS. Measured, not written down:
  //      the matrix is a fixed six rows, but its heading wraps when a recipe has
  //      unpriced elements to name, so it is 324px on one recipe and 340 on the
  //      next and a constant would be visibly wrong on one of them.
  //   2. NOTES IS GIVEN THE RIGHT COLUMN'S HEIGHT, so the two columns end level.
  // Costs never reads the list above it and the right column never reads Notes,
  // so the arrows only point one way. `xl:items-start` is load-bearing for that:
  // it stops the grid stretching the right column to the row, which would make
  // its height depend on the very thing we derive from it.
  //
  // Written straight to the nodes, the `lib/tableHead` idiom — no state, so a
  // re-measure doesn't re-render 38 rows.
  //
  // A CONSEQUENCE, ACCEPTED: the tab is no longer clamped to one screen. The row
  // is at most `costs + gap + costs` ≈ 700px, so on a window under ~1200 the
  // page scrolls a little. That is inherent in the ask — bottoms aligned on the
  // matrix's last line is a content-driven height, not a viewport-driven one.
  const wide = useViewportAtLeast(1280);
  const notesColumn = useRef<HTMLDivElement>(null);
  const rightColumn = useRef<HTMLDivElement>(null);
  const versionsBox = useRef<HTMLDivElement>(null);
  const costsBox = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const notes = notesColumn.current;
    const right = rightColumn.current;
    const box = versionsBox.current;
    const costs = costsBox.current;
    if (!notes || !right || !box || !costs) return;
    if (!wide) {
      // Stacked, both are as tall as they are and the page scrolls.
      box.style.maxHeight = "";
      notes.style.height = "";
      return;
    }
    const apply = () => {
      const costsHeight = Math.round(costs.getBoundingClientRect().height);
      if (costsHeight) {
        // The matrix's height is what the list WANTS. What it can have is also
        // bounded by the window, so the tab still opens as one screen wherever
        // it can: at 1100px the pair would come to 672 in 552 of room, and the
        // list gives up the 120 rather than the page scrolling. Both terms of
        // `room` are independent of this box's own height — the grid's top is
        // decided by what sits above it and `spaceBelow` counts real siblings
        // and padding, never slack — so this can't become the fixed point that
        // `lib/tableHead` documents.
        const grid = right.parentElement;
        const gap = Math.round(costs.getBoundingClientRect().top - box.getBoundingClientRect().bottom);
        const room = grid
          ? Math.round(
              window.innerHeight - grid.getBoundingClientRect().top - spaceBelow(grid)
            ) - gap - costsHeight
          : costsHeight;
        // Never below three rows: past that the list stops being a list, and a
        // page that scrolls is the better failure.
        const cap = `${Math.max(132, Math.min(costsHeight, room))}px`;
        if (box.style.maxHeight !== cap) box.style.maxHeight = cap;
      }
      const rightHeight = Math.round(right.getBoundingClientRect().height);
      if (rightHeight) {
        const height = `${rightHeight}px`;
        if (notes.style.height !== height) notes.style.height = height;
      }
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(costs);
    observer.observe(right);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [wide]);

  // THE CHOSEN COLUMN LIVES HERE, not inside the costs block, because two
  // things read it: the matrix, and the Batch cost fact at the top of the
  // screen (Mark, 2026-08-08 — "batch cost in the top header should change
  // depending on what is selected in the cost area"). A figure quoted in two
  // places from two different columns is the duplication this tab has spent
  // the day removing.
  const [chosen, setChosen] = useState<number | null>(version.cost_column);

  const columns = scaleColumns(version.scale_labels, version.scale_multipliers);
  const matrix = recipeCostMatrix({
    columns,
    lines: version.lines as CostLine[],
    baseIngredientCost: version.batchCost.cost,
    laborRate,
    costColumn: chosen,
  });
  const at = defaultColumn(matrix);

  return (
    <div className="flex flex-col gap-5">
      {/* HALF AND HALF, the same split as the row beneath it, so the boundary
          runs straight down the page (Mark, 2026-08-08). Two `dl`s rather than
          one four-track grid: a single grid ties the two sides to the same row
          heights, so a long description would push Storage's value down to meet
          it. */}
      <section className="shrink-0 space-y-4">
        <SectionHeading>Version {version.version_label}</SectionHeading>
        <div className="grid gap-x-10 gap-y-3 lg:grid-cols-2">
        <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-6 gap-y-2 text-[14px]">
          <Fact label="Description">
            <Editable id={version.id} column="description" value={version.description} editable={editable} />
          </Fact>
          <Fact label="Author">
            <Editable id={version.id} column="author" value={version.author} editable={editable} />
          </Fact>
          <Fact label="Created">
            <span className={READ_ONLY_VALUE}>{stamp(version.created_at) ?? "—"}</span>
          </Fact>
          <Fact label="Modified">
            <span className={READ_ONLY_VALUE}>{stamp(modifiedAt(version)) ?? "—"}</span>
          </Fact>
        </dl>
        <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-6 gap-y-2 text-[14px]">
          <Fact label="Storage">
            <Editable id={version.id} column="storage" value={version.storage} editable={editable} />
          </Fact>
          <Fact label="Shelf life">
            <Editable id={version.id} column="shelf_life" value={version.shelf_life} editable={editable} />
          </Fact>
          <Fact label="Tools">
            <Editable id={version.id} column="tools" value={version.tools} editable={editable} multiline />
          </Fact>
          <Fact label="Batch cost">
            {/* Follows the cost column. The gaps note goes on its OWN LINE,
                never beside the figure — set inline it read "≥ $7.385 not
                priced", the count's first digit running onto the cents. A
                WRAPPER, not `block` on the spans: READ_ONLY_VALUE carries
                `inline-block`, and Tailwind resolves competing display
                utilities by stylesheet order rather than class-string order. */}
            <span className="flex flex-col items-start">
              <span className={`${READ_ONLY_VALUE} tabular-nums`}>
                {at?.ingredients === null || at === null
                  ? "—"
                  : `${version.batchCost.unresolved.length ? "≥ " : ""}$${at.ingredients.toFixed(2)}`}
                <span className="ml-2 text-[12px] font-normal text-muted">at {at?.column.label}</span>
              </span>
              {unresolvedSummary(version.batchCost) ? (
                <span className={`${READ_ONLY_VALUE} text-[13px] text-mark`}>
                  {unresolvedSummary(version.batchCost)}
                </span>
              ) : null}
            </span>
          </Fact>
        </dl>
        </div>
      </section>

      {/* NOTES on the left; VERSIONS over COSTS on the right (Mark, 2026-08-08
          — "move the versions section across from Notes and above Costs"). The
          boundary is the same half-and-half as the fields above it, so one rule
          runs straight down the page.
          `min-w-0` on BOTH tracks, and not behind a breakpoint: a grid item's
          min-width defaults to min-content, so the matrix's own `minWidth`
          would stop its track shrinking and push the whole PAGE sideways rather
          than scrolling inside its box. */}
      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-2 xl:items-start xl:gap-10">
        {/* Its HEIGHT is written by the effect above — the right column's, so the
            two end level. `min-h-0` so the notes inside can give way to it. */}
        <div ref={notesColumn} className="flex min-h-0 min-w-0 flex-col">
          <Notes version={version} editable={editable} />
        </div>

        {/* SHRINK, NEVER GROW, on the versions list — sized to its own rows and
            capped at the matrix's height by the effect above. Costs is
            `shrink-0`: it is a fixed grid of figures with one right height, and
            it is what the cap above it and the column across from it are both
            measured FROM, so it must not move. */}
        <div ref={rightColumn} className="flex min-w-0 flex-col gap-12">
          <div ref={versionsBox} className="flex min-h-0 flex-col">
            <RecipeVersionList
              recipeId={recipeId}
              current={version}
              versions={versions}
              editable={editable}
              params={params}
            />
          </div>
          <div ref={costsBox} className="min-h-0 shrink-0 overflow-y-auto">
            <RecipeCosts
              version={version}
              matrix={matrix}
              laborRate={laborRate}
              locationCode={locationCode}
              editable={editable}
              onChoose={setChosen}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The version's prose, down the left of the frame.
 *
 * THE VERSION NOTE IS ITS OWN ELEMENT and sits OUTSIDE the scroller (Mark,
 * 2026-08-08). The two are not the same kind of writing: the version note is a
 * line naming what this version IS — "v09 scaled to 2000g" — which is the first
 * thing you read and should always be on screen, where testing notes accumulate
 * over years and are what the scrolling is for. Sharing one box meant a long
 * testing note could push the version's own name for itself out of sight, and
 * scrolling back up to a heading is a strange way to find a single line.
 */
function Notes({ version, editable }: { version: SheetVersion; editable: boolean }) {
  return (
    // `flex-initial` below `xl`, `flex-1` at it. Only the two-column frame has
    // a definite height to be a share OF; stacked, the frame is content-sized,
    // and `flex-1` is `flex: 1 1 0%` — a basis of 0 in an auto-height column
    // means the whole block collapses to its heading.
    <section className="flex min-h-0 flex-initial flex-col gap-3 xl:flex-1">
      <SectionHeading>Notes</SectionHeading>

      <div className="shrink-0 text-[14px]">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          Version note
        </p>
        <Editable id={version.id} column="note" value={version.note} editable={editable} multiline />
      </div>

      {/* Only the testing notes scroll, and they get the rest of the column —
          at `xl`. Stacked they are as long as they are and the page scrolls;
          see the note on the section.
          `mt-9` on top of the section's own `gap-3` — 48px, the same break the
          right column puts between Versions and Costs, because it is the same
          kind of break: two distinct blocks stacked in one column, not a label
          and the words under it. */}
      <div className="mt-9 flex min-h-0 flex-initial flex-col text-[14px] xl:flex-1">
        <p className="mb-1 shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          Testing notes
        </p>
        <div className="min-h-0 flex-initial overflow-y-auto pr-1 xl:flex-1">
          <span className="text-muted">
            <Editable
              id={version.id}
              column="testing_notes"
              value={version.testing_notes}
              editable={editable}
              multiline
            />
          </span>
        </div>
      </div>
    </section>
  );
}

/**
 * Every version of this recipe, and which one is in force.
 *
 * NOT a `DataTable`: it has no sort worth offering and no columns worth hiding,
 * and its rows are the family's own history in version order — which is the one
 * order it should ever be in. What it does have is the two things the picker
 * could never show, the date and the note, and those are the whole reason a
 * shop keeps v24 around.
 *
 * MAKING A VERSION MASTER IS TWO STATEMENTS AND THE ORDER IS LOAD-BEARING.
 * 036 enforces one master per family with a PARTIAL UNIQUE INDEX, so the old
 * flag has to be cleared BEFORE the new one is set; the reverse trips the index
 * and the write fails with a constraint error naming neither version. Both
 * `.select()` their own result, because an update matching no policy changes
 * nothing and PostgREST returns no error.
 */
function RecipeVersionList({
  recipeId,
  current,
  versions,
  editable,
  params,
}: {
  recipeId: string;
  current: SheetVersion;
  versions: SheetVersion[];
  editable: boolean;
  params: Record<string, string | string[] | undefined>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function makeMaster(next: SheetVersion) {
    setError(null);
    start(async () => {
      const old = versions.find((v) => v.is_master && v.id !== next.id);
      if (old) {
        const { data, error: e } = await supabase
          .from("production_recipe_versions")
          .update({ is_master: false })
          .eq("id", old.id)
          .select("id");
        if (e || !data?.length) {
          setError(e?.message ?? "not allowed");
          return;
        }
      }
      const { data, error: e2 } = await supabase
        .from("production_recipe_versions")
        .update({ is_master: true })
        .eq("id", next.id)
        .select("id");
      if (e2 || !data?.length) {
        setError(e2?.message ?? "not allowed");
        return;
      }
      router.refresh();
    });
  }

  return (
    // `flex-initial` — see the note at the call site: it shrinks and scrolls
    // when the family is long, and never grows past its own rows when it isn't.
    <section className="flex min-h-0 flex-initial flex-col gap-3">
      <SectionHeading count={versions.length}>Versions</SectionHeading>
      {/* `flex-initial` again, and for a reason worth stating: `flex-1` is
          `flex: 1 1 0%`, and a basis of 0 inside a section that is now sized by
          its CONTENT means the section has no content — the list would collapse
          to its heading. Basis `auto` lets the rows decide, and `min-h-0` still
          lets them give way when the column can't hold them. */}
      <div className="min-h-0 flex-initial overflow-y-auto">
        <table className="w-full table-fixed border-collapse text-[14px]">
          {/* Tight, because this list shares its column with the Notes cell and
              the costs matrix takes the width it needs. Everything fixed adds to
              308, so the Note gets whatever is left — which is the column worth
              giving it to. */}
          <colgroup>
            <col style={{ width: 72 }} />
            <col style={{ width: 58 }} />
            <col style={{ width: 88 }} />
            <col />
            <col style={{ width: 116 }} />
          </colgroup>
          <thead>
            {/* Sticky, because the pane scrolls under it — `lib/tableHead`'s
                rule, and on the `th` rather than the row: WebKit doesn't honour
                sticky on a `tr` under `border-collapse`, and an iPad is what
                this is read on. */}
            {/* `0.06em`, not the app's usual 0.12: these columns are narrow
                enough that the wider tracking pushed "VERSION" and "ACTIVE" past
                their own cells, and a clipped column label reads as a rendering
                fault. */}
            <tr className="text-[11px] uppercase tracking-[0.06em] text-ink">
              <Th>Version</Th>
              <Th>Active</Th>
              <Th>Modified</Th>
              <Th>Note</Th>
              <Th>Master</Th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr
                key={v.id}
                className={`align-baseline hover:bg-neutral-50 ${
                  v.id === current.id ? "font-bold" : ""
                }`}
              >
                <td className="px-2 py-2">
                  <Link
                    href={recipeHref(recipeId, { tab: "info", version: v.version_label }, params)}
                    className="hover:underline"
                  >
                    v{v.version_label}
                  </Link>
                </td>
                <td className="px-2 py-2">
                  {editable ? (
                    <ActiveVersion id={v.id} active={v.is_active} />
                  ) : (
                    <span className={`${READ_ONLY_VALUE} text-[13px] text-muted`}>
                      {v.is_active ? "Active" : "Inactive"}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-[13px] text-muted">{date(modifiedAt(v))}</td>
                <td className="px-2 py-2 text-[13px] text-muted">{v.note ?? ""}</td>
                <td className="px-2 py-2">
                  {v.is_master ? (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.04em]">
                      ★ Master
                    </span>
                  ) : editable ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => makeMaster(v)}
                      className="whitespace-nowrap border border-hairline px-2 py-0.5 text-[10px] uppercase tracking-[0.04em] text-muted hover:border-ink hover:text-ink disabled:opacity-35"
                    >
                      Make master
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <p className="shrink-0 text-[13px] text-accent">{error}</p> : null}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    // `h-9` on BOTH tables' header cells (see `RecipeCosts`): the rules under
    // them have to read as one band across the page, and a cell's height
    // otherwise follows whatever it contains — a 14px radio in the costs header
    // put its rule 4px lower than this one.
    <th className="sticky top-0 z-10 h-9 border-b-2 border-ink bg-white px-2 py-0 text-left align-middle">
      {children}
    </th>
  );
}

function ActiveVersion({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [on, setOn] = useState(active);
  const [pending, start] = useTransition();

  return (
    <Switch
      size="sm"
      on={on}
      disabled={pending}
      ariaLabel={on ? "Active — click to retire this version" : "Retired — click to activate"}
      onToggle={() => {
        const next = !on;
        setOn(next);
        start(async () => {
          const { data, error } = await supabase
            .from("production_recipe_versions")
            .update({ is_active: next })
            .eq("id", id)
            .select("id");
          if (error || !data?.length) {
            setOn(!next);
            return;
          }
          router.refresh();
        });
      }}
    />
  );
}

/**
 * When this version last changed.
 *
 * FileMaker's own stamp where we have one, and the row's `updated_at` where we
 * don't. That order is right today and will need revisiting: for every migrated
 * recipe `updated_at` is the moment the migration ran, so ours says 2026 about a
 * recipe FileMaker last touched in 2024 — and the 2024 answer is the true one.
 * The cost is the mirror image, and it is real: editing a migrated version here
 * will not move this date, because nothing clears the stored stamp. Giving
 * `_ModificationTimestamp` its own column is the fix and it is a migration.
 */
function modifiedAt(version: SheetVersion): string | null {
  return version.fmp_modified_at ?? version.updated_at;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Editable({
  id,
  column,
  value,
  editable,
  multiline = false,
}: {
  id: string;
  column: string;
  value: string | null;
  editable: boolean;
  multiline?: boolean;
}) {
  return editable ? (
    <InlineValue
      table="production_recipe_versions"
      id={id}
      column={column}
      value={value}
      multiline={multiline}
    />
  ) : (
    <span className={`${READ_ONLY_VALUE} ${multiline ? "whitespace-pre-wrap" : ""}`}>
      {value ?? "—"}
    </span>
  );
}

function stamp(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

function date(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}
