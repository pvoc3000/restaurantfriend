"use client";

import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TimeCell } from "./TimeCell";

/**
 * Decision 8's other half: everything a DELIVERY needs.
 *
 * THE TAB ONLY EXISTS FOR A DELIVERY (Mark, 2026-08-17: "Delivery being on its
 * own is weird"). It was weird because 6,842 of the 8,330 real orders are
 * pickups, and for those this screen held a two-cell toggle and one sentence.
 * The toggle moved to the Details quadrant on the Info tab, where the choice
 * belongs, and `tabsFor` shows this tab only when that cell says delivery — so
 * a tab that exists always leads somewhere.
 *
 * FMP's DeliverLA request and schedule buttons are deliberately NOT
 * reimplemented (the brief's kill list): the carrier integration is somebody
 * else's API, and the distance stays a hand-entered pair with the Google link
 * surviving as a plain href.
 *
 */
export function OrderDelivery({
  id,
  row,
  canWrite,
}: {
  id: string;
  row: Record<string, unknown>;
  canWrite: boolean;
}) {
  const address = (row.delivery_address as string | null) ?? "";

  return (
    <div className="space-y-12">
          <section className="space-y-3">
            <SectionHeading>Where</SectionHeading>
            <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
              <Row label="Address" wide>
                {canWrite ? (
                  <InlineValue
                    boxed={BOXED_FIELDS}
                    table="special_orders" id={id} column="delivery_address" multiline
                    value={address || null} ariaLabel="Delivery address"
                  />
                ) : (
                  <span className={`${READ_ONLY_VALUE} whitespace-pre-wrap`}>{address || "—"}</span>
                )}
                {/* FMP's Google link, as a plain href — the kill list says the
                    carrier integration is not built and this is what survives
                    of it. Only when there is an address to look up. */}
                {address ? (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 text-[12px] text-muted underline underline-offset-2 hover:text-ink"
                  >
                    Map ↗
                  </a>
                ) : null}
              </Row>
              <Row label="Distance (miles)">
                <Cell id={id} canWrite={canWrite} column="delivery_distance" value={row.delivery_distance as number | null}
                      kind="number" label="Distance in miles" />
              </Row>
              <Row label="Window opens">
                {/* `TimeCell`, not `Cell`: these are `time` columns and read
                    back as `10:00:00`. Same reason as the record's event time. */}
                <TimeCell id={id} canWrite={canWrite} column="delivery_window_start"
                          value={row.delivery_window_start as string | null}
                          label="Delivery window start" />
              </Row>
              <Row label="Window closes">
                <TimeCell id={id} canWrite={canWrite} column="delivery_window_end"
                          value={row.delivery_window_end as string | null}
                          label="Delivery window end" />
              </Row>
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeading>Who carries it</SectionHeading>
            <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
              <Row label="Company">
                <Cell id={id} canWrite={canWrite} column="delivery_company" value={row.delivery_company as string | null}
                      label="Delivery company" />
              </Row>
              <Row label="Their phone">
                <Cell id={id} canWrite={canWrite} column="delivery_company_phone" value={row.delivery_company_phone as string | null}
                      label="Delivery company phone" />
              </Row>
              <Row label="Tracking">
                <Cell id={id} canWrite={canWrite} column="delivery_tracking" value={row.delivery_tracking as string | null}
                      label="Tracking number" />
              </Row>
              <Row label="Scheduled">
                <Cell id={id} canWrite={canWrite} column="delivery_scheduled_at" value={row.delivery_scheduled_at as string | null}
                      kind="date" label="Delivery scheduled" />
              </Row>
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeading>What goes out</SectionHeading>
            <p className="max-w-[80ch] text-[13px] text-muted">
              Boxes and weight print on the kitchen document, so whoever packs
              it knows what the carrier is expecting.
            </p>
            <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
              <Row label="Boxes">
                <Cell id={id} canWrite={canWrite} column="delivery_boxes" value={row.delivery_boxes as number | null}
                      kind="number" label="Number of boxes" />
              </Row>
              <Row label="Weight (lbs)">
                <Cell id={id} canWrite={canWrite} column="delivery_weight_lbs" value={row.delivery_weight_lbs as number | null}
                      kind="number" label="Weight in pounds" />
              </Row>
              <Row label="What it costs us">
                {/* `delivery_cost` is what the CARRIER charges; the customer's
                    `delivery_charge` is money and lives on the totals card.
                    Two columns because they routinely differ, and conflating
                    them is how a delivery quietly stops making sense. */}
                <Cell id={id} canWrite={canWrite} column="delivery_cost" value={row.delivery_cost as number | null}
                      kind="number" label="What the carrier charges us" />
              </Row>
            </div>
          </section>
    </div>
  );
}

function Row({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * One editable field on the order, or plain text below supervisor+.
 *
 * MODULE SCOPE — see `CustomerDetail`'s note. A component declared during
 * render remounts on every render, which resets an inline editor mid-keystroke.
 */
function Cell({
  id,
  canWrite,
  column,
  value,
  label,
  kind,
  placeholder,
}: {
  id: string;
  canWrite: boolean;
  column: string;
  value: string | number | null;
  label: string;
  kind?: "text" | "number" | "date";
  placeholder?: string;
}) {
  if (!canWrite) return <span className={READ_ONLY_VALUE}>{(value as string) ?? "—"}</span>;
  return (
    <InlineValue
      boxed={BOXED_FIELDS}
      table="special_orders"
      id={id}
      column={column}
      kind={kind}
      value={value}
      ariaLabel={label}
      placeholder={placeholder}
    />
  );
}
