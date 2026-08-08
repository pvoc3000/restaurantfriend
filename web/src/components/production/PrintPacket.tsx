"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { openWindowNow, showBlob } from "@/lib/poProcessing";
import { fetchPacketData, stampPrinted } from "@/lib/productionPacket";
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
  editable,
  label = "Print packet…",
  onPrinted,
}: {
  scheduleIds: string[];
  /** Purchaser+ — below it the PDF still renders, but the print isn't stamped. */
  editable: boolean;
  label?: string;
  onPrinted?: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<PacketPart[]>(() => PACKET_PARTS.map((p) => p.key));
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  function openDialog() {
    setFailed(null);
    setParts(initialParts());
    setOpen(true);
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

        const first = packet.schedules[0];
        const name =
          packet.schedules.length === 1 && first
            ? `${first.date} ${first.sellsCode} packet.pdf`
            : `Production packet ${packet.printedOn}.pdf`;
        showBlob(win, blob, name);

        // Stamped only after the document exists. A print stamp on a render
        // that threw would tell the list a kitchen has paper it does not have.
        if (editable) {
          const { data } = await supabase.auth.getUser();
          const stampError = await stampPrinted(supabase, scheduleIds, data.user?.id ?? null);
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
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        {label}
      </button>

      {open && (
        <Dialog
          title="Print the packet"
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
            <p className="text-sm text-muted">
              One file for {scheduleIds.length}{" "}
              {scheduleIds.length === 1 ? "night" : "nights"}. The premade
              schedule is per shop; the guides and element sheets are per
              KITCHEN and sum every schedule it is filling, which is what makes
              them include special orders without a switch.
            </p>

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
                  <span className="ml-auto text-xs text-muted">{p.hint}</span>
                </li>
              ))}
            </ul>

            {!editable ? (
              <p className="text-xs text-muted">
                The packet will print, but the schedules won&rsquo;t be stamped
                as printed — that needs purchaser access.
              </p>
            ) : null}
          </div>
        </Dialog>
      )}
    </>
  );
}
