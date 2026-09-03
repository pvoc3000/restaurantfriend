"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { publishSales, salesSnapshot } from "@/lib/shiftReportSales";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { ProgressBand } from "@/components/ui/ProgressBand";

export type SalesBasis = { netCents: number | null; tipsCents: number | null };

function money(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Cents as a plain editable number — "4182.55", never "$4,182.55".
 *
 * What goes IN a box you can type into has to be what you would type: a comma
 * and a dollar sign are decoration the parser then has to strip back out, and
 * on an iPad they are two characters the number pad cannot produce.
 */
function dollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

/**
 * One of the two figures, typed.
 *
 * `inputMode="decimal"` rather than `type="number"`: a number input on iOS
 * still shows the number pad AND brings spinners, a scroll wheel that changes
 * the value, and a locale-dependent decimal separator. The parse is ours
 * either way (`typedCents`), so nothing is gained by asking the browser to
 * validate. `text-[16px]` is the threshold below which iOS Safari zooms the
 * page on focus, which on a tablet-first screen is the whole difference
 * between a field you can use standing up and one you cannot.
 *
 * NOT `useCalcField`: that spread is for the fields `evaluateNumeric` reads,
 * and this one is parsed by `typedCents`. An inserted × would be a value that
 * cannot be read back.
 */
function MoneyBox({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  return (
    <span className="flex items-center justify-end gap-1">
      <span className="text-muted">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        placeholder="—"
        // The dress is written out rather than taken from `BOXED_FIELD`,
        // which carries `w-full` — and Tailwind resolves competing utilities by
        // STYLESHEET order, so a `w-32` appended to it could not be relied on
        // to win. Everything else here is that constant's own values.
        className="h-9 w-32 border border-hairline px-2 text-right text-[16px] font-semibold tabular-nums outline-none hover:border-ink focus:border-2 focus:border-ink"
      />
    </span>
  );
}

function Change({ current, basis }: { current: number | null; basis: number | null }) {
  if (current === null || basis === null || basis === 0) {
    return <span className="text-faint">—</span>;
  }
  const pct = Math.round(((current - basis) / basis) * 100);
  // Red and green here are a real exception to "colour means record state", and
  // FMP's own page made it: on a comparison the sign IS the information, and
  // the figure is meaningless without knowing which way it points.
  //
  // `text-go-ink`, never `text-go` — that token is green-200, the order box's
  // FILL, and as 13px text on white it is 1.35:1 (Mark, 2026-09-03: "too light
  // to read"). Same measurement, same cure as the yellow rule.
  return (
    <span className={pct < 0 ? "text-accent" : "text-go-ink"}>
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

/**
 * FMP's page 3.
 *
 * TODAY'S FIGURE IS READ LIVE AND NEVER STORED. Square's reporting day runs
 * 1:00 AM to 12:59 AM PT, so at 9pm today's takings are a part-day. It comes
 * from `sync-square-sales`' preview mode, which writes nothing: `daily_sales`
 * is the SETTLED reporting day and it feeds `tip_pools`, so a hand-corrected
 * part-day landing there would reach payroll and — worse — 065 flips an edited
 * row to `source = 'manual'`, which the sync then skips forever, freezing the
 * day at a partial number. Nothing on this page can do that.
 *
 * IT ASKS SQUARE ON ARRIVAL (Mark, 2026-09-01), reversing the "asked for, never
 * automatic" rule this page shipped with. That rule had two arguments and only
 * one of them survives. The lint objection was real and is answered below by
 * asking in an EVENT rather than in an effect body. The billing objection —
 * "several calls a shift to answer a question nobody asked twice" — is answered
 * by the store: the answer is published to `lib/shiftReportSales`, which
 * outlives paging away and back, so this fires ONCE per report per visit to the
 * runner however many times you page across it.
 *
 * AND THE FIGURES ARE TYPEABLE (Mark, same day: "it's safe since it will
 * probably be partial data anyway and overwritten the next day"). Which is
 * exactly true of what these boxes write — nothing. Typing here changes the
 * number THIS REPORT quotes in its email and in `email_receipt`, and tomorrow's
 * sync lands the settled figure in `daily_sales` untouched by any of it. That
 * is 070's own design ("WHY NO SALES COLUMNS") holding rather than bending.
 *
 * Known cost, and it follows from the same design: a typed correction is not
 * persisted, so Pause & close loses it. The Square reading has always had that
 * property — a provisional figure is true for about an hour, which is why the
 * store refuses to persist one.
 */
export function SalesPage({
  reportId,
  locationId,
  reportDate,
  lastWeek,
  lastWeekDate,
  lastYear,
  lastYearDate,
  settled,
  partial,
  editable,
}: {
  reportId: string;
  locationId: string;
  reportDate: string;
  lastWeek: SalesBasis;
  lastWeekDate: string;
  lastYear: SalesBasis;
  lastYearDate: string;
  /** Non-null once Square has CLOSED the day and the sync has stored it. */
  settled: SalesBasis | null;
  /**
   * Today's stored row when there is one and it is NOT finished.
   *
   * Since 2026-08-31 the sync loads today as a part-day, so `daily_sales`
   * having a row for this date stopped meaning the day is over — the server
   * asks `isDayComplete` and sends the answer down one of these two props. A
   * part-day is worth showing (it is today's takings so far) and must never be
   * shown as a settled figure, so it arrives marked and Square is still asked
   * for something fresher over it.
   */
  partial: SalesBasis | null;
  /** A sent report is a document; its figures stop taking corrections. */
  editable: boolean;
}) {
  const supabase = createClient();
  // Seeded from the STORE first, so paging away and back keeps what Square
  // said — and keeps any correction typed over it — without asking again.
  const held = salesSnapshot();
  const remembered = held?.reportId === reportId ? held : null;
  const [today, setToday] = useState<SalesBasis | null>(
    remembered
      ? { netCents: remembered.netCents, tipsCents: remembered.tipsCents }
      : settled ?? partial
  );
  const [provisional, setProvisional] = useState(
    remembered?.provisional ?? (settled === null && partial !== null)
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Whether this mount has already asked. A REF, not state: it must not cause a
  // render, and it is read from inside the effect that sets it.
  const asked = useRef(remembered !== null);
  // What is IN the two boxes. Held as text rather than derived from the cents,
  // because a half-typed "4182." is a real state a number cannot hold — the
  // same reason `InlineValue` keeps a draft. Both are set by the Square load
  // and by typing, and nothing else writes them, so there is no prop to sync
  // back from.
  const [netText, setNetText] = useState(() => dollars(today?.netCents ?? null));
  const [tipsText, setTipsText] = useState(() => dollars(today?.tipsCents ?? null));

  /**
   * Ask Square what today has taken so far.
   *
   * Automatic on arrival AND still a button, because the button is what you
   * press when the first answer was "Square could not be reached".
   */
  const load = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    const { data, error } = await supabase.functions.invoke("sync-square-sales", {
      body: { from: reportDate, to: reportDate, preview: true },
    });
    setBusy(false);
    if (error) {
      setFailed(
        `Square could not be reached: ${error.message}. The figures will arrive on tomorrow's sync either way.`
      );
      return;
    }
    const row = (data?.rows ?? []).find(
      (r: { location_id: string }) => r.location_id === locationId
    );
    if (!row) {
      setFailed("Square has nothing for this shop and day yet.");
      return;
    }
    setToday({ netCents: row.net_sales_cents, tipsCents: row.tips_cents });
    setNetText(dollars(row.net_sales_cents));
    setTipsText(dollars(row.tips_cents));
    setProvisional(true);
    // So the email can quote what the supervisor is looking at. See
    // `lib/shiftReportSales` for why this is a store and not a prop.
    publishSales({
      reportId,
      netCents: row.net_sales_cents,
      tipsCents: row.tips_cents,
      provisional: true,
    });
  }, [supabase, reportDate, locationId, reportId]);

  /**
   * ON ARRIVAL, ONCE.
   *
   * The `set-state-in-effect` lint refuses a setState called SYNCHRONOUSLY from
   * an effect body, and it is right to. Nothing here does: the effect starts an
   * async call and every setState happens later, in the promise's own turn —
   * which is an event, the same shape as the button's click. That is the whole
   * of the difference between this and the version the lint rejected.
   *
   * `asked` guards the double-invoke React does in development, a
   * `router.refresh()` re-render, and — through the store it was seeded from —
   * paging back to this page later in the same visit. So one Square call per
   * report, per time the runner is opened.
   *
   * A SETTLED figure means the day is already closed and stored; asking for a
   * preview of it would be a billed call to be told what we already know.
   */
  useEffect(() => {
    if (asked.current || settled !== null) return;
    asked.current = true;
    void load();
  }, [load, settled]);
  // NB the guard is on `settled`, never on `partial`: a part-day already on
  // screen is exactly the case worth asking Square about, because the answer is
  // an hour or two newer than whenever the sync last ran.

  /**
   * Cents from what somebody typed, or null if it is not a number.
   *
   * Empty is a real answer and means "I don't know", which is different from
   * zero — the order guide's three states, one field narrower. Rounded rather
   * than truncated: a shop reads $4,182.55 off a register, not 418255.
   */
  function typedCents(raw: string): number | null {
    const cleaned = raw.replace(/[$,\s]/g, "");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }

  /** Write one of the two figures, and republish so the email follows. */
  function setFigure(which: "netCents" | "tipsCents", raw: string) {
    if (which === "netCents") setNetText(raw);
    else setTipsText(raw);

    const next: SalesBasis = {
      netCents: which === "netCents" ? typedCents(raw) : today?.netCents ?? null,
      tipsCents: which === "tipsCents" ? typedCents(raw) : today?.tipsCents ?? null,
    };
    setToday(next);
    // Still provisional whatever anybody typed — MORE so, if anything. The
    // chip below says as much and the email repeats it.
    setProvisional(true);
    publishSales({
      reportId,
      netCents: next.netCents,
      tipsCents: next.tipsCents,
      provisional: true,
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {busy ? <ProgressBand label="Asking Square for today's figures…" /> : null}

      <div className="space-y-3">
        <p className="text-center text-sm font-bold uppercase tracking-[0.08em]">Today</p>

        {/* THE BOXES ARE ALWAYS THERE, whether or not Square answered. That is
            the whole point of making them typeable: the case where somebody has
            to enter the figure by hand is exactly the case where Square could
            not be reached, and a field that only appears once the machine has
            already answered would be missing on the one night it is needed. */}
        <dl className="mx-auto grid max-w-sm grid-cols-2 items-center gap-x-6 gap-y-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.08em]">Net sales</dt>
          <dd className="text-right text-[16px] font-semibold">
            {editable ? (
              <MoneyBox
                value={netText}
                onChange={(v) => setFigure("netCents", v)}
                ariaLabel="Net sales today"
              />
            ) : (
              money(today?.netCents ?? null)
            )}
          </dd>
          <dt className="text-xs font-semibold uppercase tracking-[0.08em]">Total tips</dt>
          <dd className="text-right text-[16px] font-semibold">
            {editable ? (
              <MoneyBox
                value={tipsText}
                onChange={(v) => setFigure("tipsCents", v)}
                ariaLabel="Total tips today"
              />
            ) : (
              money(today?.tipsCents ?? null)
            )}
          </dd>
        </dl>

        {/* WHICHEVER SENTENCE IS TRUE, and only one is. A figure on screen is
            provisional and says so; no figure is either a failure worth naming
            or a day Square has not closed yet, and both of those come with the
            button that asks again. */}
        {today !== null && (today.netCents !== null || today.tipsCents !== null) ? (
          provisional ? (
            <p className="text-center text-xs">
              <span className="bg-mark-fill px-1">
                Provisional — Square closes the day at 1am
              </span>
            </p>
          ) : null
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted">
              {failed ??
                "Square has not closed this day yet — its reporting day ends at 1am, so the settled figure arrives on tomorrow's sync."}
            </p>
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={busy}
              onClick={() => void load()}
            >
              {failed ? "Try again" : "Ask Square again"}
            </button>
          </div>
        )}
      </div>

      <table className="w-full text-[15px]">
        <thead>
          <tr className="border-b-2 border-ink text-xs font-semibold uppercase tracking-[0.08em]">
            <th className="py-2 text-left"> </th>
            <th className="py-2 text-right">Last week</th>
            <th className="py-2 text-right">Change</th>
            <th className="py-2 text-right">Last year</th>
            <th className="py-2 text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-3 text-xs font-semibold uppercase tracking-[0.08em]">Net sales</td>
            <td className="py-3 text-right">{money(lastWeek.netCents)}</td>
            <td className="py-3 text-right">
              <Change current={today?.netCents ?? null} basis={lastWeek.netCents} />
            </td>
            <td className="py-3 text-right">{money(lastYear.netCents)}</td>
            <td className="py-3 text-right">
              <Change current={today?.netCents ?? null} basis={lastYear.netCents} />
            </td>
          </tr>
          <tr>
            <td className="py-3 text-xs font-semibold uppercase tracking-[0.08em]">Total tips</td>
            <td className="py-3 text-right">{money(lastWeek.tipsCents)}</td>
            <td className="py-3 text-right">
              <Change current={today?.tipsCents ?? null} basis={lastWeek.tipsCents} />
            </td>
            <td className="py-3 text-right">{money(lastYear.tipsCents)}</td>
            <td className="py-3 text-right">
              <Change current={today?.tipsCents ?? null} basis={lastYear.tipsCents} />
            </td>
          </tr>
        </tbody>
      </table>

      {/* Which days are being compared, because "last year" is 364 days back so
          the WEEKDAY aligns — `lib/sales.lastYearRange`'s own default, and a
          Saturday against a Friday would be a worse comparison than none. */}
      <p className="text-center text-xs text-muted">
        Compared against {lastWeekDate} and {lastYearDate}.
      </p>
    </div>
  );
}
