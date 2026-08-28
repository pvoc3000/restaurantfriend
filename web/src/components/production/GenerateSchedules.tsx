"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  pullReadiness,
  scheduleDraft,
  inGenerationRun,
  scheduleKitchen,
  scheduleTitle,
  type PullCandidate,
  type PullReadiness,
  type SchedulableLine,
} from "@/lib/specialOrderSchedule";
import { STATUS_LABEL } from "@/lib/specialOrders";
import { addDays } from "@/lib/payPeriods";
import { sellingShopsForKitchen, type PlanSummary } from "@/lib/productionPlans";
import { createClient } from "@/lib/supabase/client";
import { packetDate } from "@/lib/productionSchedule";
import { Checkbox } from "@/components/ui/Checkbox";
import { DateField } from "@/components/ui/DateField";
import { PickList } from "@/components/ui/PickList";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";

/**
 * "Generate schedules" — production brief decision 7.
 *
 * There is no nightly cron and there never will be: generation is part of the
 * supervisor's closing routine, and the dialog takes a start date, a NUMBER OF
 * DAYS and a location set because generating ahead is a real workflow — closed
 * days, long weekends, a supervisor who won't be in. FMP's own generator dialog
 * takes exactly these three.
 *
 * ONE KITCHEN — THE WORKING ONE (Mark, 2026-08-28). You commit the night for
 * the kitchen you are standing in, so the Shops list no longer offers every
 * active shop: it offers the shops that SELL what this kitchen makes, which is
 * usually just the one and is DF02 as well when DF01 bakes for it.
 *
 * That indirection is forced by the function rather than chosen. 040's comment
 * still holds in 069 — "the kitchen is NOT a parameter: the DAY tells you which
 * kitchens are involved" — so `p_location_ids` is a list of SELLERS and the
 * only way to aim a run at one kitchen from out here is to ask which sellers
 * feed it. `sellingShopsForKitchen` carries that, and the known limit with it.
 *
 * The SPECIAL ORDERS beside them are matched on the kitchen DIRECTLY, not
 * through that set. `inGenerationRun` has always compared `scheduleKitchen`
 * against whatever set it was handed, and it used to be handed the selling
 * shops — harmless while the two coincided, and wrong the moment they do not.
 *
 * Everything else FMP put around it is gone. Its Skip/Continue gauntlet, its
 * overwrite warning and its "locked" flag all existed because a pre-generated
 * document was the only place to store intent about a future date; par
 * overrides are that intent now, so an existing day is simply SKIPPED and
 * reported, and regenerating one is a second, explicit press.
 */

type Created = {
  schedule_id: string;
  date: string;
  location_code: string;
  kitchen_code: string;
  line_count: number;
  par_total: number;
};

type Skipped = Created & { reason: string; has_actuals: boolean };

type Replaced = {
  schedule_id: string;
  date: string;
  location_code: string;
  kitchen_code: string;
  lines_before: number;
  lines_after: number;
  actuals_carried: number;
  actuals_lost: number;
  manual_kept: number;
};

type Warning = {
  kind: string;
  date: string;
  location_code: string;
  item_name: string;
  detail: string;
};

type Receipt = {
  start: string;
  days: number;
  created: Created[];
  skipped: Skipped[];
  replaced: Replaced[];
  warnings: Warning[];
};

/** A special order the run could bring along, judged by `pullReadiness`. */
type Candidate = {
  order: PullCandidate;
  draft: ReturnType<typeof scheduleDraft>;
  readiness: PullReadiness;
  kitchenCode: string;
};

/** What became of each one, for the receipt. */
type Pulled = { number: string; title: string | null; lines: number; error?: string };

const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 28].map((n) => ({
  value: String(n),
  label: n === 1 ? "1 day" : `${n} days`,
}));

/** Yellow, never red: every one of these names something worth an eye, and the
 *  generation went ahead anyway — the under-minimum-vendor pattern. */
const WARNING_TITLE: Record<string, string> = {
  overlapping_plans: "Pars summed",
  kitchen_split_override: "Override went to one kitchen",
  kitchen_assumed: "Kitchen assumed",
  not_made: "Not made",
};

export function GenerateSchedules({
  locations,
  today,
  kitchenId,
  kitchenCode,
  plans,
}: {
  locations: { id: string; code: string; name: string }[];
  today: string;
  /** The working location — the kitchen every schedule this run writes is for. */
  kitchenId: string;
  kitchenCode: string;
  /** Every plan in the org; which ones count is decided per date range. */
  plans: PlanSummary[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(today);
  const [days, setDays] = useState("1");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ignoreSpecial, setIgnoreSpecial] = useState(false);
  const [running, setRunning] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The special orders this run could bring along, and which of them are ticked.
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [pullIds, setPullIds] = useState<Set<string>>(new Set());
  const [pulled, setPulled] = useState<{ done: Pulled[]; failed: Pulled[] } | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const loadSeq = useRef(0);

  function openDialog() {
    setOpen(true);
    setReceipt(null);
    setError(null);
    setStart(today);
    setDays("1");
    setIgnoreSpecial(false);
    // Every shop this kitchen sells THROUGH, preselected. Unlike the PO
    // generator there is no per-location guard to encode here — an
    // already-generated day is reported by the function itself rather than
    // guessed at up front.
    setSelected(new Set(shopsFor(today, 1).map((l) => l.id)));
    setCandidates(null);
    setPullIds(new Set());
    setPulled(null);
    void loadCandidates(today, 1);
  }

  /**
   * The shops whose plans feed THIS kitchen over a window.
   *
   * Recomputed from the date range rather than fixed at open, because a plan
   * starting next week legitimately adds a shop to a run that reaches it — the
   * same reason the special-order list is re-asked on every date change.
   */
  function shopsFor(from: string, dayCount: number) {
    const ids = new Set(
      sellingShopsForKitchen(plans, kitchenId, {
        starts_on: from,
        ends_on: addDays(from, Math.max(0, dayCount - 1)),
      })
    );
    return locations.filter((l) => ids.has(l.id));
  }

  /** Both halves of "what does changing the window change" — the shops this
   *  kitchen can generate for, and the orders it could bring along. */
  function rescope(from: string, dayCount: number) {
    setSelected(new Set(shopsFor(from, dayCount).map((l) => l.id)));
    void loadCandidates(from, dayCount);
  }

  /**
   * The special orders this run would bring along.
   *
   * EXPLICIT, not an effect: it is called when the dialog opens and when the
   * date or the day count changes, which is exactly when the answer can move.
   * An effect would re-run on every render of a dialog that also holds a
   * checkbox per shop, and the `set-state-in-effect` lint exists for a reason.
   *
   * Two queries over a handful of rows — there were eleven upcoming orders in
   * the whole database when this was written.
   */
  async function loadCandidates(from: string, dayCount: number) {
    // A SEQUENCE GUARD, because two of these can be in flight: changing the
    // date and then the day count fires both, and whichever answers LAST wins
    // regardless of which was asked last. Without it a slow first query
    // overwrites a fast second one and the list quietly describes the wrong
    // window.
    const seq = ++loadSeq.current;
    const to = addDays(from, dayCount - 1);
    const { data: orders, error: e } = await supabase
      .from("special_orders")
      .select(
        `id, number, title, kind, status, event_date, flag_reason,
         kitchen_location_id, location_id, production_schedule_id`
      )
      .eq("kind", "order")
      .gte("event_date", from)
      .lte("event_date", to);
    if (seq !== loadSeq.current) return;
    if (e) {
      // NOT swallowed into an empty list: "none ready for production" is a
      // claim, and a failed query must not make it.
      setCandidateError(e.message);
      setCandidates([]);
      setPullIds(new Set());
      return;
    }
    setCandidateError(null);
    if (!orders?.length) {
      setCandidates([]);
      setPullIds(new Set());
      return;
    }

    const { data: lineRows } = await supabase
      .from("special_order_items")
      .select("order_id, production_item_id, name, item_type, item_cut, item_finish, item_size, qty, notes, sort")
      .in("order_id", orders.map((o) => o.id as string))
      .order("sort", { ascending: true, nullsFirst: false });

    const byOrder = new Map<string, SchedulableLine[]>();
    for (const l of lineRows ?? []) {
      const list = byOrder.get(l.order_id as string) ?? [];
      list.push({
        name: (l.name ?? "") as string,
        production_item_id: (l.production_item_id ?? null) as string | null,
        item_type: (l.item_type ?? null) as string | null,
        item_cut: (l.item_cut ?? null) as string | null,
        item_finish: (l.item_finish ?? null) as string | null,
        item_size: (l.item_size ?? null) as string | null,
        qty: l.qty === null ? null : Number(l.qty),
        notes: (l.notes ?? null) as string | null,
      });
      byOrder.set(l.order_id as string, list);
    }

    const code = new Map(locations.map((l) => [l.id, l.code]));
    const next: Candidate[] = orders.map((raw) => {
      const order = {
        id: raw.id as string,
        number: String(raw.number ?? ""),
        title: (raw.title ?? null) as string | null,
        kind: (raw.kind ?? "") as string,
        status: (raw.status ?? null) as string | null,
        event_date: (raw.event_date ?? null) as string | null,
        flag_reason: (raw.flag_reason ?? null) as string | null,
        kitchen_location_id: (raw.kitchen_location_id ?? null) as string | null,
        location_id: (raw.location_id ?? null) as string | null,
        production_schedule_id: (raw.production_schedule_id ?? null) as string | null,
      };
      const draft = scheduleDraft(byOrder.get(order.id) ?? []);
      return {
        order,
        draft,
        readiness: pullReadiness(order, draft.lines.length, (v) =>
          STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? v
        ),
        kitchenCode: code.get(scheduleKitchen(order) ?? "") ?? "—",
      };
    });

    if (seq !== loadSeq.current) return;
    setCandidates(next);
    // Ticked by default, which is the point of offering them — everything held
    // back has to be chosen deliberately.
    setPullIds(new Set(next.filter((c) => c.readiness.state === "ready").map((c) => c.order.id)));
  }

  function togglePull(id: string) {
    setPullIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(replace: boolean, allowActuals: boolean) {
    if (!start) return;
    setRunning(true);
    setError(null);

    /* NO SHOPS IS A LEGITIMATE RUN, so the function is not called at all.
       A special order needs no plan — a wedding at a kitchen with nothing on
       its menu that week is exactly the case — and
       `generate_production_schedules` RAISES "no locations given" on an empty
       array, which would report a failure over a pull that worked fine. */
    let data: Receipt = {
      start,
      days: Number(days),
      created: [],
      skipped: [],
      replaced: [],
      warnings: [],
    };

    if (selected.size > 0) {
      const { data: got, error } = await supabase.rpc("generate_production_schedules", {
        p_start: start,
        p_days: Number(days),
        p_location_ids: [...selected],
        p_ignore_special_orders: ignoreSpecial,
        p_replace: replace,
        p_allow_actuals: allowActuals,
      });

      if (error) {
        setRunning(false);
        setError(error.message);
        return;
      }
      data = got as Receipt;
    }

    /* ----------------------------------------------------------------------
     * THE SPECIAL ORDERS, PULLED IN — decision 12's toggle finally meaning
     * something (Mark, 2026-08-27).
     *
     * IT RUNS IN THE CLIENT, one `schedule_special_order` per order, and that
     * is the whole design rather than a shortcut. Folding this into
     * `generate_production_schedules` would need a PL/pgSQL twin of
     * `scheduleDraft` — the cut canonicalisation over 93 real spellings, the
     * note copy, the Misc filter — which is 016's `nextDeliveryDate` trap and
     * the very thing 069 argued against. So PUSH stays the only writer and
     * this is a second DOOR onto it: same function, same guards, same
     * transcript.
     *
     * Each call is its own transaction, so one failure does not take the rest
     * with it — they are collected and named instead. An order somebody
     * scheduled while this dialog was open refuses itself ("already
     * scheduled"), which is why re-running is safe.
     * -------------------------------------------------------------------- */
    const done: Pulled[] = [];
    const failed: Pulled[] = [];
    if (!ignoreSpecial) {
      for (const c of candidates ?? []) {
        if (!pullIds.has(c.order.id) || !c.order.event_date) continue;
        const entry = {
          number: c.order.number,
          title: c.order.title,
          lines: c.draft.lines.length,
        };
        const { error: pullErr } = await supabase.rpc("schedule_special_order", {
          p_order_id: c.order.id,
          p_date: c.order.event_date,
          p_today: today,
          p_title: scheduleTitle(c.order.number, c.order.title),
          p_lines: c.draft.lines,
        });
        if (pullErr) failed.push({ ...entry, error: pullErr.message });
        else done.push(entry);
      }
    }

    setRunning(false);
    setReceipt(data);
    setPulled({ done, failed });
    router.refresh();
  }

  const blockedByActuals = (receipt?.skipped ?? []).some((s) => s.has_actuals);

  // The shops on offer for the window as it currently stands.
  const eligible = start ? shopsFor(start, Number(days)) : [];

  // Which candidates are in THIS run.
  //
  // MATCHED ON THE KITCHEN — a set holding the working location and nothing
  // else — never on `selected`. `inGenerationRun` compares an order's
  // `scheduleKitchen` against the set it is handed, and it used to be handed
  // the ticked SELLING shops: harmless while a shop sold only what it baked,
  // and wrong the moment DF01 bakes for DF02, when it would have offered DF01's
  // orders under a DF02 tick and withheld them under DF01's.
  const kitchenSet = useMemo(() => new Set([kitchenId]), [kitchenId]);
  const inRun = (candidates ?? []).filter(
    (c) => start && inGenerationRun(c.order, start, addDays(start, Number(days) - 1), kitchenSet)
  );
  const offered = inRun.filter((c) => c.readiness.state !== "not_ready");
  const withheld = inRun.filter((c) => c.readiness.state === "not_ready");
  /** Orders actually ticked and in this run — what makes a shopless run worth
   *  pressing. */
  const pullCount = ignoreSpecial
    ? 0
    : offered.filter((c) => pullIds.has(c.order.id)).length;

  const withheldSentence =
    withheld.length === 0
      ? ""
      : `${withheld.length} more not ready — ${[
          ...new Map(
            withheld.map((c) => [
              c.readiness.state === "not_ready" ? c.readiness.reason : "",
              c.readiness.state === "not_ready" ? c.readiness.reason : "",
            ])
          ).keys(),
        ].join(", ")}.`;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="border border-ink bg-white px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white"
      >
        Generate schedules…
      </button>

      {open && (
        <Dialog
          title={receipt ? "Schedules generated" : "Generate schedules"}
          onClose={() => setOpen(false)}
          busy={running}
          width="max-w-2xl"
          top="pt-[8vh]"
          footer={
            receipt ? (
              <>
                {receipt.skipped.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => run(true, blockedByActuals)}
                    disabled={running}
                    className={DIALOG_CANCEL_CLASS}
                  >
                    {blockedByActuals
                      ? `Regenerate anyway (${receipt.skipped.length})`
                      : `Regenerate these ${receipt.skipped.length}`}
                  </button>
                ) : null}
                {/* A BUTTON THAT CLOSES, not a link to /schedules.
                    This dialog only ever renders ON /schedules, so the link
                    pointed at the page it was already on — which Next treats as
                    a no-op, leaving the panel up and the button reading as
                    dead. The list behind it was refreshed by `run` the moment
                    the receipt arrived, so there is nothing to navigate TO;
                    finishing here means putting the receipt away. */}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className={DIALOG_COMMIT_CLASS}
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={running}
                  className={DIALOG_CANCEL_CLASS}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => run(false, false)}
                  disabled={running || !start || (selected.size === 0 && pullCount === 0)}
                  className={DIALOG_COMMIT_CLASS}
                >
                  {running ? "Generating…" : "Generate"}
                </button>
              </>
            )
          }
        >
          {error && <p className="mt-2 text-sm text-accent">{error}</p>}

          {receipt ? (
            <Receipt receipt={receipt} pulled={pulled} />
          ) : (
            <div className="mt-3 space-y-5">
              <p className="text-sm text-muted">
                One schedule per shop per kitchen, from the plans active on each
                date plus any par overrides written for it. A day that already
                has a schedule is reported rather than replaced.
              </p>

              <div className="flex flex-wrap items-end gap-6">
                <label className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Starting
                  </span>
                  <DateField
                    value={start}
                    onChange={(v) => {
                      setStart(v);
                      if (v) rescope(v, Number(days));
                    }}
                    required
                    ariaLabel="First date to generate"
                  />
                </label>
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    For
                  </span>
                  <PickList
                    variant="field"
                    value={days}
                    onPick={(v) => {
                      setDays(v);
                      if (start) rescope(start, Number(v));
                    }}
                    options={DAY_OPTIONS}
                    ariaLabel="How many days to generate"
                  />
                </div>
              </div>

              {/* THE SHOPS THIS KITCHEN SELLS THROUGH.
                  ONE ROW is stated rather than offered — a checkbox list of a
                  single item asks a question with one answer, and every real
                  plan today sells and bakes at the same shop. The list comes
                  back the moment a second shop's plan points here, which is
                  decision 9's case and the only time the choice is real. */}
              <div className="space-y-2">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Shops
                </span>

                {eligible.length === 0 ? (
                  // Named, not an empty box: "no shops" and "no plans reach
                  // this kitchen on those dates" look identical on screen and
                  // are answered in completely different places.
                  <p className="text-sm">
                    <span className="bg-mark-fill px-1">
                      No active plan makes anything at {kitchenCode}
                      {start
                        ? days === "1"
                          ? ` on ${start}`
                          : ` over those ${days} days`
                        : ""}
                      .
                    </span>{" "}
                    <span className="text-muted">
                      A plan needs {kitchenCode}{" "}
                      as its kitchen and a date range covering these days.
                    </span>
                  </p>
                ) : eligible.length === 1 ? (
                  <p className="text-sm">
                    Made at <span className="font-bold">{kitchenCode}</span>, sold at{" "}
                    <span className="font-bold">{eligible[0].code}</span>{" "}
                    <span className="text-subtle">({eligible[0].name})</span>.
                  </p>
                ) : (
                  <ul className="divide-y divide-hairline border border-ink">
                    {eligible.map((l) => (
                      <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <Checkbox
                          checked={selected.has(l.id)}
                          onChange={() => toggle(l.id)}
                          label={`Generate schedules for ${l.name}`}
                          size={18}
                        />
                        <span className="text-[13px] font-semibold uppercase tracking-[0.06em]">
                          {l.code}
                        </span>
                        <span className="text-subtle">{l.name}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <p className="text-xs text-muted">
                  Only the {kitchenCode}{" "}
                  kitchen&rsquo;s nights are generated here — these are the
                  shops it makes them for. Switch shops to generate another
                  kitchen&rsquo;s.
                </p>
              </div>

              {/* THE SPECIAL ORDERS THIS RUN WOULD BRING ALONG.
                  Only those READY FOR PRODUCTION are offered (Mark,
                  2026-08-27) — `pullReadiness`, which means `status = 'order'`,
                  the rung the module already calls "paid, printing and
                  scheduling remain". Everything held back is COUNTED and named
                  rather than silently absent, because an order that simply does
                  not appear is indistinguishable from one the query missed. */}
              <div className="space-y-2">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Special orders
                </span>

                {candidateError ? (
                  <p className="text-sm text-accent">
                    Could not check for special orders: {candidateError}
                  </p>
                ) : candidates === null ? (
                  <p className="text-xs text-muted">Looking…</p>
                ) : offered.length === 0 ? (
                  <p className="text-sm text-muted">
                    None ready for production on {days === "1" ? "that day" : "those days"}.
                    {withheld.length > 0 ? ` ${withheldSentence}` : ""}
                  </p>
                ) : (
                  <>
                    <ul className="divide-y divide-hairline border border-ink">
                      {offered.map((c) => (
                        <li key={c.order.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                          <Checkbox
                            checked={pullIds.has(c.order.id)}
                            onChange={() => togglePull(c.order.id)}
                            disabled={ignoreSpecial}
                            label={`Schedule order ${c.order.number}`}
                            size={18}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="font-semibold tabular-nums">#{c.order.number}</span>
                            {c.order.title ? <span className="text-subtle"> {c.order.title}</span> : null}
                            <span className="block text-xs text-muted">
                              {c.order.event_date} · made at {c.kitchenCode} ·{" "}
                              {c.draft.lines.length} line{c.draft.lines.length === 1 ? "" : "s"},{" "}
                              {c.draft.total} to make
                              {c.draft.blocked.length > 0
                                ? ` · ${c.draft.blocked.length} line${
                                    c.draft.blocked.length === 1 ? "" : "s"
                                  } with no menu item will not be scheduled`
                                : ""}
                            </span>
                            {/* Offered UNTICKED, saying why — 013's
                                under-minimum vendor, unchecked-but-checkable. */}
                            {c.readiness.state === "hold" ? (
                              <span className="mt-1 inline-block bg-mark-fill px-1 text-xs">
                                Flagged: {c.readiness.reason}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {withheld.length > 0 ? (
                      <p className="text-xs text-muted">{withheldSentence}</p>
                    ) : null}
                  </>
                )}
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  checked={ignoreSpecial}
                  onChange={() => setIgnoreSpecial((v) => !v)}
                  label="Ignore special orders"
                  size={18}
                />
                <span className="text-sm">
                  Ignore special orders
                  <span className="block text-xs text-muted">
                    Generate the plans only, and leave the orders above for
                    later. Recorded on each schedule it writes, so the printed
                    totals explain themselves a month from now.
                  </span>
                </span>
              </div>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

function Receipt({
  receipt,
  pulled,
}: {
  receipt: Receipt;
  pulled: { done: Pulled[]; failed: Pulled[] } | null;
}) {
  const nothing =
    receipt.created.length === 0 &&
    receipt.replaced.length === 0 &&
    receipt.skipped.length === 0 &&
    (pulled?.done.length ?? 0) === 0 &&
    (pulled?.failed.length ?? 0) === 0;

  return (
    <div className="mt-3 space-y-5">
      {nothing ? (
        <p className="text-sm text-muted">
          Nothing to generate. No plan active on{" "}
          {receipt.days === 1 ? packetDate(receipt.start) : `those ${receipt.days} days`}{" "}
          carries an item with a par at the shops you chose — which is what the
          “not made” notes below explain, if there are any.
        </p>
      ) : null}

      {receipt.created.length > 0 ? (
        <Block title={`Created ${receipt.created.length}`}>
          {receipt.created.map((c) => (
            <Row key={c.schedule_id} left={<ScheduleLink row={c} />}>
              {c.line_count} {c.line_count === 1 ? "item" : "items"} ·{" "}
              {Number(c.par_total).toLocaleString()} to make
            </Row>
          ))}
        </Block>
      ) : null}

      {receipt.replaced.length > 0 ? (
        <Block title={`Regenerated ${receipt.replaced.length}`}>
          {receipt.replaced.map((r) => (
            <Row key={r.schedule_id} left={<ScheduleLink row={r} />}>
              {r.lines_before} → {r.lines_after} items
              {r.actuals_carried
                ? ` · ${r.actuals_carried} counted ${r.actuals_carried === 1 ? "line" : "lines"} kept`
                : ""}
              {r.manual_kept ? ` · ${r.manual_kept} added by hand kept` : ""}
              {r.actuals_lost ? (
                <span className="text-accent"> · {r.actuals_lost} counted lines dropped</span>
              ) : null}
            </Row>
          ))}
        </Block>
      ) : null}

      {receipt.skipped.length > 0 ? (
        <Block title={`Already generated — ${receipt.skipped.length} left alone`}>
          {receipt.skipped.map((s) => (
            <Row key={s.schedule_id} left={<ScheduleLink row={s} />}>
              {s.line_count} {s.line_count === 1 ? "item" : "items"}
              {s.has_actuals ? (
                <span className="text-mark"> · has counted quantities</span>
              ) : null}
            </Row>
          ))}
        </Block>
      ) : null}

      {pulled && pulled.done.length > 0 ? (
        <Block title={`Special orders scheduled — ${pulled.done.length}`}>
          {pulled.done.map((o) => (
            <Row key={o.number} left={<span className="tabular-nums">#{o.number}</span>}>
              {o.title ? <span className="text-subtle">{o.title} · </span> : null}
              {o.lines} {o.lines === 1 ? "item" : "items"}
            </Row>
          ))}
        </Block>
      ) : null}

      {/* Each order is its own transaction, so one refusal leaves the rest
          done. Named rather than folded into a count — the commonest is
          somebody having scheduled it while this dialog was open. */}
      {pulled && pulled.failed.length > 0 ? (
        <Block title={`Special orders NOT scheduled — ${pulled.failed.length}`}>
          {pulled.failed.map((o) => (
            <Row key={o.number} left={<span className="tabular-nums">#{o.number}</span>}>
              <span className="text-accent">{o.error}</span>
            </Row>
          ))}
        </Block>
      ) : null}

      {receipt.warnings.length > 0 ? (
        <Block title={`Worth a look — ${receipt.warnings.length}`}>
          {receipt.warnings.map((w, i) => (
            <li key={i} className="px-4 py-2 text-sm">
              <span className="border border-ink bg-[var(--rf-yellow-200)] px-2 py-0.5 text-xs text-ink">
                {WARNING_TITLE[w.kind] ?? w.kind}
              </span>{" "}
              <span className="font-medium">{w.item_name}</span>{" "}
              <span className="text-muted">
                at {w.location_code} on {w.date} — {w.detail}
              </span>
            </li>
          ))}
        </Block>
      ) : null}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h3>
      <ul className="divide-y divide-hairline border border-ink">{children}</ul>
    </section>
  );
}

function Row({ left, children }: { left: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
      <span>{left}</span>
      <span className="text-muted">{children}</span>
    </li>
  );
}

function ScheduleLink({
  row,
}: {
  row: { schedule_id: string; date: string; location_code: string; kitchen_code: string };
}) {
  return (
    <Link
      href={`/schedules/${row.schedule_id}`}
      className="font-medium text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
    >
      {packetDate(row.date)} · {row.location_code}
      {row.kitchen_code !== row.location_code ? ` (made at ${row.kitchen_code})` : ""}
    </Link>
  );
}
