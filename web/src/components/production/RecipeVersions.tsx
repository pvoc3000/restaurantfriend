"use client";

import { useState } from "react";
import { TabPicker } from "@/components/ui/TabPicker";
import { RecipeVersionSheet, type SheetVersion } from "./RecipeVersionSheet";
import { PrintRecipe } from "./PrintRecipe";

/**
 * The version picker and the sheet under it.
 *
 * Opens on the MASTER, which is what costing reads and what the kitchen makes;
 * older versions are a click away and are the reason the family exists as a
 * record at all (decision 3). The picker is a `TabPicker` because it chooses a
 * VIEW — one of N, the app's own rule — and the master carries a mark so you
 * can tell which one is in force without reading the fields.
 */
export function RecipeVersions({
  recipeName,
  elementName,
  versions,
  editable,
}: {
  recipeName: string;
  elementName: string | null;
  versions: SheetVersion[];
  editable: boolean;
}) {
  const master = versions.find((v) => v.is_master) ?? versions[0] ?? null;
  const [id, setId] = useState(master?.id ?? "");
  const current = versions.find((v) => v.id === id) ?? master;

  if (!current) {
    return (
      <p className="text-[13px] text-muted">
        This recipe has no versions yet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TabPicker
          ariaLabel="Version"
          value={current.id}
          onChange={setId}
          options={versions.map((v) => ({
            key: v.id,
            // The master is marked in the label rather than by colour: this is
            // a TabPicker, whose black cell already means "selected", and a
            // second colour in the same control would be two things to read.
            label: v.is_master ? `v${v.version_label} ★` : `v${v.version_label}`,
          }))}
        />
        <PrintRecipe
          recipeName={recipeName}
          elementName={elementName}
          version={current}
        />
      </div>

      {!current.is_master ? (
        <p className="text-[13px] text-mark">
          This is not the master version — it is kept for reference and is not
          what the element costs.
        </p>
      ) : null}

      {/* Keyed by version: every field below seeds `useState` from props, so
          without this switching versions would show the old one's values in
          the new one's cells. The order guide's own lesson, 2026-07-26. */}
      <RecipeVersionSheet key={current.id} version={current} editable={editable} />
    </div>
  );
}
