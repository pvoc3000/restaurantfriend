"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { ingredientChoice } from "@/lib/recipes";

/**
 * The blank row at the foot of FileMaker's two lists — say what it is and it
 * becomes a row.
 *
 * AN INGREDIENT IS CHOSEN FROM THE ELEMENT CATALOG (Mark, 2026-08-11: "why
 * isn't the 'name the ingredient' box a picklist of production elements?").
 * It was a plain text box, on the reasoning that a line inserts with a LABEL
 * and no element — a real state, not a placeholder, since 036 made `element_id`
 * nullable for FileMaker's "pinch of salt" lines — and that "linking it to the
 * catalog is a separate, later decision".
 *
 * BOTH HALVES OF THAT TURNED OUT TO BE WRONG. The later decision had nowhere to
 * happen: nothing in `web/src` ever wrote `element_id`, so every ingredient
 * added here was unlinked at birth, cost nothing, contributed nothing to the
 * recipe total, and could never be fixed. And the free-text case is all but
 * absent from the real data — of 891 lines with no element, 870 are the
 * metadata and separator rows (Mixer Size, Expected Yield, Total Liquid, the
 * `-` rules), leaving 21 genuine ones, 20 of which have no label either. The
 * 1,459 figure came from the raw export before the transform sorted those out.
 *
 * So: a `PickList` with `allowNew`. Choosing an element writes `element_id`;
 * typing a name the catalog has never heard of still writes `label`, so the
 * exception survives without being the default. `lib/recipes`' `ingredientChoice`
 * is what tells the two apart, and why that matters is written up there.
 *
 * STEPS KEEP THE TEXT BOX. A procedure step is prose — it has no element and
 * never will — so the picker is offered only when a caller passes `options`.
 *
 * The new row's SORT is the last one plus ten, which is FileMaker's own habit
 * and the reason its sort fields read 1, 2, 4, 5, 99: gaps are what let you put
 * something between two rows without renumbering the list.
 *
 * `org_id` is passed explicitly, as every insert in this app must — no table has
 * a default or a trigger for it, and an insert policy's WITH CHECK is evaluated
 * BEFORE the NOT NULL constraint, so omitting it reports "new row violates
 * row-level security policy" and sends you to look at roles.
 */
export function AddRecipeRow({
  table,
  versionId,
  orgId,
  lastSort,
  what,
  placeholder,
  options,
}: {
  table: "production_recipe_lines" | "production_recipe_steps";
  versionId: string;
  orgId: string;
  lastSort: number | null;
  /** The word on the button — "ingredient" or "step". */
  what: string;
  placeholder: string;
  /**
   * The element catalog. Given, this is a picker; omitted, a text box. Only the
   * ingredient list passes it — a step has nothing to choose from.
   */
  options?: PickOption[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const elementIds = useMemo(
    () => new Set((options ?? []).map((o) => o.value)),
    [options]
  );

  function insert(row: Record<string, string | number>) {
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from(table)
        .insert({ org_id: orgId, version_id: versionId, sort: (lastSort ?? 0) + 10, ...row })
        .select("id");
      if (e) {
        setError(e.message);
        return;
      }
      if (!data?.length) {
        setError("Nothing was added — the database refused the insert and said nothing.");
        return;
      }
      setDraft("");
      router.refresh();
    });
  }

  /** The picker's answer: an element off the list, or a name that isn't one. */
  function addChosen(next: string) {
    setPicking(false);
    const choice = ingredientChoice(next, elementIds);
    if (choice.kind === "element") insert({ element_id: choice.elementId });
    else if (choice.kind === "label") insert({ label: choice.label });
    // "clear" can't happen — the picker isn't clearable, having no value.
  }

  function addTyped() {
    const value = draft.trim();
    if (!value) return;
    insert(table === "production_recipe_lines" ? { label: value } : { body: value });
  }

  if (options) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {picking ? (
          // `defaultOpen`: pressing the button already said "I want to choose
          // something", so a second tap to open the list is a tap spent on
          // nothing. `onClose` fires only on the DISMISS path, so abandoning
          // puts the command back rather than leaving an empty field behind.
          <PickList
            variant="field"
            value={null}
            options={options}
            allowNew
            defaultOpen
            onClose={() => setPicking(false)}
            onPick={addChosen}
            ariaLabel={`Element to add as an ${what}`}
            placeholder={placeholder}
            className="w-full max-w-[26rem]"
          />
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setPicking(true);
            }}
            className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
          >
            {pending ? "Adding…" : `Add ${what}`}
          </button>
        )}
        {error && <span className="text-[13px] text-accent">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={draft}
        disabled={pending}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addTyped();
          }
        }}
        className="h-9 w-full max-w-[26rem] border border-hairline px-2 text-[14px] outline-none focus:border-ink"
      />
      <button
        type="button"
        disabled={pending || !draft.trim()}
        onClick={addTyped}
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        {pending ? "Adding…" : `Add ${what}`}
      </button>
      {error && <span className="text-[13px] text-accent">{error}</span>}
    </div>
  );
}
