"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { evaluateNumeric, looksLikeExpression } from "@/lib/calc";

/**
 * One inline-editable cell: click, type, Enter or blur to save. The write is a
 * plain supabase-js update under RLS (purchaser+ for catalog tables), so price
 * and par edits still fire the DB history triggers — never log in app code
 * (CLAUDE.md rule 6).
 *
 * A `kind="number"` cell accepts arithmetic: type "4*9*25" and it stores 900,
 * with a live "= 900" under the box while you type (lib/calc.ts). Par is the
 * reason — it's in base units, but you know the pack and how many cases you
 * want, so entering it meant doing the multiplication somewhere else.
 *
 * Escape reverts. A failed write keeps the typed value on screen with the error
 * so nothing is silently lost.
 */
export function InlineValue({
  table,
  id,
  column,
  value,
  kind = "text",
  placeholder = "—",
  align = "left",
  className = "",
  nullable = true,
  format,
  alsoUpdate,
}: {
  table: string;
  id: string;
  column: string;
  value: string | number | null;
  /** "date" edits with a real date picker and stores an ISO yyyy-mm-dd. */
  kind?: "text" | "number" | "date";
  placeholder?: string;
  align?: "left" | "right";
  className?: string;
  /** False for a NOT NULL column: clearing the cell asks for a value instead
   *  of handing back a raw Postgres null-violation. */
  nullable?: boolean;
  /** Display-only formatting (e.g. money). Editing always shows the raw value. */
  format?: (value: string | number) => string;
  /**
   * Extra columns to write in the SAME update, derived from the value being
   * saved. For a field another column is computed from — a vendor item's pack
   * size and its base-unit total — a one-column write leaves the pair
   * disagreeing, which is exactly how a case of 16 oz bottles kept a content of
   * 192 after the item started being counted in bottles.
   *
   * Return null to write only this column. One statement either way, so the two
   * can't half-succeed.
   */
  alsoUpdate?: (
    next: string | number | null
  ) => Record<string, string | number | null> | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The draft only exists while editing — seeded on open, discarded on close —
  // so a fresh server value after router.refresh() needs no re-sync effect.
  function open() {
    setDraft(value === null ? "" : String(value));
    setError(null);
    setEditing(true);
  }

  async function save() {
    const trimmed = draft.trim();

    let next: string | number | null;
    if (trimmed === "") {
      next = null;
    } else if (kind === "number") {
      // A number cell accepts arithmetic — "4*9*25" stores 900. A plain number
      // is just an expression that evaluates to itself, so this is a widening,
      // not a change of behaviour.
      const value = evaluateNumeric(trimmed);
      if (value === null) {
        setError(looksLikeExpression(trimmed) ? "can't work that out" : "not a number");
        return;
      }
      next = value;
    } else {
      next = trimmed;
    }

    if (next === null && !nullable) {
      setError("required");
      return;
    }
    setEditing(false);
    if (next === value || (next === null && value === null)) return;

    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from(table)
      .update({ [column]: next, ...(alsoUpdate?.(next) ?? {}) })
      .eq("id", id);
    setSaving(false);
    if (error) {
      setError(error.message);
      setEditing(true);
      return;
    }
    router.refresh();
  }

  // The answer, while you're still typing the sum. Only for something that
  // actually looks like a calculation — echoing "= 900" under a box you just
  // typed 900 into would be noise.
  const preview =
    editing && kind === "number" && looksLikeExpression(draft)
      ? evaluateNumeric(draft)
      : null;

  if (editing) {
    return (
      <span className="inline-flex flex-col">
        <input
          autoFocus
          value={draft}
          disabled={saving}
          type={kind === "date" ? "date" : undefined}
          inputMode={kind === "number" ? "decimal" : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setError(null);
              setEditing(false);
            }
          }}
          className={`w-full min-w-16 border-2 border-ink px-2 py-1 outline-none ${
            align === "right" ? "text-right tabular-nums" : ""
          }`}
        />
        {error ? (
          <span className="text-xs text-accent">{error}</span>
        ) : (
          preview !== null && (
            <span className="text-xs tabular-nums text-muted">= {preview}</span>
          )
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      title="Click to edit"
      // Dotted underline at rest — the quietest possible "this is editable".
      className={`w-full px-1 py-0.5 underline decoration-neutral-300 decoration-dotted underline-offset-4 hover:bg-neutral-100 ${
        align === "right" ? "text-right tabular-nums" : "text-left"
      } ${value === null || value === "" ? "text-faint" : ""} ${className}`}
    >
      {value === null || value === ""
        ? placeholder
        : format
          ? format(value)
          : String(value)}
    </button>
  );
}
