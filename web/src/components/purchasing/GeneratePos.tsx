"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/purchaseOrders";
import { withFrom } from "@/lib/breadcrumbs";
import type { VendorTotal } from "@/lib/orderGuide";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";

/**
 * "Generate POs" (spec §2 step 3): one draft PO per vendor from today's
 * will-order lines, via create_purchase_orders_from_guide (migration 013) so
 * the batch is one transaction.
 *
 * The dialog is where the two guards live, both as information rather than
 * walls:
 * - a vendor under its minimum defaults to UNCHECKED (§4.2 — it "simply gets
 *   no PO") but stays checkable, because the totals bar tells you the fact and
 *   the human owns the call;
 * - FMP's "<7 days since last PO for this vendor" guard renders as a warning
 *   chip, and a vendor that already has a PO dated today defaults to unchecked
 *   — the most likely meaning is "this batch already ran".
 */

type RecentPo = {
  vendor_id: string;
  po_number: string;
  order_date: string;
  status: string;
};

type CreatedPo = {
  id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  line_count: number;
  total: number;
};

function minusDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function GeneratePos({
  totals,
  locationId,
  guideDate,
  weekday,
  trigger,
}: {
  totals: VendorTotal[];
  locationId: string;
  guideDate: string;
  weekday: number;
  /** Renders the opening control — the caller owns its placement and look. */
  trigger: (open: () => void) => ReactNode;
}) {
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<RecentPo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedPo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Created POs link out with the guide day as the way back, same as every
  // other link that leaves the guide.
  const here = { href: `/order-guide?day=${weekday}`, label: "Order Guide" };

  async function openDialog() {
    setOpen(true);
    setCreated(null);
    setError(null);
    setLoading(true);

    // The <7-days guard needs the recent POs; fetched on open so the check is
    // fresh, not as stale as the page load.
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("vendor_id, po_number, order_date, status")
      .eq("location_id", locationId)
      .gte("order_date", minusDays(guideDate, 7))
      .neq("status", "void")
      .order("order_date", { ascending: false });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }

    const pos = (data ?? []) as RecentPo[];
    setRecent(pos);
    // Preselect what the model says should become a PO: at/above minimum and
    // not already generated today.
    const generatedToday = new Set(
      pos.filter((p) => p.order_date === guideDate).map((p) => p.vendor_id)
    );
    setSelected(
      new Set(
        totals
          .filter((t) => !t.short && !generatedToday.has(t.vendor_id))
          .map((t) => t.vendor_id)
      )
    );
  }

  function toggle(vendorId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(vendorId)) next.delete(vendorId);
      else next.add(vendorId);
      return next;
    });
  }

  async function create() {
    setCreating(true);
    setError(null);

    const { data, error } = await supabase.rpc("create_purchase_orders_from_guide", {
      p_location_id: locationId,
      p_guide_date: guideDate,
      p_vendor_ids: [...selected],
    });

    setCreating(false);
    if (error) {
      setError(error.message);
      return;
    }
    setCreated((data ?? []) as CreatedPo[]);
  }

  return (
    <>
      {trigger(openDialog)}

      {open && (
        // The overlay itself — pinned title bar, scrolling body, pinned footer,
        // and the `text-ink` that keeps this dialog readable despite hanging
        // off the black ActionBar — is components/ui/Dialog.
        <Dialog
          title={created ? "Purchase orders created" : "Generate purchase orders"}
          onClose={() => setOpen(false)}
          busy={creating}
          top="pt-[10vh]"
          footer={
            !loading &&
            (created ? (
              <Link
                href="/purchase-orders"
                className="inline-flex h-9 items-center bg-ink px-5 text-[12px] font-semibold uppercase tracking-[0.06em] text-white no-underline hover:bg-neutral-800"
              >
                Open purchase orders
              </Link>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={creating}
                  className={DIALOG_CANCEL_CLASS}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={create}
                  disabled={creating || selected.size === 0}
                  className={DIALOG_COMMIT_CLASS}
                >
                  {creating
                    ? "Creating…"
                    : `Create ${selected.size} ${selected.size === 1 ? "PO" : "POs"}`}
                </button>
              </>
            ))
          }
        >
            {error && <p className="mt-2 text-sm text-accent">{error}</p>}

            {created ? (
              <div className="mt-3 space-y-4">
                {created.length === 0 ? (
                  <p className="text-sm text-muted">
                    No POs were created — the selected vendors had no will-order
                    lines.
                  </p>
                ) : (
                  <ul className="divide-y divide-hairline border border-ink">
                    {created.map((po) => (
                      <li
                        key={po.id}
                        className="flex items-baseline justify-between px-4 py-3 text-sm"
                      >
                        <span>
                          <Link
                            href={withFrom(`/purchase-orders/${po.id}`, here)}
                            className="font-medium text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                          >
                            {po.po_number}
                          </Link>{" "}
                          <span className="text-muted">{po.vendor_name}</span>
                        </span>
                        <span className="tabular-nums text-body">
                          {po.line_count} {po.line_count === 1 ? "line" : "lines"} ·{" "}
                          {money(po.total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : loading ? (
              <p className="mt-3 text-sm text-subtle">Checking recent POs…</p>
            ) : (
              <div className="mt-3 space-y-4">
                <p className="text-sm text-muted">
                  One draft PO per checked vendor, from the quantities entered for{" "}
                  {guideDate}. Vendors under their minimum start unchecked.
                </p>

                <ul className="divide-y divide-hairline border border-ink">
                  {totals.map((t) => {
                    // Latest first, so [0] is the PO the warning names.
                    const recentPo = recent.find((p) => p.vendor_id === t.vendor_id);
                    return (
                      <li key={t.vendor_id} className="px-4 py-3">
                        <div className="flex items-center gap-3 text-sm">
                          <Checkbox
                            checked={selected.has(t.vendor_id)}
                            onChange={() => toggle(t.vendor_id)}
                            label={`Generate a PO for ${t.vendor_name}`}
                            size={18}
                          />
                          <span className="text-[13px] font-semibold uppercase tracking-[0.06em]">
                            {t.vendor_name}
                          </span>
                          <span className="text-subtle">
                            {t.lines} {t.lines === 1 ? "line" : "lines"}
                          </span>
                          <span className="ml-auto tabular-nums text-body">
                            {money(t.subtotal)}
                            {t.minimum !== null && (
                              <span className="text-faint"> / {money(t.minimum)}</span>
                            )}
                          </span>
                        </div>
                        {/* Both guards inform, they don't block (§4.2). */}
                        {(t.short || recentPo) && (
                          <div className="mt-2 flex flex-wrap gap-2 pl-7 text-xs">
                            {t.short && (
                              <span className="border border-ink bg-[var(--rf-red-200)] px-2 py-0.5 text-ink">
                                {money((t.minimum ?? 0) - t.subtotal)} under minimum
                              </span>
                            )}
                            {recentPo && (
                              <span className="border border-ink bg-[var(--rf-yellow-200)] px-2 py-0.5 text-ink">
                                {recentPo.order_date === guideDate
                                  ? `already generated today — ${recentPo.po_number}`
                                  : `PO ${recentPo.po_number} on ${recentPo.order_date}`}
                              </span>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
        </Dialog>
      )}
    </>
  );
}
