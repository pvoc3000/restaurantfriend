"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Switch } from "@/components/ui/Switch";
import { useExactViewportHeight } from "@/lib/tableHead";
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
 * should scroll"). So the four blocks are laid out rather than stacked: the
 * fields at their natural height, then a row that takes whatever is left, with
 * NOTES and VERSIONS sharing the left column in proportion and scrolling their
 * own contents, and COSTS beside them. A recipe with 38 versions and a page of
 * testing notes fills the same frame as one with two lines of each.
 *
 * The height is MEASURED, never a CSS constant — `useFillViewportHeight`, the
 * same reason the receiving screen measures its own: what sits above this row
 * varies with the masthead's wrapping and with how long the description runs,
 * and every constant is wrong at some width.
 *
 * Below `xl` it STACKS at natural height and the page scrolls, which is the
 * receiving screen's rule too: nothing hidden, no panes too short to read.
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
  // THE CAP IS ON THE ROW, not on the whole tab. Capping the frame made the
  // three cells whatever was left after the fields block — 250px on a laptop,
  // which is not a pane, it is a letterbox (Mark, 2026-08-08: "much taller").
  // Measuring the row itself lets it take the window down to its own floor, and
  // past that the page scrolls rather than the cells shrinking further.
  // NOT GATED ON WIDTH. It was, on `xl`, and that is what left the page with
  // most of its height unused on any window narrower than 1280 — no height was
  // written at all and every pane fell back to its natural size. Height is the
  // only thing this measurement is about, so a short window is handled by the
  // FLOOR: below it the page scrolls, which is the honest failure.
  const row = useRef<HTMLDivElement>(null);
  useExactViewportHeight(row, true, 760);

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
    <div className="flex flex-col gap-6">
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
        <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-6 gap-y-2 text-[14px] lg:grid-cols-[minmax(6rem,auto)_1fr_minmax(6rem,auto)_1fr]">
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

      <div
        ref={row}
        className="flex min-h-0 flex-col gap-10 overflow-hidden xl:grid xl:grid-cols-2 xl:gap-10"
      >
        {/* `min-w-0` on BOTH columns, and not behind a breakpoint: a flex item's
            min-width defaults to min-content, so the costs matrix's own
            `minWidth` would make its column refuse to shrink and push the whole
            page sideways rather than scrolling inside its box. */}
        <div className="flex min-h-0 min-w-0 flex-col gap-10">
          <Notes version={version} editable={editable} />
          <RecipeVersionList
            recipeId={recipeId}
            current={version}
            versions={versions}
            editable={editable}
            params={params}
          />
        </div>
        {/* `min-w-0` is not optional here: without it the matrix's own
            `minWidth` stops this track shrinking and pushes the PAGE sideways
            instead of scrolling inside the box. */}
        <div className="min-h-0 min-w-0 overflow-y-auto">
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
  );
}

/**
 * The version's prose, in its own cell so a page of testing notes can't push
 * everything else off the screen.
 *
 * `basis-0 grow` rather than `flex-1`: the proportion has to be of the WHOLE
 * cell, not of whatever is left after the content has had its say, or a long
 * note takes the versions list's room and the ratio means nothing.
 */
function Notes({ version, editable }: { version: SheetVersion; editable: boolean }) {
  return (
    <section className="flex min-h-0 basis-0 grow flex-col gap-3">
      <SectionHeading>Notes</SectionHeading>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-[14px]">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Version note
          </p>
          <Editable id={version.id} column="note" value={version.note} editable={editable} multiline />
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Testing notes
          </p>
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
    <section className="flex min-h-0 basis-0 grow-[2] flex-col gap-3">
      <SectionHeading count={versions.length}>Versions</SectionHeading>
      <div className="min-h-0 flex-1 overflow-y-auto">
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
    <th className="sticky top-0 z-10 border-b-2 border-ink bg-white px-2 py-2 text-left">
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
