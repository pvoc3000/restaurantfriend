"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { openWindowNow, showBlob } from "@/lib/poProcessing";
import {
  companionScheduleIds,
  fetchPacketData,
  premadeSheetTitle,
  stampPrinted,
} from "@/lib/productionPacket";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { PACKET_PARTS, type PacketPart } from "@/components/production/pdf/ProductionPacketPdfs";

/**
 * Print the night's packet — production brief decision 7.
 *
 * FMP had seven buttons and a "generate all logs". This is ONE act producing
 * one file, because a packet is one print job rather than seven downloads, with
 * a checklist for the nights you only want the baker guide.
 *
 * Two mechanics, both inherited and both load-bearing:
 *   * the renderer is imported DYNAMICALLY at click — `@react-pdf/renderer` is
 *     heavy and nothing on a normal page load needs it;
 *   * the window is opened SYNCHRONOUSLY before any await, because a
 *     `window.open` after an await is silently blocked (the popup gotcha).
 */

const REMEMBERED = "rf.packet.parts";

function initialParts(): PacketPart[] {
  if (typeof window === "undefined") return PACKET_PARTS.map((p) => p.key);
  try {
    const raw = window.localStorage.getItem(REMEMBERED);
    if (!raw) return PACKET_PARTS.map((p) => p.key);
    const saved = JSON.parse(raw) as string[];
    const valid = PACKET_PARTS.filter((p) => saved.includes(p.key)).map((p) => p.key);
    return valid.length ? valid : PACKET_PARTS.map((p) => p.key);
  } catch {
    return PACKET_PARTS.map((p) => p.key);
  }
}

export function PrintPacket({
  scheduleIds,
  stampable,
  label = "Print All Documents",
  onPrinted,
  primary = false,
}: {
  scheduleIds: string[];
  /**
   * Supervisor and up — migration 044's `mark_schedule_printed`.
   *
   * It was purchaser+ until phase 5, which was the wrong line: printing the
   * packet is part of the same closing routine as counting the case, and the
   * person doing one is doing the other. Below it the PDF still renders and the
   * schedules simply aren't stamped, which is what the note at the foot of the
   * dialog says.
   */
  stampable: boolean;
  label?: string;
  onPrinted?: () => void;
  /** Fill the trigger black — see `GenerateSchedules.primary`. */
  primary?: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<PacketPart[]>(() => PACKET_PARTS.map((p) => p.key));
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  // How many special-order schedules will come along with the selection
  // (decision 11). Asked when the dialog OPENS rather than held in a prop, so
  // an order scheduled a minute ago is already counted.
  const [companions, setCompanions] = useState(0);

  function openDialog() {
    setFailed(null);
    setParts(initialParts());
    setCompanions(0);
    setOpen(true);
    void companionScheduleIds(supabase, scheduleIds).then((ids) => setCompanions(ids.length));
  }

  function toggle(key: PacketPart) {
    setParts((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
  }

  function print() {
    setFailed(null);
    try {
      window.localStorage.setItem(REMEMBERED, JSON.stringify(parts));
    } catch {
      // A private-mode browser is no reason not to print.
    }
    // Before the await, while the user gesture is still live.
    const win = openWindowNow();
    start(async () => {
      try {
        const [{ pdf }, docs, packet] = await Promise.all([
          import("@react-pdf/renderer"),
          import("./pdf/ProductionPacketPdfs"),
          fetchPacketData(supabase, scheduleIds),
        ]);

        const blob = await pdf(
          <docs.ProductionPacketPdf packet={packet} parts={parts} />
        ).toBlob();

        // NAMED FROM WHAT WAS SELECTED, never from the expanded set: one
        // chosen night that pulled a wedding in with it is still one night, and
        // "Production packet ….pdf" would be a worse name for it.
        const chosen = packet.schedules.filter((s) => scheduleIds.includes(s.id));
        const first = chosen[0];
        // A SPECIAL ORDER'S FILE IS NAMED AFTER THE ORDER, for the reason its
        // page is titled after it: "2026-08-29 DF01 packet.pdf" tells you
        // nothing about which of the night's four documents you just saved.
        // `premadeHeading` so the file and the page cannot disagree about the
        // name of one document; the slashes in an order title would make a
        // path, so they become dashes.
        const name =
          chosen.length === 1 && first
            ? first.source === "special_order" && first.title
              ? `${first.date} ${premadeSheetTitle(first).heading.replace(/[/\\]/g, "-")}.pdf`
              : `${first.date} ${first.sellsCode} packet.pdf`
            : `Production packet ${packet.printedOn}.pdf`;
        showBlob(win, blob, name);

        // Stamped only after the document exists. A print stamp on a render
        // that threw would tell the list a kitchen has paper it does not have.
        //
        // The author comes from `auth.uid()` inside the function now, rather
        // than from a `getUser()` round trip out here — the server already
        // knows who is asking, and the client's answer was only ever a copy.
        if (stampable) {
          // THE EXPANDED SET, not the selection. A special-order schedule that
          // came along and was printed but never stamped would slip past
          // `unschedule_special_order`'s printed guard — and the kitchen would
          // still be holding the paper.
          const stampError = await stampPrinted(
            supabase,
            packet.schedules.map((s) => s.id)
          );
          if (stampError) setFailed(stampError);
        }
        setOpen(false);
        onPrinted?.();
        router.refresh();
      } catch (e) {
        win?.close();
        setFailed((e as Error).message ?? "The packet could not be rendered.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        disabled={scheduleIds.length === 0}
        className={`${primary ? PRIMARY_BUTTON_CLASS : BUTTON_CLASS} shrink-0`}
      >
        {label}
      </button>

      {open && (
        <Dialog
          title="Print Documents"
          onClose={() => setOpen(false)}
          busy={pending}
          footer={
            <>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={print}
                disabled={pending || parts.length === 0}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Rendering…" : "Print"}
              </button>
            </>
          }
        >
          {failed ? <p className="mt-2 text-sm text-accent">{failed}</p> : null}

          <div className="mt-3 space-y-4">
            {/* THE "one file for N nights" SENTENCE IS GONE (Mark, 2026-09-01).
                You reached this dialog by selecting those nights, so it told
                you what you had just done.

                WHAT SURVIVES IS THE HALF YOU DID NOT DO. Decision 11 pulls in
                the night's special-order schedules whether or not you ticked
                them — that is the point of it — so the count of what is coming
                along is the one thing here nobody chose and could not
                otherwise know. It renders only when there is one. */}
            {companions > 0 ? (
              <p className="text-sm">
                <span className="bg-mark-fill px-1">
                  Including {companions} special-order{" "}
                  {companions === 1 ? "schedule" : "schedules"}
                </span>
              </p>
            ) : null}

            <ul className="divide-y divide-hairline border border-ink">
              {PACKET_PARTS.map((p) => (
                <li key={p.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Checkbox
                    checked={parts.includes(p.key)}
                    onChange={() => toggle(p.key)}
                    label={`Include the ${p.label}`}
                    size={18}
                  />
                  <span className="font-medium">{p.label}</span>
                </li>
              ))}
            </ul>

            {!stampable ? (
              <p className="text-xs text-muted">
                The packet will print, but the schedules won&rsquo;t be stamped
                as printed — that needs supervisor access.
              </p>
            ) : null}
          </div>
        </Dialog>
      )}
    </>
  );
}
