import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  bucketByDay,
  summarise,
  historyDate,
  type HistoryLine,
} from "@/lib/productionHistory";

/**
 * The last fortnight of one item — what was asked for, what was made, what came
 * back, production brief phase 5.
 *
 * NOT a `DataTable`. That component is for a list of RECORDS you sort, resize
 * and hide columns on; this is ONE record's fourteen days, where the rows are a
 * fixed calendar and there is nothing to sort by — the same call `/price-grid`
 * and the recipe's costs matrix already made.
 *
 * It reads `v_production_schedule_lines`, so `sold` arrives computed rather
 * than derived here. Empty until somebody counts a night: no history migrates
 * (the fresh-start decision), so this fills from launch.
 */
export function ProductionItemHistory({
  lines,
  dates,
  unavailable,
}: {
  lines: HistoryLine[];
  dates: string[];
  /** Set when the query failed — see the caller. An empty grid would otherwise
   *  assert that nothing was made for a fortnight, which is a real claim. */
  unavailable?: string | null;
}) {
  const days = bucketByDay(lines, dates);
  const summary = summarise(days);

  return (
    <section className="space-y-2">
      <SectionHeading>Last two weeks</SectionHeading>

      {unavailable ? (
        <p className="text-[13px] text-accent">{unavailable}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b-2 border-ink text-left">
                  <Th className="w-[132px]">Day</Th>
                  <Th align="right">To make</Th>
                  <Th align="right">Made</Th>
                  <Th align="right">Left over</Th>
                  <Th align="right">Sold</Th>
                  <Th className="w-[92px]">Shops</Th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.date} className="border-b border-hairline last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{historyDate(d.date)}</td>

                    {!d.scheduled ? (
                      // NOT the same as an uncounted night, and the grid says so
                      // in words rather than by leaving four cells blank: "we
                      // didn't make it" and "nobody wrote down what came back"
                      // are different facts about a day.
                      <td colSpan={5} className="py-1.5 text-faint">
                        no schedule
                      </td>
                    ) : (
                      <>
                        <Td align="right">{d.par.toLocaleString()}</Td>
                        {d.counted ? (
                          <>
                            <Td align="right">{d.made?.toLocaleString()}</Td>
                            <Td align="right">{d.leftover?.toLocaleString() ?? "—"}</Td>
                            <Td
                              align="right"
                              className={d.sold !== null && d.sold < 0 ? "text-mark" : ""}
                            >
                              {d.sold?.toLocaleString()}
                            </Td>
                          </>
                        ) : (
                          <td colSpan={3} className="py-1.5 text-mark">
                            not counted
                          </td>
                        )}
                        <td className="py-1.5 text-muted">
                          {d.shops === 1 ? "1 shop" : `${d.shops} shops`}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* THE DIVISOR IS NAMED. An average over five counted nights
              presented as a fortnightly figure is a number two-thirds too low
              that looks entirely reasonable. */}
          <p className="text-[13px] text-muted">
            {summary.daysCounted === 0
              ? summary.daysScheduled === 0
                ? "Not on a schedule in the last two weeks."
                : `Scheduled on ${summary.daysScheduled} of the last 14 days, and none of them counted yet.`
              : `${summary.sold.toLocaleString()} sold over ${summary.daysCounted} counted ${
                  summary.daysCounted === 1 ? "night" : "nights"
                } — averaging ${summary.soldPerNight!.toFixed(1)} a night, with ${summary.leftover.toLocaleString()} left over.`}
          </p>
        </>
      )}
    </section>
  );
}

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={`py-1.5 pr-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`py-1.5 pr-3 tabular-nums ${
        align === "right" ? "text-right" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
