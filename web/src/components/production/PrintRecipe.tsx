"use client";

import { useState, useTransition } from "react";
import { openWindowNow, showBlob } from "@/lib/poProcessing";
import type { SheetVersion } from "./RecipeVersionSheet";

/**
 * Print the recipe sheet — the kitchen binder page.
 *
 * The renderer is imported DYNAMICALLY at click, the way PO processing does it:
 * `@react-pdf/renderer` is heavy and nothing on a normal page load needs it.
 *
 * And the window is opened SYNCHRONOUSLY, before any await. A `window.open`
 * after an await is silently blocked — the popup gotcha CLAUDE.md records, and
 * the reason `openWindowNow` exists at all.
 */
export function PrintRecipe({
  recipeName,
  elementName,
  version,
}: {
  recipeName: string;
  elementName: string | null;
  version: SheetVersion;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  function print() {
    setFailed(null);
    // Before the await, while the user gesture is still live.
    const win = openWindowNow();
    start(async () => {
      try {
        const [{ pdf }, { RecipePdf }] = await Promise.all([
          import("@react-pdf/renderer"),
          import("./pdf/RecipePdf"),
        ]);

        const blob = await pdf(
          <RecipePdf
            data={{
              orgName: "",
              recipeName,
              elementName,
              versionLabel: version.version_label,
              isMaster: version.is_master,
              author: version.author,
              description: version.description,
              yieldAmount: version.yield_amount,
              yieldUnit: version.yield_unit,
              mixerSize: version.mixer_size,
              prepTime: version.prep_time,
              shelfLife: version.shelf_life,
              storage: version.storage,
              tools: version.tools,
              note: version.note,
              testingNotes: version.testing_notes,
              scaleLabels: version.scale_labels,
              scaleMultipliers: version.scale_multipliers,
              lines: version.lines.map((l) => ({
                // The LABEL leads where there is one: FMP's `columnName_t` is
                // an override written for the printed page ("Speedy Glaze"),
                // and the element's catalog name is what it is filed under.
                name: l.label ?? l.elementName ?? "—",
                qty: l.qty,
                unit: l.unit,
                note: l.note,
                scaleAuto: l.scaleAuto,
                scaleAmounts: l.scaleAmounts,
                scaleUnits: l.scaleUnits,
                hidden: l.hideOnPrint,
                cost: l.cost.cost,
              })),
              steps: version.steps.map((s) => ({ body: s.body, imageUrl: s.imageUrl })),
              batchCost: version.batchCost.cost,
              unpricedCount: new Set(version.batchCost.unresolved.map((u) => u.name)).size,
              // The date belongs to the PRINT, not to the recipe: a sheet
              // carries live costs frozen at the moment it was made.
              printedOn: new Date().toISOString().slice(0, 10),
            }}
          />
        ).toBlob();

        showBlob(win, blob, `${recipeName} v${version.version_label}.pdf`);
      } catch (e) {
        win?.close();
        setFailed((e as Error).message ?? "The sheet could not be rendered.");
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      {failed ? <span className="text-[13px] text-accent">{failed}</span> : null}
      <button
        type="button"
        onClick={print}
        disabled={pending}
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        {pending ? "Rendering…" : "Print sheet"}
      </button>
    </div>
  );
}
