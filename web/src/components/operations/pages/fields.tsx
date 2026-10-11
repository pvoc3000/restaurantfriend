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

// LAYOUT ONLY; the border's colour is each field's own (`boxBorder`), the
// "shared class string states layout" rule — so one page can ask for black.
const BOX = "w-full border bg-white px-3 text-[16px] focus:outline-none";

/**
 * The box's edge. HAIRLINE by default, blackening on hover and focus; `ink`
 * is black at rest (Mark, 2026-09-30): the Donut batches fields, where the
 * black-edged picklists sit beside them, the Employees page's Note and the
 * Report page's text.
 */
function boxBorder(ink: boolean): string {
  return ink ? "border-ink" : "border-hairline hover:border-ink focus:border-ink";
}

/** A number a supervisor counts. Carries CalcPad, so "12+6" is typeable. */
export function CountField({
  value,
  onCommit,
  ariaLabel,
  disabled = false,
  ink = false,
}: {
  value: number | null;
  onCommit: (next: number | null) => void;
  ariaLabel: string;
  disabled?: boolean;
  /** A black edge at rest — see `boxBorder`. */
  ink?: boolean;
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
      className={`${BOX} ${boxBorder(ink)} h-12 text-right`}
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
  ink = false,
}: {
  value: string | null;
  onCommit: (next: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  /** A black edge at rest — see `boxBorder`. */
  ink?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [seen, setSeen] = useState(value);
  // The same guard as `ProseField`, which explains it: a refresh that follows
  // a save must not put the box back while somebody is typing in it again.
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState<{ sent: string | null } | null>(null);
  if (pending && pending.sent === value) setPending(null);
  if (seen !== value) {
    setSeen(value);
    if (!pending && !focused) setDraft(value ?? "");
  }
  return (
    <input
      type="text"
      className={`${BOX} ${boxBorder(ink)} h-12`}
      value={draft}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const next = draft.trim() === "" ? null : draft;
        if (next === (pending ? pending.sent : value)) return;
        setPending({ sent: next });
        onCommit(next);
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
  ink = false,
}: {
  value: string | null;
  onCommit: (next: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /** A black edge at rest — see `boxBorder`. */
  ink?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [seen, setSeen] = useState(value);
  const [focused, setFocused] = useState(false);
  // What this field last sent and has not yet seen come back. A save is
  // followed by a server refresh, and that refresh hands down the text AS IT
  // WAS SAVED — by which time the person has typed more. Adopting it put the
  // box back a second or two: the last word gone, the caret thrown to the end,
  // iOS's autocorrect and double-space full stop undone (2026-10-10). So the
  // box only follows the server when nobody is in it and nothing is in flight.
  const [pending, setPending] = useState<{ sent: string | null } | null>(null);
  if (pending && pending.sent === value) setPending(null);
  if (seen !== value) {
    setSeen(value);
    if (!pending && !focused) setDraft(value ?? "");
  }

  const next = draft.trim() === "" ? null : draft;
  const saved = pending ? pending.sent : value;
  const commit = () => {
    if (next === saved) return;
    setPending({ sent: next });
    onCommit(next);
  };

  // Saves on blur AND on a pause, because a supervisor writing four paragraphs
  // may never blur before the iPad sleeps.
  useEffect(() => {
    if (next === saved) return;
    const t = setTimeout(() => {
      setPending({ sent: next });
      onCommit(next);
    }, 1500);
    return () => clearTimeout(t);
  }, [next, saved, onCommit]);

  return (
    <div className="space-y-1">
      <textarea
        className={`${BOX} ${boxBorder(ink)} py-3 leading-relaxed`}
        rows={rows}
        value={draft}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
      />
      <p className="text-xs text-muted">length: {draft.length}</p>
    </div>
  );
}
