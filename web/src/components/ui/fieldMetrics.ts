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
 * HEIGHT IS `h-9`/36px — THE APP'S OWN FIELD HEIGHT, and the whole point is
 * that it is not a number invented here. `TextInput` says so in its own
 * comment: "h-9 is the app's field height — `TabPicker`'s cells and
 * `PickList`'s". Every button is `h-9` too. So a boxed field, a command button,
 * a filter tab and a form input are now one height everywhere in the app, which
 * is what Mark asked for when he was given the choice (2026-08-28: "whatever
 * would make for a consistent look app wide").
 *
 * IT SHIPPED AT 32px FIRST, ON A PREDICTION THAT TURNED OUT TO BE WRONG, and
 * the correction is worth keeping because the reasoning was plausible. The
 * argument was that the special-order Info tab is FOUR QUADRANTS MEASURED TO
 * ONE SCREEN (`useExactViewportHeight`) at nine rows a column, so 36px would
 * add "~68px per column" and push the scrolling panes into scrolling sooner.
 * Nobody measured it. Measured: the layout absorbs it almost entirely, because
 * the panes that scroll are exactly what gives way — the Completion dates pane
 * went 160px to 152px, EIGHT pixels, and the page's own scroll went 100px to
 * 103. On the 21-line order the table grew ~5px a row.
 *
 * What 32px cost, against that, was the thing the boxes exist for: on the Info
 * tab it left 23 fields at 32px sitting under 8 command buttons at 36, which is
 * a near-miss rather than a contrast and exactly the class of difference the
 * boxes made visible in the first place. At 36 the screen measures ONE height,
 * 190 controls of it.
 *
 * `h-8` remains a real member of the scale — it is `TabPicker size="sm"`, "for
 * tight bands like the receiving screen's" — so a genuinely dense band may
 * still want it. A record is not a tight band.
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
 * DO DETAIL SCREENS BOX THEIR EDITABLE FIELDS? (Mark, 2026-08-28: "app wide".)
 *
 * It began as one constant in `components/specialOrders/fieldLook.ts` while the
 * look was an experiment on one record; that file is gone and this is the same
 * switch with the whole app behind it. It stays a switch rather than being
 * inlined for the reason it was one: a look this pervasive should be judgeable
 * and reversible in a single edit, not forty.
 *
 * IT IS ABOUT RECORDS, NOT LISTS (Mark, same day: "lists are fine as is"). A
 * `DataTable` already has column headings and rules doing the work the box
 * does, and boxing every cell of a 790-row list is a different decision. The
 * special-order Items table is boxed because it is part of a record, and even
 * there it is the busiest result on the screen — so a caller inside a list
 * passes `boxed={false}` deliberately rather than reading this.
 */
export const BOXED_FIELDS = true;

/**
 * A single-line boxed field: one height, fills its track.
 *
 * A MINIMUM, NEVER A FIXED HEIGHT. A fixed one clipped: a short-text cell still
 * WRAPS when the value is long enough — the note on a special order's first
 * line does — and a definite height does not grow, so the second line spilled
 * 6px past the border it was meant to sit inside (measured: scrollHeight 36
 * against clientHeight 30). `min-h-9` renders every ordinary one-line field at
 * exactly 36px, because one line of 13px text plus the padding comes to less,
 * and lets the rare wrapping one take the room it needs. Uniform where
 * uniformity is possible, correct where it is not.
 */
export const BOXED_FIELD = "min-h-9 w-full";

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

/**
 * THE DRESS A FORM FIELD IN A DIALOG WEARS — border, ground, focus, padding.
 *
 * Extracted 2026-08-30 because it had already drifted once and the drift was
 * visible: `NewTask` and `ResolveTask` wrote `border-hairline` where every
 * field beside them was `border-ink`, so the Details box on the new maintenance
 * request read as disabled (Mark: "most fields have black borders, details is
 * grey"). Seven call sites had typed the same string by hand; two of them had
 * typed it wrong.
 *
 * IT CARRIES THE COLOURS ON PURPOSE, which is the opposite of the rule a
 * white-on-white Finish button taught the same week ("a shared class string
 * states layout; each caller states its own colours"). That rule is about a
 * constant whose colour a caller must be able to OVERRIDE — and it cannot, since
 * Tailwind resolves competing utilities by stylesheet order rather than
 * class-string order. Here the colours are exactly what must never vary, and
 * nothing overrides them. The corollary of the same fact still binds: **the
 * padding here cannot be overridden either**, so a field that genuinely wants
 * different padding writes its own dress rather than composing from this one.
 * The public pages do — `/inquiry`, `/welcome`, `/q/[token]` and `/login` are
 * `px-3` at `text-[16px]`, the threshold below which iOS Safari zooms the page
 * on focus, and they are a different surface with a different reason.
 *
 * It deliberately sets NO width and NO font size. The PO and special-order
 * compose panels put their body in a label/field grid, which supplies the width
 * and lets the field inherit 16px — a big writing surface for a message you are
 * about to send, and not a thing to shrink by folding a `text-sm` in here.
 */
export const FORM_FIELD_DRESS =
  "border border-ink bg-white px-2 py-1 outline-none focus:border-2";

/**
 * The ordinary multiline field in a create dialog: the dress, filling its
 * track, at the app's 14px form size. Five call sites and byte-identical
 * across all of them, which is what makes it a constant rather than a pattern.
 */
export const FORM_TEXTAREA = `w-full ${FORM_FIELD_DRESS} text-sm`;
