"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { formatTypedDate } from "@/lib/dateInput";
import { money } from "@/lib/purchaseOrders";
import type { HeaderDifference, HeaderDifferenceColumn } from "@/lib/bills";

function shown(kind: HeaderDifference["kind"], value: string | number | null): string {
  if (value === null) return "—";
  if (kind === "money") return money(Number(value));
  if (kind === "date") return formatTypedDate(String(value));
  return String(value);
}

/**
 * Where a bill and the reading of its document disagree, offered field by
 * field (Mark, 2026-10-06).
 *
 * EVERY ROW STARTS TICKED: the dialog exists because somebody asked what the
 * page says, and unticking the one misread is less work than ticking the six
 * that are right. Nothing is written until Use these is pressed, and only the
 * ticked rows are — a reading is a proposal, here as everywhere.
 *
 * The WRITE is the caller's (`onApply`), because what follows from a charge
 * — the bill's cached totals — needs the lines, and the bill screen has them.
 */
export function BillReadingDifferences({
  differences,
  onApply,
  onClose,
}: {
  differences: HeaderDifference[];
  /** Resolves to an error message, or null once the bill is written. */
  onApply: (columns: HeaderDifferenceColumn[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const [skipped, setSkipped] = useState<Set<HeaderDifferenceColumn>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = differences.filter((d) => !skipped.has(d.column));

  async function apply() {
    setSaving(true);
    setError(null);
    const problem = await onApply(chosen.map((d) => d.column));
    setSaving(false);
    if (problem) setError(problem);
  }

  return (
    <Dialog
      title="The invoice reads differently"
      onClose={onClose}
      busy={saving}
      onSubmit={chosen.length > 0 ? () => void apply() : undefined}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={DIALOG_CANCEL_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={saving || chosen.length === 0}
            className={DIALOG_COMMIT_CLASS}
          >
            {saving ? "Saving…" : "Use these"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-sm">
        <span />
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-subtle">
          Bill says
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-subtle">
          Invoice says
        </span>
        {differences.map((d) => (
          <div key={d.column} className="contents">
            <Checkbox
              checked={!skipped.has(d.column)}
              disabled={saving}
              onChange={(next) =>
                setSkipped((prev) => {
                  const out = new Set(prev);
                  if (next) out.delete(d.column);
                  else out.add(d.column);
                  return out;
                })
              }
            >
              {d.label}
            </Checkbox>
            <span className="min-w-0 break-words tabular-nums text-muted">
              {shown(d.kind, d.current)}
            </span>
            <span className="min-w-0 break-words font-semibold tabular-nums">
              {shown(d.kind, d.printed)}
            </span>
          </div>
        ))}
      </div>
      {error && (
        <p className="mt-4 border border-accent px-4 py-3 text-sm text-accent">{error}</p>
      )}
    </Dialog>
  );
}
