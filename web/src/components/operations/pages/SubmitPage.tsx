/**
 * The readiness page — FMP's last one, minus checklists and minus sales.
 *
 * IT SAYS NOTHING ABOUT SALES AT ALL (Mark, 2026-09-03, in two passes). The
 * line explaining that Square had not reported yet went first — that is the
 * NORMAL case, so the page opened by describing a wait nobody is waiting on
 * and that no act of a supervisor's can end — and then "Sales are in." went
 * with it, because a page listing what is UNRESOLVED has nothing to say about
 * a thing that resolved itself. The figure is on page 3 and in the email;
 * `salesNote` is deleted rather than left returning null.
 *
 * It NAMES what is unresolved and then lets you through, which is
 * `closeReadiness`'s rule and its reason: gate a shift report on a complete set
 * and the night the printer jams is a report that never gets sent, which is how
 * a status stops meaning anything. A supervisor standing in a shop at 11pm can
 * be prevented from sending, or can be told what is missing; only one of those
 * gets the night's information to anybody.
 *
 * THE CHECKBOXES ARE GONE (Mark, 2026-09-01: "both kind of accomplish the same
 * thing, but I think the 'Still outstanding' text is more informative and
 * better"). They were four rows restating, in weaker form, what the list
 * beneath them already said in sentences — and the list says MORE: the
 * uncounted premade lines, the batches with no yield, the checklist, all of
 * which no checkbox covered. One of the four could not even be pressed.
 *
 * Where the state went, since two of those boxes were the only WRITER of a
 * `task_*` flag on this screen: each flag is now ticked where its work happens.
 * `task_schedules_done` and `task_special_orders_done` were already on page 7
 * and on the packet; `task_ratings_done` moved to the ratings page, which is
 * where somebody can say they have finished rating.
 *
 * SO THIS PAGE WRITES NOTHING NOW. It reads, and it sends — which is the whole
 * of what a last page should be, and is why it stopped being a client
 * component.
 */
export function SubmitPage({
  outstanding,
  blockers,
}: {
  /**
   * Already computed — see the note where it is. The page renders the SAME
   * array the email sends, rather than calling `submitReadiness` a second time,
   * so the two cannot disagree about one night.
   */
  outstanding: string[];
  /**
   * The one thing that stops a send — see `submitBlockers`.
   *
   * Kept apart from `outstanding` rather than mixed in with a flag, because
   * the two are read differently: that list is "you can go", this one is "you
   * cannot", and a reader must be able to tell at a glance which sentences are
   * which. Red for the second, since here something really is wrong.
   */
  blockers: string[];
}) {
  const blocked = blockers.length > 0;

  if (blockers.length + outstanding.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm">Everything is done. Send it.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-2">
      {/* ONE BOX, ONE COLOUR (Mark, 2026-09-03, over four passes). Two frames
          spent a heading, a border and 32px of air on a gate-versus-list
          distinction that the SEND BUTTON already enforces — it is disabled,
          and its tooltip names the blockers. So this is one list of things
          somebody should deal with, and the only thing still telling the two
          kinds apart is the BORDER.

          The heading is OUTSIDE the box and centred, so it titles the thing
          rather than being its first line. It follows the box's job: with a
          blocker present the box is the gate and says so; with none it is a
          list. Blockers lead — you cannot leave without them. */}
      <p className="text-center text-xs font-semibold uppercase tracking-[0.08em] text-accent">
        {blocked ? "Before this can be sent" : "Still outstanding"}
      </p>
      <div
        className={`bg-mark-fill p-4 ${
          blocked ? "border-2 border-accent" : "border border-hairline"
        }`}
      >
        <ul className="space-y-1 text-sm text-accent">
          {[...blockers, ...outstanding].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
