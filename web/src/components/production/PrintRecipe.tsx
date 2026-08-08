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
  orgName,
  version,
}: {
  recipeName: string;
  /** Printed at the foot of every page, where FileMaker sets the wordmark. */
  orgName: string;
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
              orgName,
              recipeName,
              versionLabel: version.version_label,
              createdAt: formatStamp(version.created_at),
              author: version.author,
              info: version.description,
              shelfLife: version.shelf_life,
              storage: version.storage,
              tools: version.tools,
              scaleLabels: version.scale_labels,
              scaleMultipliers: version.scale_multipliers,
              lines: version.lines.map((l) => ({
                // THE ELEMENT'S NAME LEADS, and the label is only a fallback.
                // FileMaker's own printed sheet does the same, and its data is
                // why: `columnName_t` is an override that goes stale when a
                // version is copied. Banana Cake Donut v10 still carries
                // "Coffee" and "Amoretti Espresso Artisan Flavor" over its
                // bananas, left behind by the coffee donut it was cloned from —
                // and FMP prints "Bananas, Mashed", because it reads the item.
                name: l.elementName ?? l.label ?? "—",
                qty: l.qty,
                unit: l.unit,
                scaleAuto: l.scaleAuto,
                scaleAmounts: l.scaleAmounts,
                scaleUnits: l.scaleUnits,
                hidden: l.hideOnPrint,
                sort: l.sort,
              })),
              steps: version.steps.map((s) => ({ body: s.body, imageUrl: s.imageUrl })),
              printedOn: new Date().toLocaleDateString(),
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

/**
 * A timestamp as FileMaker's header block sets it — the local date and time,
 * not an ISO string. This is the one page in the app read by somebody who has
 * never seen a database.
 */
function formatStamp(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}
