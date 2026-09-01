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
import { fetchOrderDocData } from "@/lib/specialOrderDocs";

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

/**
 * SPECIAL ORDERS ARE TICKED EVEN FOR SOMEBODY WHO HAS PRINTED BEFORE.
 *
 * The remembered set is what you last chose, and every reader of it predates
 * this part existing — so an honest replay would leave the new part OFF for
 * everyone who has ever opened this dialog, which is exactly the population
 * that would not think to look for it. `columnOrder`'s rule, in a checklist's
 * terms: a part added later surfaces at its declared default rather than being
 * silently missing for anyone with a stored preference.
 */
function initialParts(offered: PacketPart[]): PacketPart[] {
  const all = () => offered;
  if (typeof window === "undefined") return all();
  try {
    const raw = window.localStorage.getItem(REMEMBERED);
    if (!raw) return all();
    const saved = JSON.parse(raw) as string[];
    const known = new Set(saved);
    const valid = offered.filter((k) => known.has(k) || !SAVEABLE.has(k));
    return valid.length ? valid : all();
  } catch {
    return all();
  }
}

/** Parts a stored preference is allowed to speak for — see `initialParts`. */
const SAVEABLE = new Set<PacketPart>(["premade", "baker", "fryer", "decorator"]);

export function PrintPacket({
  scheduleIds,
  specialOrderIds = [],
  printedOn,
  stampable,
  label = "Print All Documents",
  onPrinted,
  primary = false,
}: {
  scheduleIds: string[];
  /**
   * The night's SPECIAL ORDERS, as ids — the kitchen order sheets.
   *
   * From the CALLER, never derived from `scheduleIds`, and the reason is a
   * measurement rather than a preference: a special order reaches
   * `production_schedules` only if somebody scheduled it, and of the 33 orders
   * printed since 2026-08-01 exactly 2 had been. Deriving them would put two
   * sheets in the packet, leave thirty-one out, and call the result "all
   * documents". `ProductionPacketPdf.orders` carries the same note.
   *
   * Empty (the default) means this caller has no orders to offer, and the part
   * is not shown at all — `/schedules` and a single schedule's record are about
   * production, not about a customer's order.
   */
  specialOrderIds?: string[];
  /** The org's calendar day, for the kitchen sheets' AS OF line and stamp. */
  printedOn?: string;
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

  // What THIS caller can offer. The special-orders part only exists where there
  // are special orders; on `/schedules` the list is four rows as before.
  const offered = PACKET_PARTS.filter(
    (p) => p.key !== "special" || specialOrderIds.length > 0
  );
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<PacketPart[]>(() => offered.map((p) => p.key));
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  // How many special-order schedules will come along with the selection
  // (decision 11). Asked when the dialog OPENS rather than held in a prop, so
  // an order scheduled a minute ago is already counted.
  const [companions, setCompanions] = useState(0);

  function openDialog() {
    setFailed(null);
    setParts(initialParts(offered.map((p) => p.key)));
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
        // The orders are fetched only when their part is ticked — an unticked
        // checklist row should not cost a query over `special_order_items`.
        const wantOrders = parts.includes("special") && specialOrderIds.length > 0;

        const [{ pdf }, docs, fetched, orderDocs] = await Promise.all([
          import("@react-pdf/renderer"),
          import("./pdf/ProductionPacketPdfs"),
          fetchPacketData(supabase, scheduleIds),
          wantOrders ? fetchOrderDocData(supabase, specialOrderIds) : null,
        ]);

        // THE ORG'S DAY WINS OVER THE PACKET'S OWN, when a caller supplies one.
        // `fetchPacketData` derives `printedOn` from `new Date().toISOString()`,
        // which is UTC — so after 4pm Pacific it dates the packet to tomorrow.
        // It matters more than usual now: the kitchen sheets carry AS OF, and
        // the SAME sheet printed from the row above uses the org's today, so
        // without this the two routes to one document would disagree about the
        // day it was printed.
        const packet = printedOn ? { ...fetched, printedOn } : fetched;

        const blob = await pdf(
          <docs.ProductionPacketPdf
            packet={packet}
            parts={parts}
            orders={orderDocs?.orders ?? []}
          />
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

        // THE ORDERS GET THEIR OWN STAMP, and it is not the schedules'.
        // `special_orders.order_printed_at` is the sixth rung of the progress
        // ladder and what `unschedule_special_order` refuses on, so a sheet
        // that came out of the printer inside this packet has to move it — or
        // the record says the kitchen is holding paper nobody printed.
        //
        // ONLY WHERE IT IS EMPTY, which is the rule the per-order button has
        // always followed: a second copy next week is not a second print, and
        // overwriting would move the date the record already claims.
        if (wantOrders) {
          const { error: stampErr } = await supabase
            .from("special_orders")
            // `printedOn` is the day the ACT happened — every other stage date
            // in this module records that, never the day the thing is FOR.
            // Falls back to the packet's own date for a caller supplying none.
            .update({ order_printed_at: packet.printedOn })
            .in("id", specialOrderIds)
            // THE "ONLY WHERE EMPTY" TEST IS POSTGRES', not a filter over what
            // the page happened to be holding. The screen's copy of
            // `order_printed_at` is as old as its last render, so a sheet
            // printed from the row above a minute ago would be re-stamped from
            // a stale null — moving a date the record had already, correctly,
            // claimed.
            .is("order_printed_at", null)
            .select("id");
          if (stampErr) setFailed(stampErr.message);
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
        // ENABLED WHENEVER THERE IS A DOCUMENT, which since the special-orders
        // part is no longer the same as "there is a schedule". The common night
        // has orders and nothing generated (measured: 0 of 9 upcoming orders
        // are scheduled), and on that night this button used to be dead while
        // there were plainly sheets to print.
        disabled={scheduleIds.length === 0 && specialOrderIds.length === 0}
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
              {offered.map((p) => (
                <li key={p.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Checkbox
                    checked={parts.includes(p.key)}
                    onChange={() => toggle(p.key)}
                    label={`Include the ${p.label}`}
                    size={18}
                  />
                  <span className="font-medium">{p.label}</span>
                  {/* COUNTED, because this is the one part whose size is not
                      implied by the nights you selected — the others are one
                      document per schedule or per kitchen. */}
                  {p.key === "special" ? (
                    <span className="text-muted">
                      {specialOrderIds.length}{" "}
                      {specialOrderIds.length === 1 ? "order" : "orders"}
                    </span>
                  ) : null}
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
