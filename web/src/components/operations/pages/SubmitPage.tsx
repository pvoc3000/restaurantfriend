import { salesNote } from "@/lib/shiftReports";

/**
 * The readiness page — FMP's last one, minus checklists and minus sales.
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
  netSalesCents,
}: {
  /**
   * Already computed — see the note where it is. The page renders the SAME
   * array the email sends, rather than calling `submitReadiness` a second time,
   * so the two cannot disagree about one night.
   */
  outstanding: string[];
  netSalesCents: number | null;
}) {
  const caveats = outstanding;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <p className="text-sm text-muted">{salesNote(netSalesCents)}</p>

      {caveats.length > 0 ? (
        <div className="space-y-2 border border-hairline p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em]">
            Still outstanding
          </p>
          <ul className="space-y-1 text-sm">
            {caveats.map((c) => (
              <li key={c}>
                <span className="bg-mark-fill px-1">{c}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            You can send it anyway — this is a list, not a gate.
          </p>
        </div>
      ) : (
        <p className="text-sm">Everything is done. Send it.</p>
      )}
    </div>
  );
}
