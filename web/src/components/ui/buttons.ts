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
 * BLACK ON A RED GROUND since 2026-09-21 (Mark: "let's make it black with a red
 * fill"). It was an all-red bordered button — red edge, red type, white ground,
 * filling accent-red on hover — for the life of the app until then.
 *
 * THE RED IS `stop` (#ffcfc9), NOT `accent` (#d20000), and that is arithmetic
 * rather than taste: black on the accent is 3.74:1, under AA for 12px type,
 * where black on `stop` is 15:1. It is also the grammar the app already had —
 * `bg-mark-fill` under black ink, and `lib/receiving`'s zeroed box, which is
 * `border-ink bg-stop` exactly. The old worry that "a filled red cell would
 * read as the primary action of the screen" was about the ACCENT; a pale wash
 * under black type reads as a marked cell, which is what it is.
 *
 * The shadow went black with the border — `mac-danger`'s red shadow matched the
 * red EDGE it hung from, and there is no red edge any more. The hover and press
 * are `mac-stop` in `styles/mac-look.css`, which is `.mac-primary`'s shape with
 * a different ground.
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
  "mac-control mac-own-hover mac-stop h-9 border border-ink bg-stop px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink disabled:opacity-35";

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
// `mac-control` on all three (Mark, 2026-09-10: the Mac look app-wide) — see
// `styles/mac-look.css`. The destructive one adds `mac-own-hover` (so the plain
// hover rule can't force its ground white and wipe the fill) and `mac-stop`,
// which re-earns the 2px edge and keeps the red while held.
//
// THE PRIMARY ONE IS A PALE BLUE FILL since 2026-09-21 (Mark) — `bg-commit-fill`
// (#e3edfb) under black type, with `mac-primary` giving it the fields' 2px edge
// on hover; held, it keeps the blue and drops. Light grey from 2026-09-11 until
// then. A soft blue inner GLOW shipped in between and lasted one commit;
// `mac-look.css` explains it at length, because WHY it was reversed is the
// useful part. It keeps `mac-own-hover` so the plain rules can't paint grey
// over the blue.
//
// THE TWO FILLED COMMANDS NOW AGREE: a pale wash under black type — blue for
// the one command a screen is pointing at, red for the one that destroys
// something. The same sentence in two colours, which is what the glow could
// never quite say while its neighbour stayed flat.
export const PRIMARY_BUTTON_CLASS =
  "mac-control mac-own-hover mac-primary inline-flex h-9 items-center justify-center whitespace-nowrap border border-ink bg-commit-fill px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink disabled:opacity-35";

export const BUTTON_CLASS =
  "mac-control inline-flex h-9 items-center justify-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

/**
 * THE SMALL COMMAND BUTTON — `BUTTON_CLASS` at the size a tight band can hold.
 *
 * `h-5 px-2 text-[10px]`, against `BUTTON_CLASS`'s `h-9 px-4 text-[12px]`: 20px
 * tall where the ordinary button is 36, a little over half.
 *
 * IT TOOK FOUR TRIES AND AFTER THE FIRST ONE ONLY THE BOX MOVED. It landed at
 * `h-8 px-3 text-[11px]` — `TabPicker size="sm"` exactly, on the argument that
 * a small button and a small tab in the same row have to agree — then `h-7
 * px-2.5 text-[10px]`, then `h-6`, then here, Mark saying smaller each time. So
 * the tab-matching argument is dead and worth not resurrecting: a tab is a
 * place you ARE and a button is a thing you DO, and nothing says two different
 * jobs share a height.
 *
 * THE TYPE STOPPED AT 10px AND THE BOX KEPT GOING, which is the one deliberate
 * thing in that sequence. 10px is where the app's column labels, day glyphs and
 * badges already sit, so it is a FLOOR THAT ALREADY EXISTS rather than a size
 * this part picked; 9px would be a new smallest thing in the whole app,
 * introduced by a button of all things. From `h-7` down, "smaller" therefore
 * means less air around the word, never a smaller word. 20px leaves 5px above
 * and below a 10px line, and all four steps were rendered against the real
 * stylesheet and read cleanly at every one.
 *
 * `px-2` SURVIVED ALL FOUR STEPS and should be the last thing anyone takes.
 * Horizontal padding is what keeps a bordered box reading as a BUTTON rather
 * than as a boxed label; `px-1.5` was rendered beside this and the frame starts
 * hugging the word.
 *
 * TRACKING WENT UP AS THE TYPE CAME DOWN, 0.06em to 0.08em, matching every
 * other 10px uppercase run in the app. Uppercase at 10px closes up without it.
 *
 * THE SHADOW IS 2px, which is `mac-small` in `styles/mac-look.css` and the only
 * thing there that is not inherited from `.mac-control`. `.mac-day` measured it
 * at 26px ("3px of shadow on a 26px square is a ninth of the button") and every
 * step since has been further inside that argument, not outside it.
 *
 * IF IT IS ASKED TO SHRINK AGAIN, the honest answer is that the next notch is
 * not a smaller button. It is a text command (`/interface`'s "text link"
 * specimen) or a `⋯` row menu, both of which the app already has, and both of
 * which are what a command this quiet is actually asking to become. A fifth
 * step would have to spend the 10px floor or the `px-2`, and those are the two
 * things holding it together.
 *
 * IT EXISTED BEFORE IT WAS SHARED, three times — `ShiftDecisions`,
 * `AdjudicateOvertime` and `DerivedDay`'s "Set" each had their own copy, two of
 * them byte-identical and the third `px-2` with the ink colour left off. That
 * is `BUTTON_CLASS`'s own history repeating one size down, and all three had
 * additionally missed the 2026-09-10 Mac sweep: none carried `mac-control`, so
 * three buttons in the app were flat while every other button was raised.
 *
 * WHEN TO REACH FOR IT: a command INSIDE a row, a cell or an expanded panel —
 * where the button is subordinate to the thing it acts on. A command in a
 * filter row, a selection bar, a page's command strip or a dialog footer stays
 * `h-9`; shrinking those is how a screen ends up with three heights of the same
 * kind of button, which is the complaint that created `BUTTON_CLASS`.
 *
 * THERE IS NO SMALL PRIMARY AND NO SMALL DANGER, deliberately. Both of those
 * are arguments about a control being the one thing that matters where it
 * stands, and a control small enough to live inside a row is not making that
 * claim. If one is ever wanted, it gets its own entry and its own reason.
 *
 * Positional classes stay at the CALL SITE — the payroll pair's `shrink-0`,
 * say — same rule as the three above.
 */
export const SMALL_BUTTON_CLASS =
  "mac-control mac-small inline-flex h-5 items-center justify-center whitespace-nowrap border border-ink bg-white px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";
