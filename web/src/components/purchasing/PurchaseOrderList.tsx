"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TextInput } from "@/components/ui/TextInput";
import { TabPicker } from "@/components/ui/TabPicker";
import {
  downloadBlob,
  fetchPoDocData,
  openWindowNow,
  showBlob,
  SENT_VIA_FOR_ORDER_TYPE,
} from "@/lib/poProcessing";
import { MenuButton } from "@/components/ui/MenuButton";
import {
  money,
  PO_STATUS_CLASS,
  PO_STATUS_LABEL,
  PO_STATUS_ORDER,
  isPoOpen,
  poDocumentFileName,
  type PoStatus,
} from "@/lib/purchaseOrders";
import {
  parsePoFilters,
  poDetailHref,
  poFiltersToQuery,
  poListHref,
  serializePoView,
  PO_VIEW_COOKIE,
  RANGES,
  type PoFilters,
  type PoSortKey,
  type RangeKey,
  type StatusFilter,
} from "@/lib/poFilters";
import { urlFilterParams } from "@/lib/filterMenus";
import { makeComparator, type SortValue } from "@/lib/tableSort";
import { withFrom } from "@/lib/breadcrumbs";
import { usePublishRecordSet } from "@/lib/recordSet";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { Checkbox } from "@/components/ui/Checkbox";
import { RowMenu } from "@/components/ui/RowMenu";
import type { PoListRow } from "@/app/(app)/purchase-orders/page";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

// Widths and hidden columns share this key — one table, one identity.
const PO_WIDTHS_KEY = "rf.purchaseOrders.columnWidths.v2";

function sortValue(po: PoListRow, key: PoSortKey): SortValue {
  switch (key) {
    case "po_number":
      return po.po_number;
    case "order_date":
      return po.order_date;
    case "vendor":
      return po.vendors?.name ?? null;
    case "status":
      return PO_STATUS_ORDER.indexOf(po.status);
    case "lines":
      return po.line_count;
    case "total":
      return po.ordered_total;
  }
}

/**
 * The columns that band their runs when the list is sorted by them (Mark,
 * 2026-08-02) — the ordering day, the vendor, the state.
 *
 * Not the others, and the test is the same one everywhere: a band is worth its
 * row when the column has few values and many rows each. `po_number` is unique
 * per row, and `lines` and `total` are figures — banding either would put a
 * heading above nearly every order. A date passes because ordering happens in
 * batches, so a day's band is a day's run of POs.
 */
const GROUP_LABEL: Partial<Record<PoSortKey, (po: PoListRow) => string>> = {
  order_date: (po) => po.order_date,
  vendor: (po) => po.vendors?.name ?? "No vendor",
  status: (po) => PO_STATUS_LABEL[po.status],
};

/**
 * The PO list — the Monday workflow surface (spec §4.8): status at a glance,
 * a totals row, and selection for the batch operations that follow once PDF
 * generation exists.
 */
export function PurchaseOrderList({
  orders,
  initialFilters,
  activeLocationCode,
  capped,
  editable,
}: {
  orders: PoListRow[];
  initialFilters: PoFilters;
  activeLocationCode: string;
  capped: boolean;
  /**
   * The Page Permissions sheet's cell for /purchase-orders (2026-09-04). A
   * supervisor is Read Only there, and this list had never taken a role at
   * all — "RLS is the gate" — so they were offered the selection column, the
   * batch bar and a row's Delete, each of which then changed zero rows and
   * said so. False hides the three; Preview and Download stay, being reads.
   */
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  // Seeded from the ADDRESS BAR where it can be read, and only from the props
  // otherwise — see `urlFilterParams`. A back or forward restore hands this
  // component the props of whatever query the history entry was created with,
  // which after a `replaceState` is not the query it now shows.
  // The props are the fallback PER FIELD, so a URL that pins only `?status=draft`
  // still keeps the remembered sort the server folded in.
  const [filters, setFilters] = useState<PoFilters>(() => {
    const live = urlFilterParams("/purchase-orders");
    return live ? parsePoFilters(live, initialFilters) : initialFilters;
  });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  /**
   * Remember the view for the rest of the browser session. The URL alone
   * can't do it: the menu's link is a bare `/purchase-orders`, so coming back
   * through it dropped the sort and filters every time (Mark, 2026-07-27).
   * Same session cookie the order guide uses, written from an effect for the
   * same reason — a cookie write in the component body is a modification of
   * outside state, which the lint rejects. signOut deletes it.
   */
  useEffect(() => {
    document.cookie = `${PO_VIEW_COOKIE}=${serializePoView(filters)}; path=/; SameSite=Lax`;
  }, [filters]);

  function update(patch: Partial<PoFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    const query = poFiltersToQuery(next);
    window.history.replaceState(
      null,
      "",
      query ? `/purchase-orders?${query}` : "/purchase-orders"
    );
  }

  // The date window is a server filter, so changing it must re-run the page —
  // router.push, not the replaceState the other filters use. setFilters as
  // well as pushing: the push re-renders the server component but does NOT
  // remount this one, so state seeded from props would otherwise keep showing
  // the old window on the chips.
  function setRange(range: RangeKey) {
    const next = { ...filters, range };
    setFilters(next);
    router.push(poListHref(next));
  }

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const po of orders) counts[po.status] = (counts[po.status] ?? 0) + 1;
    return counts;
  }, [orders]);

  /** The roll-up behind the Open chip — see isPoOpen. */
  const openCount = useMemo(
    () => orders.filter((po) => isPoOpen(po.status)).length,
    [orders]
  );

  const visible = useMemo(() => {
    const words = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return orders.filter((po) => {
      if (filters.status === "open") {
        if (!isPoOpen(po.status)) return false;
      } else if (filters.status !== "all" && po.status !== filters.status) {
        return false;
      }
      if (words.length === 0) return true;
      const haystack = `${po.po_number} ${po.vendors?.name ?? ""} ${po.status}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [orders, filters.status, filters.q]);

  const sorted = useMemo(
    () =>
      [...visible].sort(
        makeComparator<PoListRow>({
          value: (po) => sortValue(po, filters.sort),
          dir: filters.dir,
          // VENDOR IS THE SECONDARY SORT, whatever the primary is (Mark,
          // 2026-08-03): Ordered then vendor, Status then vendor. A day's
          // orders and a status's orders are both read vendor by vendor, so
          // the run under each band arrives in the order you'd read it out.
          //
          // No need to special-case sorting BY vendor — equal primaries there
          // are the same vendor, so this returns 0 and falls through to the PO
          // number, which stays the last word because it is unique per row and
          // so makes the whole order deterministic.
          tiebreaks: [(po) => po.vendors?.name ?? "", (po) => po.po_number],
        })
      ),
    [visible, filters.sort, filters.dir]
  );

  // The found set, for the record book on PO detail (lib/recordSet).
  usePublishRecordSet(
    "/purchase-orders",
    useMemo(
      () => sorted.map((po) => ({ id: po.id, href: poDetailHref(po.id, filters) })),
      [sorted, filters]
    )
  );

  const pageTotal = useMemo(
    () => visible.reduce((sum, po) => sum + po.ordered_total, 0),
    [visible]
  );
  const selectedTotal = useMemo(
    () =>
      visible
        .filter((po) => checked.has(po.id))
        .reduce((sum, po) => sum + po.ordered_total, 0),
    [visible, checked]
  );

  function toggleOne(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** The selected orders' numbers, in the order the batch PDF will run them —
   *  so the menu's hint is the name the file will actually get. */
  const selectedNumbers = useMemo(
    () =>
      orders
        .filter((po) => checked.has(po.id))
        .map((po) => po.po_number)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [orders, checked]
  );

  const selectedDrafts = useMemo(
    () => orders.filter((po) => checked.has(po.id) && po.status === "draft"),
    [orders, checked]
  );

  // Receivable = anything not already received, and not closed or void — those
  // two are inert states you'd have to leave deliberately. Drafts count because
  // an order placed by phone never passes through "sent", and a delivery
  // arriving against one is a real Friday.
  const selectedReceivable = useMemo(
    () =>
      orders.filter(
        (po) => checked.has(po.id) && (po.status === "draft" || po.status === "sent")
      ),
    [orders, checked]
  );

  // Closeable = received. Deliberately narrower than the receivable set: a
  // draft or a sent order hasn't arrived yet, so there is nothing to have
  // finished with. PO detail offers Close on `sent` too, because there you're
  // looking at the one order and can see that it landed.
  const selectedCloseable = useMemo(
    () => orders.filter((po) => checked.has(po.id) && po.status === "received"),
    [orders, checked]
  );

  /**
   * Close the selection — the end of an order's life. Like the per-order close,
   * the confirm NAMES what's unresolved across the batch and then lets it
   * through; see closeReadiness. Line-level caveats aren't available here (the
   * list carries totals, not lines), so it reports the two facts it does have:
   * a short received total, and missing paperwork.
   */
  async function batchClose() {
    const short = selectedCloseable.filter(
      (po) => po.received_total < po.ordered_total - 0.005
    ).length;
    const unfiled = selectedCloseable.filter((po) => po.attachment_count === 0).length;
    const caveats = [
      short > 0 && `${short} received less than ${short === 1 ? "it" : "they"} ordered`,
      unfiled > 0 && `${unfiled} ${unfiled === 1 ? "has" : "have"} no paperwork attached`,
    ].filter(Boolean);
    const message =
      `Close ${selectedCloseable.length} order${selectedCloseable.length === 1 ? "" : "s"}?` +
      (caveats.length > 0 ? `\n\nStill unresolved:\n· ${caveats.join("\n· ")}` : "") +
      "\n\nClosed means done being worked on; you can reopen from the status menu.";
    if (!(await confirmDialog({ ...splitConfirmMessage(message), confirmLabel: "Close orders" }))) return;

    setBatchBusy("closed");
    setBatchError(null);
    try {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ status: "closed" })
        .in(
          "id",
          selectedCloseable.map((po) => po.id)
        );
      if (error) throw new Error(error.message);
      setChecked(new Set());
      router.refresh();
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(null);
    }
  }

  /**
   * One PDF for the whole selection — a page run per PO (spec §4.8's batch
   * preview / shopping-list modes), either OPENED for reading and printing or
   * DOWNLOADED under a name that says which orders are in it.
   *
   * Two verbs, because a preview tab cannot be named (Mark, 2026-08-27): the
   * tab is navigated to a `blob:` URL, whose path is a UUID and which carries
   * no `Content-Disposition`, so saving from the browser's own PDF viewer
   * yields `8f3c….pdf`. `a.download` is the only lever, and `downloadBlob` is
   * the only place that pulls it — see `ProcessPo.downloadPdf`.
   */
  async function batchPdf(kind: "po" | "shopping", mode: "open" | "download") {
    await renderPoPdf(kind, mode, [...checked]);
  }

  /**
   * The renderer both doors share — the selection bar, and a single row's own
   * ⋯ menu. `ids` is the only difference between them, and it is a parameter
   * rather than a second copy of this because the popup rule below is the kind
   * of thing that gets remembered in one place and forgotten in the other.
   */
  async function renderPoPdf(
    kind: "po" | "shopping",
    mode: "open" | "download",
    ids: string[]
  ) {
    if (ids.length === 0) return;
    // Opened before any await, while the click gesture still counts — a popup
    // opened after async work is silently blocked. `MenuButton` closes
    // synchronously inside the click, so this is still inside the gesture, and
    // that is as true of a RowMenu as of the command bar's own button.
    const win = mode === "open" ? openWindowNow() : null;
    setBatchBusy(`${kind}:${mode}`);
    setBatchError(null);
    try {
      const [{ pdf }, docs, { org, pos }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./pdf/PoPdfDocs"),
        fetchPoDocData(supabase, ids),
      ]);
      pos.sort((a, b) => a.po_number.localeCompare(b.po_number, undefined, { numeric: true }));
      const Doc = kind === "po" ? docs.PoPdf : docs.ShoppingListPdf;
      const blob = await pdf(<Doc pos={pos} org={org} />).toBlob();
      const name = poDocumentFileName(kind, pos.map((p) => p.po_number));
      if (mode === "open") showBlob(win, blob, name);
      else downloadBlob(blob, name);
    } catch (e) {
      win?.close();
      setBatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(null);
    }
  }

  /**
   * Delete orders, PO lines cascading with them. ONE implementation behind BOTH
   * doors — the selection bar and a row's own ⋯ menu — because the thing that
   * matters here is the confirm, and two copies of it would drift into
   * disagreeing about what deleting a sent order costs.
   *
   * Drafts are the expected case; anything already sent or received is order
   * HISTORY (and feeds "last ordered"), so the confirm names those separately
   * before anything irreversible happens. A single order is named outright,
   * since from a row menu "1 purchase order" is a worse answer to "which one?"
   * than the number on the row you just pressed.
   */
  async function deleteOrders(selected: PoListRow[]): Promise<boolean> {
    if (selected.length === 0) return false;
    const nonDraft = selected.filter((po) => po.status !== "draft");

    /**
     * WHICH BILLS POINT AT THESE ORDERS.
     *
     * Both links are `on delete set null` (025), so deleting an order does not
     * take its invoices with it — the money is still owed and the bill stays
     * payable, which is right. What goes is the ATTRIBUTION: those invoices
     * silently stop knowing what was ordered, and nothing said so (Mark asked
     * what happens, 2026-09-02).
     *
     * Asked here rather than carried on every row: the list is 500 orders and
     * this matters at the moment of deleting one.
     */
    let attributed: string[] = [];
    const { data: linked } = await supabase
      .from("vendor_invoice_lines")
      .select("invoice_id, vendor_invoices ( invoice_number )")
      .in("purchase_order_id", selected.map((po) => po.id));
    if (linked && linked.length > 0) {
      attributed = [
        ...new Set(
          linked
            .map(
              (l) =>
                (l.vendor_invoices as unknown as { invoice_number: string | null } | null)
                  ?.invoice_number ?? "no number"
            )
            .filter(Boolean)
        ),
      ];
    }

    const message =
      (selected.length === 1
        ? `Delete purchase order ${selected[0].po_number} and its lines?`
        : `Delete ${selected.length} purchase orders and their lines?`) +
      (nonDraft.length > 0
        ? (selected.length === 1
            ? `\n\nWARNING: it is ${nonDraft[0].status}, not a draft.`
            : `\n\nWARNING: ${nonDraft.length} of them ${
                nonDraft.length === 1 ? "is" : "are"
              } not a draft (${[...new Set(nonDraft.map((po) => po.status))].join(", ")}).`) +
          " Deleting sent or received orders erases order history permanently."
        : "") +
      (attributed.length > 0
        ? `\n\n${attributed.length} invoice${attributed.length === 1 ? "" : "s"} ` +
          `(${attributed.slice(0, 4).join(", ")}${attributed.length > 4 ? ", …" : ""}) ` +
          `${attributed.length === 1 ? "is" : "are"} attributed to ` +
          `${selected.length === 1 ? "this order" : "these orders"}. ` +
          `The bill${attributed.length === 1 ? "" : "s"} stay${attributed.length === 1 ? "s" : ""} ` +
          `and remain${attributed.length === 1 ? "s" : ""} payable — but ` +
          `${attributed.length === 1 ? "it" : "they"} will no longer know what was ordered.`
        : "") +
      (nonDraft.length === 0 && attributed.length === 0
        ? "\n\nThis cannot be undone."
        : "");
    if (!(await confirmDialog({ ...splitConfirmMessage(message), confirmLabel: "Delete", tone: "danger" })))
      return false;

    setBatchBusy("delete");
    setBatchError(null);
    try {
      // `.select()` ON A DELETE. With no matching RLS policy Postgres removes
      // ZERO ROWS and PostgREST returns NO ERROR, so a bare delete reports a
      // cheerful success and the order is still there after the refresh — the
      // employee-delete lesson, and the reason below purchaser+ this has to
      // fail out loud rather than quietly.
      const { data, error } = await supabase
        .from("purchase_orders")
        .delete()
        .in(
          "id",
          selected.map((po) => po.id)
        )
        .select("id");
      if (error) throw new Error(error.message);
      if ((data?.length ?? 0) < selected.length) {
        throw new Error(
          data?.length
            ? `Only ${data.length} of ${selected.length} were deleted — the rest are not yours to delete.`
            : "Nothing was deleted. Purchase orders are a purchaser's to remove."
        );
      }
      setChecked(new Set());
      return true;
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBatchBusy(null);
    }
  }

  /** The selection bar's door onto `deleteOrders`. */
  async function batchDelete() {
    if (await deleteOrders(orders.filter((po) => checked.has(po.id)))) router.refresh();
  }

  /**
   * Delete ONE order, from its own row menu.
   *
   * The selection bar could already do this and the row could not, so removing
   * a single order meant ticking it, reading a bar written for a batch, and
   * remembering to untick. It goes through `deleteOrders` with the batch, which
   * is what keeps the two confirms from drifting into disagreeing about what
   * deleting a sent order costs.
   */
  async function deleteOne(po: PoListRow) {
    setBatchError(null);
    if (await deleteOrders([po])) router.refresh();
  }

  /** Drafts only — sent_via comes from each vendor's order type. */
  async function batchMarkSent() {
    setBatchBusy("sent");
    setBatchError(null);
    try {
      const byVia = new Map<string, string[]>();
      for (const po of selectedDrafts) {
        const via = SENT_VIA_FOR_ORDER_TYPE[po.vendors?.order_type ?? "none"] ?? "print";
        byVia.set(via, [...(byVia.get(via) ?? []), po.id]);
      }
      for (const [via, ids] of byVia) {
        const { error } = await supabase
          .from("purchase_orders")
          .update({ status: "sent", sent_via: via })
          .in("id", ids);
        if (error) throw new Error(error.message);
      }
      setChecked(new Set());
      router.refresh();
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(null);
    }
  }

  /**
   * Mark the selection received — the Friday counterpart to Mark sent.
   *
   * It writes QUANTITIES, not just the status, because a status-only "received"
   * is a lie this screen would then report: the Received column flags any
   * received PO whose total falls short of what was ordered, so flipping the
   * status alone paints every order red for a shortfall that never happened.
   * "Received" means the delivery landed, so the lines say so.
   *
   * Only lines with NO received quantity are filled. Anything already counted —
   * a short case someone recorded on the detail screen — is a measurement, and
   * a batch button must not overwrite it. (PO detail's "Receive all as ordered"
   * deliberately does overwrite; that one is aimed at a single order you're
   * looking at.)
   */
  async function batchMarkReceived() {
    setBatchBusy("received");
    setBatchError(null);
    try {
      const ids = selectedReceivable.map((po) => po.id);
      const { data: lines, error: lineError } = await supabase
        .from("purchase_order_items")
        .select("id, qty_ordered")
        .in("po_id", ids)
        .is("qty_received", null);
      if (lineError) throw new Error(lineError.message);

      // PostgREST can't say "set qty_received = qty_ordered", and one request
      // per line would be hundreds on a Friday. Ordered quantities are a tiny
      // set of small numbers, so grouping by value costs a handful of requests
      // — the same shape as batchMarkSent's grouping by sent_via.
      const byQty = new Map<number, string[]>();
      for (const l of lines ?? []) {
        const q = Number(l.qty_ordered);
        byQty.set(q, [...(byQty.get(q) ?? []), l.id]);
      }
      for (const [q, lineIds] of byQty) {
        const { error } = await supabase
          .from("purchase_order_items")
          .update({ qty_received: q })
          .in("id", lineIds);
        if (error) throw new Error(error.message);
      }

      const { error } = await supabase
        .from("purchase_orders")
        .update({ status: "received" })
        .in("id", ids);
      if (error) throw new Error(error.message);

      setChecked(new Set());
      router.refresh();
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(null);
    }
  }

  const allVisibleChecked =
    sorted.length > 0 && sorted.every((po) => checked.has(po.id));

  function toggleAllVisible() {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) sorted.forEach((po) => next.delete(po.id));
      else sorted.forEach((po) => next.add(po.id));
      return next;
    });
  }

  const columns: DataColumn<PoListRow>[] = [
    ...(editable ? [{
      key: "select",
      label: "",
      width: 48,
      // The header cell carries the select-all, which is where every list in
      // the app puts it (Mark, 2026-07-31: "make it like Inventory. that's how
      // they all should be"). No visible label — a checkbox at the head of a
      // column of checkboxes has already said what it does. See
      // DataColumn.header.
      header: (
        <Checkbox
          checked={allVisibleChecked}
          onChange={toggleAllVisible}
          label="Select all shown"
          size={18}
        />
      ),
      render: (po) => (
        <Checkbox
          checked={checked.has(po.id)}
          onChange={() => toggleOne(po.id)}
          label={`select ${po.po_number}`}
          size={18}
        />
      ),
    } satisfies DataColumn<PoListRow>] : []),
    {
      key: "po_number",
      label: "PO number",
      pinned: true,
      // 170 → 155. See the note on the table's storageKey: the eleven columns
      // summed to 1393 against 1344 of content, so this list was the one that
      // couldn't have sticky column labels. A PO number is short and fixed
      // ("DF01-1043"), so this is the cheapest 15px in the row.
      width: 155,
      sortValue: (po) => po.po_number,
      render: (po) => (
        <Link
          href={poDetailHref(po.id, filters)}
          className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
        >
          {po.po_number}
        </Link>
      ),
    },
    {
      key: "order_date",
      label: "Ordered",
      width: 130,
      sortValue: (po) => po.order_date,
      render: (po) => <span className="tabular-nums text-muted">{po.order_date}</span>,
    },
    {
      key: "vendor",
      label: "Vendor",
      // 240 → 210. The widest column and the one with the most slack: the
      // longest vendor name in the catalog is "Trinity Oil & Grease Recycling",
      // which truncated at 240 as well.
      width: 181,
      sortValue: (po) => po.vendors?.name ?? null,
      render: (po) =>
        po.vendors ? (
          <Link
            href={withFrom(`/vendors/${po.vendors.id}`, {
              href: poListHref(filters),
              label: "POs",
            })}
            className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            {po.vendors.name}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      key: "status",
      label: "Status",
      width: 130,
      sortValue: (po) => PO_STATUS_ORDER.indexOf(po.status),
      render: (po) => (
        <span
          className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${PO_STATUS_CLASS[po.status]}`}
        >
          {PO_STATUS_LABEL[po.status]}
        </span>
      ),
    },
    {
      key: "sent_via",
      label: "Sent via",
      // 120 → 110. The values are one short word — gmail, resend, phone.
      width: 103,
      hideWhenCompact: true,
      sortValue: (po) => po.sent_via,
      render: (po) => <span className="text-muted">{po.sent_via ?? "—"}</span>,
    },
    {
      key: "delivery_date",
      label: "Delivery",
      width: 130,
      sortValue: (po) => po.delivery_date,
      render: (po) => (
        <span className="tabular-nums text-muted">{po.delivery_date ?? "—"}</span>
      ),
    },
    {
      key: "lines",
      label: "Lines",
      width: 78,
      hideWhenCompact: true,
      align: "right",
      sortValue: (po) => po.line_count,
      render: (po) => <span className="text-muted">{po.line_count}</span>,
    },
    {
      key: "total",
      label: "Ordered",
      width: 117,
      align: "right",
      sortValue: (po) => po.ordered_total,
      render: (po) => <span className="text-body">{money(po.ordered_total)}</span>,
    },
    {
      key: "received_total",
      label: "Received",
      width: 121,
      align: "right",
      sortValue: (po) => po.received_total,
      render: (po) => (
        <span
          className={
            // A received total short of what was ordered is the signal worth
            // catching on this screen.
            po.status === "received" && po.received_total < po.ordered_total - 0.005
              ? "font-semibold text-accent"
              : "text-muted"
          }
        >
          {money(po.received_total)}
        </span>
      ),
    },
    // The paperwork, as a count (migration 018). Narrow on purpose — the only
    // question this column answers on a Friday is "which delivery still has
    // nothing filed", and a dash answers it.
    {
      key: "attachments",
      label: "Files",
      width: 75,
      align: "right",
      sortValue: (po) => po.attachment_count,
      render: (po) =>
        po.attachment_count === 0 ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="tabular-nums text-muted">{po.attachment_count}</span>
        ),
    },
    // The row's own commands. Unlabelled and last, so it stays out of the
    // Columns menu — it is a control rather than a field.
    //
    // 58, and every pixel of it was MEASURED rather than chosen. Widths are
    // WEIGHTS, so what a column resolves to depends on the table's total: at
    // 1280 (the tight case — `compactBelow` has not fired yet) a weight of 50
    // is a 42px cell holding a 36px button, and `TasksScreen`'s 50 works only
    // because that table's total is smaller.
    //
    // The total stays at the 1338 the storageKey note tuned this table to,
    // which is what keeps every column NOT named here at exactly the pixels it
    // had before — the factor does not move. The 58 was paid for out of
    // measured slack at 1280: Lines and Files had 21px and 22px spare (their
    // content is one or two digits and their own LABEL is the binding
    // constraint, so that slack is structural rather than a fact about
    // today's data), the two money columns 17px and 13px, Sent via 8px, and
    // the rest came from Vendor, whose cells are proper nouns where an
    // ellipsis is idiomatic. Nothing was taken from Status, which had ZERO
    // spare — "RECEIVED" fills its chip exactly — or from the two DATE
    // columns, which had 2px and are the thing you read this list for.
    //
    // Delete is offered only to a Write role (`editable`); Preview and
    // Download are reads and stay for everyone who can open the list.
    // `deleteOrders` still checks its own row count, so a stale session's
    // refusal is a sentence rather than a silent success.
    {
      key: "menu",
      label: "",
      width: 70,
      render: (po) => (
        <RowMenu
          label={`Commands for ${po.po_number}`}
          items={[
            {
              label: "Preview purchase order",
              hint: "Opens for reading or printing",
              disabled: batchBusy !== null,
              onSelect: () => void renderPoPdf("po", "open", [po.id]),
            },
            {
              // The FILENAME as the hint, which is what the command bar's own
              // download items do: a preview tab cannot be named (its blob URL
              // is a UUID), so the name is the whole difference between the two
              // verbs and is worth showing before you press one.
              label: "Download purchase order",
              hint: poDocumentFileName("po", [po.po_number]),
              disabled: batchBusy !== null,
              onSelect: () => void renderPoPdf("po", "download", [po.id]),
            },
            ...(editable
              ? [
                  {
                    label: "Delete purchase order",
                    hint:
                      po.status === "draft"
                        ? "and its lines"
                        : `it is ${po.status} — this erases order history`,
                    danger: true,
                    onSelect: () => void deleteOne(po),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];

  /**
   * All · Open · then whichever raw statuses are actually represented.
   *
   * The two roll-ups are ALWAYS shown, where an empty raw status is dropped,
   * and the difference is what a zero means. "Draft 0" says only that no order
   * happens to be in that state right now; "Open 0" says nothing is
   * outstanding, which is the answer you came to the screen for. A standing
   * view should be able to tell you it's empty.
   *
   * Open sits second because it's the working list — everything after it is a
   * way of narrowing that, and All is the archive.
   */
  const statusTabs: StatusFilter[] = [
    "all",
    "open",
    ...PO_STATUS_ORDER.filter((s) => (statusCounts[s] ?? 0) > 0),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Purchase Orders
          </h1>
          <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
            {activeLocationCode} · {visible.length} of {orders.length} orders
          </p>
        </div>
        {/* The window total as a Statistic: small-caps label over the figure. */}
        <div className="ml-auto text-right">
          <div className="text-[12px] uppercase tracking-[0.12em] text-subtle">
            Window total
          </div>
          <div className="text-[22px] font-bold tabular-nums tracking-[-0.01em]">
            {money(pageTotal)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <TextInput
          value={filters.q}
          onValueChange={(q) => update({ q })}
          placeholder="Search PO number or vendor…"
          clearLabel="Clear the search"
          className="w-64"
        />

        <TabPicker
          ariaLabel="Status"
          value={filters.status}
          onChange={(status) => update({ status })}
          options={statusTabs.map((s) => ({
            key: s,
            label:
              s === "all"
                ? "All"
                : s === "open"
                  ? "Open"
                  : PO_STATUS_LABEL[s as PoStatus],
            count:
              s === "all"
                ? orders.length
                : s === "open"
                  ? openCount
                  : statusCounts[s] ?? 0,
          }))}
        />

        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
            Window
          </span>
          <TabPicker
            ariaLabel="Date window"
            value={filters.range}
            onChange={setRange}
            options={RANGES.map((r) => ({ key: r.key, label: r.label }))}
          />
        </div>
      </div>

      {capped && (
        <p className="border border-ink bg-mark-fill px-4 py-3 text-sm text-ink">
          Showing the 500 most recent orders in this window — narrow the window
          to see everything in it.
        </p>
      )}

      {editable && checked.size > 0 && (
        <div className="space-y-1 border border-ink px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-4">
            <span>{checked.size} selected</span>
            <span className="tabular-nums text-muted">{money(selectedTotal)}</span>

            {/* Batch documents (spec §4.8): every selected PO as one PDF, a
                page run per order.
                A MENU rather than buttons, which is what lets Download exist
                without a seventh and eighth cell in this bar: four commands
                behind one trigger is one fewer control than the two it
                replaces. That is the opposite of ProcessPo's call, and for the
                opposite reason — that card has room for two plain buttons and
                Preview is its everyday act, where this bar is already six
                commands wide and wraps. */}
            <MenuButton
              label="Batch document"
              trigger={
                batchBusy?.includes(":") ? "Rendering…" : "Documents"
              }
              triggerClassName="flex h-9 items-center border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
              caret
              disabled={batchBusy !== null}
              minWidth={260}
              items={[
                {
                  label: "Preview PO PDFs",
                  hint: "Opens for reading or printing",
                  onSelect: () => batchPdf("po", "open"),
                },
                {
                  label: "Download PO PDFs",
                  hint: poDocumentFileName("po", selectedNumbers),
                  onSelect: () => batchPdf("po", "download"),
                },
                {
                  label: "Preview shopping lists",
                  hint: "Opens for reading or printing",
                  onSelect: () => batchPdf("shopping", "open"),
                },
                {
                  label: "Download shopping lists",
                  hint: poDocumentFileName("shopping", selectedNumbers),
                  onSelect: () => batchPdf("shopping", "download"),
                },
              ]}
            />
            <button
              disabled={batchBusy !== null || selectedDrafts.length === 0}
              onClick={batchMarkSent}
              title={
                selectedDrafts.length === 0
                  ? "No drafts selected — only drafts can be marked sent"
                  : `Marks ${selectedDrafts.length} draft${
                      selectedDrafts.length === 1 ? "" : "s"
                    } sent, sent_via from each vendor's order type`
              }
              className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              {batchBusy === "sent"
                ? "Saving…"
                : `Mark sent (${selectedDrafts.length})`}
            </button>
            <button
              disabled={batchBusy !== null || selectedReceivable.length === 0}
              onClick={batchMarkReceived}
              title={
                selectedReceivable.length === 0
                  ? "Nothing receivable selected — these are already received, closed or void"
                  : `Receives ${selectedReceivable.length} order${
                      selectedReceivable.length === 1 ? "" : "s"
                    } at the ordered quantity. Lines already counted are left alone.`
              }
              className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              {batchBusy === "received"
                ? "Receiving…"
                : `Mark received (${selectedReceivable.length})`}
            </button>
            <button
              disabled={batchBusy !== null || selectedCloseable.length === 0}
              onClick={batchClose}
              title={
                selectedCloseable.length === 0
                  ? "Nothing closeable selected — only a received order can be closed"
                  : `Closes ${selectedCloseable.length} received order${
                      selectedCloseable.length === 1 ? "" : "s"
                    }: reconciled and filed, done being worked on.`
              }
              className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              {batchBusy === "closed" ? "Closing…" : `Close (${selectedCloseable.length})`}
            </button>

            {/* Danger inverts red on hover — same move, different meaning. */}
            <button
              disabled={batchBusy !== null}
              onClick={batchDelete}
              className={DANGER_BUTTON_CLASS}
            >
              {batchBusy === "delete" ? "Deleting…" : "Delete"}
            </button>

            <button
              onClick={() => setChecked(new Set())}
              className="ml-auto text-muted underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
            >
              Clear
            </button>
          </div>
          {batchError && <p className="text-accent">{batchError}</p>}
        </div>
      )}

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(po) => po.id}
        // v2 (2026-07-31): the eleven columns summed to 1393px against 1344 of
        // content at a 1440 window, so this list had a horizontal scrollbar —
        // and, once column labels started sticking, was the ONE list that
        // couldn't have them (a sticky cell inside an overflow-x container pins
        // to that container, not the page; see lib/tableHead). PO number,
        // Vendor and Sent via gave up 15, 30 and 10, which brings the row to
        // 1338 and fits. The key had to move with them or anyone who had ever
        // dragged a column would keep the old total and keep the scrollbar.
        // Sheds Sent via and Lines below xl (Mark, 2026-07-31). Eleven
        // columns is too many to read on a tablet; the table fits either way
        // now that the columns are proportional.
        compactBelow={1280}
        storageKey={PO_WIDTHS_KEY}
        columnChooser
        sort={{ key: filters.sort, dir: filters.dir }}
        onSortChange={(next) =>
          update({ sort: next.key as PoSortKey, dir: next.dir })
        }
        // Bands on the three columns whose runs are worth naming (Mark,
        // 2026-08-02): the ordering day, the vendor, the state. This list sorts
        // through the URL, so the caller decides — see DataGroup. Ordering
        // happens in batches, so a date band is a day's run of POs; the other
        // two are small vocabularies by construction.
        // A VOID order is GREY — EVERY WORD OF IT (Mark, 2026-08-27, twice:
        // "all the text in a purchase order list row should be faint"). It is
        // the treatment six catalog lists give an inactive row, and `isPoOpen`
        // has called void "inert" since it was written without anything on
        // screen saying so. Not `line-through` as well: a cancelled special
        // order gets that because it was called OFF, where a void PO was never
        // an order.
        //
        // `text-faint` alone reaches only the cells that state no colour of
        // their own, which on this row is four of eleven — the two links are
        // `text-ink` and the dates, Received and Files are `text-muted`, and a
        // child's own colour beats an inherited one whatever the stylesheet
        // order says (this is specificity, not Tailwind's ordering rule). So
        // the descendant variant, which is a real selector and outranks them:
        // `[&_*]:text-faint` is (0,1,1) against a plain utility's (0,1,0), so
        // it wins with no `!important` and nothing has to be restated at six
        // call sites — a twelfth column added next month is faint for free.
        //
        // It reaches the status chip too, which already reads `text-faint` for
        // void (PO_STATUS_CLASS), so that word is unchanged; the chip's border
        // and fill are untouched, being background and border rather than
        // colour. The links keep their underline — greying text you can still
        // click reads as disabled, and the underline is what says it isn't.
        rowClassName={(po) =>
          po.status === "void" ? "text-faint [&_*]:text-faint" : ""
        }
        group={GROUP_LABEL[filters.sort] ? { label: GROUP_LABEL[filters.sort]! } : undefined}
        empty={<p className="text-sm text-muted">No orders in this window.</p>}
      />
    </div>
  );
}
