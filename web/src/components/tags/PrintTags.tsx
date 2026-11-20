"use client";

import { useState, useTransition } from "react";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { openWindowNow, showBlob } from "@/lib/poProcessing";
import { formatTagPrice, type TagSize } from "@/lib/displayTags";
import type { TagRow } from "./TagsList";
import type { TagPrint } from "./pdf/TagSheetPdf";

/**
 * One size of sheet from the selected tags — 2x3.5 8-up, 2x8 and 2x10 3-up.
 *
 * A tag prints only when it has THAT background and a price: a label with no
 * art would be a black brick, and one with no price would print the stale
 * figure baked into the art, which is the thing the overlay exists to stop.
 * UNDER HIDE PRICE the price is not needed — the box covers the art's figure
 * and says nothing — so only the background is. The button says how many of
 * the selection qualify and, at zero, why not.
 *
 * Replace Description sets the record's Description over the art's own; a
 * tag whose Description is blank keeps the art's, rather than printing an
 * empty box where the words were.
 *
 * THE WINDOW OPENS SYNCHRONOUSLY, before any `await` (`PrintChecklist`'s note).
 * The backgrounds reach the renderer as the signed URLs the page was served
 * with — an hour's TTL, so a tab left open past that prints blank labels; the
 * recipe sheet has the same edge and it has not bitten.
 */
export function PrintTags({
  size,
  tags,
  locationCode,
  today,
  hidePrice,
  replaceDescription,
}: {
  size: TagSize;
  tags: TagRow[];
  locationCode: string;
  today: string;
  hidePrice: boolean;
  replaceDescription: boolean;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const printable: TagPrint[] = tags.flatMap((t) => {
    const url = t.images[size]?.url;
    const price = hidePrice ? null : formatTagPrice(t.price);
    if (!url || (!hidePrice && !price)) return [];
    return [{ url, price, description: replaceDescription ? t.description : null, title: t.title }];
  });
  const withoutArt = tags.filter((t) => !t.images[size]?.url).length;
  const withoutPrice = hidePrice ? 0 : tags.filter((t) => t.images[size]?.url && t.price === null).length;

  const why =
    printable.length > 0
      ? undefined
      : withoutArt === tags.length
        ? `None of the selected tags has a ${size} background.`
        : `None of the selected tags has both a ${size} background and a price at ${locationCode}.`;

  function print() {
    setFailed(null);
    const win = openWindowNow();
    start(async () => {
      try {
        const [{ pdf }, { TagSheetPdf }] = await Promise.all([
          import("@react-pdf/renderer"),
          import("./pdf/TagSheetPdf"),
        ]);
        const blob = await pdf(<TagSheetPdf size={size} tags={printable} />).toBlob();
        showBlob(win, blob, `Tags ${size} ${today}.pdf`);
      } catch (e) {
        win?.close();
        setFailed(e instanceof Error ? e.message : "The PDF could not be built.");
      }
    });
  }

  const skipped = withoutArt + withoutPrice;
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className={BUTTON_CLASS}
        disabled={pending || printable.length === 0}
        title={why ?? (skipped > 0 ? `${skipped} of the selection cannot print at ${size}` : undefined)}
        onClick={print}
      >
        {pending ? "Building…" : `Print ${size} (${printable.length})`}
      </button>
      {failed ? <span className="text-accent">{failed}</span> : null}
    </span>
  );
}
