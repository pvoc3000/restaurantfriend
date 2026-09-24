import Link from "next/link";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { crumbPath, parseTrail, withFrom } from "@/lib/breadcrumbs";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import type { RawSearchParams } from "@/lib/filterMenus";
import {
  KIND_LABEL,
  ORDER_TAB_LABEL,
  KIND_CHIP_LABEL,
  STANDING_STATUS_OPTIONS,
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
  tabsFor,
  FULFILLMENT_OPTIONS,
  type SpecialOrderKind,
  type SpecialOrderStatus,
  customerContactName,
} from "@/lib/specialOrders";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionNav } from "@/components/ui/SectionNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { resolveItemPrice } from "@/lib/productionPrice";
import { OrderLines, type OrderLineRow } from "@/components/specialOrders/OrderLines";
import { OrderNumberCell } from "@/components/specialOrders/OrderNumberCell";
import type { MenuItem } from "@/components/specialOrders/AddOrderLine";
import { OrderPayments, type PaymentRow } from "@/components/specialOrders/OrderPayments";
import { CompletionDates } from "@/components/specialOrders/CompletionDates";
import { StatusCatchUp } from "@/components/specialOrders/StatusCatchUp";
import { OrderTotals } from "@/components/specialOrders/OrderTotals";
import { OrderLog, type OrderEventRow } from "@/components/specialOrders/OrderLog";
import { OrderCommandMenu } from "@/components/specialOrders/OrderCommandMenu";
import { OrderDelivery } from "@/components/specialOrders/OrderDelivery";
import { TimeCell } from "@/components/specialOrders/TimeCell";
import { StandingOrderBlock } from "@/components/specialOrders/StandingOrderBlock";
import { OrderInfoLayout, OrderSplitLayout } from "@/components/specialOrders/OrderInfoLayout";
import { OrderDocuments } from "@/components/specialOrders/OrderDocuments";
import { TakenBy } from "@/components/specialOrders/TakenBy";
import {
  SO_ATTACHMENT_BUCKET,
  SO_SIGNED_URL_TTL_SECONDS,
  type SignedSoAttachment,
  type SoAttachment,
} from "@/lib/specialOrderAttachments";
import { canEditPage } from "@/lib/pageAccess";
import {
  INVOICE_STATUS_LABEL,
  SQUARE_ITEM_OPTIONS,
  invoiceChanged,
  invoiceNumberText,
  invoiceStatus,
  readInvoiceTerms,
} from "@/lib/customerInvoices";
import { canRefundPayments, canScheduleProduction } from "@/lib/roles";

const SPECIAL_ORDERS_CRUMB = { href: "/special-orders", label: "Orders" };

/**
 * The app's chip box, layout only — the exact string the purchase order and
 * pay period chips carry. LAYOUT HERE, COLOURS AT THE CALL SITE, which is
 * CLAUDE.md's rule for a shared class string.
 */
const CHIP =
  "inline-flex h-6 items-center border px-2 text-[12px] font-semibold uppercase tracking-[0.12em]";

/** How many log entries one record fetches. A twelve-year order carries a few
 *  hundred; the block states the total beside what it shows. */
const LOG_PAGE = 200;

const ORDER_COLUMNS = `
  id, org_id, number, kind, status, todo, flag_reason, flag_source,
  customer_id, contact_name, contact_phone, contact_email, allergen_info,
  title, event_date, event_time, ready_by_time,
  location_id, kitchen_location_id, fulfillment,
  delivery_address, delivery_distance, delivery_cost, delivery_company,
  delivery_company_phone, delivery_tracking, delivery_window_start,
  delivery_window_end, delivery_boxes, delivery_weight_lbs,
  tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee, rush_rate,
  ignore_balance, square_item, taken_by, taken_by_employee_id,
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
 * `tabsFor`, and the reason there — as does a pickup order, which has no
 * Delivery tab at all.
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
  // The log lives on the Notes tab now, so Info stops paying for 200 rows.
  const wantsLog = tab === "notes";
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
    { data: invoiceLinkRows },
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
      .select("id, paid_on, amount, payment_type, note, external_ref, customer_invoice_id")
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
          .select("id, order_id, kind, storage_path, file_name, content_type, byte_size, created_at")
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
    // THE CUSTOMER INVOICES THIS ORDER IS A LINE ON (124), void ones included —
    // a payment taken on an invoice later voided still names it.
    supabase
      .from("customer_invoice_lines")
      .select("invoice_id, amount, sent_amount, customer_invoices ( id, number, sent_at, paid_at, voided_at, due_on )")
      .eq("special_order_id", id),
  ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load this order: {error.message}
        {/* NAME THE MIGRATION, not "something is missing" — the record is one
            select, so an unapplied column takes the whole screen down and the
            raw Postgres text is the only clue anybody gets. 043's rule. */}
        {error.message.includes("taken_by_employee_id") ? (
          <span className="mt-2 block text-muted">
            Migration 053 has not been applied yet — it is what makes “Taken by”
            a link to an employee.
          </span>
        ) : error.message.includes("special_order") ? (
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

  /**
   * TWO SMALL FOLLOW-UPS, and they cannot ride the `Promise.all` above because
   * both are gated on what the record turned out to BE — `kind` and
   * `standing_order_id` are columns of the row that was just fetched.
   *
   *   · a standing order counts what it has actually made, so the record can
   *     say so rather than only describing the rule (see `StandingOrderBlock`);
   *   · a MATERIALIZED day names the standing order behind it, because "why is
   *     this order here and who agreed to it" has no other answer on screen.
   *
   * One round trip on the screens that need one, none on the rest.
   */
  const standingId = (row.standing_order_id as string | null) ?? null;
  const [{ data: madeRows, count: madeCount }, { data: sourceRow }] = await Promise.all([
    row.kind === "standing_order"
      ? supabase
          .from("special_orders")
          .select("event_date", { count: "exact" })
          .eq("standing_order_id", id)
          .order("event_date", { ascending: false })
          .limit(1)
      : SKIP,
    standingId
      ? supabase
          .from("special_orders")
          .select("id, number, title")
          .eq("id", standingId)
          .maybeSingle()
      : { data: null },
  ]);
  const madeThrough = (madeRows?.[0]?.event_date as string | null) ?? null;
  const madeFrom = (sourceRow as { id: string; number: string; title: string | null } | null) ?? null;

  const kind = row.kind as SpecialOrderKind;
  const status = row.status as SpecialOrderStatus | null;
  const customer = row.customers as {
    id: string; first_name: string | null; last_name: string | null;
    company: string | null; phone: string | null; email: string | null;
  } | null;

  /**
   * The filed documents, each with somewhere to look at it.
   *
   * Signed HERE, on the server, in ONE batch call — one round trip instead of
   * one per chip, and a URL built to expire does not sit in the browser any
   * longer than the page does. `createSignedUrls` answers in request order and
   * reports per-object failures rather than throwing, so a missing object
   * costs that one thumbnail and not the tab.
   */
  const documentRowList = (documentRows ?? []) as unknown as SoAttachment[];
  let documents: SignedSoAttachment[] = documentRowList.map((a) => ({ ...a, url: null }));
  if (documentRowList.length > 0) {
    const { data: signed } = await supabase.storage
      .from(SO_ATTACHMENT_BUCKET)
      .createSignedUrls(
        documentRowList.map((a) => a.storage_path),
        SO_SIGNED_URL_TTL_SECONDS
      );
    documents = documentRowList.map((a, i) => ({ ...a, url: signed?.[i]?.signedUrl ?? null }));
  }

  const lines: OrderLineRow[] = ((lineRows ?? []) as unknown as OrderLineRow[]);
  /**
   * WHICH CUSTOMER INVOICE BILLS THIS ORDER (Mark, 2026-09-23: "we need to put
   * the invoice in the payments area … remove the take a payment button from
   * special orders that are part of a customer invoice … try adding the
   * invoice field on the orders info tab"). `liveInvoice` is the one not
   * voided — an order is on at most one — and the rest only name payments.
   */
  const invoiceTerms = readInvoiceTerms(session.orgSettings as Record<string, unknown>);
  type InvoiceRef = { id: string; number: number; sent_at: string | null; paid_at: string | null; voided_at: string | null; due_on: string | null };
  const invoiceLinks = (invoiceLinkRows ?? []) as unknown as {
    amount: number; sent_amount: number | null; customer_invoices: InvoiceRef | null;
  }[];
  const invoicesOnOrder = invoiceLinks
    .map((l) => l.customer_invoices)
    .filter((i): i is InvoiceRef => i !== null);
  const invoiceHref = (invoiceId: string, from: string) =>
    withFrom(`/customer-invoices/${invoiceId}`, { href: from, label: `#${row.number as string}` });
  const invoiceLabel = (i: InvoiceRef) => `Invoice ${invoiceNumberText(i.number, invoiceTerms)}`;
  const liveInvoiceRow = invoicesOnOrder.find((i) => !i.voided_at) ?? null;
  const liveInvoice = liveInvoiceRow
    ? {
        id: liveInvoiceRow.id,
        label: invoiceLabel(liveInvoiceRow),
        // THIS order's line moving since the send is what makes the invoice
        // "changed" from here — it is the change somebody just made.
        status: INVOICE_STATUS_LABEL[
          invoiceStatus(
            liveInvoiceRow,
            today,
            invoiceChanged(invoiceLinks.filter((l) => l.customer_invoices?.id === liveInvoiceRow.id))
          )
        ],
      }
    : null;

  const payments: PaymentRow[] = ((paymentRows ?? []) as unknown as (PaymentRow & {
    customer_invoice_id: string | null;
  })[]).map((p) => {
    const inv = invoicesOnOrder.find((i) => i.id === p.customer_invoice_id);
    return {
      ...p,
      invoice: inv
        ? { label: invoiceLabel(inv), href: invoiceHref(inv.id, orderTabHref(id, "payments", rawParams)) }
        : null,
    };
  });

  const moneyInputs = {
    tax_rate: row.tax_rate as number | null,
    discount_amount: row.discount_amount as number | null,
    discount_rate: row.discount_rate as number | null,
    delivery_charge: row.delivery_charge as number | null,
    rush_fee: row.rush_fee as number | null,
    rush_rate: row.rush_rate as number | null,
    ignore_balance: Boolean(row.ignore_balance),
  };
  const totals = orderTotals(moneyInputs, lines, payments, settings.rush);

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

  // The Page Permissions sheet: staff READ an order, supervisor+ change it —
  // 092 widened decision 7's select policies for the read half.
  const canWrite = canEditPage(session.membership.role, "/special-orders");

  /* ------------------------------------------------------------------------
   * DECISION 9's LOCK (Mark, 2026-08-27)
   * ------------------------------------------------------------------------
   * Once the kitchen has this order, the three things the schedule was BUILT
   * from go read-only: the items, the event date and the kitchen. Everything
   * else — money, contact, notes, documents, payments, the pickup shop — stays
   * editable, because none of it changes what gets made.
   *
   * There is no sync. Unscheduling deletes the schedule and unlocks the order,
   * which is a rule you can state in a sentence; keeping a live schedule in
   * step with a changing order is a standing obligation nobody can predict.
   *
   * It is a UI lock and does not pretend otherwise — the guard that matters,
   * the one protecting a PRINTED or COUNTED night, is inside
   * `unschedule_special_order`.
   */
  const scheduleId = (row.production_schedule_id as string | null) ?? null;
  const scheduled = Boolean(scheduleId);
  const canEditItems = canWrite && !scheduled;

  // The schedule's two shops, coerced exactly as `schedule_special_order` does,
  // so the dialog states what the function will actually write.
  const orderKitchenId = (row.kitchen_location_id as string | null) ?? null;
  const orderSellsId = (row.location_id as string | null) ?? null;
  const kitchenId = orderKitchenId ?? orderSellsId;
  const sellsId = orderSellsId ?? orderKitchenId;
  const codeFor = (loc: string | null) =>
    session.locations.find((l) => l.id === loc)?.code ?? null;

  // A HEAD count, and only when there is a schedule to count. It cannot join
  // the wave above: it depends on `production_schedule_id`, which arrives in
  // it. `head: true` fetches no rows — the number is all either the link's
  // label or the unschedule confirm needs, and naming what goes is the whole
  // point of that confirm.
  const { count: scheduleLines } = scheduleId
    ? await supabase
        .from("production_schedule_items")
        .select("id", { count: "exact", head: true })
        .eq("schedule_id", scheduleId)
    : { count: 0 };
  const scheduleLineCount = scheduleLines ?? 0;
  const trail = parseTrail(rawParams, SPECIAL_ORDERS_CRUMB);
  const tabs = tabsFor(kind, (row.fulfillment as string | null) ?? "pickup");
  const tabOptions = tabs.map((t) => ({
    key: t,
    label: ORDER_TAB_LABEL[t],
    href: orderTabHref(id, t, rawParams),
    count: t === "items" ? lines.length : undefined,
  }));
  // A stale `?tab=delivery` on a template would otherwise render a tab the nav
  // does not offer, which reads as the nav being broken.
  const activeTab = tabs.includes(tab) ? tab : "info";


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
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 lg:ml-48">
        <div className="min-w-0 space-y-2">
          {/* THE STATUS IS A CHIP BESIDE THE TITLE (Mark, 2026-09-19) — the
              purchase order record's header exactly: same box, same type, same
              `gap-4` row, so the two record screens wear one badge.

              IT MOVED OUT OF THE LINE BELOW rather than joining it. The status
              read as plain text there, and the same word twice 20px apart reads
              as two different facts. The line keeps the KIND for a template or
              a standing order, which has no status to chip (decision 3).

              ONE YELLOW FOR EVERY STATUS, not a colour per rung. Yellow is this
              app's "worth your eye" mark and the chip is here to be read at a
              glance; a five-colour ladder would make the colour the message and
              leave the word as decoration. Green is spoken for below.

              PAID IS THE `invoice_paid_at` STAMP — what the list's Paid column
              and the progress ladder's "Invoice paid" rung both mean by that
              word. Deliberately NOT `isSettled`, which counts `ignore_balance`
              (which keeps an order out of the unpaid queue) as settled: an
              order carrying that flag is not a paid one.
              The money still speaks for itself on the line below, where an
              outstanding balance prints as "$X due". */}
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
              {(row.title as string) || `Order ${row.number as string}`}
            </h1>
            {/* AN ORDER WEARS ITS STATUS; A SHAPE WEARS WHAT IT IS.
                Since 112 a standing order carries a status too, but it is the
                rung its DAYS start at rather than a state this record is in, so
                putting INVOICE on its badge would answer a question nobody
                asked. What a reader of a template needs from a badge is the one
                thing that changes how they read everything else on the screen —
                that this is not a live order (Mark, 2026-09-21).

                BOTH ARE YELLOW, and that is the design system applying rather
                than being bent: yellow is this app's "worth your eye" mark, and
                being a template is exactly that. Green stays spoken for by
                Paid. */}
            {kind === "order" ? (
              status ? (
                <span className={`${CHIP} border-ink bg-[var(--rf-yellow-200)] text-ink`}>
                  {STATUS_LABEL[status]}
                </span>
              ) : null
            ) : (
              <span className={`${CHIP} border-ink bg-[var(--rf-yellow-200)] text-ink`}>
                {KIND_CHIP_LABEL[kind] ?? KIND_LABEL[kind]}
              </span>
            )}
            {/* PAID IS AN ORDER'S TOO. A shape has no invoice to have been
                paid — the conversion strips the stage dates — and the one way
                it could carry that date is somebody setting it by hand on a
                record where it means nothing. */}
            {kind === "order" && row.invoice_paid_at ? (
              <span className={`${CHIP} border-ink bg-[var(--rf-green-200)] text-ink`}>Paid</span>
            ) : null}
          </div>
          <p className="text-sm text-muted">
            <span className="tabular-nums">#{row.number as string}</span>
            {/* THE KIND LEFT THIS LINE when it became a chip (2026-09-21) —
                the same move the status made when IT became one, and for the
                same reason: the word twice, 20px apart, reads as two facts. */}
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
            {/* A SHAPE OWES NOTHING (2026-09-20). A template and a standing
                order carry lines and no payments, so the arithmetic produces a
                balance — and until Convert into an Order Template existed
                almost nobody had one to notice. "$1,125.00 due" in red on a
                record that is a PROTOTYPE is the same falsehood as the progress
                wash it lost this morning. `kind` rather than `countsAsOwed`,
                which would also silence a lead or a quote — those are orders,
                and what their balance means is a separate argument. */}
            {kind === "order" && totals.balance > 0 && !moneyInputs.ignore_balance ? (
              <span className="text-accent"> · {money(totals.balance)} due</span>
            ) : null}
          </p>

          {/* Decision 19's sentence, on the record as well as in the list.
              RED when a human flagged it, YELLOW when the app worked it out —
              the same split the list's to-do column makes.

              THE YELLOW IS A FILL, THE RED IS INK (Mark, 2026-08-28: "you have
              yellow warning text in the identity area that should be converted
              to a yellow box"), which is the app's standing rule rather than a
              local choice: `text-mark` on white measures 1.43:1, so it is not
              a legibility complaint but text you cannot read, where
              `bg-mark-fill` puts ink on yellow-200 at 15.53:1. Red needs no
              such help at 5.61:1 and stays a colour on the words.

              `inline-block` so the fill is the length of the SENTENCE. Full
              width it would be a banner across the record rather than a mark
              on one fact. */}
          {attention ? (
            <p className="text-[13px]">
              <span
                className={
                  row.flag_reason ? "text-accent" : "inline-block bg-mark-fill px-1"
                }
              >
                {attention}
              </span>
            </p>
          ) : null}
        </div>

        {/* THE COMMANDS SIT LEVEL WITH THE TITLE (Mark, 2026-08-19: "remove the
            title 'commands' and move the buttons up a level so they're even
            with the title area").

            They have been three places in two days: a `ui/StickyFooter` pinned
            to every tab, then a "Commands" section inside the Info tab's
            top-right quadrant, and now here — a band shared with the record's
            own heading. THE HEADING IS GONE WITH THE MOVE, and that is the
            same argument `OrderActions` made when it lost its own: a row of
            seven buttons is self-evidently a row of buttons, and a caption over
            it only takes the vertical space the move was meant to give back.

            Two things this buys beyond the space. They are ON EVERY TAB again,
            because the identity block sits ABOVE the tab switch — so the Info-
            only consequence of the last move is gone. And a command row beside
            the thing it acts on reads as belonging to it, where at the foot of
            the window it belonged to the app.

            `items-start` on the row so the buttons line up with the TOP of the
            title rather than centring against a block whose height changes with
            the attention sentence.

            And the two button rows RIGHT-ALIGN beside the title but LEFT-ALIGN
            once they wrap under it (`items-start xl:items-end`). Right is
            correct beside the title — both rows end on the page margin, which
            is what makes a command cluster read as one block — and wrong under
            it, where right-aligning the shorter row indents it from the
            heading's own margin for no reason anybody could name. Measured: the
            wrap happens between 1024 and 1280, which is where the breakpoint
            is. */}
        {canWrite ? (
          <div className="flex shrink-0 flex-col items-end gap-3">
            {/* ONE "ACTIONS" BUTTON, level with the title at the right margin
                (Mark, 2026-09-11: the command row's buttons were "all different
                sizes and colors"). Preview, Download and Email… each open the
                four documents; then Duplicate and Flag…, scheduling, and Cancel
                order and Delete. Templates and standing orders get no document
                rows: neither has a customer expecting a quote. */}
            <OrderCommandMenu
              send={
                kind === "order"
                  ? {
                      orderId: id,
                      orgId: row.org_id as string,
                      number: row.number as string,
                      canWrite,
                      workflow: row as never,
                      orgSettings: session.orgSettings,
                      onCustomerInvoice: liveInvoice !== null,
                      today,
                      invoice: {
                        liveInvoiceId: liveInvoice?.id ?? null,
                        liveInvoiceLabel: liveInvoice?.label ?? null,
                        candidate: {
                          id,
                          number: row.number as string,
                          kind,
                          status: status,
                          title: (row.title as string | null) ?? null,
                          event_date: (row.event_date as string | null) ?? null,
                          customer_id: customer?.id ?? null,
                          customer_name: customer ? customerLabel(customer) : "",
                          shop: codeFor(kitchenId),
                          balance: totals.balance,
                          on_invoice: liveInvoice !== null,
                        },
                        from: { href: orderTabHref(id, activeTab, rawParams), label: `#${row.number as string}` },
                      },
                    }
                  : null
              }
              // OFF (Mark, 2026-09-23: "disable 'Send to quickbooks...'"). An
              // order is billed on a customer invoice now, collected through
              // Square, and a pay-link sale must NOT also be pushed to QBO as an
              // invoice (CLAUDE.md). `PushOrderToQuickBooks` is kept; restore by
              // passing its props here again.
              quickbooks={null}
              schedule={
                kind === "order" && status !== "cancelled" && canScheduleProduction(session.membership.role)
                  ? {
                      orderId: id,
                      orgId: row.org_id as string,
                      number: row.number as string,
                      title: (row.title as string | null) ?? null,
                      eventDate: (row.event_date as string | null) ?? null,
                      today,
                      kitchenCode: codeFor(kitchenId),
                      sellsCode: codeFor(sellsId),
                      kitchenAssumed: orderKitchenId === null && orderSellsId !== null,
                      sellsAssumed: orderSellsId === null && orderKitchenId !== null,
                      // You commit the night for the kitchen you are standing in
                      // (Mark, 2026-08-28) — the same rule /schedules generates
                      // under. Null when the order names no shop at all, which
                      // `ScheduleProduction` already refuses for its own reason.
                      atThisKitchen: kitchenId !== null && kitchenId === session.activeLocation?.id,
                      workingCode: session.activeLocation?.code ?? null,
                      lines,
                      scheduleId,
                      scheduleLineCount,
                      order: row as never,
                    }
                  : null
              }
              /* EVERY KIND, templates included — the Customer row is not
                 kind-gated on the Info tab and never has been, so gating the
                 commands would quietly take linking away from templates. */
              customer={
                {
                      orderId: id,
                      orgId: row.org_id as string,
                      currentCustomerId: (row.customer_id as string | null) ?? null,
                      currentCustomerLabel: customer ? customerLabel(customer) : null,
                      linkedCustomer: customer
                        ? {
                            name: customerContactName(customer),
                            phone: customer.phone,
                            email: customer.email,
                          }
                        : null,
                      contact: {
                        name: row.contact_name as string | null,
                        phone: row.contact_phone as string | null,
                        email: row.contact_email as string | null,
                      },
                      canWrite,
                }
              }
              create={
                /* "New Order…" — the list's own dialog, reached from the
                   record (Mark, 2026-09-20). Every kind offers it: a new order
                   is not about the record you are standing on, which is also
                   why it wears its own rule above Duplicate. The working shop
                   is the pickup default, exactly as it is on the list. */
                canWrite
                  ? {
                      orgId: session.membership.org_id,
                      kitchens: session.activeLocations.map((l) => ({ id: l.id, code: l.code })),
                      defaultLocationId: session.activeLocation?.id ?? null,
                      today,
                      takenBy: session.membership.display_name ?? session.email,
                    }
                  : null
              }
              actions={{
                scheduled,
                id,
                orgId: row.org_id as string,
                number: row.number as string,
                kind,
                status,
                flagReason: row.flag_reason as string | null,
                flagSource: row.flag_source as string | null,
                todo: row.todo as string | null,
                canWrite,
              }}
            />
          </div>
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
          {/* ================= INFO — FOUR QUADRANTS ================= */}
          {/* FileMaker's EVENT INFO tab: the facts you set up top, the two
              panes that grow underneath. See `OrderInfoLayout`. */}
          {activeTab === "info" && (
            <OrderInfoLayout
              topLeft={
                <section className="space-y-3">
                  <SectionHeading>Details</SectionHeading>
                  <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                    {/* THE TOP (Mark, 2026-09-23, second arrangement): Order
                        name across the row, then Status | To-do — the two
                        fields that say where the order stands and what is
                        next — then Order number | Sold as. A template has no
                        Sold as, so an empty cell holds its place and the pairs
                        below do not shift along by one. */}
                    <Row label="Order name" wide>
                      <Cell table="special_orders" id={id} column="title" value={row.title as string | null}
                            canWrite={canWrite} ariaLabel="What the order is for" />
                    </Row>
                    <Row label="Status">
                      {kind === "order" ? (
                        <>
                          <Cell table="special_orders" id={id} column="status" kind="pick"
                                options={STATUS_OPTIONS} value={status} canWrite={canWrite}
                                ariaLabel="Status" />
                          {/* The catch-up: the dates have run ahead of the
                              status, and here is the one tap that squares
                              them. Absent when there is nothing to say. */}
                          <StatusCatchUp id={id} order={row as never} canWrite={canWrite} />
                        </>
                      ) : kind === "standing_order" ? (
                        /* A STANDING ORDER CARRIES THE STATUS ITS DAYS START
                           WITH (migration 112). It is the same column and the
                           same cell; what differs is the VOCABULARY, because
                           only two rungs mean anything to a day that has not
                           been made yet — see `STANDING_STATUS_OPTIONS`.

                           NOT RELABELLED. Every field on this record is what
                           its days inherit — the title, the event time, the tax
                           rate — so calling this one "Days start as" would
                           imply the others are not. And no `StatusCatchUp`:
                           that reads stage dates, and this record has none. */
                        <Cell table="special_orders" id={id} column="status" kind="pick"
                              options={STANDING_STATUS_OPTIONS} value={status} canWrite={canWrite}
                              ariaLabel="What its days start as" />
                      ) : (
                        /* A TEMPLATE STILL HAS NONE, and the database still
                           enforces it: 112 widened decision 3's biconditional
                           to standing orders and stopped there, because a
                           template is DUPLICATED rather than instantiated on a
                           schedule — it has no days to prototype. Offering the
                           picker here would offer a write a CHECK refuses, which
                           is the one refusal an InlineValue cannot explain. */
                        <span className={READ_ONLY_VALUE}>{KIND_LABEL[kind]}</span>
                      )}
                    </Row>
                    <Row label="To-do">
                      {/* Decision 4: MANUAL, with `allowNew` — the real data
                          holds "ON HOLD" and "Adjust time to 9am or later". */}
                      <Cell table="special_orders" id={id} column="todo" kind="pick" allowNew clearable
                            options={TODO_OPTIONS} value={row.todo as string | null}
                            canWrite={canWrite} ariaLabel="To-do" />
                    </Row>
                    <Row label="Order number" className="sm:pb-4">
                      <OrderNumberCell id={id} value={row.number as string} canWrite={canWrite} />
                    </Row>
                    {/* WHICH SQUARE ITEM ITS MONEY IS SOLD AS (129, Mark
                        2026-09-23: "we need to be able to create a one-off
                        wholesale order"). A standing order's days take its
                        value when they are made; a hand-made order starts as
                        Special Order. An unpaid invoice line follows it. */}
                    {kind === "order" || kind === "standing_order" ? (
                      <Row label="Sold as" className="sm:pb-4">
                        <Cell table="special_orders" id={id} column="square_item" kind="pick"
                              options={SQUARE_ITEM_OPTIONS} value={row.square_item as string}
                              canWrite={canWrite} ariaLabel="Sold as" />
                      </Row>
                    ) : (
                      <div aria-hidden />
                    )}
                    <Row label="Event date">
                      <Cell table="special_orders" id={id} column="event_date" kind="date"
                            value={row.event_date as string | null} canWrite={canEditItems}
                            ariaLabel="Event date" />
                    </Row>
                    <Row label="Event time">
                      {/* `TimeCell`, not `Cell`: a `time` column reads back as
                          `10:00:00`. It has to be a client component — `format`
                          is a function, and one passed from here throws. */}
                      <TimeCell id={id} column="event_time" value={row.event_time as string | null}
                                label="Event time" canWrite={canWrite} />
                    </Row>
                    <Row label="Ready by">
                      <TimeCell id={id} column="ready_by_time" value={row.ready_by_time as string | null}
                                label="Ready by" canWrite={canWrite} />
                    </Row>
                    <Row label="Taken by">
                      {/* A LINK TO AN EMPLOYEE since migration 053, with
                          FileMaker's text as the fallback on the 7,944
                          migrated orders whose first names are too ambiguous to
                          resolve. See `TakenBy`. */}
                      <TakenBy
                        orderId={id}
                        orgId={row.org_id as string}
                        employeeId={(row.taken_by_employee_id as string | null) ?? null}
                        legacyName={(row.taken_by as string | null) ?? null}
                        canWrite={canWrite}
                      />
                    </Row>
                    <Row label="Kitchen">
                      {/* Decision 8: kitchen is where it is MADE… */}
                      <Cell table="special_orders" id={id} column="kitchen_location_id" kind="pick"
                            options={locationOptions} value={row.kitchen_location_id as string | null}
                            canWrite={canEditItems} ariaLabel="Kitchen" />
                    </Row>
                    <Row label="Pickup shop">
                      {/* …and location is where it is PICKED UP. */}
                      <Cell table="special_orders" id={id} column="location_id" kind="pick"
                            options={locationOptions} value={row.location_id as string | null}
                            canWrite={canWrite} ariaLabel="Pickup shop" />
                    </Row>
                    <Row label="Pickup / delivery">
                      {/* The pickup/delivery CHOICE lives here, beside the
                          pickup shop — it is a fact about the order. The
                          Delivery TAB appears only when this says delivery;
                          see `tabsFor`. */}
                      <Cell table="special_orders" id={id} column="fulfillment" kind="pick"
                            options={FULFILLMENT_OPTIONS} value={(row.fulfillment as string) ?? "pickup"}
                            canWrite={canWrite} ariaLabel="Pickup or delivery" />
                    </Row>
                    <Row label="Allergies">
                      <Cell table="special_orders" id={id} column="allergen_info"
                            value={row.allergen_info as string | null} canWrite={canWrite}
                            ariaLabel="Allergen information" />
                    </Row>
                    {/* WHY THIS ORDER EXISTS, on the days nobody typed.
                        `standing_order_id` has been a column since 051 and had
                        no reader anywhere, so a materialized day was
                        indistinguishable from a hand-made one — which is the
                        point for editing it, and exactly wrong for deciding
                        whether to cancel it. READ-ONLY and a LINK: the row it
                        names is where the recurrence is changed, and repointing
                        a day at a different standing order is not a thing
                        anybody should be able to do by picking from a list. */}
                    {madeFrom ? (
                      <Row label="Made from">
                        <Link
                          href={withFrom(`/special-orders/${madeFrom.id}`, {
                            href: orderTabHref(id, activeTab, rawParams),
                            label: `#${row.number as string}`,
                          })}
                          className="underline underline-offset-2"
                        >
                          {madeFrom.number}
                          {madeFrom.title ? ` — ${madeFrom.title}` : ""}
                        </Link>
                      </Row>
                    ) : null}
                    {/* THE INVOICE THAT BILLS IT, when a customer invoice
                        does (124) — shown only then, like Made from, so the
                        8,000 orders billed on their own say nothing new. */}
                    {liveInvoice ? (
                      <Row label="Invoice">
                        <Link
                          href={invoiceHref(liveInvoice.id, orderTabHref(id, "info", rawParams))}
                          className="underline underline-offset-2"
                        >
                          {liveInvoice.label}
                        </Link>
                        <span className="text-muted"> · {liveInvoice.status}</span>
                      </Row>
                    ) : null}
                  </div>
                </section>
              }
              topRight={
                <section className="space-y-3">
                  <SectionHeading>Customer</SectionHeading>
                  <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                    {/* THE LINK GOES BOTH WAYS NOW. Until 2026-08-18 the
                        only writer of `customer_id` was "New order for them"
                        on the customer record, so an order that started as a
                        lead — every phone order, and everything the inquiry
                        form will create — said "None linked" forever with
                        nothing to press. */}
                    <Row label="Customer">
                      <span className="flex flex-wrap items-center gap-3">
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
                      </span>
                    </Row>
                    <Row label="Their phone">
                      <span className={READ_ONLY_VALUE}>{customer?.phone ?? "—"}</span>
                    </Row>
                    {/* The DAY-OF contact, who is often not the customer —
                        filled on 7,735 of the 8,330 real orders. */}
                    <Row label="Day-of contact">
                      <Cell table="special_orders" id={id} column="contact_name"
                            value={row.contact_name as string | null} canWrite={canWrite}
                            ariaLabel="Day-of contact name" />
                    </Row>
                    <Row label="Contact phone">
                      <Cell table="special_orders" id={id} column="contact_phone"
                            value={row.contact_phone as string | null} canWrite={canWrite}
                            ariaLabel="Day-of contact phone" />
                    </Row>
                    <Row label="Contact email">
                      <Cell table="special_orders" id={id} column="contact_email"
                            value={row.contact_email as string | null} canWrite={canWrite}
                            ariaLabel="Day-of contact email" />
                    </Row>
                  </div>
                </section>
              }
              bottomLeft={
                <OtherOrdersThatDay
                  orgId={session.membership.org_id}
                  orderId={id}
                  eventDate={row.event_date as string | null}
                  kitchenId={row.kitchen_location_id as string | null}
                  kitchens={session.locations.map((l) => ({ id: l.id, code: l.code }))}
                  listHref={orderTabHref(id, "info", rawParams)}
                />
              }
              /* THE QUADRANT THAT ANSWERS "WHEN". For an order that is the
                 stage dates; for a standing order it is the recurrence, which
                 is the same question asked of a record that has no single
                 date. A standing order has no status, so it can have no
                 completion dates either. */
              bottomRight={
                kind === "standing_order" ? (
                    <StandingOrderBlock
                      id={id}
                      standingDays={(row.standing_days as number[] | null) ?? []}
                      startsOn={row.starts_on as string | null}
                      endsOn={row.ends_on as string | null}
                      paused={Boolean(row.paused)}
                      horizonDays={settings.horizonDays}
                      today={today}
                      canWrite={canWrite}
                      orgId={row.org_id as string}
                      number={row.number as string}
                      madeCount={madeCount ?? 0}
                      madeThrough={madeThrough}
                    />
                  ) : kind === "order" ? (
                    <section className="space-y-3">
                      <SectionHeading>Completion dates</SectionHeading>
                      {/* INLINE LABELS, not stacked — FileMaker's own shape,
                          and load-bearing rather than cosmetic: stacked, nine
                          date fields run ~400px and swallow a quadrant. Beside
                          their boxes they are five rows of ~34px. They stay
                          inline where Details and Customer went back to
                          stacked, because a date is a short value and a name
                          or a phone is not — those wrapped. */}
                      {/* The paid date offers to settle the balance, so it
                          needs the balance — and `ignore_balance` with it, or
                          it would offer one on every wholesale day. */}
                      <CompletionDates
                        id={id}
                        orgId={row.org_id as string}
                        order={row as never}
                        money={{
                          balance: totals.balance,
                          ignore_balance: moneyInputs.ignore_balance,
                        }}
                        canWrite={canWrite}
                      />
                    </section>
                  ) : null
              }
            />
          )}

          {/* ================= NOTES ================= */}
          {/* NOTES AND THE LOG, SIDE BY SIDE (Mark, 2026-08-17). The log left
              the Info tab so each of its four quadrants could hold one section,
              and this is where it belongs: notes want WIDTH — they are
              paragraphs — and the log wants HEIGHT, so neither fits under the
              other and both scroll their own rows. */}
          {activeTab === "notes" && (
            <OrderSplitLayout
              left={
                <section className="space-y-3">
                  <SectionHeading>Notes</SectionHeading>
                  <p className="text-[13px] text-muted">
                    Each of these prints on its own document. The general note
                    prints nowhere — it is for you.
                  </p>
                  {/* `boxed` rather than the app's usual dotted underline
                      (Mark, 2026-08-21). Five stacked paragraphs under five
                      headings need to read as five FIELDS, and a dotted rule
                      marks only the last line of a wrapped paragraph — which
                      down a column reads as loose text rather than as a box you
                      can type in. See `INLINE_REST_BOXED`. */}
                  <div className="space-y-6 pr-2">
                    <Row label="General (prints nowhere)">
                      <Cell table="special_orders" id={id} column="notes_general" multiline boxed
                            value={row.notes_general as string | null} canWrite={canWrite} ariaLabel="General note" />
                    </Row>
                    <Row label="On the quote">
                      <Cell table="special_orders" id={id} column="notes_quote" multiline boxed
                            value={row.notes_quote as string | null} canWrite={canWrite} ariaLabel="Quote note" />
                    </Row>
                    <Row label="On the kitchen order">
                      <Cell table="special_orders" id={id} column="notes_production" multiline boxed
                            value={row.notes_production as string | null} canWrite={canWrite} ariaLabel="Production note" />
                    </Row>
                    <Row label="On the invoice">
                      <Cell table="special_orders" id={id} column="notes_invoice" multiline boxed
                            value={row.notes_invoice as string | null} canWrite={canWrite} ariaLabel="Invoice note" />
                    </Row>
                    <Row label="On the receipt">
                      <Cell table="special_orders" id={id} column="notes_receipt" multiline boxed
                            value={row.notes_receipt as string | null} canWrite={canWrite} ariaLabel="Receipt note" />
                    </Row>
                  </div>
                </section>
              }
              right={
                <OrderLog
                  orderId={id}
                  orgId={row.org_id as string}
                  rows={(logRows ?? []) as unknown as OrderEventRow[]}
                  total={logTotal ?? 0}
                  canWrite={canWrite}
                  authorName={session.membership.display_name ?? session.email}
                />
              }
            />
          )}

          {/* ================= ITEMS ================= */}
          {activeTab === "items" && (
            <>
              {lineError ? (
                <p className="text-sm text-accent">Could not load the lines: {lineError.message}</p>
              ) : (
                <>
                  {scheduled ? (
                    <p className="mb-3 text-[13px]">
                      <span className="bg-mark-fill px-1">
                        The kitchen has this order. Unschedule it to change the items.
                      </span>
                    </p>
                  ) : null}
                  <OrderLines
                    orderId={id}
                    orgId={row.org_id as string}
                    rows={lines}
                    canWrite={canEditItems}
                    menu={menu}
                  />
                </>
              )}
            </>
          )}

          {/* ================= PAYMENTS ================= */}
          {/* ITS OWN TAB (Mark, 2026-09-16) — Payments and Money moved here
              from under the lines on Items, keeping their arrangement. */}
          {activeTab === "payments" && (
            <>
              {/* MONEY FIRST, THEN PAYMENTS (Mark, 2026-09-16, on the new
                  Payments tab) — what the order comes to, then what has been
                  paid against it. Money stays sized to its content and
                  Payments takes the rest of the row. The note below is how the
                  pair was arranged under the lines on Items, right to left. */}
              {/* PAYMENTS LEFT, MONEY RIGHT (Mark, 2026-08-19: "move the
                  'money' section on the items tab so it's all the way to the
                  right of the page, and the payment is all the way to the
                  left"). They shipped the other way round the same day and this
                  is better: the lines above END in a money column against the
                  right margin, and Money's own figures are a column of amounts
                  against a right margin too, so on this side they continue the
                  page's one vertical rule of numbers instead of starting a
                  second one 400px to its left.

                  MONEY IS SIZED TO ITS CONTENT AND PAYMENTS TAKES THE REST,
                  which is what puts each against its own edge — the recipe
                  record's Costs pane and its reason. Money is label/value pairs
                  set `justify-between`, so given half of a 1150px column it
                  becomes 500px of white space between "Delivery charge" and
                  "$49.50"; Payments is a four-column table with a free-text
                  Note, which uses every pixel it is given. Payments being the
                  flexible one is also what holds Money on the right margin when
                  its table stops at its own `max-w`.

                  ONE DOM ORDER AT EVERY WIDTH — no `order-*` classes. Stacked
                  below `xl` you read Payments then Money, which is the price of
                  keeping the visual order and the tab order the same thing.

                  `min-w-0` on the payments track and NOT behind a breakpoint: a
                  flex item's min-width defaults to min-content, so a long note
                  would push the PAGE sideways instead of the cell wrapping. */}
              <div className="flex flex-col gap-12 xl:flex-row xl:items-start xl:gap-12">
                <div className="shrink-0">
                  <OrderTotals
                    id={id}
                    totals={totals}
                    inputs={moneyInputs}
                    rushSuggestion={rushSuggestion}
                    canWrite={canWrite}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <OrderPayments
                    orderId={id}
                    orgId={row.org_id as string}
                    rows={payments}
                    invoice={
                      liveInvoice
                        ? {
                            label: liveInvoice.label,
                            href: invoiceHref(liveInvoice.id, orderTabHref(id, "payments", rawParams)),
                          }
                        : null
                    }
                    balance={totals.balance}
                    canWrite={canWrite}
                    canRefund={canRefundPayments(session.membership.role)}
                    today={today}
                    workflow={row as never}
                  />
                </div>
              </div>
            </>
          )}

          {/* ================= DELIVERY ================= */}
          {activeTab === "delivery" && (
            <OrderDelivery id={id} row={row} canWrite={canWrite} />
          )}

          {/* ================= DOCUMENTS ================= */}
          {activeTab === "documents" && (
            documentError ? (
              <section className="space-y-3">
                <SectionHeading>Documents</SectionHeading>
                <p className="text-sm text-accent">
                  Could not load the paperwork: {documentError.message}
                </p>
              </section>
            ) : (
              <OrderDocuments
                orderId={id}
                orgId={row.org_id as string}
                attachments={documents}
                canWrite={canWrite}
                quoteReturnedAt={row.quote_returned_at as string | null}
                authorName={session.membership.display_name ?? session.email}
              />
            )
          )}
        </div>
      </div>

    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A LABEL BESIDE ITS VALUE — the Info tab's row, and FileMaker's own shape:
 * every block on its EVENT INFO tab right-aligns its labels against a fixed
 * track so the boxes share one left edge.
 *
 * HEIGHT IS THE REASON, not fidelity. Stacked (label over value) the three
 * top blocks came to 337px and 494px, which in a measured 588px frame left the
 * History pane FIFTY-FOUR PIXELS — a heading and nothing else. Inline they are
 * roughly half that, and the two panes that grow get their share of the column
 * back. The stacked `Row` below is still right for the Notes tab, where the
 * value is a paragraph rather than a box.
 */

function Row({
  label,
  wide = false,
  className = "",
  children,
}: {
  label: string;
  wide?: boolean;
  /** Extra room under a row — the gap that ends the top block (2026-09-23). */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${wide ? "space-y-1 sm:col-span-2" : "space-y-1"} ${className}`}>
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
  // THE EXPERIMENT'S SEAM. Every editable cell on this record goes through
  // here, so one default boxes the lot — and a caller can still opt out per
  // cell without unpicking it.
  boxed = BOXED_FIELDS,
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
  boxed?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  if (!canWrite) {
    const shown =
      props.kind === "pick"
        ? props.options?.find((o) => o.value === value)?.label ?? (value as string) ?? "—"
        : (value as string) ?? "—";
    // A READ-ONLY VALUE GETS NO BOX, which is the whole point of the box: it
    // means "you can change this". The one exception is a NOTE, which keeps
    // its frame below purchaser+ because there the box is doing a second job —
    // without it the Notes tab reads as five headings with loose text under
    // them, which is what it was added to fix in the first place.
    return (
      <span
        className={`${READ_ONLY_VALUE} ${
          props.multiline && boxed
            ? "block min-h-16 w-full whitespace-pre-wrap border border-hairline"
            : ""
        }`}
      >
        {shown || "—"}
      </span>
    );
  }
  return <InlineValue value={value} boxed={boxed} {...props} />;
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
  kitchenId,
  kitchens,
  listHref,
}: {
  orgId: string;
  orderId: string;
  eventDate: string | null;
  kitchenId: string | null;
  /** Every shop, for the labels — `session.locations`, so a closed one still
   *  renders its code rather than an em dash. */
  kitchens: { id: string; code: string }[];
  listHref: string;
}) {
  if (!eventDate) return null;
  const supabase = await createClient();

  let query = supabase
    .from("special_orders")
    .select(
      "id, number, kind, title, event_time, kitchen_location_id, status, customers ( first_name, last_name, company )"
    )
    .eq("org_id", orgId)
    .eq("event_date", eventDate)
    .neq("id", orderId)
    .neq("status", "cancelled");

  /**
   * SCOPED TO THIS KITCHEN (Mark, 2026-08-17: "I assume you're only displaying
   * orders for the same kitchen" — it wasn't). The block exists to stop a
   * supervisor double-booking a KITCHEN, so another shop's work is not context,
   * it is noise that inflates the count. Measured on 2026-08-16: order 9885 is
   * DF01 and two of the four it listed were DF02, so half the block was about
   * somebody else's night.
   *
   * UNASSIGNED ORDERS COME TOO, and are marked. 1,403 of the 8,329 real orders
   * carry no kitchen — that is 17% of the history, and they are load that will
   * land SOMEWHERE. Hiding them would understate the day while looking
   * complete, which is the failure this block is meant to prevent.
   *
   * An order with no kitchen of its own has nothing to scope BY, so it sees
   * every kitchen and the heading says so.
   */
  if (kitchenId) {
    query = query.or(`kitchen_location_id.eq.${kitchenId},kitchen_location_id.is.null`);
  }

  const { data } = await query
    .order("event_time", { ascending: true, nullsFirst: false })
    .limit(25);

  const rows = data ?? [];
  const kitchenCode = kitchenId ? kitchens.find((k) => k.id === kitchenId)?.code ?? null : null;
  const codeOf = (id: unknown) =>
    id ? kitchens.find((k) => k.id === id)?.code ?? null : null;
  return (
    <section className="space-y-3">
      <SectionHeading count={rows.length}>Also that day</SectionHeading>
      <p className="text-[12px] text-muted">
        {kitchenCode
          ? `At ${kitchenCode}, plus anything not yet assigned a kitchen.`
          : "Every kitchen — this order has none set."}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing else is booked for {eventDate}.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {rows.map((o) => {
            const st = o.status as SpecialOrderStatus | null;
            return (
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
                {/* THE STATUS, so a day's list distinguishes work from
                    possibility (Mark, 2026-08-17: "so we know if it's an order
                    we should be concerned about or just a lead"). The query has
                    always selected it and nothing read it.

                    WEIGHT, NOT COLOUR. A committed `order` is real kitchen load
                    and reads in full ink; a lead or a quote may never happen and
                    stays muted. Colour is reserved for record STATE meaning
                    something is WRONG or worth an eye, and a lead is neither —
                    it is simply less firm. Dimming the whole ROW was the other
                    option and is refused for the reason the Locations list
                    refuses it: greying text you can still click reads as
                    disabled and lies. */}
                <span
                  className={`ml-1.5 text-[12px] ${
                    st === "order" ? "font-semibold text-ink" : "text-subtle"
                  }`}
                >
                  {st ? STATUS_LABEL[st] : KIND_LABEL[o.kind as SpecialOrderKind]}
                </span>
                {/* Only when it ISN'T simply this kitchen's: an unassigned
                    order says so, and with no kitchen to scope by every row
                    names its own. Repeating "DF01" down a list already
                    headed "At DF01" would be noise. */}
                {o.kitchen_location_id !== kitchenId || !kitchenId ? (
                  // A CHIP, for the reason above — and this one is the case the
                  // rule was written for: a shop code at 12px in `text-mark` is
                  // 1.43:1, which is decoration that happens to have a shape.
                  <span className="ml-1.5 bg-mark-fill px-1 text-[12px]">
                    {codeOf(o.kitchen_location_id) ?? "no kitchen"}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
