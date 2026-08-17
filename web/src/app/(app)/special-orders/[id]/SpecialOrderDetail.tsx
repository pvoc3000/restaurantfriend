import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEnterCounts } from "@/lib/roles";
import { crumbPath, parseTrail, withFrom } from "@/lib/breadcrumbs";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import type { RawSearchParams } from "@/lib/filterMenus";
import {
  KIND_LABEL,
  ORDER_TAB_LABEL,
  STATUS_LABEL,
  STATUS_OPTIONS,
  TODO_OPTIONS,
  customerLabel,
  money,
  needsAttention,
  orderTotals,
  parseOrderTab,
  orderTabHref,
  readSettings,
  suggestedRushFee,
  tabsForKind,
  type SpecialOrderKind,
  type SpecialOrderStatus,
} from "@/lib/specialOrders";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionNav } from "@/components/ui/SectionNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { resolveItemPrice } from "@/lib/productionPrice";
import { OrderLines, type OrderLineRow } from "@/components/specialOrders/OrderLines";
import type { MenuItem } from "@/components/specialOrders/AddOrderLine";
import { OrderPayments, type PaymentRow } from "@/components/specialOrders/OrderPayments";
import { OrderTotals } from "@/components/specialOrders/OrderTotals";
import { OrderLog, type OrderEventRow } from "@/components/specialOrders/OrderLog";
import { OrderActions } from "@/components/specialOrders/OrderActions";
import { OrderDelivery } from "@/components/specialOrders/OrderDelivery";
import { TimeCell } from "@/components/specialOrders/TimeCell";
import { StandingOrderBlock } from "@/components/specialOrders/StandingOrderBlock";

const SPECIAL_ORDERS_CRUMB = { href: "/special-orders", label: "Special Orders" };

/** How many log entries one record fetches. A twelve-year order carries a few
 *  hundred; the block states the total beside what it shows. */
const LOG_PAGE = 200;

const ORDER_COLUMNS = `
  id, org_id, number, kind, status, todo, flag_reason,
  customer_id, contact_name, contact_phone, contact_email, allergen_info,
  title, event_date, event_time, ready_by_time,
  location_id, kitchen_location_id, fulfillment,
  delivery_address, delivery_distance, delivery_cost, delivery_company,
  delivery_company_phone, delivery_tracking, delivery_window_start,
  delivery_window_end, delivery_boxes, delivery_weight_lbs,
  tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee,
  ignore_balance, taken_by,
  notes_general, notes_quote, notes_production, notes_invoice, notes_receipt,
  standing_days, starts_on, ends_on, paused, standing_order_id,
  date_initiated, quote_sent_at, quote_returned_at, invoice_sent_at,
  invoice_paid_at, receipt_sent_at, delivery_scheduled_at,
  order_printed_at, order_scheduled_at,
  production_schedule_id, inbound_subject, source,
  customers ( id, first_name, last_name, company, phone, email )
`;

/**
 * One special order.
 *
 * FOUR TABS (`ui/SectionNav`, the employee record's pattern) and the same
 * payoff: the Info tab does not pay for the lines, and only Documents signs a
 * Storage URL. A template or a standing order shows TWO of the four — see
 * `tabsForKind`, and the reason there.
 *
 * THE MONEY IS DERIVED (decision 6). There is no total column to read; the
 * totals card computes from the lines and the payments on every load, which is
 * why the Items tab fetches both even though only one of them is a table on
 * screen.
 */
export async function SpecialOrderDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  const session = await getAppSession();

  // Decision 7: supervisor+ for the whole module, READ included. RLS is the
  // real gate; this is the sentence that explains the empty screen rather than
  // leaving someone staring at one.
  if (!canEnterCounts(session.membership.role)) {
    return (
      <p className="text-sm text-muted">
        Special orders are open to supervisors and up — they carry customer
        names, addresses and phone numbers.
      </p>
    );
  }

  const supabase = await createClient();
  const timeZone = session.orgSettings.timezone ?? serverTimeZone();
  const today = todayInTimeZone(timeZone);
  const settings = readSettings(session.orgSettings);

  const tab = parseOrderTab(rawParams.tab);
  const SKIP = { data: null, error: null, count: null };
  const SKIP_MENU: { data: null } = { data: null };
  // The Info tab needs the LINES too — not to show them, but because the
  // attention sentence and the header's balance are derived from them. Cheaper
  // than the alternative, which is a stored total.
  const wantsLines = true;
  const wantsLog = tab === "info";
  const wantsDocuments = tab === "documents";
  const wantsMenu = tab === "items";

  const [
    { data: order, error },
    { data: lineRows, error: lineError },
    { data: paymentRows },
    { data: logRows, count: logTotal },
    { data: documentRows, error: documentError },
    { data: menuRows },
    { data: gridRows },
    { data: gridOverrideRows },
    { data: itemOverrideRows },
  ] = await Promise.all([
    supabase.from("special_orders").select(ORDER_COLUMNS).eq("id", id).maybeSingle(),
    wantsLines
      ? supabase
          .from("special_order_items")
          .select(
            "id, sort, production_item_id, name, item_donut, item_type, item_cut, item_finish, item_size, notes, qty, unit_price, taxable"
          )
          .eq("order_id", id)
          .order("sort", { ascending: true, nullsFirst: false })
      : SKIP,
    supabase
      .from("special_order_payments")
      .select("id, paid_on, amount, payment_type, note, external_ref")
      .eq("order_id", id)
      .order("paid_on", { ascending: true, nullsFirst: false }),
    wantsLog
      ? supabase
          .from("special_order_events")
          .select("id, happened_at, author, message, source", { count: "exact" })
          .eq("order_id", id)
          .order("happened_at", { ascending: false })
          .limit(LOG_PAGE)
      : SKIP,
    wantsDocuments
      ? supabase
          .from("special_order_attachments")
          .select("id, kind, storage_path, file_name, content_type, byte_size, created_at")
          .eq("order_id", id)
          .order("created_at", { ascending: false })
      : SKIP,
    // THE PRICED MENU, for the Items tab's chooser. Resolved on the server
    // because `price_override` lives on `production_item_locations`, not on the
    // item — a client that selected the item alone would find no price column
    // and quietly offer every donut at zero.
    wantsMenu
      ? supabase
          .from("production_items")
          .select("id, name, item_type, subtype, finish, size, price_class, price_tier")
          .eq("org_id", session.membership.org_id)
          .eq("is_active", true)
          .order("name")
      : SKIP_MENU,
    wantsMenu
      ? supabase.from("production_price_grid").select("id, price_class, price_tier, price")
      : SKIP_MENU,
    wantsMenu
      ? supabase.from("production_price_grid_locations").select("grid_id, location_id, price")
      : SKIP_MENU,
    wantsMenu
      ? supabase.from("production_item_locations").select("item_id, location_id, price_override")
      : SKIP_MENU,
  ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load this order: {error.message}
        {error.message.includes("special_order") ? (
          <span className="mt-2 block text-muted">
            If this names a missing relation or column, migration 051 has not
            been applied yet.
          </span>
        ) : null}
      </p>
    );
  }
  if (!order) {
    return <p className="text-sm text-muted">That order does not exist, or is not yours to see.</p>;
  }

  const row = order as unknown as Record<string, unknown>;
  const kind = row.kind as SpecialOrderKind;
  const status = row.status as SpecialOrderStatus | null;
  const customer = row.customers as {
    id: string; first_name: string | null; last_name: string | null;
    company: string | null; phone: string | null; email: string | null;
  } | null;

  const lines: OrderLineRow[] = ((lineRows ?? []) as unknown as OrderLineRow[]);
  const payments: PaymentRow[] = ((paymentRows ?? []) as unknown as PaymentRow[]);

  const moneyInputs = {
    tax_rate: row.tax_rate as number | null,
    discount_amount: row.discount_amount as number | null,
    discount_rate: row.discount_rate as number | null,
    delivery_charge: row.delivery_charge as number | null,
    rush_fee: row.rush_fee as number | null,
    ignore_balance: Boolean(row.ignore_balance),
  };
  const totals = orderTotals(moneyInputs, lines, payments);

  const attention = needsAttention(row as never, today, totals, settings.attention);

  // Decision 22: the figure the terms promise, offered beside the empty cell.
  // Nothing writes it — `OrderTotals` renders it as a `→` you tap.
  const rushSuggestion = suggestedRushFee(
    { event_date: row.event_date as string | null, today, subtotal: totals.subtotal },
    settings.rush
  );

  /**
   * The menu, priced AT THE PICKUP SHOP.
   *
   * Which location decides the price is a real question and this is the
   * answer: decision 8 makes `location_id` where the customer collects, so it
   * is the shop that is SELLING and therefore the shop whose grid applies. The
   * kitchen is where it is made, which is a cost question rather than a price
   * one. With neither set, `resolveItemPrice` falls through to the org grid,
   * which is right — every price class agrees across DF01/02/03 anyway
   * (measured: all 40 cells; only EVENT differs).
   */
  const pricingLocation = (row.location_id as string | null) ?? null;
  const menu: MenuItem[] = (menuRows ?? []).map((i) => {
    const item = i as unknown as { id: string; name: string; item_type: string | null;
      subtype: string | null; finish: string | null; size: string | null;
      price_class: string | null; price_tier: string | null };
    const resolved = resolveItemPrice(
      item,
      pricingLocation,
      (gridRows ?? []) as never,
      (gridOverrideRows ?? []) as never,
      ((itemOverrideRows ?? []) as unknown as { item_id: string; location_id: string; price_override: number | null }[])
        .filter((o) => o.item_id === item.id)
    );
    return {
      id: item.id,
      name: item.name,
      item_type: item.item_type,
      subtype: item.subtype,
      finish: item.finish,
      size: item.size,
      price: resolved.price,
    };
  });

  const canWrite = canEnterCounts(session.membership.role);
  const trail = parseTrail(rawParams, SPECIAL_ORDERS_CRUMB);
  const tabs = tabsForKind(kind);
  const tabOptions = tabs.map((t) => ({
    key: t,
    label: ORDER_TAB_LABEL[t],
    href: orderTabHref(id, t, rawParams),
    count: t === "items" ? lines.length : undefined,
  }));
  // A stale `?tab=delivery` on a template would otherwise render a tab the nav
  // does not offer, which reads as the nav being broken.
  const activeTab = tabs.includes(tab) ? tab : "info";

  const locationCode = (locId: unknown) =>
    locId ? session.locations.find((l) => l.id === locId)?.code ?? "—" : "—";

  /** Every shop, for the two pickers. Active only — design rule 3. */
  const locationOptions = [
    { value: "", label: "Not set" },
    ...session.activeLocations.map((l) => ({ value: l.id, label: l.code, hint: l.name })),
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <Breadcrumbs trail={trail} current={`#${row.number as string}`} />
        <RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />
      </div>

      {/* ---- who and what, ABOVE the split ----------------------------- */}
      {/* `lg:ml-48` is the sidebar's `lg:w-40` plus the row's `lg:gap-8`. THOSE
          THREE VALUES ARE COUPLED — change one and the heading drifts off the
          content it belongs to. */}
      <div className="space-y-2 lg:ml-48">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {(row.title as string) || `Order ${row.number as string}`}
        </h1>
        <p className="text-sm text-muted">
          <span className="tabular-nums">#{row.number as string}</span>
          {" · "}
          {kind === "order" ? (status ? STATUS_LABEL[status] : "—") : KIND_LABEL[kind]}
          {row.event_date ? ` · ${row.event_date as string}` : ""}
          {" · "}
          {customer ? (
            <Link
              href={withFrom(`/customers/${customer.id}`, {
                href: orderTabHref(id, activeTab, rawParams),
                label: `#${row.number as string}`,
              })}
              className="hover:underline"
            >
              {customerLabel(customer)}
            </Link>
          ) : (
            <span className="text-faint">no customer</span>
          )}
          {" · "}
          <span className="tabular-nums">{money(totals.total)}</span>
          {totals.balance > 0 && !moneyInputs.ignore_balance ? (
            <span className="text-accent"> · {money(totals.balance)} due</span>
          ) : null}
        </p>

        {/* Decision 19's sentence, on the record as well as in the list.
            RED when a human flagged it, YELLOW when the app worked it out —
            the same split the list's to-do column makes. */}
        {attention ? (
          <p className={`text-[13px] ${row.flag_reason ? "text-accent" : "text-mark"}`}>
            {attention}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <div
          className="hidden lg:sticky lg:block lg:w-40 lg:shrink-0"
          style={{ top: "calc(var(--rf-header-h) + 1.5rem)" }}
        >
          <SectionNav ariaLabel="Which part of this order" value={activeTab} items={tabOptions} />
        </div>
        <div className="lg:hidden">
          <SectionNav
            orientation="horizontal"
            ariaLabel="Which part of this order"
            value={activeTab}
            items={tabOptions}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-12">
          {/* ================= INFO ================= */}
          {activeTab === "info" && (
            <>
              <section className="space-y-3">
                <SectionHeading>Details</SectionHeading>
                <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
                  <Row label="What it is">
                    <Cell table="special_orders" id={id} column="title" value={row.title as string | null}
                          canWrite={canWrite} ariaLabel="What the order is for" />
                  </Row>
                  <Row label="Status">
                    {kind === "order" ? (
                      <Cell table="special_orders" id={id} column="status" kind="pick"
                            options={STATUS_OPTIONS} value={status} canWrite={canWrite}
                            ariaLabel="Status" />
                    ) : (
                      /* Decision 3: status exists exactly when kind is `order`,
                         and the database enforces the biconditional. Offering
                         the picker here would be offering a write that is
                         refused by a CHECK — the one refusal an InlineValue
                         cannot explain. */
                      <span className={READ_ONLY_VALUE}>{KIND_LABEL[kind]}</span>
                    )}
                  </Row>
                  <Row label="Event date">
                    <Cell table="special_orders" id={id} column="event_date" kind="date"
                          value={row.event_date as string | null} canWrite={canWrite}
                          ariaLabel="Event date" />
                  </Row>
                  <Row label="Event time">
                    {/* `TimeCell`, not `Cell`: a `time` column reads back as
                        `10:00:00` and the list already says "10:00 AM". It has
                        to be a client component — `format` is a function, and
                        one passed from here throws at runtime. */}
                    <TimeCell id={id} column="event_time" value={row.event_time as string | null}
                              label="Event time" canWrite={canWrite} />
                  </Row>
                  <Row label="Ready by">
                    <TimeCell id={id} column="ready_by_time" value={row.ready_by_time as string | null}
                              label="Ready by" canWrite={canWrite} placeholder="9:00 AM" />
                  </Row>
                  <Row label="Kitchen">
                    {/* Decision 8: kitchen is where it is MADE. */}
                    <Cell table="special_orders" id={id} column="kitchen_location_id" kind="pick"
                          options={locationOptions} value={row.kitchen_location_id as string | null}
                          canWrite={canWrite} ariaLabel="Kitchen" />
                  </Row>
                  <Row label="Pickup shop">
                    {/* …and location is where it is PICKED UP. Two nullable FKs
                        because they routinely differ. */}
                    <Cell table="special_orders" id={id} column="location_id" kind="pick"
                          options={locationOptions} value={row.location_id as string | null}
                          canWrite={canWrite} ariaLabel="Pickup shop" />
                  </Row>
                  <Row label="Taken by">
                    <Cell table="special_orders" id={id} column="taken_by" value={row.taken_by as string | null}
                          canWrite={canWrite} ariaLabel="Order taken by" />
                  </Row>
                  <Row label="To-do">
                    {/* Decision 4: MANUAL, with `allowNew` — the real data
                        holds "ON HOLD", "HOLIDAY" and "Adjust time to 9am or
                        later", so a closed vocabulary would refuse it. */}
                    <Cell table="special_orders" id={id} column="todo" kind="pick" allowNew clearable
                          options={TODO_OPTIONS} value={row.todo as string | null}
                          canWrite={canWrite} ariaLabel="To-do" />
                  </Row>
                  <Row label="Allergies">
                    <Cell table="special_orders" id={id} column="allergen_info"
                          value={row.allergen_info as string | null} canWrite={canWrite}
                          ariaLabel="Allergen information" />
                  </Row>
                </div>
              </section>

              <section className="space-y-3">
                <SectionHeading>Contact</SectionHeading>
                <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
                  <Row label="Customer">
                    {customer ? (
                      <Link
                        href={withFrom(`/customers/${customer.id}`, {
                          href: orderTabHref(id, "info", rawParams),
                          label: `#${row.number as string}`,
                        })}
                        className={`${READ_ONLY_VALUE} underline underline-offset-2 hover:text-ink`}
                      >
                        {customerLabel(customer)}
                      </Link>
                    ) : (
                      <span className={`${READ_ONLY_VALUE} text-faint`}>None linked</span>
                    )}
                  </Row>
                  <Row label="Customer phone">
                    <span className={READ_ONLY_VALUE}>{customer?.phone ?? "—"}</span>
                  </Row>
                  {/* The DAY-OF contact, who is often not the customer — filled
                      on 7,735 of the 8,330 real orders. Editable here where the
                      customer's own details are edited on their record. */}
                  <Row label="Day-of contact">
                    <Cell table="special_orders" id={id} column="contact_name"
                          value={row.contact_name as string | null} canWrite={canWrite}
                          ariaLabel="Day-of contact name" />
                  </Row>
                  <Row label="Their phone">
                    <Cell table="special_orders" id={id} column="contact_phone"
                          value={row.contact_phone as string | null} canWrite={canWrite}
                          ariaLabel="Day-of contact phone" />
                  </Row>
                  <Row label="Their email">
                    <Cell table="special_orders" id={id} column="contact_email"
                          value={row.contact_email as string | null} canWrite={canWrite}
                          ariaLabel="Day-of contact email" />
                  </Row>
                </div>
              </section>

              {kind === "standing_order" ? (
                <StandingOrderBlock
                  id={id}
                  standingDays={(row.standing_days as number[] | null) ?? []}
                  startsOn={row.starts_on as string | null}
                  endsOn={row.ends_on as string | null}
                  paused={Boolean(row.paused)}
                  horizonDays={settings.horizonDays}
                  today={today}
                  canWrite={canWrite}
                />
              ) : null}

              <section className="space-y-3">
                <SectionHeading>Progress</SectionHeading>
                <p className="max-w-[80ch] text-[13px] text-muted">
                  Each date stamps itself when the app does the thing — sending a
                  quote, taking a payment — and every one is editable, because
                  plenty of them happen on the phone.
                </p>
                <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
                  <Row label="Initiated"><Cell table="special_orders" id={id} column="date_initiated" kind="date" value={row.date_initiated as string | null} canWrite={canWrite} ariaLabel="Date initiated" /></Row>
                  <Row label="Quote sent"><Cell table="special_orders" id={id} column="quote_sent_at" kind="date" value={row.quote_sent_at as string | null} canWrite={canWrite} ariaLabel="Quote sent" /></Row>
                  <Row label="Quote approved"><Cell table="special_orders" id={id} column="quote_returned_at" kind="date" value={row.quote_returned_at as string | null} canWrite={canWrite} ariaLabel="Quote approved" /></Row>
                  <Row label="Invoice sent"><Cell table="special_orders" id={id} column="invoice_sent_at" kind="date" value={row.invoice_sent_at as string | null} canWrite={canWrite} ariaLabel="Invoice sent" /></Row>
                  <Row label="Invoice paid"><Cell table="special_orders" id={id} column="invoice_paid_at" kind="date" value={row.invoice_paid_at as string | null} canWrite={canWrite} ariaLabel="Invoice paid" /></Row>
                  <Row label="Receipt sent"><Cell table="special_orders" id={id} column="receipt_sent_at" kind="date" value={row.receipt_sent_at as string | null} canWrite={canWrite} ariaLabel="Receipt sent" /></Row>
                  <Row label="Order printed"><Cell table="special_orders" id={id} column="order_printed_at" kind="date" value={row.order_printed_at as string | null} canWrite={canWrite} ariaLabel="Order printed" /></Row>
                  <Row label="Production scheduled"><Cell table="special_orders" id={id} column="order_scheduled_at" kind="date" value={row.order_scheduled_at as string | null} canWrite={canWrite} ariaLabel="Production scheduled" /></Row>
                </div>
              </section>

              <section className="space-y-3">
                <SectionHeading>Notes</SectionHeading>
                <p className="max-w-[80ch] text-[13px] text-muted">
                  Each of these prints on its own document. The general note
                  prints nowhere — it is for you.
                </p>
                <div className="space-y-4">
                  <Row label="General (prints nowhere)" wide>
                    <Cell table="special_orders" id={id} column="notes_general" multiline
                          value={row.notes_general as string | null} canWrite={canWrite} ariaLabel="General note" />
                  </Row>
                  <Row label="On the quote" wide>
                    <Cell table="special_orders" id={id} column="notes_quote" multiline
                          value={row.notes_quote as string | null} canWrite={canWrite} ariaLabel="Quote note" />
                  </Row>
                  <Row label="On the kitchen order" wide>
                    <Cell table="special_orders" id={id} column="notes_production" multiline
                          value={row.notes_production as string | null} canWrite={canWrite} ariaLabel="Production note" />
                  </Row>
                  <Row label="On the invoice" wide>
                    <Cell table="special_orders" id={id} column="notes_invoice" multiline
                          value={row.notes_invoice as string | null} canWrite={canWrite} ariaLabel="Invoice note" />
                  </Row>
                  <Row label="On the receipt" wide>
                    <Cell table="special_orders" id={id} column="notes_receipt" multiline
                          value={row.notes_receipt as string | null} canWrite={canWrite} ariaLabel="Receipt note" />
                  </Row>
                </div>
              </section>

              <OtherOrdersThatDay
                orgId={session.membership.org_id}
                orderId={id}
                eventDate={row.event_date as string | null}
                listHref={orderTabHref(id, "info", rawParams)}
              />

              <OrderLog
                orderId={id}
                orgId={row.org_id as string}
                rows={(logRows ?? []) as unknown as OrderEventRow[]}
                total={logTotal ?? 0}
                canWrite={canWrite}
                authorName={session.membership.display_name ?? session.email}
              />

              <OrderActions
                id={id}
                number={row.number as string}
                kind={kind}
                status={status}
                flagReason={row.flag_reason as string | null}
                lineCount={lines.length}
                paymentCount={payments.length}
                canWrite={canWrite}
              />
            </>
          )}

          {/* ================= ITEMS ================= */}
          {activeTab === "items" && (
            <>
              {lineError ? (
                <p className="text-sm text-accent">Could not load the lines: {lineError.message}</p>
              ) : (
                <OrderLines
                  orderId={id}
                  orgId={row.org_id as string}
                  rows={lines}
                  canWrite={canWrite}
                  menu={menu}
                />
              )}

              <OrderTotals
                id={id}
                totals={totals}
                inputs={moneyInputs}
                rushSuggestion={rushSuggestion}
                canWrite={canWrite}
              />

              <OrderPayments
                orderId={id}
                orgId={row.org_id as string}
                rows={payments}
                balance={totals.balance}
                canWrite={canWrite}
                today={today}
              />
            </>
          )}

          {/* ================= DELIVERY ================= */}
          {activeTab === "delivery" && (
            <OrderDelivery
              id={id}
              fulfillment={(row.fulfillment as string) ?? "pickup"}
              row={row}
              pickupCode={locationCode(row.location_id)}
              canWrite={canWrite}
            />
          )}

          {/* ================= DOCUMENTS ================= */}
          {activeTab === "documents" && (
            <section className="space-y-3">
              <SectionHeading count={documentRows?.length ?? 0}>Documents</SectionHeading>
              {documentError ? (
                <p className="text-sm text-accent">
                  Could not load the paperwork: {documentError.message}
                </p>
              ) : (
                <p className="max-w-[80ch] text-sm text-muted">
                  Signed quotes, photographs and anything else this order needs
                  on file. The upload surface arrives with phase 3, alongside the
                  documents the app itself produces.
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

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
    <div className={wide ? "space-y-1" : "space-y-1"}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * An inline cell that renders as plain text below supervisor+.
 *
 * Every write on this record is gated the same way, so the gate is here rather
 * than at forty call sites — and it renders `READ_ONLY_VALUE` rather than
 * nothing, because the padding is what keeps the column straight (the
 * `sent_via` lesson).
 */
function Cell({
  canWrite,
  value,
  ...props
}: {
  canWrite: boolean;
  table: string;
  id: string;
  column: string;
  value: string | number | null;
  kind?: "text" | "number" | "date" | "pick";
  options?: { value: string; label: string; hint?: string }[];
  allowNew?: boolean;
  clearable?: boolean;
  multiline?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  if (!canWrite) {
    const shown =
      props.kind === "pick"
        ? props.options?.find((o) => o.value === value)?.label ?? (value as string) ?? "—"
        : (value as string) ?? "—";
    return <span className={READ_ONLY_VALUE}>{shown || "—"}</span>;
  }
  return <InlineValue value={value} {...props} />;
}

/**
 * "Other orders that day" — the thing FileMaker got right, and the reason a
 * supervisor does not double-book a kitchen.
 *
 * Its own query rather than a join on the parent: it is a different question
 * about a different set of rows, and on a record with no date there is nothing
 * to ask, so the query does not run at all.
 */
async function OtherOrdersThatDay({
  orgId,
  orderId,
  eventDate,
  listHref,
}: {
  orgId: string;
  orderId: string;
  eventDate: string | null;
  listHref: string;
}) {
  if (!eventDate) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("special_orders")
    .select("id, number, title, event_time, kitchen_location_id, status, customers ( first_name, last_name, company )")
    .eq("org_id", orgId)
    .eq("event_date", eventDate)
    .neq("id", orderId)
    .neq("status", "cancelled")
    .order("event_time", { ascending: true, nullsFirst: false })
    .limit(25);

  const rows = data ?? [];
  return (
    <section className="space-y-3">
      <SectionHeading count={rows.length}>Also that day</SectionHeading>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing else is booked for {eventDate}.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((o) => (
            <li key={o.id as string}>
              <Link
                href={withFrom(`/special-orders/${o.id as string}`, {
                  href: listHref,
                  label: "Back",
                })}
                className="hover:underline"
              >
                <span className="tabular-nums text-muted">#{o.number as string}</span>{" "}
                {(o.title as string) || customerLabel(o.customers as never)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
