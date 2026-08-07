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
