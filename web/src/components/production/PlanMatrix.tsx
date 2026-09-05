"use client";

import { Fragment, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { PickList } from "@/components/ui/PickList";
import { TextInput } from "@/components/ui/TextInput";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { RowMenu } from "@/components/ui/RowMenu";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { TabPicker } from "@/components/ui/TabPicker";
import { StickyFooter } from "@/components/ui/StickyFooter";
import {
  WEEKDAYS,
  buildMatrix,
  defaultParFor,
  traySortUpdates,
  renumberTrays,
  slotParLabel,
  stepPar,
  nextTrayNumber,
  type DefaultPars,
  type TraySlot,
  type MatrixGrouping,
  type ItemTaxonomy,
} from "@/lib/productionPlans";
import { useSlotDrag, type SlotDragSource, type SlotDropTarget } from "@/lib/planSlotDrag";
import { withSlot } from "@/lib/production";
import { alertDialog, confirmDialog, splitConfirmMessage } from "@/lib/confirm";

export type MatrixTray = { id: string; tray_number: string; band: string | null; sort: number | null };
export type MatrixSlot = {
  id: string;
  tray_id: string;
  weekday: number;
  item_id: string;
  par: number | null;
};
export type MatrixItem = {
  id: string;
  name: string;
  taxonomy: string;
  /** Retired: still offered, under `PickList`'s own heading. */
  inactive?: boolean;
  tally_box_size: number;
  item_type: string | null;
  subtype: string | null;
  finish: string | null;
};

/**
 * The tray column's fixed width — just the number and its band now that the
 * row's controls have moved to the other end.
 */
const TRAY_COLUMN = 40;
/**
 * The controls column at the far right: the row's stepper pair (16px) beside
 * `RowMenu`'s 36px trigger. It took the 20px the tray column gave up, so the
 * seven days are exactly as wide as before.
 */
const MENU_COLUMN = 60;

/**
 * The tray × weekday matrix — FileMaker's best idea in this module, and the one
 * screen in this app that is genuinely a grid of its own.
 *
 * It models the physical display case the way the order guide models the
 * physical walk: a row per tray, a column per day, and what sits there. Not a
 * `DataTable` — the columns are DAYS rather than fields, every cell is a set of
 * items rather than a value, and there is nothing to sort by.
 *
 * Editing is one item at a time and writes immediately, like `InlineValue`
 * everywhere else: there is no draft of a menu to save. Every write `.select()`s
 * its own result — with no matching RLS policy Postgres changes nothing and
 * PostgREST returns no error, which reads as a cheerful success.
 *
 * Since migration 043 a slot is `[item] [par]`, and the par has THREE states,
 * which are the order guide's three: a number, a deliberate 0 ("on the menu,
 * making none"), and null ("nobody has said"), rendered as a yellow "—".
 *
 * Four gestures share a cell and they must not fight: the item NAME is the drag
 * handle, the steppers move the par by one box, the par itself is an
 * `InlineValue` you click into, and the ✕ takes the item off the tray.
 */
export function PlanMatrix({
  planId,
  orgId,
  trays,
  slots,
  items,
  defaultPars,
  locationId,
  locationCode,
  bands,
  reviewDefaults = false,
  editable,
}: {
  planId: string;
  orgId: string;
  trays: MatrixTray[];
  slots: MatrixSlot[];
  items: MatrixItem[];
  /**
   * Each item's DEFAULT par at the shop this plan sells at, seven ISO slots —
   * the seed a new slot's par is prefilled from, and the only thing
   * `production_item_locations.par_by_weekday` is still for.
   */
  defaultPars: DefaultPars;
  /** The shop this plan SELLS at — whose defaults `defaultPars` holds. */
  locationId: string;
  locationCode: string;
  /** The band vocabulary already in use across this org's plans. */
  bands: string[];
  /**
   * Open in review mode — every par that disagrees with its shop default
   * offers it. How a DUPLICATED plan arrives; see `review` below for the other
   * two ways in.
   */
  reviewDefaults?: boolean;
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState<{ trayId: string; weekday: number } | null>(null);
  const [newTray, setNewTray] = useState(false);
  const [editing, setEditing] = useState<MatrixTray | null>(null);
  /**
   * How the trays are ORDERED on screen. Local state, not the URL: it changes
   * nothing about what the plan IS, `production_plan_trays.sort` is untouched
   * either way, and a plan is read in one sitting.
   */
  const [grouping, setGrouping] = useState<MatrixGrouping>("tray");
  /**
   * REVIEW MODE: every par that disagrees with this shop's default offers it.
   *
   * One mode with three doors, because they are the same question asked at
   * three moments (Mark, 2026-08-08, having moved a copied plan from DF01 to
   * DF02): a DUPLICATE arrives in it, MOVING the plan to another shop turns it
   * on by itself, and the Check pars control turns it on whenever you like.
   *
   * A MODE rather than a permanent flag, which is the one option not taken. A
   * plan is supposed to diverge from the defaults — that is what a seasonal
   * menu IS — so flagging every difference forever would put a yellow mark on
   * exactly the slots somebody had already thought hardest about, and teach the
   * reader to stop seeing it.
   */
  const [review, setReview] = useState(reviewDefaults);
  /**
   * Moving the plan to another shop makes EVERY par suspect at once, so it
   * turns review on by itself. Adjusting state during render when a prop
   * changes is React's own documented pattern for this, and it is why the
   * previous value is held rather than compared in an effect.
   */
  const [reviewedShop, setReviewedShop] = useState(locationId);
  if (locationId !== reviewedShop) {
    setReviewedShop(locationId);
    setReview(true);
  }
  /**
   * Slots a drag has landed on, each with the destination's own default par —
   * shown as a one-tap `→` beside that par when the two disagree.
   *
   * This is where "should the par travel or be re-seeded?" is answered: it
   * TRAVELS, and the other answer is OFFERED, visible and reversible, instead of
   * being encoded in which half of a cell you hit. The receiving screen's idiom
   * — nothing prefills, the app's number sits beside yours and you take it.
   *
   * Held in state rather than derived, exactly like the receiving screen's undo
   * band: plenty of slots legitimately differ from their default, and offering
   * on all of them would be noise. This is about the ones you just moved.
   *
   * IT STAYS UNTIL DISMISSED (Mark, 2026-08-08). It used to clear on your next
   * action, which meant moving three items and then touching anything lost the
   * question before you had answered it — and the whole point of offering rather
   * than applying is that you get to decide in your own time. A record rather
   * than one entry, so a run of drags leaves a run of offers; each carries its
   * own ✕, and taking one settles it.
   */
  const [landed, setLanded] = useState<Record<string, number>>({});
  /** Slots whose offer has been answered "no" — needed for the review mode,
   *  where the offer is DERIVED and so cannot be cleared by forgetting it. */
  const [dismissed, setDismissed] = useState<Record<string, true>>({});

  /** Stop offering for this slot, without changing its par. */
  function dismissLanded(rowId: string) {
    setDismissed((prev) => ({ ...prev, [rowId]: true }));
    setLanded((prev) => {
      if (!(rowId in prev)) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  }

  /**
   * The default this slot could take instead of the par it carries, or null for
   * no offer.
   *
   * ONE function for both routes into it: a drag that just landed (`landed`,
   * explicit and per-slot) and a whole duplicated plan (`reviewDefaults`,
   * derived from every slot). Answering is the same act either way, so
   * `dismissed` covers both — the derived offer cannot be cleared by forgetting
   * it, which is why that set exists at all.
   */
  function suggestionFor(slot: TraySlot, weekday: number): number | null {
    if (dismissed[slot.rowId]) return null;
    const explicit = landed[slot.rowId];
    if (explicit !== undefined) return explicit === slot.par ? null : explicit;
    return review ? defaultGap(slot, weekday) : null;
  }

  /**
   * This shop's default for the slot, when it disagrees with the par — the
   * FACT, independent of whether the screen is currently offering it.
   *
   * Kept apart from `suggestionFor` so the Check pars control can say how many
   * differ while review is OFF. A count that only worked once you had already
   * turned the thing on would be no use for deciding whether to.
   */
  function defaultGap(slot: TraySlot, weekday: number): number | null {
    const seeded = defaultParFor(defaultPars, slot.itemId, weekday);
    return seeded !== null && seeded !== slot.par ? seeded : null;
  }
  const tableRef = useRef<HTMLTableElement | null>(null);

  const itemNames = new Map(items.map((i) => [i.id, i.name]));
  // The step for a par is the item's OWN tally box size (037), so the number a
  // par moves by and the number the printed tally strip counts in are one fact.
  const boxSize = new Map(items.map((i) => [i.id, i.tally_box_size]));
  const stepFor = (itemId: string) => boxSize.get(itemId) ?? 6;
  // The taxonomy the `type` grouping sorts and bands by.
  const taxonomy = new Map<string, ItemTaxonomy>(
    items.map((i) => [i.id, { item_type: i.item_type, subtype: i.subtype, finish: i.finish }])
  );
  const matrix = buildMatrix(trays, slots, itemNames, grouping, taxonomy);

  /** One write, one refresh, one place to report the failure. */
  /**
   * Every write on this screen goes through here, and a failure is a POPUP
   * (Mark, 2026-09-04: the message "is at the top of the page and I'm working
   * at the bottom so didn't see it"). A plan runs to two dozen trays, so a
   * line under the heading is off screen for most of the work.
   */
  function run(work: (supabase: ReturnType<typeof createClient>) => Promise<string | null>) {
    start(async () => {
      const message = await work(createClient());
      if (message) {
        await alertDialog({ title: "That didn't work", body: message });
        return;
      }
      router.refresh();
    });
  }

  /**
   * Keep `production_plan_trays.sort` in step with the tray NUMBERS, which is
   * the order the matrix reads them in (`compareTrayNumbers`). `sort` is what
   * `production_day` and the printed packet order by, and until now nothing
   * wrote it except "append" — so a tray 17 created after 18 and 20 printed
   * after them. Called after anything that adds or renumbers a tray; writes
   * only the rows whose value differs, one statement each, checked.
   */
  async function resortTrays(supabase: ReturnType<typeof createClient>): Promise<string | null> {
    const { data, error } = await supabase
      .from("production_plan_trays")
      .select("id, tray_number, sort")
      .eq("plan_id", planId);
    if (error || !data) return error?.message ?? "The trays could not be reordered.";
    for (const u of traySortUpdates(data)) {
      const { data: w, error: e } = await supabase
        .from("production_plan_trays")
        .update({ sort: u.sort })
        .eq("id", u.id)
        .select("id");
      if (e || !w?.length) return e?.message ?? "The trays could not be reordered.";
    }
    return null;
  }

  /**
   * "Renumber trays" (Mark, 2026-09-04): top to bottom becomes 01, 02, 03 …
   * however many there are. A confirm names how many move and the range.
   *
   * TWO PASSES, because the number is unique per plan and a one-pass rename
   * collides with itself the moment a tray takes a number another tray still
   * holds. Every moving tray is first parked on a placeholder no real tray can
   * carry, then given its final number; `sort` follows in the same statement.
   * Each write is checked. If it stops halfway the parked trays are visible on
   * the screen as "~n" and one more press finishes the job — a partial rename
   * you can see beats a silent one.
   */
  async function renumber() {
    const moves = renumberTrays(trays);
    if (moves.length === 0) {
      await alertDialog({
        title: "Nothing to renumber",
        body: `The ${trays.length} trays are already numbered in order.`,
      });
      return;
    }
    const last = String(trays.length).padStart(Math.max(2, String(trays.length).length), "0");
    if (
      !(await confirmDialog({
        title: `Renumber ${trays.length} trays 01 – ${last}?`,
        body: `${moves.length} ${moves.length === 1 ? "tray changes" : "trays change"} number, in the order they are listed. The printed packet follows the new numbers.`,
        confirmLabel: "Renumber",
      }))
    ) {
      return;
    }
    run(async (supabase) => {
      const write = async (id: string, patch: { tray_number: string; sort?: number }) => {
        const { data, error } = await supabase
          .from("production_plan_trays")
          .update(patch)
          .eq("id", id)
          .select("id");
        return error || !data?.length ? error?.message ?? "nothing was written" : null;
      };
      for (const [i, m] of moves.entries()) {
        const e = await write(m.id, { tray_number: `~${i + 1}` });
        if (e) return `Tray ${m.from} could not be renumbered: ${e}`;
      }
      for (const m of moves) {
        const e = await write(m.id, { tray_number: m.to, sort: Number(m.to) });
        if (e) return `Tray ${m.from} could not become ${m.to}: ${e}`;
      }
      return resortTrays(supabase);
    });
  }

  function addItem(trayId: string, weekday: number, itemId: string) {
    if (!itemId) return;
    run(async (supabase) => {
      // org_id EXPLICITLY — design rule 1.
      //
      // The par is SEEDED from the item's default at this shop on this weekday
      // (043), and from here on the slot owns it: nothing re-reads the default,
      // so changing it later does not move a plan already built. Null when the
      // item has no default, or has one of zero — decision 2's third state,
      // which needs no special case here.
      const { data, error } = await supabase
        .from("production_plan_tray_items")
        .insert({
          org_id: orgId,
          tray_id: trayId,
          weekday,
          item_id: itemId,
          par: defaultParFor(defaultPars, itemId, weekday),
        })
        .select("id");
      if (error || !data?.length) {
        return /duplicate key|unique/.test(error?.message ?? "")
          ? "That item is already on this tray that day."
          : error?.message ?? "That could not be added.";
      }
      setAdding(null);
      return null;
    });
  }

  function removeSlot(rowId: string) {
    run(async (supabase) => {
      const { data, error } = await supabase
        .from("production_plan_tray_items")
        .delete()
        .eq("id", rowId)
        .select("id");
      return error || !data?.length ? error?.message ?? "That could not be removed." : null;
    });
  }

  /** One box up or down on a single slot. */
  function stepSlot(slot: TraySlot, direction: 1 | -1) {
    const next = stepPar(slot.par, stepFor(slot.itemId), direction);
    if (next === slot.par) return; // already on the floor
    run(async (supabase) => {
      const { data, error } = await supabase
        .from("production_plan_tray_items")
        .update({ par: next })
        .eq("id", slot.rowId)
        .select("id");
      return error || !data?.length ? error?.message ?? "That par could not be changed." : null;
    });
  }

  /**
   * One box up or down across the WHOLE tray row — FMP's second pair of
   * steppers, beside the tray number.
   *
   * Grouped by the resulting value rather than one statement per slot: each item
   * brings its own box size and each slot its own current par, but a tray's
   * seven days usually land on two or three distinct answers, so this is two or
   * three updates rather than a dozen.
   */
  /**
   * Step ONE ROW of a tray across the week — the slot at `index` in every day
   * (Mark, 2026-09-04: "each stepper should only increase the items in its
   * row"). It stepped the whole tray until then, which on a tray of three
   * donuts moved all three when you meant one. Rows are POSITIONS: a day's
   * slots list by name, so position n is the same donut down the week wherever
   * the tray carries one kind of donut per row, and where it doesn't it is
   * still exactly the row on screen the stepper sits beside.
   */
  function stepTray(days: TraySlot[][], direction: 1 | -1, index: number) {
    const groups = new Map<number, string[]>();
    for (const day of days) {
      const slot = day[index];
      if (!slot) continue;
      const next = stepPar(slot.par, stepFor(slot.itemId), direction);
      if (next === slot.par) continue;
      groups.set(next, [...(groups.get(next) ?? []), slot.rowId]);
    }
    if (!groups.size) return;
    run(async (supabase) => {
      const results = await Promise.all(
        [...groups].map(([par, ids]) =>
          supabase.from("production_plan_tray_items").update({ par }).in("id", ids).select("id")
        )
      );
      const bad = results.find((r) => r.error || !r.data?.length);
      return bad ? bad.error?.message ?? "That tray could not be changed." : null;
    });
  }

  /**
   * Move an item to another slot, or COPY it there — whichever half of the
   * destination cell you let go over.
   *
   * THE PAR ALWAYS TRAVELS. A move gets it for free, being the same row; a copy
   * hands it over explicitly. It is the number you typed or stepped, and a
   * reposition must not quietly rewrite it — nor may it re-read the item's
   * default, which 043 spent a migration turning into a seed that is consumed
   * once and never read again.
   *
   * Where the destination's own default disagrees, that is OFFERED afterwards
   * (`landed`) rather than applied: a Wednesday 18 dragged to Saturday, where
   * DF01 plans 36, is a real question, and the honest place to ask it is on the
   * screen with both numbers visible.
   */
  function dropSlot(source: SlotDragSource, target: SlotDropTarget, copy: boolean) {
    run(async (supabase) => {

      const { data, error } = copy
        ? await supabase
            .from("production_plan_tray_items")
            .insert({
              org_id: orgId,
              tray_id: target.trayId,
              weekday: target.weekday,
              item_id: source.itemId,
              par: source.par,
            })
            .select("id")
        : await supabase
            .from("production_plan_tray_items")
            .update({ tray_id: target.trayId, weekday: target.weekday })
            .eq("id", source.rowId)
            .select("id");
      if (error || !data?.length) {
        // The same donut twice on one tray-day is refused (039's key), and
        // stays refused — Mark, 2026-09-04, having tried a merge for an hour:
        // "go back to not allowing the exact same donut on a tray".
        return /duplicate key|unique/.test(error?.message ?? "")
          ? `${source.name} is already on that tray that day.`
          : error?.message ?? `${source.name} could not be ${copy ? "copied" : "moved"}.`;
      }
      // The row that now sits at the destination: a copy's new id, or the moved
      // row's own. Added to the offers already on screen rather than replacing
      // them — a run of drags leaves a run of questions, each still answerable.
      const suggested = defaultParFor(defaultPars, source.itemId, target.weekday);
      if (suggested !== null && suggested !== source.par) {
        const rowId = data[0].id as string;
        setLanded((prev) => ({ ...prev, [rowId]: suggested }));
      }
      return null;
    });
  }

  /**
   * Every slot this shop's defaults disagree with, ignoring the ones already
   * answered. Computed from the matrix so it counts exactly what the screen is
   * offering — a count that could drift from the offers would be worse than no
   * count.
   */
  const differing = matrix.flatMap((row) =>
    row.days.flatMap((day, i) =>
      day.flatMap((slot) => {
        const suggested = dismissed[slot.rowId] ? null : defaultGap(slot, WEEKDAYS[i].iso);
        return suggested === null ? [] : [{ rowId: slot.rowId, suggested }];
      })
    )
  );

  /**
   * Take every offer at once — the bulk answer to "re-base this plan on the new
   * shop's numbers", which is a real thing to want after moving a plan and a
   * tedious thing to do 225 times.
   *
   * Grouped by resulting value, like the tray stepper: a plan's differences
   * usually land on a handful of distinct numbers, so this is a few statements
   * rather than one per slot.
   */
  async function takeAllSuggested() {
    if (!differing.length) return;
    if (
      !(await confirmDialog({ ...splitConfirmMessage(`Set ${differing.length} par${differing.length === 1 ? "" : "s"} to ${locationCode}'s defaults? The numbers currently on those slots are replaced.`), confirmLabel: "Use defaults" }))
    ) {
      return;
    }
    const groups = new Map<number, string[]>();
    for (const d of differing) {
      groups.set(d.suggested, [...(groups.get(d.suggested) ?? []), d.rowId]);
    }
    run(async (supabase) => {
      const results = await Promise.all(
        [...groups].map(([par, ids]) =>
          supabase.from("production_plan_tray_items").update({ par }).in("id", ids).select("id")
        )
      );
      const bad = results.find((r) => r.error || !r.data?.length);
      return bad ? bad.error?.message ?? "Those pars could not be changed." : null;
    });
  }

  /**
   * The REVERSE of taking the default: teach the shop this slot's number.
   *
   * The receiving screen's two-stage price button, in a plan's terms — take the
   * app's figure, or tell the app yours — and a SEPARATE act for the same
   * reason: fixing this plan is not consent to edit the shop's catalog, so it
   * is a second button rather than something the first one also does.
   *
   * UPSERT, not update: most (item, location) pairs have no row at all
   * (/price-grid's "set" problem), and an update would change nothing and
   * report success. Only `par_by_weekday` is written, so a row's `is_active`
   * and `price_override` survive.
   *
   * `arrayWidth` is 7 and not the strip's own length — 037 checks
   * `array_length = 7`, so a null or short strip has to be padded or the first
   * write on an item that never had defaults is refused.
   */
  function updateDefault(slot: TraySlot, weekday: number) {
    if (slot.par === null) return;
    const strip = withSlot(defaultPars[slot.itemId] ?? null, weekday - 1, slot.par, 7);
    run(async (supabase) => {
      const { data, error } = await supabase
        .from("production_item_locations")
        .upsert(
          {
            org_id: orgId,
            item_id: slot.itemId,
            location_id: locationId,
            par_by_weekday: strip,
          },
          { onConflict: "item_id,location_id" }
        )
        .select("id");
      return error || !data?.length
        ? error?.message ?? "That default could not be changed."
        : null;
    });
  }

  /**
   * The bulk reverse: make this plan's pars the shop's defaults.
   *
   * One row per ITEM rather than per slot — an item appears on several weekdays,
   * and they share one seven-slot array, so writing them separately would have
   * each overwrite the last.
   */
  async function updateAllDefaults() {
    if (!differing.length) return;
    const byItem = new Map<string, (number | null)[]>();
    for (const row of matrix) {
      row.days.forEach((day, i) => {
        for (const slot of day) {
          if (slot.par === null || dismissed[slot.rowId]) continue;
          if (defaultGap(slot, WEEKDAYS[i].iso) === null) continue;
          byItem.set(
            slot.itemId,
            withSlot(byItem.get(slot.itemId) ?? defaultPars[slot.itemId] ?? null, i, slot.par, 7)
          );
        }
      });
    }
    if (!byItem.size) return;
    if (
      !(await confirmDialog({ ...splitConfirmMessage(`Set ${locationCode}'s DEFAULT pars from this plan — ${byItem.size} item${
          byItem.size === 1 ? "" : "s"
        }? This changes the shop's catalog, not just this plan, and every future plan seeds from it.`), confirmLabel: "Update defaults" }))
    ) {
      return;
    }
    run(async (supabase) => {
      const { data, error } = await supabase
        .from("production_item_locations")
        .upsert(
          [...byItem].map(([item_id, par_by_weekday]) => ({
            org_id: orgId,
            item_id,
            location_id: locationId,
            par_by_weekday,
          })),
          { onConflict: "item_id,location_id" }
        )
        .select("id");
      return error || data?.length !== byItem.size
        ? error?.message ?? "Those defaults could not be changed."
        : null;
    });
  }

  /** Take the destination's default for a slot a drag landed on. */
  function takeSuggested(rowId: string, par: number) {
    dismissLanded(rowId);
    run(async (supabase) => {
      const { data, error } = await supabase
        .from("production_plan_tray_items")
        .update({ par })
        .eq("id", rowId)
        .select("id");
      return error || !data?.length ? error?.message ?? "That par could not be changed." : null;
    });
  }

  const { dragging, startSlotDrag, chipRef, moveZoneRef, copyZoneRef } = useSlotDrag({
    tableRef,
    onDrop: dropSlot,
  });

  /**
   * Change a tray's NUMBER, CATEGORY and DONUT — "Edit tray" on the ⋯ menu
   * (Mark, 2026-09-04, widening what had been "Edit category").
   *
   * The column is still `band`, which is what 039 called it and what every
   * reader downstream selects; only the word on screen is "Category" (Mark,
   * 2026-08-08). Same split as `admin` displaying as "Manager".
   *
   * THE DONUT IS THE ONE HALF WITH RULES. The dialog offers it only when the
   * tray holds AT MOST ONE distinct item — the common shape, one kind of donut
   * all week — because "the tray's donut" is not a fact about a tray carrying
   * three. Changing it RE-POINTS the existing slots at the new item, keeping
   * every par (the par is the number you typed, and swapping the donut is not
   * consent to lose a week of numbers — the drag-move rule), and fills any day
   * the old item was missing from, seeded from the new item's default. Picking
   * a donut for an EMPTY tray fills all seven days, exactly as Add tray does.
   */
  function editTray(
    tray: MatrixTray,
    next: { trayNumber: string; category: string; itemId: string },
    currentItemId: string | null
  ) {
    run(async (supabase) => {
      const { data, error } = await supabase
        .from("production_plan_trays")
        .update({ tray_number: next.trayNumber.trim(), band: next.category.trim() || null })
        .eq("id", tray.id)
        .select("id");
      if (error || !data?.length) {
        return /duplicate key|unique/.test(error?.message ?? "")
          ? `This plan already has a tray ${next.trayNumber.trim()}.`
          : error?.message ?? "That tray could not be changed.";
      }

      if (next.itemId && next.itemId !== currentItemId) {
        const held = slots.filter((sl) => sl.tray_id === tray.id && sl.item_id === currentItemId);
        if (held.length > 0) {
          const { data: moved, error: moveError } = await supabase
            .from("production_plan_tray_items")
            .update({ item_id: next.itemId })
            .in("id", held.map((sl) => sl.id))
            .select("id");
          if (moveError || (moved?.length ?? 0) !== held.length) {
            return `The tray was changed, but its donut could not be: ${
              moveError?.message ?? "nothing was written"
            }`;
          }
        }
        const missing = [1, 2, 3, 4, 5, 6, 7].filter(
          (weekday) => !held.some((sl) => sl.weekday === weekday)
        );
        if (missing.length > 0) {
          const { data: added, error: addError } = await supabase
            .from("production_plan_tray_items")
            .insert(
              missing.map((weekday) => ({
                org_id: orgId,
                tray_id: tray.id,
                weekday,
                item_id: next.itemId,
                par: defaultParFor(defaultPars, next.itemId, weekday),
              }))
            )
            .select("id");
          if (addError || (added?.length ?? 0) !== missing.length) {
            return `The tray was changed, but its donut could not be added to every day: ${
              addError?.message ?? "nothing was written"
            }`;
          }
        }
      }
      const resort = await resortTrays(supabase);
      if (resort) return resort;
      setEditing(null);
      return null;
    });
  }

  /**
   * A tray, and optionally the donut it carries ALL WEEK (Mark, 2026-09-04:
   * "whatever donut is selected will be added to every day of the week on
   * that tray"). A tray usually holds one kind of donut every day, so seven
   * "+ add"s for the common case was the transcription the dialog exists to
   * skip. Each day's par is seeded from the item's default at this shop for
   * THAT weekday, exactly as a single "+ add" would.
   *
   * The tray is written BEFORE its slots — a tray with nothing on it is
   * visible and one gesture from fixed, where slots with no tray cannot exist.
   * If the slots then fail, the dialog stays up saying so over a tray that
   * already exists, so the failure is not mistaken for the tray's.
   */
  function addTray(trayNumber: string, band: string, itemId: string) {
    run(async (supabase) => {
      const { data, error } = await supabase
        .from("production_plan_trays")
        .insert({
          org_id: orgId,
          plan_id: planId,
          tray_number: trayNumber.trim(),
          band: band.trim() || null,
          sort: trays.length + 1,
        })
        .select("id");
      if (error || !data?.length) {
        return /duplicate key|unique/.test(error?.message ?? "")
          ? `This plan already has a tray ${trayNumber.trim()}.`
          : error?.message ?? "That tray could not be added.";
      }
      if (itemId) {
        const trayId = data[0].id as string;
        const { data: slots, error: slotError } = await supabase
          .from("production_plan_tray_items")
          .insert(
            [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
              org_id: orgId,
              tray_id: trayId,
              weekday,
              item_id: itemId,
              par: defaultParFor(defaultPars, itemId, weekday),
            }))
          )
          .select("id");
        if (slotError || (slots?.length ?? 0) !== 7) {
          return `Tray ${trayNumber.trim()} was added, but its donut could not be: ${
            slotError?.message ?? "nothing was written"
          }`;
        }
      }
      const resort = await resortTrays(supabase);
      if (resort) return resort;
      setNewTray(false);
      return null;
    });
  }

  /**
   * Take a tray off the plan, and everything on it with it (039's slots cascade
   * from the tray).
   *
   * It exists because DUPLICATE exists: a one-tap way to create a tray with no
   * way to remove one is a one-way door, and the first thing anybody does with a
   * copy button is make a copy they didn't want. A confirm naming what is
   * about to go, matching the PO batch-delete pattern — a tray carrying nine
   * items is a real amount of work to lose.
   */
  async function removeTray(tray: MatrixTray, days: TraySlot[][]) {
    const held = days.flat().length;
    if (
      !(await confirmDialog({ ...splitConfirmMessage(held
          ? `Remove tray ${tray.tray_number} from this plan, and the ${held} item${
              held === 1 ? "" : "s"
            } on it?`
          : `Remove tray ${tray.tray_number} from this plan?`), confirmLabel: "Delete tray", tone: "danger" }))
    ) {
      return;
    }
    run(async (supabase) => {
      const { data, error } = await supabase
        .from("production_plan_trays")
        .delete()
        .eq("id", tray.id)
        .select("id");
      return error || !data?.length
        ? error?.message ?? "That tray could not be removed."
        : null;
    });
  }

  /**
   * Copy a tray and everything on it, pars included — a display case is mostly
   * variations on a tray you already built.
   *
   * Tray FIRST, then its slots: a tray with nothing on it is visible and one
   * gesture from being fixed, where slots with no tray cannot exist at all.
   */
  function duplicateTray(tray: MatrixTray, days: TraySlot[][]) {
    const number = nextTrayNumber(trays.map((t) => t.tray_number), tray.tray_number);
    run(async (supabase) => {
      const { data: made, error } = await supabase
        .from("production_plan_trays")
        .insert({
          org_id: orgId,
          plan_id: planId,
          tray_number: number,
          band: tray.band,
          sort: trays.length + 1,
        })
        .select("id");
      if (error || !made?.length) {
        return error?.message ?? "That tray could not be duplicated.";
      }
      const rows = days.flatMap((day, i) =>
        day.map((slot) => ({
          org_id: orgId,
          tray_id: made[0].id as string,
          weekday: WEEKDAYS[i].iso,
          item_id: slot.itemId,
          par: slot.par,
        }))
      );
      if (rows.length) {
        const { data: copied, error: slotError } = await supabase
          .from("production_plan_tray_items")
          .insert(rows)
          .select("id");
        if (slotError || copied?.length !== rows.length) {
          return `Tray ${number} was created, but its items could not be copied: ${
            slotError?.message ?? "nothing was written"
          }`;
        }
      }
      return resortTrays(supabase);
    });
  }

  return (
    <div className="space-y-3">

      {/* A control that changes what the list SHOWS goes with the list, never
          in a command bar — and every one-of-N choice in this app is a
          TabPicker. */}
      {trays.length > 1 ? (
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Group by
          </span>
          <TabPicker<MatrixGrouping>
            ariaLabel="Group trays by"
            value={grouping}
            onChange={setGrouping}
            options={[
              { key: "tray", label: "Tray" },
              { key: "category", label: "Category" },
              { key: "type", label: "Item type" },
            ]}
          />
        </div>
      ) : null}

      <div className="overflow-x-auto">
        {/* `table-fixed` is what makes the widths below actual widths. Without
            it the browser lays the table out by content and a long item name
            stretches its own column, so the seven days drift apart. */}
        <table ref={tableRef} className="w-full table-fixed border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
              <th className="px-1 py-2 text-left" style={{ width: TRAY_COLUMN }}>
                {/* "#" on screen (Mark, 2026-08-08) — the column holds "01",
                    "7A", and the word was wider than the column it labelled.
                    Still announced as "Tray", because a screen reader saying
                    "number sign" names nothing. */}
                <span aria-hidden="true">#</span>
                <span className="sr-only">Tray</span>
              </th>
              {WEEKDAYS.map((d) => (
                <th
                  key={d.iso}
                  className="px-2 py-2 text-left"
                  style={{ width: `calc((100% - ${TRAY_COLUMN + MENU_COLUMN}px) / 7)` }}
                >
                  {d.short}
                </th>
              ))}
              <th className="px-1 py-2" style={{ width: MENU_COLUMN }}>
                <span className="sr-only">Tray actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => {
              const tray = trays.find((t) => t.id === row.tray.id);
              return (
                <Fragment key={row.tray.id}>
                {/* One band per run, black with white text — the same mark
                    `DataTable` uses, because a grey wash against tall rows reads
                    as one more row rather than as a break between runs. */}
                {row.groupLabel ? (
                  <tr>
                    <td
                      colSpan={WEEKDAYS.length + 2}
                      className="bg-ink px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white"
                    >
                      {row.groupLabel}
                      {/* The run's tray count, dimmed — `DataTable`'s own band
                          treatment, so a grouped plan reads like every other
                          grouped list in the app. */}
                      <span className="ml-2 font-normal normal-case tracking-normal text-white/55">
                        {row.groupCount}
                      </span>
                    </td>
                  </tr>
                ) : null}
                {/* The CUT — FileMaker's second level, its BANANA / VANILLA
                    headings. Black on white rather than a filled band (Mark,
                    2026-08-08): a second black rule would read as another
                    break of the same weight, where this is a heading INSIDE
                    one. The gap that separates the runs is on the last row of
                    each, not here. */}
                {row.subGroupLabel ? (
                  <tr>
                    <td
                      colSpan={WEEKDAYS.length + 2}
                      className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink"
                    >
                      {row.subGroupLabel}
                    </td>
                  </tr>
                ) : null}
                {/* A RULE BETWEEN TRAYS (Mark, 2026-08-28). A tray row is
                    tall — seven cells of stacked chips, and a busy day runs to
                    four or five — so with nothing between them two trays' chips
                    read as one column of chips. This is not `DataTable`'s
                    no-rule rule being broken: that one is about 56px rows of
                    single values, where the row IS the visual unit. Here the
                    unit is a grid cell and the rule is what says where a tray
                    ends.

                    BLACK, not a hairline (Mark, 2026-09-05), the day after
                    the padding between trays doubled: with 32px of air a grey
                    rule reads as a smudge, and the app's mark for a band that
                    DELIMITS is ink. On the `<tr>`, which `border-collapse`
                    honours — and where the head's own `border-b-2` still wins
                    the collapse against the first row's 1px, so the table
                    opens on one heavy rule rather than two stacked. */}
                <tr className="group/tray border-t border-ink align-top">
                  <td className={`px-1 py-4 ${row.endsSubGroup ? "pb-8" : ""}`}>
                    <div className="min-w-0">
                      <span className="block truncate font-medium">{row.tray.tray_number}</span>
                      {row.tray.band ? (
                        <span className="block truncate text-[10px] uppercase tracking-[0.08em] text-subtle">
                          {row.tray.band}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  {row.days.map((day, i) => {
                    const weekday = WEEKDAYS[i].iso;
                    const isAdding =
                      adding?.trayId === row.tray.id && adding?.weekday === weekday;
                    return (
                      <td
                        key={weekday}
                        data-tray-id={row.tray.id}
                        data-weekday={weekday}
                        className={`px-2 py-4 align-top ${row.endsSubGroup ? "pb-8" : ""}`}
                      >
                        <div className="flex flex-col gap-1">
                          {day.map((slot, slotIndex) => (
                            <span
                              key={slot.rowId}
                              data-slot-index={slotIndex}
                              // ONE line, TWO groups (Mark, 2026-08-08):
                              // `[item ✕] [par ▲▼]`. The ✕ belongs with the
                              // thing it removes and the steppers with the
                              // number they move, so each pair reads as a pair —
                              // which the old `name · steppers · par · ✕` did
                              // not, having interleaved the two.
                              className="group flex flex-col border border-hairline px-1.5 py-1 leading-tight"
                            >
                              <span className="flex items-start gap-1">
                              <span className="flex min-w-0 flex-1 items-start gap-1">
                              <span
                                onPointerDown={
                                  editable
                                    ? (e) =>
                                        startSlotDrag(e, {
                                          rowId: slot.rowId,
                                          itemId: slot.itemId,
                                          name: slot.name,
                                          par: slot.par,
                                          trayId: row.tray.id,
                                          weekday,
                                        })
                                    : undefined
                                }
                                title={
                                  editable
                                    ? "Drag to another day — hold Option to copy"
                                    : undefined
                                }
                                className={`min-w-0 flex-1 break-words ${
                                  editable ? "cursor-grab select-none touch-pan-y" : ""
                                }`}
                              >
                                {slot.name}
                              </span>
                              {editable ? (
                                <button
                                  type="button"
                                  onClick={() => removeSlot(slot.rowId)}
                                  disabled={pending}
                                  aria-label={`Remove ${slot.name} from tray ${row.tray.tray_number} on ${WEEKDAYS[i].long}`}
                                  className="shrink-0 text-subtle opacity-0 transition-opacity hover:text-accent focus:opacity-100 group-hover:opacity-100"
                                >
                                  ✕
                                </button>
                              ) : null}
                              </span>

                              <span className="flex shrink-0 items-start gap-1">
                                {/* Fixed width so the steppers sit at the same x
                                    in every cell, however wide the number. */}
                                <span className="w-6 shrink-0">
                                  {editable ? (
                                    <InlineValue
                                      table="production_plan_tray_items"
                                      id={slot.rowId}
                                      column="par"
                                      kind="number"
                                      value={slot.par}
                                      placeholder="—"
                                      // Yellow rather than faint: an unset par is
                                      // worth your eye, because that slot makes
                                      // nothing. A zero is black — somebody said it.
                                      // A FILL, never ink: `text-mark` on white is
                                      // 1.43:1, which is text you cannot read.
                                      emptyClassName="bg-mark-fill"
                                      align="right"
                                      ariaLabel={`How many ${slot.name} on tray ${row.tray.tray_number}, ${WEEKDAYS[i].long}`}
                                    />
                                  ) : (
                                    <span
                                      className={`${READ_ONLY_VALUE} block text-right tabular-nums ${
                                        slot.par === null ? "bg-mark-fill" : ""
                                      }`}
                                    >
                                      {slotParLabel(slot.par)}
                                    </span>
                                  )}
                                </span>
                                {editable ? (
                                  <Steppers
                                    disabled={pending}
                                    onUp={() => stepSlot(slot, 1)}
                                    onDown={() => stepSlot(slot, -1)}
                                    labelUp={`Raise ${slot.name} by one box`}
                                    labelDown={`Lower ${slot.name} by one box`}
                                  />
                                ) : null}
                              </span>
                              </span>

                              {/* The destination's own default, offered on the
                                  slot a drag just landed on — the receiving
                                  screen's `→` idiom, so taking it is one tap and
                                  ignoring it is none.

                                  On its OWN line, which does not breach the
                                  one-line rule above: that rule is about the
                                  chip at REST, and this is a transient offer
                                  that clears on your next action. Squeezed onto
                                  the main line it took the width the name needs
                                  and broke "Angry Samoa" into "Angr/y/Sam/oa". */}
                              {editable && suggestionFor(slot, weekday) !== null ? (
                                <span className="mt-0.5 flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => takeSuggested(slot.rowId, suggestionFor(slot, weekday) as number)}
                                    disabled={pending}
                                    title={`${WEEKDAYS[i].long}'s default here is ${suggestionFor(slot, weekday)} — use it instead of ${slotParLabel(slot.par)}`}
                                    aria-label={`Use ${WEEKDAYS[i].long}'s default of ${suggestionFor(slot, weekday)} for ${slot.name}`}
                                    className="whitespace-nowrap bg-mark-fill px-1 text-[11px] tabular-nums text-ink underline underline-offset-2 hover:bg-ink hover:text-white"
                                  >
                                    → use default {suggestionFor(slot, weekday)}
                                  </button>
                                  {/* Its own ✕: the offer now outlives your next
                                      action, so it needs a way to be answered
                                      "no" as well as "yes". */}
                                  <button
                                    type="button"
                                    onClick={() => dismissLanded(slot.rowId)}
                                    title={`Keep ${slotParLabel(slot.par)} for ${slot.name}`}
                                    aria-label={`Dismiss the default-par suggestion for ${slot.name} on ${WEEKDAYS[i].long}`}
                                    className="text-[10px] leading-none text-subtle hover:text-ink"
                                  >
                                    ✕
                                  </button>
                                </span>
                              ) : null}

                              {/* THE REVERSE, on its own line: teach the shop
                                  this number instead of taking its one. Two
                                  lines because the pair will not fit a 150px
                                  chip, and quieter than the offer above it —
                                  taking a default changes this plan, where
                                  setting one changes the catalog every future
                                  plan seeds from. */}
                              {editable && suggestionFor(slot, weekday) !== null && slot.par !== null ? (
                                <button
                                  type="button"
                                  onClick={() => updateDefault(slot, weekday)}
                                  disabled={pending}
                                  title={`Make ${slot.par} ${locationCode}'s default for ${slot.name} on ${WEEKDAYS[i].long} — changes the shop, not just this plan`}
                                  aria-label={`Set ${locationCode}'s default for ${slot.name} on ${WEEKDAYS[i].long} to ${slot.par}`}
                                  className="mt-0.5 self-start whitespace-nowrap text-[11px] tabular-nums text-subtle hover:text-ink"
                                >
                                  ↑ set default {slot.par}
                                </button>
                              ) : null}
                            </span>
                          ))}
                          {editable ? (
                            isAdding ? (
                              <PickList
                                variant="field"
                                ariaLabel={`Add an item to tray ${row.tray.tray_number} on ${WEEKDAYS[i].long}`}
                                value=""
                                // "+ add" already said you want to choose
                                // something, so the list is open when it
                                // arrives — and since 307 items make it
                                // searchable, the cursor lands in the find box
                                // ready to type. Dismissing puts "+ add" back
                                // rather than leaving an empty field where the
                                // command used to be.
                                defaultOpen
                                onClose={() => setAdding(null)}
                                onPick={(v) => addItem(row.tray.id, weekday, v)}
                                // The hint carries the DEFAULT this item would
                                // arrive with, so the number is on screen before
                                // you choose rather than after — which is the
                                // whole reason the defaults are fetched with the
                                // page rather than looked up at click time.
                                options={items.map((it) => {
                                  const seed = defaultParFor(defaultPars, it.id, weekday);
                                  return {
                                    value: it.id,
                                    label: it.name,
                                    hint:
                                      seed === null ? it.taxonomy : `${it.taxonomy} · par ${seed}`,
                                    inactive: it.inactive,
                                  };
                                })}
                                placeholder="Which item…"
                                activateTable="production_items"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setAdding({ trayId: row.tray.id, weekday })}
                                className="border border-dashed border-hairline px-1.5 py-1 text-left text-[11px] uppercase tracking-[0.08em] text-subtle hover:border-ink hover:text-ink"
                              >
                                + add
                              </button>
                            )
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                  {/* The row's OWN controls, together at the end of the row it
                      acts on (Mark, 2026-08-08): the stepper pair that moves the
                      whole week, then the ⋯. `px-0` because the two of them are
                      exactly this column's width and RowMenu's 36px trigger
                      carries its own whitespace. */}
                  <td className={`px-0 py-4 align-top ${row.endsSubGroup ? "pb-8" : ""}`}>
                    <div className="flex items-start justify-end gap-1">
                    {editable ? (
                      <RowSteppers
                        rows={Math.max(0, ...row.days.map((d) => d.length))}
                        disabled={pending}
                        trayNumber={row.tray.tray_number}
                        onStep={(index, direction) => stepTray(row.days, direction, index)}
                      />
                    ) : null}
                    {editable && tray ? (
                      <RowMenu
                        label={`Actions for tray ${row.tray.tray_number}`}
                        items={[
                          {
                            label: "Edit tray",
                            hint: "Number, category and donut",
                            onSelect: () => setEditing(tray),
                          },
                          {
                            label: "Duplicate",
                            hint: "A new tray carrying the same items and pars",
                            onSelect: () => duplicateTray(tray, row.days),
                          },
                          {
                            label: "Delete",
                            hint: (() => {
                              const held = row.days.flat().length;
                              return held
                                ? `Removes the tray and the ${held} item${
                                    held === 1 ? "" : "s"
                                  } on it`
                                : "Removes the tray from this plan";
                            })(),
                            danger: true,
                            onSelect: () => removeTray(tray, row.days),
                          },
                        ]}
                      />
                    ) : null}
                    </div>
                  </td>
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {matrix.length === 0 ? (
        <p className="text-[13px] text-muted">
          No trays yet. A plan is a display case — add the trays, then put an
          item in each slot it holds that day.
        </p>
      ) : null}

      {/* PINNED to the foot of the window (Mark, 2026-08-08). A plan runs to a
          dozen trays and more, so a command that lived under the table was a
          scroll away from the rows you were building. `StickyFooter` measures
          its own height into a spacer, so the table's last row never hides
          behind it. */}
      {editable ? (
        <StickyFooter spacerClassName="-mt-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => setNewTray(true)}
              className="inline-flex h-9 items-center border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white"
            >
              Add tray
            </button>
            <button
              type="button"
              onClick={() => void renumber()}
              disabled={pending || trays.length === 0}
              className="inline-flex h-9 items-center border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              Renumber trays
            </button>
            {/* The grand total, beside the command that changes it. It repeats
                the heading's own count deliberately: once the footer is pinned
                the heading has scrolled away, and this is the line that stays
                with you while you build. */}
            <span className="text-[13px] text-muted">
              {trays.length} tray{trays.length === 1 ? "" : "s"} on this plan
            </span>
            {/* The pars against this shop's own defaults. Always available, so the
                question can be asked without a duplicate or a move to prompt it —
                and it says the count BEFORE you turn it on, which is what you need
                to decide whether to. */}
            {editable && (differing.length > 0 || review) ? (
              <div className="flex flex-wrap items-center gap-3 border-l-2 border-mark pl-3 text-[13px]">
                <span className="text-muted">
                  {differing.length === 0 ? (
                    <>Every par matches {locationCode}&rsquo;s defaults.</>
                  ) : (
                    <>
                      <span className="font-medium text-ink">
                        {differing.length} par{differing.length === 1 ? "" : "s"}
                      </span>{" "}
                      differ{differing.length === 1 ? "s" : ""} from {locationCode}&rsquo;s defaults.
                    </>
                  )}
                </span>
                {differing.length ? (
                  <button
                    type="button"
                    onClick={() => setReview((v) => !v)}
                    className="inline-flex h-8 items-center border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white"
                  >
                    {review ? "Stop checking" : "Check pars"}
                  </button>
                ) : null}
                {review && differing.length ? (
                  <>
                    <button
                      type="button"
                      onClick={takeAllSuggested}
                      disabled={pending}
                      title={`Replace those pars with ${locationCode}'s defaults`}
                      className="inline-flex h-8 items-center border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-40"
                    >
                      Use {locationCode} defaults
                    </button>
                    {/* The reverse, and the riskier direction: it writes the SHOP's
                        catalog, which every future plan seeds from. It reads as a peer
                        of its opposite (Mark, 2026-08-08) — the app's one button
                        weight, outlined and white — so the warning lives entirely in
                        the confirm, which names the blast radius. */}
                    <button
                      type="button"
                      onClick={updateAllDefaults}
                      disabled={pending}
                      title={`Make this plan's pars ${locationCode}'s defaults — changes the shop's catalog`}
                      className="inline-flex h-8 items-center border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-40"
                    >
                      Update {locationCode} defaults
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </StickyFooter>
      ) : null}

      {/* The drag overlay: the two drop zones and the chip in hand. All three
          are positioned, labelled and restyled by the hook through refs — no
          state per pointer move, so dragging never re-renders the trays. */}
      {dragging ? (
        <>
          <div ref={moveZoneRef} style={{ display: "none" }} />
          <div ref={copyZoneRef} style={{ display: "none" }} />
          <div
            ref={chipRef}
            style={{ left: dragging.x, top: dragging.y }}
            className="pointer-events-none fixed z-[70] -translate-y-1/2 translate-x-3 whitespace-nowrap border border-ink bg-white px-2 py-1 text-[12px]"
          >
            {dragging.name}
          </div>
        </>
      ) : null}

      {newTray ? (
        <NewTrayDialog
          bands={bands}
          items={items}
          pending={pending}
          onClose={() => setNewTray(false)}
          onAdd={addTray}
        />
      ) : null}

      {editing ? (
        <EditTrayDialog
          tray={editing}
          heldItemIds={[...new Set(slots.filter((sl) => sl.tray_id === editing.id).map((sl) => sl.item_id))]}
          bands={bands}
          items={items}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(next, currentItemId) => editTray(editing, next, currentItemId)}
        />
      ) : null}
    </div>
  );
}

/**
 * FMP's stacked pair, and the reason it is a pair rather than a number box: a
 * par moves by whole boxes, so the gesture that changes it should too.
 *
 * NO BORDER (Mark, 2026-08-08). A box around a 7px glyph spends most of its
 * width on the box, and two of them stacked read as a control you have to
 * decipher. Bare arrows can be half again as large in the same space, which is
 * what makes the pair legible at a glance — the glyph IS the affordance, and it
 * darkens on hover like every other quiet control here.
 */
function Steppers({
  onUp,
  onDown,
  disabled,
  labelUp,
  labelDown,
}: {
  onUp: () => void;
  onDown: () => void;
  disabled: boolean;
  labelUp: string;
  labelDown: string;
}) {
  const cell =
    "flex h-3 w-4 items-center justify-center text-[11px] leading-none text-subtle transition-colors hover:text-ink disabled:opacity-30";
  return (
    <span className="flex shrink-0 flex-col">
      <button type="button" onClick={onUp} disabled={disabled} aria-label={labelUp} className={cell}>
        ▲
      </button>
      <button
        type="button"
        onClick={onDown}
        disabled={disabled}
        aria-label={labelDown}
        className={cell}
      >
        ▼
      </button>
    </span>
  );
}

/**
 * One stepper per ROW of a tray, each level with the chips it moves.
 *
 * The seven day cells lay their chips out independently and a long name wraps,
 * so row n's chips do not share a y by construction — the third row can start
 * at 88px in Monday's cell and 92px in Tuesday's. The band each stepper sits
 * against is therefore MEASURED off the chips themselves (`data-slot-index`),
 * top of the highest to bottom of the lowest across the week, and re-measured
 * whenever the row resizes: a name wrapping, an offer line appearing, a chip
 * added. Written straight to the node, no state, the receiving screen's rule.
 *
 * The stepper sits 5px into its band — the chip's 1px border plus 4px top
 * padding — so its arrows line up with the per-day pair inside every chip on
 * that row. If the chip's padding moves, this moves with it.
 */
function RowSteppers({
  rows,
  disabled,
  trayNumber,
  onStep,
}: {
  rows: number;
  disabled: boolean;
  trayNumber: string;
  onStep: (index: number, direction: 1 | -1) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    const tr = el?.closest("tr");
    if (!el || !tr) return;
    const place = () => {
      const origin = el.getBoundingClientRect().top;
      const bands = new Map<number, { top: number; bottom: number }>();
      tr.querySelectorAll<HTMLElement>("[data-slot-index]").forEach((chip) => {
        const i = Number(chip.dataset.slotIndex);
        const r = chip.getBoundingClientRect();
        const b = bands.get(i);
        bands.set(i, {
          top: Math.min(b?.top ?? Infinity, r.top - origin),
          bottom: Math.max(b?.bottom ?? -Infinity, r.bottom - origin),
        });
      });
      let height = 0;
      el.querySelectorAll<HTMLElement>("[data-row-stepper]").forEach((node) => {
        const b = bands.get(Number(node.dataset.rowStepper));
        if (!b) return;
        node.style.top = `${b.top}px`;
        height = Math.max(height, b.bottom);
      });
      // The column is a positioning frame; give it the chips' height so the
      // row's own height and the ⋯ beside it are unaffected.
      el.style.height = `${height}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(tr);
    return () => ro.disconnect();
  }, [rows]);

  return (
    <div ref={box} className="relative w-4 shrink-0">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} data-row-stepper={i} className="absolute left-0 mt-[5px]">
          <Steppers
            disabled={disabled}
            onUp={() => onStep(i, 1)}
            onDown={() => onStep(i, -1)}
            labelUp={`Raise row ${i + 1} of tray ${trayNumber} by one box, every day`}
            labelDown={`Lower row ${i + 1} of tray ${trayNumber} by one box, every day`}
          />
        </span>
      ))}
    </div>
  );
}

function NewTrayDialog({
  bands,
  items,
  pending,
  onClose,
  onAdd,
}: {
  bands: string[];
  items: MatrixItem[];
  pending: boolean;
  onClose: () => void;
  /** `itemId` empty = a bare tray, to be filled a day at a time. */
  onAdd: (trayNumber: string, band: string, itemId: string) => void;
}) {
  const [trayNumber, setTrayNumber] = useState("");
  const [band, setBand] = useState("");
  const [itemId, setItemId] = useState("");

  return (
    <Dialog
      title="Add tray"
      onClose={onClose}
      busy={pending}
      width="max-w-md"
      // Enter commits, guarded by exactly what the commit button's `disabled`
      // asks — an Enter that fires a refused write is worse than one that does
      // nothing.
      onSubmit={() => {
        if (!pending && trayNumber.trim() !== "") onAdd(trayNumber, band, itemId);
      }}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className={DIALOG_CANCEL_CLASS}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onAdd(trayNumber, band, itemId)}
            disabled={pending || trayNumber.trim() === ""}
            className={DIALOG_COMMIT_CLASS}
          >
            {pending ? "Adding…" : "Add tray"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Tray number
          </span>
          {/* Text, not a number: FileMaker's are "01", "05", "07" and a case
              can grow a "7A". */}
          <TextInput
            value={trayNumber}
            onValueChange={setTrayNumber}
            placeholder="01"
            aria-label="Tray number"
            // The pick lists beside it fill the track; the text box must say so
            // twice (wrapper and input) or it shrink-wraps — see ui/TextInput.
            fullWidth
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Category
          </span>
          <PickList
            variant="field"
            ariaLabel="Category"
            className="w-full"
            value={band}
            onPick={setBand}
            options={bands.map((b) => ({ value: b, label: b }))}
            allowNew
            placeholder="RAISED, CLASSIC, SIGNATURE…"
          />
        </div>
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Donut
          </span>
          {/* Optional. Chosen here it goes on all seven days of the tray, each
              day seeded with the item's default par at this shop; left empty
              the tray arrives bare and is filled a day at a time. */}
          <PickList
            variant="field"
            ariaLabel="Donut"
            className="w-full"
            value={itemId}
            onPick={setItemId}
            clearable
            options={items.map((it) => ({
              value: it.id,
              label: it.name,
              hint: it.taxonomy,
              inactive: it.inactive,
            }))}
            placeholder="Every day of the week, or leave empty"
            activateTable="production_items"
          />
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Change one tray's number, category and donut — the ⋯ menu's "Edit tray",
 * the Add tray dialog's three fields over an existing tray.
 *
 * The number is unique per plan and the write says so if it collides. The
 * donut field is offered only when the tray holds at most ONE distinct item;
 * a tray carrying several says so in its place, since there is no one donut to
 * show and re-pointing three items at one would silently collapse a tray
 * somebody built by hand.
 */
function EditTrayDialog({
  tray,
  heldItemIds,
  bands,
  items,
  pending,
  onClose,
  onSave,
}: {
  tray: MatrixTray;
  /** The distinct items on this tray, any day. */
  heldItemIds: string[];
  bands: string[];
  items: MatrixItem[];
  pending: boolean;
  onClose: () => void;
  onSave: (
    next: { trayNumber: string; category: string; itemId: string },
    currentItemId: string | null
  ) => void;
}) {
  const single = heldItemIds.length <= 1;
  const currentItemId = heldItemIds.length === 1 ? heldItemIds[0] : null;
  const [trayNumber, setTrayNumber] = useState(tray.tray_number);
  const [category, setCategory] = useState(tray.band ?? "");
  const [itemId, setItemId] = useState(currentItemId ?? "");
  const ready = trayNumber.trim() !== "";
  const save = () => onSave({ trayNumber, category, itemId }, currentItemId);

  return (
    <Dialog
      title={`Edit tray ${tray.tray_number}`}
      onClose={onClose}
      busy={pending}
      width="max-w-md"
      onSubmit={() => {
        if (!pending && ready) save();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className={DIALOG_CANCEL_CLASS}>
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || !ready}
            className={DIALOG_COMMIT_CLASS}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Tray number
          </span>
          <TextInput
            value={trayNumber}
            onValueChange={setTrayNumber}
            placeholder="01"
            aria-label="Tray number"
            // The pick lists beside it fill the track; the text box must say so
            // twice (wrapper and input) or it shrink-wraps — see ui/TextInput.
            fullWidth
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Category
          </span>
          <PickList
            variant="field"
            ariaLabel="Category"
            className="w-full"
            value={category}
            onPick={setCategory}
            options={bands.map((b) => ({ value: b, label: b }))}
            allowNew
            placeholder="RAISED, CLASSIC, SIGNATURE…"
          />
          {/* Clearing it is a real answer — a tray with no category groups under
              "No category" rather than disappearing. */}
          <button
            type="button"
            onClick={() => setCategory("")}
            disabled={pending || category === ""}
            className="text-[11px] uppercase tracking-[0.08em] text-subtle hover:text-ink disabled:opacity-35"
          >
            Clear
          </button>
        </div>
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Donut
          </span>
          {single ? (
            <PickList
              variant="field"
              ariaLabel="Donut"
              className="w-full"
              value={itemId}
              onPick={setItemId}
              options={items.map((it) => ({
                value: it.id,
                label: it.name,
                hint: it.taxonomy,
                inactive: it.inactive,
              }))}
              placeholder="Every day of the week, or leave empty"
              activateTable="production_items"
            />
          ) : (
            <p className="text-[13px] text-muted">
              This tray holds {heldItemIds.length} different items — change them
              on the tray itself.
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** A link back to the item, for the plan's own summary line. */
export function ItemLink({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/production-items/${id}`} className="hover:underline">
      {name}
    </Link>
  );
}
