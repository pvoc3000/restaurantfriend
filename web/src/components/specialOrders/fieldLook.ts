/**
 * AN EXPERIMENT: every editable field on the special-order record wears a
 * bounding box (Mark, 2026-08-28 — "I'm having trouble distinguishing editable
 * from non-editable, and fields from labels. The page just looks like a lot of
 * text").
 *
 * ONE KNOB, so it can be judged and then kept, trimmed or reverted in a single
 * edit rather than forty. Set it false and the record goes back to the dotted
 * underline everywhere; delete this file and inline `false` to retire it.
 *
 * WHAT THE BOX MEANS HERE IS "YOU CAN CHANGE THIS", which is why the underline
 * comes off with it — two cues for one fact, and the second reads as an
 * artefact — and why a read-only value gets NO box. That is the whole
 * distinction being tested, so it is the one thing not to blur: if a
 * `READ_ONLY_VALUE` ever grows a border, the experiment stops answering the
 * question it was set.
 *
 * A boxed MULTILINE field keeps its 64px minimum (the Notes tab, unchanged
 * since 2026-08-21) — the box says "editable", the height says "put a
 * paragraph here", and only notes want the second.
 */
export const BOXED_FIELDS = true;
