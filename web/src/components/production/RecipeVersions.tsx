"use client";

import { useRouter } from "next/navigation";
import { TabPicker } from "@/components/ui/TabPicker";
import { PickList } from "@/components/ui/PickList";
import { recipeHref, type RecipeTab } from "@/lib/recipes";
import { PrintRecipe } from "./PrintRecipe";
import type { SheetVersion } from "./RecipeVersionSheet";

/**
 * The version picker and Print sheet, above the record's sections.
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
  recipeName,
  orgName,
  versions,
  current,
  tab,
  params,
}: {
  recipeId: string;
  recipeName: string;
  orgName: string;
  versions: SheetVersion[];
  current: SheetVersion;
  tab: RecipeTab;
  params: Record<string, string | string[] | undefined>;
}) {
  const router = useRouter();
  const href = (v: SheetVersion) =>
    recipeHref(recipeId, { tab, version: v.version_label }, params);

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      {/* A SEGMENTED BAR UNTIL THERE ARE TOO MANY VERSIONS, THEN A LIST.
          Chocolate Glaze has 38 and Chocolate Chip Cookie 23: a TabPicker of
          those is 2,381px wide in a 1,425px window, so the whole PAGE scrolled
          sideways — which the app's layout rules forbid outright. Eight is
          PickList's own threshold for growing a find box, and a reader hunting
          for v43 among 38 wants to type it anyway. Below that a bar is still
          right: three versions read at a glance and cost one tap. */}
      {versions.length > 8 ? (
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
      ) : (
        <TabPicker
          ariaLabel="Version"
          value={current.version_label}
          options={versions.map((v) => ({
            key: v.version_label,
            // The master is marked in the label rather than by colour: this is a
            // TabPicker, whose black cell already means "selected", and a second
            // colour in the same control would be two things to read.
            label: v.is_master ? `v${v.version_label} ★` : `v${v.version_label}`,
            href: href(v),
          }))}
        />
      )}
      <PrintRecipe recipeName={recipeName} orgName={orgName} version={current} />
    </div>
  );
}
