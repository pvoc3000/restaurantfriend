"use client";

import { useTransition } from "react";
import { setActiveLocation } from "@/app/actions";

/**
 * The control that makes a location the one you're working at — FMP's button
 * beside each row (Mark, 2026-08-01), and what replaced the masthead switcher.
 *
 * Three states, and the third is the interesting one:
 *
 * - the working location: an inert FILLED chip. The `here` badge on
 *   VendorLocationsTable is only bordered; among six rows this one has to be
 *   unmissable, and fill is the strongest mark available without spending
 *   colour, which in this app only ever means record state.
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
    // OPTICALLY the same size, which is not the same as measuring the same
    // (Mark, 2026-08-01: "the working here button still seems smaller"). It
    // measured identically — 128×28, same left and right edge, both borders
    // black. A solid dark block simply reads smaller than an outline around
    // white, because light areas expand to the eye. So the filled one is drawn
    // 1px larger all round and pulled back by the same pixel: the painted box
    // is 130×30, the space it occupies is still 128×28, and nothing in the
    // column moves.
    return (
      <span className={`${box} -m-px h-[30px] w-[130px] border-ink bg-ink text-white`}>
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
