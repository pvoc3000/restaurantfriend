import { SectionHeading } from "@/components/ui/SectionHeading";
import { formatCents } from "@/lib/tipPool";
import { formatFraction, tipFraction, type Comparison, type SalesTotals } from "@/lib/sales";

export type SalesSummaryData = {
  rangeLabel: string;
  fellBack: boolean;
  current: SalesTotals;
  vsPrevious: Comparison;
  vsLastYear: Comparison;
  gaps: { locationCode: string; business_date: string }[];
};

/**
 * SUMMARY FIRST (Mark, 2026-08-23), with the daily table below it.
 *
 * BOTH COMPARISONS ARE ALWAYS SHOWN. "Against the last fortnight" and "against
 * the same fortnight last year" answer different questions — one is momentum,
 * the other is seasonality — and putting them behind a toggle means whichever
 * one is not selected never gets looked at.
 *
 * A server component: it renders figures and holds no state.
 */
export function SalesSummary({ summary }: { summary: SalesSummaryData }) {
  const { current, vsPrevious, vsLastYear, gaps } = summary;
  const share = tipFraction(current);

  return (
    <section className="space-y-3">
      <SectionHeading>{summary.rangeLabel}</SectionHeading>

      <div className="grid gap-px border border-hairline bg-hairline sm:grid-cols-3">
        <Figure label="Net sales" value={formatCents(current.netSalesCents)}>
          <Delta c={vsPrevious} field="net" what="last period" />
          <Delta c={vsLastYear} field="net" what="a year ago" />
        </Figure>

        <Figure label="Tips" value={formatCents(current.tipsCents)}>
          <Delta c={vsPrevious} field="tips" what="last period" />
          <Delta c={vsLastYear} field="tips" what="a year ago" />
        </Figure>

        <Figure label="Tips as a share of sales" value={formatFraction(share)}>
          <ShareDelta c={vsPrevious} what="last period" />
          <ShareDelta c={vsLastYear} what="a year ago" />
        </Figure>
      </div>

      {summary.fellBack ? (
        <p className="text-xs text-muted">
          No pay period covers today, so this is the last 14 days instead.
        </p>
      ) : null}

      {gaps.length ? (
        // NOT decoration. Every figure above is a sum, and a sum over a window
        // with holes in it is smaller than the truth while looking exactly as
        // authoritative — a period missing two Saturdays reads as a bad
        // fortnight. Today is deliberately not counted: the shops have not
        // finished trading.
        <p className="text-xs">
          <span className="bg-mark-fill px-1">
            {gaps.length === 1
              ? "1 shop-day has not been pulled from Square"
              : `${gaps.length} shop-days have not been pulled from Square`}
          </span>{" "}
          <span className="text-muted">
            — these figures are short by whatever was taken on{" "}
            {gaps
              .slice(0, 4)
              .map((g) => `${g.locationCode} ${g.business_date}`)
              .join(", ")}
            {gaps.length > 4 ? ` and ${gaps.length - 4} more` : ""}.
          </span>
        </p>
      ) : null}
    </section>
  );
}

function Figure({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </div>
      <div className="mt-1 text-[26px] font-bold tabular-nums">{value}</div>
      <div className="mt-2 space-y-0.5">{children}</div>
    </div>
  );
}

function Delta({
  c,
  field,
  what,
}: {
  c: Comparison;
  field: "net" | "tips";
  what: string;
}) {
  const cents = field === "net" ? c.netDeltaCents : c.tipsDeltaCents;
  const fraction = field === "net" ? c.netDeltaFraction : c.tipsDeltaFraction;
  const basis = field === "net" ? c.basis.netSalesCents : c.basis.tipsCents;

  // Nothing to compare against is a real state and says so, rather than
  // printing a confident "+100%" against a fortnight the shop was shut.
  if (basis === 0) {
    return <Line what={what}>no figures</Line>;
  }

  return (
    <Line what={what}>
      <span className={cents < 0 ? "text-accent" : undefined}>
        {formatFraction(fraction, { sign: true })}
      </span>{" "}
      <span className="text-muted">
        ({cents >= 0 ? "+" : "−"}
        {formatCents(Math.abs(cents))})
      </span>
    </Line>
  );
}

function ShareDelta({ c, what }: { c: Comparison; what: string }) {
  if (c.tipFractionDelta === null) return <Line what={what}>no figures</Line>;
  return (
    <Line what={what}>
      {/* Points, not per cent: a tip share going 7.5% → 7.9% moved by 0.4
          POINTS, and calling that "+5.3%" is a different and confusing claim. */}
      {formatFraction(c.tipFractionDelta, { sign: true }).replace("%", " pts")}
    </Line>
  );
}

function Line({ what, children }: { what: string; children: React.ReactNode }) {
  return (
    <div className="text-xs tabular-nums">
      {children} <span className="text-muted">vs {what}</span>
    </div>
  );
}
