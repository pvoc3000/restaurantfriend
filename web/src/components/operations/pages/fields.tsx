"use client";

import { useEffect, useState } from "react";
import { useCalcField } from "@/components/ui/CalcPad";

/**
 * The runner's own field dress, and the reason it is not `InlineValue`.
 *
 * `InlineValue` is an edit-in-place CELL: dotted underline or a box, click to
 * open, blur to save, sized for a dense table. This is a FORM on a tablet held
 * at arm's length by somebody at the end of a shift — 44px targets, and
 * `text-[16px]`, which is the threshold below which iOS Safari zooms the whole
 * page on focus. The `/inquiry` form made the same call for the same reason.
 *
 * Every field here saves on blur, debounced, straight to the report's own draft
 * rows. Nothing it writes reaches the tables that own these facts.
 */
export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="block space-y-1">
      <span className="block text-xs font-semibold uppercase tracking-[0.08em]">{children}</span>
      {hint ? <span className="block text-xs italic text-muted">{hint}</span> : null}
    </span>
  );
}

const BOX =
  "w-full border border-hairline bg-white px-3 text-[16px] hover:border-ink focus:border-ink focus:outline-none";

/** A number a supervisor counts. Carries CalcPad, so "12+6" is typeable. */
export function CountField({
  value,
  onCommit,
  ariaLabel,
  disabled = false,
}: {
  value: number | null;
  onCommit: (next: number | null) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const calc = useCalcField();
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  // React's own "adjust state during render" pattern, and it has to be STATE
  // rather than a ref: a ref read during render is exactly what the
  // `react-hooks/refs` lint forbids, and the reason is that a ref does not make
  // the component re-render, so the box could keep a stale value. A server
  // refresh hands down a new `value` and this follows it with no effect.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value === null ? "" : String(value));
  }

  return (
    <input
      {...calc}
      type="text"
      className={`${BOX} h-12 text-right`}
      value={draft}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const raw = draft.trim();
        if (raw === "") {
          if (value !== null) onCommit(null);
          return;
        }
        const parsed = Number(raw);
        // A number that will not parse is left ON SCREEN rather than silently
        // discarded — the person can see what they typed and fix it.
        if (!Number.isFinite(parsed) || parsed < 0) return;
        if (parsed !== value) onCommit(parsed);
      }}
    />
  );
}

/** A line of free text. */
export function TextField({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  disabled = false,
}: {
  value: string | null;
  onCommit: (next: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value ?? "");
  }
  return (
    <input
      type="text"
      className={`${BOX} h-12`}
      value={draft}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim() === "" ? null : draft;
        if (next !== value) onCommit(next);
      }}
    />
  );
}

/** Prose. The narrative page is the one field with real value in it. */
export function ProseField({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  rows = 14,
  disabled = false,
}: {
  value: string | null;
  onCommit: (next: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value ?? "");
  }

  // Saves on blur AND on a pause, because a supervisor writing four paragraphs
  // may never blur before the iPad sleeps.
  useEffect(() => {
    if (draft === (value ?? "")) return;
    const t = setTimeout(() => onCommit(draft.trim() === "" ? null : draft), 1500);
    return () => clearTimeout(t);
  }, [draft, value, onCommit]);

  return (
    <div className="space-y-1">
      <textarea
        className={`${BOX} py-3 leading-relaxed`}
        rows={rows}
        value={draft}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft.trim() === "" ? null : draft)}
      />
      <p className="text-xs text-muted">length: {draft.length}</p>
    </div>
  );
}
