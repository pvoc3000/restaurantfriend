"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { createClient } from "@/lib/supabase/client";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { money } from "@/lib/specialOrders";
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
 * else's API, and the Google link survives as a plain href.
 *
 * THE DISTANCE IS CALCULATED (Mark, 2026-10-01: "calculate delivery distance
 * on the order screen too") — driving miles from the KITCHEN, by the
 * `order-delivery-distance` function, when the address is saved and from the
 * Calculate button beside it (the kitchen changed, or the first try failed).
 * It still stays an editable cell. An empty delivery charge is filled from
 * the org's rates; a charge already there is never moved.
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
  const router = useRouter();
  const [measuring, setMeasuring] = useState(false);
  const [measured, setMeasured] = useState<string | null>(null);

  /** Measure from the kitchen and save it. Returns a sentence for the screen. */
  async function measure(): Promise<void> {
    setMeasuring(true);
    setMeasured(null);
    const { data, error } = await createClient().functions.invoke("order-delivery-distance", {
      body: { order_id: id },
    });
    setMeasuring(false);
    const r = (data ?? {}) as { state?: string; miles?: number; fee?: number | null; charge_set?: boolean; error?: string };
    let note: string;
    if (error) {
      let message = error.message;
      try {
        const parsed = await (error as { context?: Response }).context?.json();
        if (parsed?.error) message = parsed.error;
      } catch {
        // keep the generic message
      }
      note = `Distance not calculated: ${message}`;
    } else if (r.state === "ok" || r.state === "outside_area") {
      note =
        r.state === "outside_area"
          ? `${r.miles?.toFixed(1)} mi from the kitchen — beyond the farthest we estimate, so no charge was set.`
          : r.charge_set && typeof r.fee === "number"
            ? `${r.miles?.toFixed(1)} mi from the kitchen. Delivery charge set to ${money(r.fee)}.`
            : `${r.miles?.toFixed(1)} mi from the kitchen.`;
      router.refresh();
    } else {
      note =
        r.state === "no_kitchen"
          ? "Choose a kitchen on the Info tab to calculate the distance."
          : r.state === "no_address"
            ? "Enter an address to calculate the distance."
            : r.state === "address_not_found"
              ? "Google couldn’t find this address."
              : r.state === "not_configured"
                ? "Delivery rates aren’t set up in Settings."
                : "Distance not calculated. Try again.";
    }
    setMeasured(note);
  }

  /** The address cell's write: save it, then measure the new one. */
  async function writeAddress(next: string | number | null): Promise<{ error: string | null }> {
    const { data, error } = await createClient()
      .from("special_orders")
      .update({ delivery_address: next })
      .eq("id", id)
      .select("id");
    if (error || !data || data.length === 0) return { error: error?.message ?? "not saved" };
    if (typeof next === "string" && next.trim().length >= 5) void measure();
    else setMeasured(null);
    return { error: null };
  }

  return (
    <div className="space-y-12">
          <section className="space-y-3">
            <SectionHeading>Where</SectionHeading>
            <div className={GRID}>
              <Row label="Address" wide>
                {canWrite ? (
                  <InlineValue
                    boxed={BOXED_FIELDS}
                    table="special_orders" id={id} column="delivery_address" multiline
                    value={address || null} ariaLabel="Delivery address"
                    onWrite={writeAddress}
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
              <Row label="Distance (miles)" first>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Cell id={id} canWrite={canWrite} column="delivery_distance" value={row.delivery_distance as number | null}
                          kind="number" label="Distance in miles" />
                  </div>
                  {canWrite && address ? (
                    <button
                      type="button"
                      className={BUTTON_CLASS}
                      onClick={() => void measure()}
                      disabled={measuring}
                    >
                      {measuring ? "Calculating…" : "Calculate"}
                    </button>
                  ) : null}
                </div>
                {measured ? (
                  <p className="pt-1 text-[12px] text-muted" role="status">{measured}</p>
                ) : null}
              </Row>
              <Row label="Window opens">
                {/* `TimeCell`, not `Cell`: these are `time` columns and read
                    back as `10:00:00`. Same reason as the record's event time. */}
                <TimeCell id={id} canWrite={canWrite} column="delivery_window_start"
                          value={row.delivery_window_start as string | null}
                          label="Delivery window start" />
              </Row>
              <Row label="Window closes" first>
                <TimeCell id={id} canWrite={canWrite} column="delivery_window_end"
                          value={row.delivery_window_end as string | null}
                          label="Delivery window end" />
              </Row>
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeading>Who carries it</SectionHeading>
            <div className={GRID}>
              <Row label="Company" first>
                <Cell id={id} canWrite={canWrite} column="delivery_company" value={row.delivery_company as string | null}
                      label="Delivery company" />
              </Row>
              <Row label="Their phone">
                <Cell id={id} canWrite={canWrite} column="delivery_company_phone" value={row.delivery_company_phone as string | null}
                      label="Delivery company phone" />
              </Row>
              <Row label="Tracking" first>
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
            <div className={GRID}>
              <Row label="Boxes" first>
                <Cell id={id} canWrite={canWrite} column="delivery_boxes" value={row.delivery_boxes as number | null}
                      kind="number" label="Number of boxes" />
              </Row>
              <Row label="Weight (lbs)">
                <Cell id={id} canWrite={canWrite} column="delivery_weight_lbs" value={row.delivery_weight_lbs as number | null}
                      kind="number" label="Weight in pounds" />
              </Row>
              <Row label="What it costs us" first>
                {/* `delivery_cost` is what the CARRIER charges; the customer's
                    `delivery_charge` is beside it. Two columns because they
                    routinely differ, and conflating them is how a delivery
                    quietly stops making sense. */}
                <Cell id={id} canWrite={canWrite} column="delivery_cost" value={row.delivery_cost as number | null}
                      kind="number" label="What the carrier charges us" />
              </Row>
              {/* THE SAME COLUMN THE PAYMENTS TAB'S MONEY CARD WRITES (Mark,
                  2026-09-29: "so we can enter it there as well as on the
                  billing page"). Beside the cost, because what the carrier
                  charges is what you are looking at when you set it. Both
                  cells read the record, so an edit in one shows in the other. */}
              <Row label="Delivery charge">
                <Cell id={id} canWrite={canWrite} column="delivery_charge" value={row.delivery_charge as number | null}
                      kind="number" label="Delivery charge" format={(v) => money(Number(v))} />
              </Row>
            </div>
          </section>
    </div>
  );
}

/**
 * FOUR COLUMNS, THE FIELDS IN THE FIRST TWO (Mark, 2026-10-01): the address
 * spans two, every other field takes one, and the third and fourth stay empty.
 * Auto-placement would carry the third field into column 3, so a field that
 * begins a line says so (`first`) and the grid puts it back in column 1.
 */
const GRID = "grid gap-x-12 gap-y-4 sm:grid-cols-4";

function Row({
  label,
  wide = false,
  first = false,
  children,
}: {
  label: string;
  wide?: boolean;
  /** Begins a line — column 1. */
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1 ${wide ? "sm:col-span-2 sm:col-start-1" : first ? "sm:col-start-1" : ""}`}>
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
  format,
}: {
  id: string;
  canWrite: boolean;
  column: string;
  value: string | number | null;
  label: string;
  kind?: "text" | "number" | "date";
  placeholder?: string;
  format?: (v: string | number) => string;
}) {
  if (!canWrite)
    return (
      <span className={READ_ONLY_VALUE}>
        {value === null ? "—" : format ? format(value) : value}
      </span>
    );
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
      format={format}
    />
  );
}
