"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The blank row at the foot of FileMaker's two lists — type into it and it
 * becomes a row.
 *
 * An ingredient inserts with a LABEL and no element, which is a real state and
 * not a placeholder: 1,459 of FMP's own lines are exactly that ("pinch of
 * salt"), 036's `element_id` is nullable for them, and the element is then
 * chosen on the row itself. So adding costs one field, and linking it to the
 * catalog is a separate, later decision.
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
}: {
  table: "production_recipe_lines" | "production_recipe_steps";
  versionId: string;
  orgId: string;
  lastSort: number | null;
  /** The word on the button — "ingredient" or "step". */
  what: string;
  placeholder: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    const value = draft.trim();
    if (!value) return;
    setError(null);
    start(async () => {
      const sort = (lastSort ?? 0) + 10;
      const row: Record<string, string | number> = {
        org_id: orgId,
        version_id: versionId,
        sort,
        ...(table === "production_recipe_lines" ? { label: value } : { body: value }),
      };
      const { error: e } = await supabase.from(table).insert(row).select("id").single();
      if (e) {
        setError(e.message);
        return;
      }
      setDraft("");
      router.refresh();
    });
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
            add();
          }
        }}
        className="h-9 w-full max-w-[26rem] border border-hairline px-2 text-[14px] outline-none focus:border-ink"
      />
      <button
        type="button"
        disabled={pending || !draft.trim()}
        onClick={add}
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        {pending ? "Adding…" : `Add ${what}`}
      </button>
      {error && <span className="text-[13px] text-accent">{error}</span>}
    </div>
  );
}
