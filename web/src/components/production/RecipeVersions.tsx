"use client";

import { useState } from "react";
import { TabPicker } from "@/components/ui/TabPicker";
import { PickList } from "@/components/ui/PickList";
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
  orgName,
  versions,
  editable,
}: {
  recipeName: string;
  orgName: string;
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
        {/* A SEGMENTED BAR UNTIL THERE ARE TOO MANY VERSIONS, THEN A LIST.
            Chocolate Glaze has 38 and Chocolate Chip Cookie 23: a TabPicker of
            those is 2,381px wide in a 1,425px window, so the whole PAGE
            scrolled sideways — which the app's layout rules forbid outright.
            Eight is PickList's own threshold for growing a find box, and a
            reader hunting for v43 among 38 wants to type it anyway. Below
            that a bar is still right: three versions read at a glance and
            cost one tap. */}
        {versions.length > 8 ? (
          <PickList
            variant="field"
            ariaLabel="Version"
            value={current.id}
            onPick={setId}
            options={versions.map((v) => ({
              value: v.id,
              label: `v${v.version_label}`,
              hint: v.is_master ? "master" : undefined,
            }))}
            className="w-48"
          />
        ) : (
          <TabPicker
            ariaLabel="Version"
            value={current.id}
            onChange={setId}
            options={versions.map((v) => ({
              key: v.id,
              // The master is marked in the label rather than by colour: this
              // is a TabPicker, whose black cell already means "selected", and
              // a second colour in the same control would be two things to read.
              label: v.is_master ? `v${v.version_label} ★` : `v${v.version_label}`,
            }))}
          />
        )}
        <PrintRecipe recipeName={recipeName} orgName={orgName} version={current} />
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
