"use client";

import { useState, useTransition } from "react";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { openWindowNow, showBlob } from "@/lib/poProcessing";
import type { ChecklistPdfData } from "./pdf/ChecklistPdf";

/**
 * The completed checklist as paper.
 *
 * The record screen is what the shop reads and the emailed shift report is what
 * management reads; neither is what a health inspector asks for. They ask for
 * the paper.
 *
 * THE WINDOW OPENS SYNCHRONOUSLY, before any `await` — a `window.open` after
 * one is silently blocked, which is the PO module's own hard-won note and looks
 * exactly like the button doing nothing. `showBlob` falls back to a download
 * when the popup was blocked anyway.
 */
export function PrintChecklist({ data }: { data: ChecklistPdfData }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  function print() {
    setFailed(null);
    const win = openWindowNow();
    start(async () => {
      try {
        const [{ pdf }, { ChecklistPdf }] = await Promise.all([
          import("@react-pdf/renderer"),
          import("./pdf/ChecklistPdf"),
        ]);
        const blob = await pdf(<ChecklistPdf data={data} />).toBlob();
        showBlob(win, blob, `${data.businessDate} ${data.title}.pdf`);
      } catch (e) {
        win?.close();
        setFailed(e instanceof Error ? e.message : "The PDF could not be built.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className={BUTTON_CLASS}
        disabled={pending}
        onClick={print}
      >
        {pending ? "Building…" : "Print"}
      </button>
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}
    </div>
  );
}
