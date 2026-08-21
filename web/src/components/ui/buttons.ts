// The app's button weights, where more than one screen needs the same one.
//
// There is essentially ONE button in this design system — white, black-outlined,
// filling black on hover — and the rules around it are about the exceptions.
// Black fill means a SET FILTER, a delimiting band, or a panel's own commit
// (`DIALOG_COMMIT_CLASS`). Red means DESTRUCTIVE, which is this file.

/**
 * A destructive command, out on a screen: Delete, Void, "Deactivate everywhere".
 *
 * RED EVEN THOUGH MOST OF THESE ONLY OPEN A CONFIRM (Mark, 2026-08-06). The
 * employee record argued the other way for a while — that the red belongs on the
 * commit inside the dialog, since that is the keystroke that actually destroys
 * something — and it was alone: seven other triggers were already red and every
 * one of them is also just an opener. A reader cannot tell "this opens a confirm"
 * from "this destroys" by looking, so the warning has to be where you reach.
 *
 * BORDERED, never filled. A filled red cell would read as the primary action of
 * the screen, which deleting something never is.
 *
 * Not the same as `DIALOG_DANGER_CLASS`, and they should not be merged: that one
 * is the commit inside a dialog footer and carries `px-5`, the roomier padding a
 * footer's decision gets. This is `px-4`, matching the ordinary command buttons
 * it sits beside in a filter row or a selection bar.
 *
 * Positional classes stay at the CALL SITE — a `shrink-0` inside a flex row, say
 * — so this string can never be the reason one screen's button lays out
 * differently from another's.
 */
export const DANGER_BUTTON_CLASS =
  "h-9 border border-accent bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-35";

/**
 * The ordinary command button — the ONE button this design system has.
 *
 * `DANGER_BUTTON_CLASS` has been here since the sweep and this one hadn't,
 * which is backwards: the red exception was shared while the rule it excepts
 * was retyped at every call site. That cost exactly what you would expect
 * (Mark, 2026-08-09: "the add batch button looks bigger than the mark complete
 * button") — the batch log had `px-4 py-2 text-[13px]` on one and a local
 * `h-8 px-3 text-[11px]` on another, sitting in the same row as an `h-9` Delete,
 * so three commands that do the same KIND of thing came out three heights.
 *
 * It is deliberately dimension-for-dimension the red one, minus the colour: a
 * destructive command and an ordinary one differ in what they mean, not in how
 * big they are, and now they cannot drift apart.
 *
 * Positional classes stay at the CALL SITE, same rule as above.
 */
/**
 * The ONE case where a command button on a screen is filled black (Mark,
 * 2026-08-21, for "Resolve the issue" on a flagged order).
 *
 * This is `DIALOG_COMMIT_CLASS`'s argument applied outside a dialog, not a
 * breach of the rule that only a set filter or a delimiting band is black. That
 * exception turns on a control being a COMMIT STANDING BESIDE NO PEERS — and a
 * flagged order is exactly that situation: the record is in an abnormal state,
 * one command returns it to normal, and Duplicate and Delete beside it are
 * peripheral by comparison. The receiving screen's `Complete` reached the same
 * conclusion by the same route.
 *
 * IT IS ONLY EVER RIGHT CONDITIONALLY. A button that wears this all the time is
 * claiming to be the point of its screen, which no command on a detail screen
 * is — what you came to do there is edit the inline cells. Reach for it when
 * the record is in a state that has ONE way out, and use `BUTTON_CLASS` the
 * rest of the time.
 *
 * Dimension-for-dimension `BUTTON_CLASS`, minus the colours: these differ in
 * what they mean, not in how big they are, and that file's own history says
 * what happens when they drift.
 */
export const PRIMARY_BUTTON_CLASS =
  "inline-flex h-9 items-center justify-center whitespace-nowrap border border-ink bg-ink px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-white transition-colors hover:bg-white hover:text-ink disabled:opacity-35";

export const BUTTON_CLASS =
  "inline-flex h-9 items-center justify-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";
