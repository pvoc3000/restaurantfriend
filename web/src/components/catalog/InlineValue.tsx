"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * One inline-editable cell: click, type, Enter or blur to save. The write is a
 * plain supabase-js update under RLS (purchaser+ for catalog tables), so price
 * and par edits still fire the DB history triggers — never log in app code
 * (CLAUDE.md rule 6).
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
}: {
  table: string;
  id: string;
  column: string;
  value: string | number | null;
  kind?: "text" | "number";
  placeholder?: string;
  align?: "left" | "right";
  className?: string;
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
    const next: string | number | null =
      trimmed === "" ? null : kind === "number" ? Number(trimmed) : trimmed;

    if (kind === "number" && next !== null && Number.isNaN(next)) {
      setError("not a number");
      return;
    }
    setEditing(false);
    if (next === value || (next === null && value === null)) return;

    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from(table)
      .update({ [column]: next })
      .eq("id", id);
    setSaving(false);
    if (error) {
      setError(error.message);
      setEditing(true);
      return;
    }
    router.refresh();
  }

  if (editing) {
    return (
      <span className="inline-flex flex-col">
        <input
          autoFocus
          value={draft}
          disabled={saving}
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
          className={`w-full min-w-16 rounded border border-blue-400 px-1 py-0.5 text-sm ${
            align === "right" ? "text-right tabular-nums" : ""
          }`}
        />
        {error && <span className="text-xs text-red-700">{error}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      title="Click to edit"
      className={`w-full rounded px-1 py-0.5 hover:bg-blue-50 ${
        align === "right" ? "text-right tabular-nums" : "text-left"
      } ${value === null || value === "" ? "text-neutral-400" : ""} ${className}`}
    >
      {value === null || value === "" ? placeholder : String(value)}
    </button>
  );
}
