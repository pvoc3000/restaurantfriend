"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Checkbox } from "@/components/ui/Checkbox";
import { freezeScales, type ScalableLine, type ScaleColumn } from "@/lib/production";

/**
 * The AUTO box — FileMaker's `AutoUpdate_bool`, one per ingredient row, sitting
 * between the base column and the first scaled one because that is exactly what
 * it governs.
 *
 * A CHECKBOX AND NOT A SWITCH (Mark, 2026-08-08: "we have both toggle switches
 * and check boxes in the ingredient list. Pick one"). Both were doing the same
 * job on the same row — this and HIDE — and two shapes for one kind of answer is
 * just something else to read. The box wins on the two grounds that decide it:
 * FileMaker uses one here, and at 18px square it costs a third of the width a
 * 36×20 switch does on a grid that is already 1,300px wide. `ui/Switch` stays
 * what it is — a control for a RECORD's state, which is what `ActiveToggle` and
 * the versions list use it for.
 *
 * ON: the columns to its right are the base times the multiplier above them.
 * OFF: they are whatever somebody typed, and nothing overwrites them.
 *
 * TURNING IT OFF FREEZES WHAT IS ON SCREEN, in the same statement. Anything
 * else loses the row: the computed values live nowhere but the render, so a
 * bare `scale_auto = false` would blank four cells the instant you took control
 * of them, which reads as having destroyed the line rather than as having
 * claimed it. Turning it back ON leaves the strip where it is — it costs
 * nothing, it stops a mis-tap being destructive, and the next switch-off
 * re-freezes over it anyway.
 */
export function ScaleAutoBox({
  line,
  columns,
  base,
  baseIndex,
  percent,
  editable,
}: {
  line: ScalableLine & { id: string };
  columns: ScaleColumn[];
  base: number;
  baseIndex: number;
  /** The derived baker's percentage, so a frozen `%` column keeps its number. */
  percent: number | null;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const auto = line.scaleAuto !== false;
  const [on, setOn] = useState(auto);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  if (!editable) {
    return (
      <span className="text-[11px] uppercase tracking-[0.12em] text-subtle">
        {auto ? "auto" : "set"}
      </span>
    );
  }

  function toggle() {
    const next = !on;
    setOn(next);
    setFailed(false);
    start(async () => {
      const frozen = next ? null : freezeScales(line, columns, base, percent, baseIndex);
      const { data, error } = await supabase
        .from("production_recipe_lines")
        .update(
          frozen
            ? { scale_auto: false, scale_amounts: frozen.amounts, scale_units: frozen.units }
            : { scale_auto: true }
        )
        .eq("id", line.id)
        // An update matching no policy changes nothing and returns NO error, so
        // a bare call would report a cheerful success and leave the switch
        // showing a state the database never took.
        .select("id");
      if (error || !data?.length) {
        setOn(!next);
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Checkbox
        checked={on}
        disabled={pending}
        size={18}
        label={
          on
            ? "Scaled from the multipliers — clear to type these columns"
            : "Typed — tick to scale these columns from the multipliers"
        }
        onChange={toggle}
      />
      {failed && <span className="text-[11px] uppercase text-accent">retry</span>}
    </span>
  );
}

/**
 * The HIDE box — FMP's `shouldHide_bool`. The row stays in the recipe and comes
 * off the printed sheet, which is how a working note ("check the water
 * temperature") lives in the record without going into the binder. 304 lines
 * came over carrying it.
 */
export function HideOnPrint({
  id,
  hidden,
  editable,
}: {
  id: string;
  hidden: boolean;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [on, setOn] = useState(hidden);
  const [pending, start] = useTransition();

  if (!editable) {
    return hidden ? (
      <span className="text-[11px] uppercase tracking-[0.12em] text-subtle">hidden</span>
    ) : null;
  }

  return (
    <Checkbox
      checked={on}
      disabled={pending}
      size={18}
      label={on ? "Hidden when printed" : "Printed"}
      onChange={(next) => {
        setOn(next);
        start(async () => {
          const { data, error } = await supabase
            .from("production_recipe_lines")
            .update({ hide_on_print: next })
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
 * Take a row off the recipe.
 *
 * `window.confirm`, matching the PO batch-delete pattern, and it NAMES the row
 * — a grid of numbered rows is exactly where a delete lands on the wrong one.
 * The delete `.select()`s its own result for the reason 023 taught: with no
 * matching policy Postgres removes zero rows and PostgREST returns no error, so
 * a bare call reports success and leaves the row on screen after the refresh,
 * which reads as the button being broken rather than as being refused.
 */
export function DeleteRecipeRow({
  table,
  id,
  what,
}: {
  table: "production_recipe_lines" | "production_recipe_steps";
  id: string;
  what: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        title={`Remove ${what}`}
        aria-label={`Remove ${what}`}
        onClick={() => {
          if (!window.confirm(`Remove ${what} from this version?\n\nThis cannot be undone.`)) {
            return;
          }
          setError(null);
          start(async () => {
            const { data, error: e } = await supabase
              .from(table)
              .delete()
              .eq("id", id)
              .select("id");
            if (e) {
              setError(e.message);
              return;
            }
            if (!data?.length) {
              setError("not allowed");
              return;
            }
            router.refresh();
          });
        }}
        className="px-1 py-0.5 text-[14px] leading-none text-subtle hover:text-accent disabled:opacity-35"
      >
        ×
      </button>
      {error && <span className="text-[11px] text-accent">{error}</span>}
    </span>
  );
}
