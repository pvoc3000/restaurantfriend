"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { openWindowNow, showBlob } from "@/lib/poProcessing";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import {
  companionScheduleIds,
  fetchPacketData,
  premadeSheetTitle,
  stampPrinted,
} from "@/lib/productionPacket";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { PACKET_PARTS, type PacketPart } from "@/components/production/pdf/ProductionPacketPdfs";
import { DOCUMENT_LABEL, fetchOrderDocData } from "@/lib/specialOrderDocs";
import { logOrderEvents } from "@/lib/specialOrderWrites";

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

/** A special order the packet prints, with what the dialog names it by. */
export type PacketOrder = { id: string; number: string | null; title: string | null };

/**
 * `2026-11-28` → `Sat Nov 28`, the wording `schedule_special_order`'s own
 * History line uses (`to_char(p_date, 'FMDy FMMon FMDD')`), so the two entries
 * an order's night writes read alike. UTC throughout: a wall-clock date, not
 * an instant.
 */
function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).replace(",", "");
}

export function PrintPacket({
  scheduleIds,
  specialOrders,
  printedOn,
  stampable,
  label = "Print All Documents",
  children,
  onPrinted,
  primary = false,
}: {
  scheduleIds: string[];
  /**
   * The night's SPECIAL ORDERS — the kitchen order sheets. Each carries its
   * number and title so the dialog can NAME what it is about to print (Mark,
   * 2026-10-04); the caller hands over only orders ready for the kitchen
   * (`ordersForPacket`).
   *
   * From the CALLER, never derived from `scheduleIds`, and the reason is a
   * measurement rather than a preference: a special order reaches
   * `production_schedules` only if somebody scheduled it, and of the 33 orders
   * printed since 2026-08-01 exactly 2 had been. Deriving them would put two
   * sheets in the packet, leave thirty-one out, and call the result "all
   * documents". `ProductionPacketPdf.orders` carries the same note.
   *
   * UNDEFINED AND EMPTY ARE DIFFERENT ANSWERS, and the distinction is the whole
   * reason this is not defaulted.
   *
   * `undefined` means this caller has nothing to do with special orders —
   * `/schedules` and a single schedule's record are about production, not about
   * a customer's order — so the part is not offered at all.
   *
   * `[]` means somebody LOOKED and tomorrow has none. That is worth saying
   * (Mark, 2026-09-01: "even if there aren't any special orders to print, let's
   * show the option but say 'None' after it so it's clear the app isn't
   * forgetting something"), and it is what lets the page itself stop listing
   * them: with the row always present, this dialog is the one place that
   * speaks about special orders, and silence there would be the absence that
   * looks like completeness all over again.
   */
  specialOrders?: PacketOrder[];
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
  /**
   * Hand the command out as an Actions menu row instead of drawing a button —
   * `OrderCommandMenu`'s arrangement. The dialog stays here either way.
   */
  children?: (row: ActionMenuItem) => React.ReactNode;
}) {
  const supabase = createClient();
  const router = useRouter();

  // What THIS caller can offer. The special-orders row appears whenever the
  // caller deals in them AT ALL — including when the answer is none — and never
  // on `/schedules`, which is four rows as before.
  const offersSpecial = specialOrders !== undefined;
  const orderIds = (specialOrders ?? []).map((o) => o.id);
  const offered = PACKET_PARTS.filter((p) => p.key !== "special" || offersSpecial);
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

  /**
   * Stamp `order_printed_at` on the orders matching `column in ids`.
   *
   * `printedOn` is the day the ACT happened — every other stage date in this
   * module records that, never the day the thing is FOR. Falls back to the
   * packet's own date for a caller supplying none.
   *
   * THE "ONLY WHERE EMPTY" TEST IS POSTGRES', not a filter over what the page
   * happened to be holding. The screen's copy of `order_printed_at` is as old
   * as its last render, so a sheet printed from the row above a minute ago
   * would be re-stamped from a stale null — moving a date the record had
   * already, correctly, claimed. It is also the rule the per-order button has
   * always followed: a second copy next week is not a second print.
   *
   * EACH ORDER IT STAMPS GETS A HISTORY LINE, and only those: the rows the
   * update returns are exactly the orders that moved, so the entry and the
   * date agree one for one. `describe` words it from the order's schedule.
   */
  async function stampOrdersPrinted(
    column: "id" | "production_schedule_id",
    ids: string[],
    day: string,
    describe: (scheduleId: string | null) => string
  ): Promise<string | null> {
    const { data, error } = await supabase
      .from("special_orders")
      .update({ order_printed_at: day })
      .in(column, ids)
      .is("order_printed_at", null)
      .select("id, org_id, production_schedule_id");
    if (error) return error.message;
    await logOrderEvents(
      supabase,
      (data ?? []).map((o) => ({
        org_id: o.org_id as string,
        order_id: o.id as string,
        message: describe((o.production_schedule_id ?? null) as string | null),
      }))
    );
    return null;
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
        const wantOrders = parts.includes("special") && orderIds.length > 0;

        const [{ pdf }, docs, fetched, orderDocs] = await Promise.all([
          import("@react-pdf/renderer"),
          import("./pdf/ProductionPacketPdfs"),
          fetchPacketData(supabase, scheduleIds),
          wantOrders ? fetchOrderDocData(supabase, orderIds) : null,
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
        //
        // TWO WAYS A SHEET FOR AN ORDER COMES OUT, and both stamp it (Mark,
        // 2026-11-27: "the app only records these events when they are
        // initiated from a specific place"). One is the kitchen order sheet,
        // the Special Orders part, offered only where the caller hands over
        // `specialOrders`. The other is the order's own PRODUCTION SCHEDULE,
        // which `/schedules` and a schedule's record print with the night and
        // which is titled after the order. Before this, only the first one
        // stamped: DF02's 11-28 packet printed both orders' schedules from
        // `/schedules` and left both orders reading unprinted.
        //
        // Read from the schedules ACTUALLY IN THE PACKET (the expanded set,
        // for the reason the schedule stamp above uses it), through the
        // order's `production_schedule_id`, the one link between the two.
        //
        // WHATEVER PARTS WERE TICKED, the schedule stamp's own rule: the two
        // stamps answer one question (is there paper in the kitchen for this),
        // and a schedule reading printed over an order reading unprinted is
        // the disagreement this exists to end.
        const orderSchedules = packet.schedules
          .filter((s) => s.source === "special_order")
          .map((s) => s.id);
        const byId = new Map(packet.schedules.map((s) => [s.id, s]));
        const stamps: Promise<string | null>[] = [];
        if (wantOrders) {
          stamps.push(
            stampOrdersPrinted("id", orderIds, packet.printedOn, () => `${DOCUMENT_LABEL.order} printed`)
          );
        }
        if (orderSchedules.length > 0) {
          stamps.push(
            stampOrdersPrinted("production_schedule_id", orderSchedules, packet.printedOn, (id) => {
              const s = id ? byId.get(id) : undefined;
              return s
                ? `Order printed with the ${s.kitchenCode} production schedule for ${shortDay(s.date)}`
                : "Order printed with its production schedule";
            })
          );
        }
        const stampErr = (await Promise.all(stamps)).find((m) => m !== null);
        if (stampErr) setFailed(stampErr);
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
      {children
        ? children({
            label,
            onSelect: openDialog,
            disabled: scheduleIds.length === 0 && orderIds.length === 0,
          })
        : (
        <button
          type="button"
          onClick={openDialog}
          // ENABLED WHENEVER THERE IS A DOCUMENT, which since the special-orders
          // part is no longer the same as "there is a schedule". The common night
          // has orders and nothing generated (measured: 0 of 9 upcoming orders
          // are scheduled), and on that night this button used to be dead while
          // there were plainly sheets to print.
          disabled={scheduleIds.length === 0 && orderIds.length === 0}
          className={`${primary ? PRIMARY_BUTTON_CLASS : BUTTON_CLASS} shrink-0`}
        >
          {label}
        </button>
        )}

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
                <li key={p.key} className="flex flex-wrap items-center gap-x-3 px-4 py-2.5 text-sm">
                  <Checkbox
                    checked={parts.includes(p.key)}
                    onChange={() => toggle(p.key)}
                    // NOTHING TO CHOOSE IS NOT A CHOICE. The row stays, ticked,
                    // so the packet still reads as covering special orders —
                    // and it is disabled, because unticking "none" would be a
                    // decision about nothing. `NewTimesheet`'s rule: disable
                    // rather than hide, since a control that vanishes cannot be
                    // told from a feature that is not there.
                    disabled={p.key === "special" && orderIds.length === 0}
                    label={`Include the ${p.label}`}
                  />
                  <span className="font-medium">{p.label}</span>
                  {/* COUNTED, because this is the one part whose size is not
                      implied by the nights you selected — the others are one
                      document per schedule or per kitchen. And it SPEAKS at
                      zero rather than going quiet, which is the point of it: an
                      absent row and a row reading nothing are the same picture
                      to somebody wondering whether the app looked.

                      "NOTHING TO PRINT", NOT "NONE" (Mark, 2026-09-01). Beside
                      a TICKED box, "None" has a second reading — none INCLUDED
                      — which is the opposite of the truth: they are included,
                      there simply are not any. The two states are deliberately
                      different registers, and that is the same call the PO
                      status chips make: with orders you want to know HOW MANY,
                      and with none you want the answer you came for rather than
                      the numeral zero. */}
                  {p.key === "special" ? (
                    /* PUSHED TO THE RIGHT EDGE (Mark, 2026-09-01: "if there's a
                       dot between 'special orders' and 'nothing to print' I
                       don't see it" — there wasn't one, only a flex gap).
                       `ml-auto` separates them by the whole width of the row,
                       which is more separation than any character could be, and
                       it makes the annotation a COLUMN: with four rows saying
                       nothing there, the one that speaks is the only ink on
                       that edge. A middot was the other candidate and is three
                       pixels of ink — the same failure one size up. */
                    <span className="ml-auto text-muted">
                      {orderIds.length === 0
                        ? "Nothing to print"
                        : `${orderIds.length} ${orderIds.length === 1 ? "order" : "orders"}`}
                    </span>
                  ) : null}
                  {/* NAMED, not only counted (Mark, 2026-10-04). On 2026-10-03
                      "2 orders" was one order and one unapproved quote, and
                      nothing here could have said so. `basis-full` so the list
                      claims its own line under the row. */}
                  {p.key === "special" && orderIds.length > 0 ? (
                    <ul className="basis-full pl-7 pt-1 text-muted">
                      {(specialOrders ?? []).map((o) => (
                        <li key={o.id}>
                          {[o.number, o.title].filter(Boolean).join(" · ") || "Special order"}
                        </li>
                      ))}
                    </ul>
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
