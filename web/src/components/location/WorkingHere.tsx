"use client";

import { useTransition } from "react";
import { setActiveLocation } from "@/app/actions";

/**
 * The control that makes a location the one you're working at — FMP's button
 * beside each row (Mark, 2026-08-01), and what replaced the masthead switcher.
 *
 * Three states, and the third is the interesting one:
 *
 * - the working location: an inert YELLOW chip. The `here` badge on
 *   VendorLocationsTable is only bordered; among six rows this one has to be
 *   unmissable. It was a BLACK fill until 2026-08-02, which read as a button —
 *   see the note at that branch for why yellow is the right mark and not an
 *   indulgence.
 * - any other ACTIVE location: the button.
 * - an INACTIVE location: nothing at all. Only an open shop can be worked at
 *   (Mark, 2026-08-01) — the reason a closed one was ever selectable was that
 *   switching to it was the only way to reach its record, and the list reaches
 *   it directly now. Stated by absence rather than by a dead button: there is
 *   nothing to explain, the Active toggle in the first column is the answer.
 *   Note this is a UI rule — `set_my_member_profile` checks only that the
 *   location is in your org, so nothing below stops a closed one being written.
 *
 * The write is `setActiveLocation`, the same server action the switcher called;
 * its `revalidatePath("/", "layout")` re-renders the layout and this list in
 * place, so there is no router.refresh and nothing to navigate to. `isPending`
 * spans the action AND the revalidated render, which is why the label alone is
 * enough feedback.
 */
export function WorkingHere({
  locationId,
  isWorking,
  isActive,
}: {
  locationId: string;
  isWorking: boolean;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();

  // ONE box for both states (Mark, 2026-08-01): same width, same height, same
  // border — only the fill changes. A chip that sized itself to its own words
  // moved the column's edge as the working location moved down the list.
  const box =
    "inline-flex items-center justify-center border text-[11px] font-semibold uppercase tracking-[0.12em]";

  if (isWorking) {
    // YELLOW, not black (Mark, 2026-08-02: a black label "make[s] it look like
    // a button when it's not"). He was right twice over.
    //
    // Read: down a table column the boxes are 56px apart, so they aren't read
    // as one segmented control the way a TabPicker's abutting cells are —
    // each is read on its own, and on its own a filled box with a label is a
    // button. The original note called fill "the strongest mark available
    // without spending colour"; the mistake was treating colour as the more
    // expensive of the two, when black fill was already spoken for.
    //
    // Rule: since the button sweep, a black fill means a SET FILTER, a
    // delimiting band, or a panel commit. A chip in a table column is none of
    // those, so this was off-rule as well as ambiguous.
    //
    // Why yellow specifically: it is already this app's mark for WHICH ONE
    // YOU ARE AT — `AppNav` marks the active section `text-mark`, "the yellow
    // says which module you're in". Same sentence, different noun. And no
    // button anywhere is filled yellow, so it cannot be misread as one.
    //
    // The 130×30 optical compensation went with the black: a solid dark block
    // reads smaller than an outline around white, but a pale yellow fill is a
    // light area like the outlined box beside it, so the two now match at the
    // same measured size and the column's edge still doesn't move.
    return (
      <span className={`${box} h-7 w-32 border-ink bg-mark-fill text-ink`}>
        Working here
      </span>
    );
  }

  if (!isActive) return null;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setActiveLocation(locationId);
        })
      }
      className={`${box} h-7 w-32 border-ink text-ink hover:bg-ink hover:text-white disabled:opacity-35`}
    >
      {pending ? "Switching…" : "Work here"}
    </button>
  );
}
