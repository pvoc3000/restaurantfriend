"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Switch } from "@/components/ui/Switch";
import { formatCost, unresolvedSummary } from "@/lib/productionCost";
import { recipeHref } from "@/lib/recipes";
import { RecipeCosts } from "./RecipeCosts";
import type { SheetVersion } from "./RecipeVersionSheet";

/**
 * The recipe's Info tab — everything about this version that isn't the making
 * of it, which is FileMaker's own split between its INFO and RECIPE tabs.
 *
 * Three blocks: the version's own fields, the family's other versions, and the
 * costs. The middle one is the piece the app had been missing outright — a
 * recipe with 38 versions was a picker with 38 cells in it and no way to see
 * when each was written or why, which is the only thing that makes an old
 * version worth keeping.
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
  return (
    <div className="space-y-16">
      <section className="space-y-3">
        <SectionHeading>Version {version.version_label}</SectionHeading>
        <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-2 text-[14px] lg:grid-cols-[minmax(7rem,auto)_1fr_minmax(7rem,auto)_1fr]">
          <Fact label="Description">
            <Editable id={version.id} column="description" value={version.description} editable={editable} />
          </Fact>
          <Fact label="Storage">
            <Editable id={version.id} column="storage" value={version.storage} editable={editable} />
          </Fact>
          <Fact label="Note">
            <Editable id={version.id} column="note" value={version.note} editable={editable} multiline />
          </Fact>
          <Fact label="Prep time">
            <Editable id={version.id} column="prep_time" value={version.prep_time} editable={editable} />
          </Fact>
          <Fact label="Author">
            <Editable id={version.id} column="author" value={version.author} editable={editable} />
          </Fact>
          <Fact label="Shelf life">
            <Editable id={version.id} column="shelf_life" value={version.shelf_life} editable={editable} />
          </Fact>
          <Fact label="Mixer">
            <Editable id={version.id} column="mixer_size" value={version.mixer_size} editable={editable} />
          </Fact>
          <Fact label="Tools">
            <Editable id={version.id} column="tools" value={version.tools} editable={editable} multiline />
          </Fact>
          <Fact label="Yield">
            {editable ? (
              <span className="flex items-baseline gap-1">
                <InlineValue
                  table="production_recipe_versions"
                  id={version.id}
                  column="yield_amount"
                  kind="number"
                  value={version.yield_amount}
                />
                <InlineValue
                  table="production_recipe_versions"
                  id={version.id}
                  column="yield_unit"
                  value={version.yield_unit}
                />
              </span>
            ) : (
              <span className={READ_ONLY_VALUE}>
                {version.yield_amount === null
                  ? "—"
                  : `${version.yield_amount} ${version.yield_unit ?? ""}`.trim()}
              </span>
            )}
          </Fact>
          <Fact label="Created">
            <span className={READ_ONLY_VALUE}>{formatStamp(version.created_at) ?? "—"}</span>
          </Fact>
          <Fact label="Batch cost">
            {/* The gaps note goes on its OWN LINE, never beside the figure. Set
                inline it read "≥ $7.385 not priced" — the count's first digit
                runs straight onto the cents. A WRAPPER, not `block` on the
                spans: READ_ONLY_VALUE carries `inline-block`, and Tailwind
                resolves competing display utilities by stylesheet order. */}
            <span className="flex flex-col items-start">
              <span className={`${READ_ONLY_VALUE} tabular-nums`}>{formatCost(version.batchCost)}</span>
              {unresolvedSummary(version.batchCost) ? (
                <span className={`${READ_ONLY_VALUE} text-[13px] text-mark`}>
                  {unresolvedSummary(version.batchCost)}
                </span>
              ) : null}
            </span>
          </Fact>
          <Fact label="Testing notes">
            <Editable
              id={version.id}
              column="testing_notes"
              value={version.testing_notes}
              editable={editable}
              multiline
            />
          </Fact>
        </dl>
      </section>

      <RecipeVersionList
        recipeId={recipeId}
        current={version}
        versions={versions}
        editable={editable}
        params={params}
      />

      <RecipeCosts
        version={version}
        laborRate={laborRate}
        locationCode={locationCode}
        editable={editable}
      />
    </div>
  );
}

/**
 * Every version of this recipe, and which one is in force.
 *
 * NOT a `DataTable`: it is short, it has no sort worth offering and no columns
 * worth hiding, and its rows are the family's own history in version order —
 * which is the one order it should ever be in. What it does have is the two
 * things the picker could never show, the date and the note, and those are the
 * whole reason a shop keeps v24 around.
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
    <section className="space-y-3">
      <SectionHeading count={versions.length}>Versions</SectionHeading>
      <table className="w-full table-fixed border-collapse text-[14px]">
        <colgroup>
          <col style={{ width: 90 }} />
          <col style={{ width: 92 }} />
          <col style={{ width: 130 }} />
          <col />
          <col style={{ width: 130 }} />
        </colgroup>
        <thead>
          <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em] text-ink">
            <th className="px-3 py-2 text-left">Version</th>
            <th className="px-3 py-2 text-left">Active</th>
            <th className="px-3 py-2 text-left">Created</th>
            <th className="px-3 py-2 text-left">Note</th>
            <th className="px-3 py-2 text-left">Master</th>
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
              <td className="px-3 py-2">
                <Link
                  href={recipeHref(recipeId, { tab: "info", version: v.version_label }, params)}
                  className="hover:underline"
                >
                  v{v.version_label}
                </Link>
              </td>
              <td className="px-3 py-2">
                {editable ? (
                  <ActiveVersion id={v.id} active={v.is_active} />
                ) : (
                  <span className={`${READ_ONLY_VALUE} text-[13px] text-muted`}>
                    {v.is_active ? "Active" : "Inactive"}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-[13px] text-muted">{formatDate(v.created_at)}</td>
              <td className="px-3 py-2 text-[13px] text-muted">{v.note ?? ""}</td>
              <td className="px-3 py-2">
                {v.is_master ? (
                  <span className="inline-flex items-center gap-1 text-[12px] font-semibold uppercase tracking-[0.06em]">
                    ★ Master
                  </span>
                ) : editable ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => makeMaster(v)}
                    className="border border-hairline px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] text-muted hover:border-ink hover:text-ink disabled:opacity-35"
                  >
                    Make master
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
      <p className="max-w-[70ch] text-[12px] text-muted">
        The master is what the element costs and what the recipe sheet prints by
        default. Exactly one version may be master; the others are kept for
        reference.
      </p>
    </section>
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

function formatStamp(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}
