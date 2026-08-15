"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { evaluateNumeric, looksLikeExpression } from "@/lib/calc";
import { DateField } from "@/components/ui/DateField";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { useCalcField } from "@/components/ui/CalcPad";

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

/**
 * A copy of `strip` with slot `index` set to `next`, padded out to `width`.
 *
 * The array counterpart of `setJsonPath`, and it exists for the same reason:
 * PostgREST can't write one element, so the whole column is rewritten. Padding
 * rather than assuming the array is already long enough matters because a row
 * that predates a column being added has no array at all, and the first slot
 * somebody edits is as likely to be the fourth as the first.
 */
function setArraySlot(
  strip: readonly (string | number | null)[] | null | undefined,
  index: number,
  next: string | number | null,
  width: number
): (string | number | null)[] {
  const out: (string | number | null)[] = [];
  for (let i = 0; i < Math.max(width, index + 1); i++) out.push(strip?.[i] ?? null);
  out[index] = next;
  return out;
}

/**
 * A value that ISN'T editable, wearing the padding `InlineValue`'s resting
 * button wears. Every editable value starts 4px in; a plain string started at 0
 * and broke the column (Mark, 2026-08-02, on an emailed order: "'email' isn't
 * aligned with the ordered date and note, probably having something to do with
 * it not being editable" — which was exactly the cause).
 *
 * It lives HERE rather than beside either caller because it is defined by this
 * component's own resting padding: change `px-1 py-0.5` below and this is what
 * has to change with it.
 */
/**
 * THE BOX EVERY STATE OF AN INLINE VALUE OCCUPIES, and the reason it is one
 * constant: clicking a cell must not move it (Mark, 2026-08-13: "when I click
 * into a field it moves/resizes and this really slows me down").
 *
 * It used to. At rest a value was `px-1 py-0.5` with no border; editing it
 * became `border-2 px-2 py-1`, so the box grew 12px wider and 8px taller and
 * the text jumped 6px right and 4px down — on every cell, on every click, in a
 * list you are typing down.
 *
 * THE EDIT STATE IS AN OUTLINE, NOT A BORDER. That is the whole trick: an
 * outline is painted outside the layout box and occupies no space, so the
 * editing frame can be as heavy as the old border while the text stays exactly
 * where it was sitting. A border can only be matched by reserving its width at
 * rest with a transparent one, which works but pushes every value — editable
 * and read-only alike — 2px further from its label across the whole app.
 */
const INLINE_BOX = "px-1 py-0.5";

/** The editing frame. `-outline-offset-1` keeps it inside the cell's own
 *  padding rather than bleeding into the column beside it. */
const INLINE_EDITING = `${INLINE_BOX} outline outline-2 -outline-offset-1 outline-ink`;

export const READ_ONLY_VALUE = `inline-block ${INLINE_BOX}`;

export function InlineValue({
  table,
  id,
  column,
  value,
  kind = "text",
  placeholder = "—",
  align = "left",
  className = "",
  emptyClassName = "text-faint",
  ariaLabel,
  nullable = true,
  format,
  alsoUpdate,
  options,
  allowNew = false,
  clearable,
  jsonColumn,
  jsonPath,
  jsonDocument,
  arrayColumn,
  arrayIndex,
  arrayStrip,
  arrayWidth,
  match,
  onWrite,
  scale,
  multiline = false,
  collapseWhenEmpty = false,
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
  /**
   * What the resting cell wears when it holds NOTHING — faint by default,
   * because an empty cell is usually just an empty cell.
   *
   * It is a prop rather than something the caller folds into `className`
   * because Tailwind resolves competing utilities by STYLESHEET order, not by
   * class-string order: `text-faint` and `text-mark` are two `@theme inline`
   * entries in the same layer, so which one wins is a coin flip that a token
   * reorder would silently flip back. The plan matrix needs a yellow "—" (an
   * unset par is worth your eye, where a blank note is not), and this is the
   * only way to say so reliably.
   */
  emptyClassName?: string;
  /**
   * The cell's accessible name. Defaults to `column`, which is right in a
   * detail `dl` where a `<dt>` sits beside it and wrong in a grid of identical
   * cells — the plan matrix is 7 × N par boxes that would otherwise all
   * announce as "—, click to edit".
   */
  ariaLabel?: string;
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
  ) => Record<string, string | number | null | (string | number | null)[]> | null;
  /** Required by kind="pick": the vocabulary this column may hold. */
  options?: PickOption[];
  /** kind="pick" only — let a value off the list be typed in (categories). */
  allowNew?: boolean;
  /**
   * kind="pick" only — offer a "None" row that writes null. DEFAULTS TO
   * `nullable`, so every pick cell over a nullable column can be emptied and no
   * cell over a NOT NULL one offers a write the database would reject. Pass it
   * explicitly only to overrule that.
   */
  clearable?: boolean;
  /** The jsonb column to write, when this cell edits a key inside one. */
  jsonColumn?: string;
  /** Path to the key within that column, e.g. ["shipping", "street1"]. */
  jsonPath?: string[];
  /** That column's CURRENT value — the object the new one is derived from. */
  jsonDocument?: Record<string, unknown> | null;
  /**
   * The array column to write, when this cell edits ONE SLOT of one.
   *
   * The same shape as the jsonb trio above, for the same reason: a Postgres
   * array is a single value to PostgREST, so the slot is set in the browser and
   * the whole column is rewritten. Built for the recipe sheet, whose scale
   * columns are `numeric[]` + `text[]` aligned with the version's own strip —
   * the `par_by_weekday` idiom, which until now had no editor at all.
   *
   * A column whose length is CONSTRAINED against a sibling array (041's scale
   * strip) must write both in one statement; that is what `alsoUpdate` is for.
   */
  arrayColumn?: string;
  /** Which slot, 0-based. */
  arrayIndex?: number;
  /** That column's CURRENT value — the array the new one is derived from. */
  arrayStrip?: readonly (string | number | null)[] | null;
  /** How many slots the written array should have. Defaults to the strip's own
   *  length, which is wrong the moment a version grows a scale column. */
  arrayWidth?: number;
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
  /**
   * Write this cell through something OTHER than an update to `table`.
   *
   * Everything else about the cell is unchanged — the arithmetic evaluator,
   * Escape-reverts, reopen-on-failure, the dotted underline, the aria name —
   * only the statement at the end differs. `table` and `column` are still
   * required, and are what the error text and the accessible name are built
   * from.
   *
   * It exists because RLS filters ROWS and some rules are about COLUMNS.
   * `production_schedule_items.made` is the case that forced it: a supervisor
   * may set it and may not touch `par` or the cost snapshot beside it, so
   * migration 044 exposes it as a definer function. Without this prop the cell
   * would issue a plain UPDATE, which for a supervisor matches zero rows and
   * returns NO ERROR — the component would report success, `router.refresh()`
   * would hand back the old value, and the number they typed would vanish with
   * nothing on screen to say why.
   *
   * Return `{ error }` — a string to show in the cell, or null for success.
   * Resolve the "wrote nothing" case yourself: a definer function that RAISES
   * gives a sentence, where a zero-row update gives silence.
   */
  onWrite?: (next: string | number | null) => Promise<{ error: string | null }>;
  /**
   * A column STORED in one unit and read in another.
   *
   * `format` is display-only and editing deliberately shows the raw value, which
   * is right for money but wrong for a unit change: showing 0.50 at rest and
   * putting 30 in the box the moment you click it invites someone to type an
   * hour figure into a minutes column. `scale` converts BOTH ways, so the cell
   * is honestly in the reader's unit end to end and the database keeps its own.
   *
   * Built for `timesheets.unpaid_break_minutes`, which is minutes in the schema
   * and has to read as hours beside Regular / OT / Worked (Mark, 2026-08-05:
   * "break times should be in fractions of an hour instead of minutes to fit
   * with hours worked"). Null passes through untouched at both ends — an empty
   * cell has no unit.
   */
  scale?: { toShown: (stored: number) => number; toStored: (shown: number) => number };
  /**
   * A field whose value is PROSE — a recipe step, a storage note.
   *
   * It edits in a textarea, so Enter makes a paragraph instead of saving, and
   * it rests with `whitespace-pre-wrap` so the line breaks somebody typed are
   * still there when they come back. ⌘/Ctrl+Enter and blur both save, since
   * with Enter spoken for there has to be a keyboard way out.
   */
  multiline?: boolean;
  /** kind="date" only — see `DateField`. For a date cell in a narrow box, where
   *  reserving a field's width for an empty value strands the calendar glyph. */
  collapseWhenEmpty?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const calcField = useCalcField();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The draft only exists while editing — seeded on open, discarded on close —
  // so a fresh server value after router.refresh() needs no re-sync effect.
  // What the reader sees and types. Identical to `value` unless `scale` is set.
  const shown =
    scale && typeof value === "number" && Number.isFinite(value) ? scale.toShown(value) : value;

  function open() {
    setDraft(shown === null ? "" : String(shown));
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
      // Back into the column's own unit before anything is compared or written.
      next = scale ? scale.toStored(value) : value;
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

    // A caller-supplied write replaces the statement and nothing else. It is
    // checked FIRST so none of the row-identity machinery below applies: a
    // definer function is handed the id it needs by the closure, and asking a
    // cell that writes through an RPC for a `match` would be asking it to
    // describe an update it never makes.
    if (onWrite) {
      const { error } = await onWrite(next);
      setSaving(false);
      if (error) {
        setError(error);
        if (reopen) setEditing(true);
        return;
      }
      router.refresh();
      return;
    }

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
          : arrayColumn && arrayIndex !== undefined
            ? {
                [arrayColumn]: setArraySlot(
                  arrayStrip,
                  arrayIndex,
                  next,
                  arrayWidth ?? arrayStrip?.length ?? 0
                ),
                ...(alsoUpdate?.(next) ?? {}),
              }
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
          clearable={clearable ?? nullable}
          disabled={saving}
          placeholder={placeholder}
          ariaLabel={ariaLabel ?? column}
          align={align}
          onPick={(next) => void write(next === "" ? null : next, false)}
          className={className}
        />
        {error && <span className="text-xs text-accent">{error}</span>}
      </span>
    );
  }

  // A DATE ALWAYS SHOWS ITS CALENDAR (Mark, 2026-08-02: "always include a
  // calendar picker for any date field"). So `kind="date"` is the second kind
  // that doesn't click-to-edit — a date input is already a box you can type
  // into AND a picker, and hiding that behind a dotted underline cost the one
  // affordance a date has that no other field does.
  //
  // The box itself is `ui/DateField`, which carries the Safari empty-date
  // apparatus and the reasons for it. All that's left here is the write.
  if (kind === "date") {
    return (
      <span className="inline-flex flex-col items-start">
        <DateField
          value={value === null ? null : String(value)}
          disabled={saving}
          required={!nullable}
          // The same gap the `pick` branch had until 2026-08-08: `ariaLabel`
          // reached the text/number button and nothing else, so a date cell
          // announced its raw COLUMN NAME ("batch_date") however carefully the
          // caller had named it.
          ariaLabel={ariaLabel ?? column}
          className={className}
          collapseWhenEmpty={collapseWhenEmpty}
          onChange={(next) => {
            if (next === null && !nullable) {
              setError("required");
              return;
            }
            if (next === (value ?? null)) return;
            setError(null);
            void write(next, false);
          }}
        />
        {error && <span className="text-xs text-accent">{error}</span>}
      </span>
    );
  }

  if (editing && multiline) {
    return (
      <span className="flex flex-col">
        <textarea
          autoFocus
          rows={4}
          value={draft}
          disabled={saving}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            // Enter is a paragraph break here, so the commit moves to the
            // modifier — a field you can only leave by clicking elsewhere is
            // one you can't fill in from a keyboard.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
            if (e.key === "Escape") {
              setError(null);
              setEditing(false);
            }
          }}
          className={`w-full resize-y ${INLINE_EDITING}`}
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
          // Same reason as the date box above: no restored values, no autofill.
          autoComplete="off"
          // No date here any more — `kind="date"` returned above with a picker
          // that's always on screen.
          // iOS's number pad has no operators, so on a touch device the field
          // asks for no system keyboard at all and `ui/CalcPad` supplies one
          // that has them. Only on the kind that runs `evaluateNumeric`.
          {...(kind === "number" ? calcField : {})}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setError(null);
              setEditing(false);
            }
          }}
          // NO `min-w-16`. It was the other half of the resize: in a column
          // narrower than 4rem — the plan matrix's par cells, a quantity beside
          // its unit — the input grew past the cell it was sitting in.
          className={`w-full ${INLINE_EDITING} ${
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
      aria-label={ariaLabel ?? column}
      // Dotted underline at rest — the quietest possible "this is editable".
      className={`w-full ${INLINE_BOX} underline decoration-neutral-300 decoration-dotted underline-offset-4 hover:bg-neutral-100 ${
        align === "right" ? "text-right tabular-nums" : "text-left"
      } ${multiline ? "whitespace-pre-wrap" : ""} ${
        shown === null || shown === "" ? emptyClassName : ""
      } ${className}`}
    >
      {shown === null || shown === ""
        ? placeholder
        : format
          ? format(shown)
          : String(shown)}
    </button>
  );
}
