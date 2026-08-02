"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { evaluateNumeric, looksLikeExpression } from "@/lib/calc";
import { PickList, type PickOption } from "@/components/ui/PickList";

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
 *
 * `kind="pick"` is the one that DOESN'T take typing: it renders a PickList and
 * the choice is the edit, saved immediately, with no blur to wait for. Use it
 * for any column whose values are a known vocabulary — a package token, a unit,
 * a category — which is most of what used to accept anything at all.
 *
 * A cell can also address a key INSIDE a jsonb column: pass `jsonColumn` +
 * `jsonPath` + the column's current value as `jsonDocument`. That's what the
 * location's two addresses are — thirteen fields living in `locations.address`,
 * which stays jsonb because `lib/poProcessing.ts` reads `address.shipping` as
 * the Ship-to on every vendor PO. See `write()` for the one caveat.
 */
/**
 * A copy of `doc` with `path` set to `next` — or with that key REMOVED when
 * next is null, so clearing a field leaves `{city: "…"}` rather than
 * `{city: "…", street2: null}` and the address renders the same way an
 * untouched one does.
 *
 * PostgREST can't `jsonb_set`, so the whole column is rewritten. Two people
 * editing two keys of the same column at the same moment would lose one of the
 * edits; one person edits this app, and the alternative is a security-definer
 * RPC per jsonb column, which is a lot of machinery for a form.
 */
function setJsonPath(
  doc: Record<string, unknown> | null | undefined,
  path: string[],
  next: string | number | null
): Record<string, unknown> {
  const root: Record<string, unknown> = structuredClone(doc ?? {});
  let node = root;
  for (const key of path.slice(0, -1)) {
    const child = node[key];
    node[key] =
      child && typeof child === "object" && !Array.isArray(child)
        ? (child as Record<string, unknown>)
        : {};
    node = node[key] as Record<string, unknown>;
  }
  const leaf = path[path.length - 1];
  if (next === null) delete node[leaf];
  else node[leaf] = next;
  return root;
}

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
  options,
  allowNew = false,
  jsonColumn,
  jsonPath,
  jsonDocument,
  match,
}: {
  table: string;
  /** The row's uuid — the identity of every table in the catalog. Omit it only
   *  when passing `match` instead, for a table keyed some other way. */
  id?: string;
  /** The column this cell writes — unless `jsonPath` is set, in which case
   *  this is only the field's name for error messages and aria labels. */
  column: string;
  value: string | number | null;
  /** "date" edits with a real date picker and stores an ISO yyyy-mm-dd;
   *  "pick" chooses from `options` instead of accepting typing. */
  kind?: "text" | "number" | "date" | "pick";
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
  /** Required by kind="pick": the vocabulary this column may hold. */
  options?: PickOption[];
  /** kind="pick" only — let a value off the list be typed in (categories). */
  allowNew?: boolean;
  /** The jsonb column to write, when this cell edits a key inside one. */
  jsonColumn?: string;
  /** Path to the key within that column, e.g. ["shipping", "street1"]. */
  jsonPath?: string[];
  /** That column's CURRENT value — the object the new one is derived from. */
  jsonDocument?: Record<string, unknown> | null;
  /**
   * How to find the row, when its identity ISN'T a column called `id`.
   *
   * Every table in the catalog has a uuid `id`, so `id` alone is the normal
   * case and stays the default. `org_members` doesn't: it is keyed
   * `(org_id, user_id)`, which is what the App access block edits a role
   * through. Passing the full key rather than matching on `user_id` alone
   * keeps this correct the day someone belongs to two orgs.
   */
  match?: Record<string, string>;
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
    await write(next, true);
  }

  /**
   * The write itself, shared by the typed editors and by `kind="pick"` — which
   * has no draft and no blur, so it can't go through `save`.
   *
   * `reopen` is for the typed path only: putting the box back with the value
   * still in it is how a failed write stops being silent. A pick has nothing to
   * put back, and its error shows beside the closed control instead.
   */
  async function write(next: string | number | null, reopen: boolean) {
    if (next === value || (next === null && value === null)) return;

    setSaving(true);
    setError(null);
    // One or the other; a cell with neither would silently update every row in
    // the table, so this is a hard stop rather than a default.
    const where = match ?? (id ? { id } : null);
    if (!where) {
      setSaving(false);
      setError("this field has no row to write to");
      return;
    }
    const { error } = await supabase
      .from(table)
      .update(
        jsonColumn && jsonPath
          ? { [jsonColumn]: setJsonPath(jsonDocument, jsonPath, next) }
          : { [column]: next, ...(alsoUpdate?.(next) ?? {}) }
      )
      .match(where);
    setSaving(false);
    if (error) {
      setError(error.message);
      if (reopen) setEditing(true);
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

  // A chosen value writes on the spot: there's no draft to abandon and nothing
  // to confirm, which is the same call BaseUnitEditor made ("picking a unit IS
  // the edit") and the reason the control can live in a table cell at all.
  if (kind === "pick") {
    return (
      <span className="inline-flex w-full flex-col">
        <PickList
          value={value === null ? null : String(value)}
          options={options ?? []}
          allowNew={allowNew}
          disabled={saving}
          placeholder={placeholder}
          ariaLabel={column}
          align={align}
          onPick={(next) => void write(next === "" ? null : next, false)}
          className={className}
        />
        {error && <span className="text-xs text-accent">{error}</span>}
      </span>
    );
  }

  // A DATE ALWAYS SHOWS ITS CALENDAR (Mark, 2026-08-02: "always include a
  // calendar picker for any date field" — the PO's delivery date had one and
  // the order date beside it didn't, which is what made the pair look
  // unfinished). So `kind="date"` is the second control that doesn't
  // click-to-edit: the browser's own date input is already a box you can type
  // into AND a picker, and hiding it behind a dotted underline bought nothing
  // while costing the one affordance a date has that no other field does.
  //
  // Writes on change, like `kind="pick"` and for the same reason: a date input
  // emits "" until the whole date is valid, so a change event IS a finished
  // value — there's no half-typed state to protect and nothing to confirm.
  if (kind === "date") {
    return (
      <span className="inline-flex flex-col items-start">
        <input
          type="date"
          value={value === null ? "" : String(value)}
          disabled={saving}
          required={!nullable}
          aria-label={column}
          onChange={(e) => {
            const next = e.target.value || null;
            const stored = value === null ? "" : String(value);

            // A REJECTED OR NO-OP EDIT MUST PUT THE BOX BACK BY HAND. This is
            // a controlled input whose `value` prop didn't change, so React has
            // nothing to re-render and the browser's own idea of the field
            // survives — a date box left showing something the column doesn't
            // hold and nothing will ever save. Found 2026-08-02 on a Chefs
            // Warehouse PO whose delivery_date is null in the database while
            // the field read 08/02/2026.
            if (next === null && !nullable) {
              setError("required");
              e.target.value = stored;
              return;
            }
            if (next === (value ?? null)) {
              e.target.value = stored;
              return;
            }
            setError(null);
            void write(next, false);
          }}
          // px-1 py-0.5 is the resting BUTTON's padding, not a field's: these
          // sit in a dl beside text cells, and a date indented 8px while the
          // note beside it is indented 4px is exactly the misalignment Mark
          // caught on `sent_via`. The border earns its place by saying the box
          // takes input; the padding keeps the column straight.
          className={`border border-ink px-1 py-0.5 tabular-nums disabled:opacity-35 ${className}`}
        />
        {error && <span className="text-xs text-accent">{error}</span>}
      </span>
    );
  }

  if (editing) {
    return (
      <span className="inline-flex flex-col">
        <input
          autoFocus
          value={draft}
          disabled={saving}
          // No date here any more — `kind="date"` returned above with a picker
          // that's always on screen.
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
