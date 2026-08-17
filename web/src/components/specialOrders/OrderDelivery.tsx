"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TabPicker } from "@/components/ui/TabPicker";
import { TimeCell } from "./TimeCell";

/**
 * Decision 8's other half: pickup or delivery, and everything a delivery needs.
 *
 * FMP's DeliverLA request and schedule buttons are deliberately NOT
 * reimplemented (the brief's kill list): the carrier integration is somebody
 * else's API, and the distance stays a hand-entered pair with the Google link
 * surviving as a plain href.
 *
 * THE FULFILLMENT PICKER IS A `TabPicker`, which is the one place on this
 * screen a black cell appears — it is a set filter's cousin, a one-of-N choice,
 * and the convention says every one of those is this control.
 */
export function OrderDelivery({
  id,
  fulfillment,
  row,
  pickupCode,
  canWrite,
}: {
  id: string;
  fulfillment: string;
  row: Record<string, unknown>;
  pickupCode: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function setFulfillment(next: string) {
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_orders")
        .update({ fulfillment: next })
        .eq("id", id)
        .select("id");
      if (e) setError(e.message);
      else if (!data?.length) setError("The change wasn't saved — the database refused it silently.");
      else router.refresh();
    });
  }

  const address = (row.delivery_address as string | null) ?? "";
  const isDelivery = fulfillment === "delivery";

  return (
    <div className="space-y-12">
      <section className="space-y-3">
        <SectionHeading>How it leaves</SectionHeading>
        {canWrite ? (
          <TabPicker
            options={[
              { key: "pickup", label: "Pickup" },
              { key: "delivery", label: "Delivery" },
            ]}
            value={fulfillment}
            onChange={setFulfillment}
            ariaLabel="Pickup or delivery"
          />
        ) : (
          <p className="text-sm">{isDelivery ? "Delivery" : "Pickup"}</p>
        )}
        {!isDelivery ? (
          <p className="text-sm text-muted">
            Picked up at <strong>{pickupCode}</strong>. Change the pickup shop on
            the Info tab.
          </p>
        ) : null}
        {error ? <p className="text-[13px] text-accent">{error}</p> : null}
      </section>

      {isDelivery ? (
        <>
          <section className="space-y-3">
            <SectionHeading>Where</SectionHeading>
            <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
              <Row label="Address" wide>
                {canWrite ? (
                  <InlineValue
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
                          label="Delivery window start" placeholder="10:00 AM" />
              </Row>
              <Row label="Window closes">
                <TimeCell id={id} canWrite={canWrite} column="delivery_window_end"
                          value={row.delivery_window_end as string | null}
                          label="Delivery window end" placeholder="11:00 AM" />
              </Row>
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeading>Who carries it</SectionHeading>
            <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
              <Row label="Company">
                <Cell id={id} canWrite={canWrite} column="delivery_company" value={row.delivery_company as string | null}
                      label="Delivery company" placeholder="DeliverLA" />
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
        </>
      ) : null}
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
