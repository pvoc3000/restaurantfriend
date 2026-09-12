"use client";

import { useRouter } from "next/navigation";
import { ControlField } from "@/components/ui/ControlField";
import { PickList } from "@/components/ui/PickList";
import { recipeHref, type RecipeTab } from "@/lib/recipes";
import type { SheetVersion } from "./RecipeVersionSheet";

/**
 * The version picker, above the record's sections. Print sheet moved up to
 * the title row (Mark, 2026-09-12).
 *
 * It sits ABOVE the split rather than inside a tab, because the version is what
 * both tabs are about: Info describes this version and Recipe is how to make it,
 * and a control that changed under you when you moved between them would be the
 * `key`-a-client-component trap in a new costume.
 *
 * WHICH VERSION IS IN THE URL (`?v=11`), not in state. That is the app's rule
 * for view state, and here it is also what makes the two tabs agree — client
 * state would be discarded on the soft navigation between them, silently
 * dropping you back to the master half way through reading v24.
 */
export function RecipeVersions({
  recipeId,
  versions,
  current,
  tab,
  params,
}: {
  recipeId: string;
  versions: SheetVersion[];
  current: SheetVersion;
  tab: RecipeTab;
  params: Record<string, string | string[] | undefined>;
}) {
  const router = useRouter();
  const href = (v: SheetVersion) =>
    recipeHref(recipeId, { tab, version: v.version_label }, params);

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* ALWAYS A PICKLIST (Mark, 2026-09-12). It was a TabPicker up to eight
          versions and a list past that — Chocolate Glaze has 38, and as tabs
          that ran 2,381px wide and scrolled the page sideways — which meant the
          same field was a different control from one recipe to the next. A
          list at every count is one control, and past eight it grows its find
          box. Captioned, because a collapsed picker has to say what it is. */}
      <ControlField label="Version">
        <PickList
          variant="field"
          ariaLabel="Version"
          value={current.version_label}
          onPick={(label) => {
            const next = versions.find((v) => v.version_label === label);
            if (next) router.push(href(next));
          }}
          options={versions.map((v) => ({
            value: v.version_label,
            label: `v${v.version_label}`,
            hint: v.is_master ? "master" : undefined,
          }))}
          className="w-48"
        />
      </ControlField>
    </div>
  );
}
