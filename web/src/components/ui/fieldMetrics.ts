/**
 * ONE DRESS FOR EVERY BOXED FIELD (Mark, 2026-08-28: "I'm noticing different
 * heights on the fields now. Let's pick a good height that works for all
 * controls and then apply it to everything. If we can also make sure widths
 * are aligned…").
 *
 * The boxes made a difference visible that the dotted underline had hidden.
 * Measured on the record's Info tab before this: THREE heights — 28.5px for a
 * text, number or pick cell, 30px for a date or a time — and TWO widths, 214px
 * where a field filled its column against 142px for every date, which is
 * `DateField`'s fixed `w-28` plus its calendar glyph. Underlined, a 1.5px
 * difference in height is invisible and a short field just looks like a short
 * value; boxed, both read as misalignment, because a box declares where a
 * thing begins and ends.
 *
 * HEIGHT IS 32px, WHICH IS A CHOICE BETWEEN TWO EXISTING NUMBERS. The app's
 * form controls — `TextInput`, `TabPicker`, `PickList variant="field"` — are
 * all `h-9`/36px, and matching them would have been the tidiest answer on
 * paper. It costs too much here: the Info tab is FOUR QUADRANTS MEASURED TO
 * ONE SCREEN (`useExactViewportHeight`), nine rows to a column, so 36px adds
 * ~68px per column and pushes the panes that scroll into scrolling sooner.
 * 32px clears the tallest natural control (the 30px date) with room for its
 * border, and adds ~32px per column. If the record ever stops being one
 * measured screen, `h-9` is the value to revisit.
 *
 * WIDTH IS THE TRACK, NOT A SCALE. Mark asked whether a predetermined set of
 * widths would help pages stay coherent; the answer here is that the `dl`
 * ALREADY defines them — every field fills its own column, so a block's fields
 * share a left AND a right edge with no numbers to choose or keep in step, and
 * the grid stays the single place a layout is decided. A scale would be a
 * second system saying the same thing, and the first field somebody sized `md`
 * in a `lg` track would be misaligned again with nothing on screen explaining
 * why. Where a value genuinely wants to be narrow — a quantity in a table —
 * that column is already narrow.
 *
 * A side effect worth knowing: `w-full` is what lets a date SHRINK, which fixes
 * the Completion dates block that has been overflowing its quadrant by ~75px
 * since long before the boxes (a fixed 112px date field twice over, plus two
 * 128px label tracks, in 450px).
 */

/**
 * A single-line boxed field: one height, fills its track.
 *
 * A MINIMUM, NEVER A FIXED HEIGHT. `h-8` was the first cut and it clipped: a
 * short-text cell still WRAPS when the value is long enough — the note on a
 * special order's first line does — and a definite height does not grow, so the
 * second line spilled 6px past the border it was meant to sit inside
 * (measured: scrollHeight 36 against clientHeight 30). `min-h-8` renders every
 * ordinary one-line field at exactly 32px, because one line of 13px text plus
 * the padding comes to less, and lets the rare wrapping one take the room it
 * needs. Uniform where uniformity is possible, correct where it is not.
 */
export const BOXED_FIELD = "min-h-8 w-full";

/** The box itself — the resting cue that says "you can change this". */
export const BOXED_FIELD_BORDER = "border border-hairline hover:border-ink";

/** A boxed MULTILINE field grows instead, from a paragraph's worth of floor. */
export const BOXED_FIELD_TALL = "min-h-16 w-full";

/**
 * WHAT AN EMPTY FIELD USED TO SAY, and no longer needs to (Mark, 2026-08-28:
 * "with the boxes, there's no longer a need for the em dashes in other empty
 * fields… we can tell it's empty now").
 *
 * The em dash was never decoration: an underlined cell with nothing in it is a
 * few pixels of dotted rule, which is neither legible as a field nor a target
 * you can hit, so something had to stand in the gap. A box does that job
 * properly — it has an outline and 32px of height whether or not it holds
 * anything — and the dash left over reads as a VALUE, which on a field that is
 * genuinely empty is the same lie the time examples told.
 *
 * SUPPRESSED, NOT FORBIDDEN, and the difference matters: only a placeholder
 * that IS this dash goes. A caller passing real text still shows it — `TakenBy`
 * puts FileMaker's own name there on the 7,944 migrated orders that have no
 * employee link, and blanking that would delete the only record of who took
 * the order rather than tidying a hint.
 */
export const EMPTY_FIELD_DASH = "—";

/** What a boxed field should show when it holds nothing: the caller's
 *  placeholder, unless that placeholder is the dash a box makes redundant. */
export function fieldPlaceholder(placeholder: string, boxed: boolean): string {
  return boxed && placeholder === EMPTY_FIELD_DASH ? "" : placeholder;
}
