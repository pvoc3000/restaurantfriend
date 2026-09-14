"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { PickList } from "@/components/ui/PickList";
import { nextDeliveryDate } from "@/lib/poProcessing";
import { withFrom } from "@/lib/breadcrumbs";

type VendorOption = {
  id: string;
  name: string;
  vendor_locations: { location_id: string; delivery_days: number[] | null; is_active: boolean }[];
};

/**
 * A purchase order nobody generated from the guide (Mark, 2026-09-14): choose
 * the vendor, and the order is created EMPTY — then the new record opens with
 * Add Item… already up (`?add=1`), since adding lines is the next thing to do.
 *
 * It numbers the order with `next_po_number` (006) and dates delivery from the
 * vendor's delivery days at this shop, the two things 013's generation does, so
 * an order made here reads exactly like a generated one.
 *
 * The vendors are fetched when the dialog opens — active vendors only, the ones
 * set up at this shop first — rather than paid for on every load of the list.
 */
export function NewPurchaseOrder({
  orgId,
  locationId,
  today,
  children,
}: {
  orgId: string;
  locationId: string;
  /** The org's calendar day — the order date. */
  today: string;
  /** Hands out the command; the list's Actions menu owns where it sits. */
  children: (open: () => void) => ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function openDialog() {
    setOpen(true);
    setVendorId("");
    setFailed(null);
    setLoading(true);
    const { data, error } = await supabase
      .from("vendors")
      .select("id, name, vendor_locations ( location_id, delivery_days, is_active )")
      .eq("is_active", true)
      .order("name");
    setLoading(false);
    if (error) {
      setFailed(error.message);
      return;
    }
    setVendors((data ?? []) as unknown as VendorOption[]);
  }

  function close() {
    if (pending) return;
    setOpen(false);
  }

  const hereFor = (v: VendorOption) =>
    v.vendor_locations.find((vl) => vl.location_id === locationId && vl.is_active) ?? null;

  const options = [...vendors]
    .sort((a, b) => Number(!hereFor(a)) - Number(!hereFor(b)) || a.name.localeCompare(b.name))
    .map((v) => ({
      value: v.id,
      label: v.name,
      group: hereFor(v) ? "Used at this shop" : "Other vendors",
    }));

  function create() {
    if (!vendorId) return;
    setFailed(null);
    startTransition(async () => {
      const vendor = vendors.find((v) => v.id === vendorId);
      const { data: poNumber, error: numberError } = await supabase.rpc("next_po_number", {
        p_vendor_id: vendorId,
        p_location_id: locationId,
      });
      if (numberError || !poNumber) {
        setFailed(numberError?.message ?? "The order could not be numbered.");
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("purchase_orders")
        .insert({
          org_id: orgId,
          location_id: locationId,
          vendor_id: vendorId,
          po_number: poNumber as string,
          status: "draft",
          order_date: today,
          delivery_date: vendor
            ? nextDeliveryDate(today, hereFor(vendor)?.delivery_days)
            : null,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error || !data) {
        setFailed(error?.message ?? "The purchase order could not be created.");
        return;
      }
      setOpen(false);
      router.refresh();
      router.push(
        withFrom(`/purchase-orders/${data.id}?add=1`, {
          href: "/purchase-orders",
          label: "Purchase Orders",
        })
      );
    });
  }

  return (
    <>
      {children(() => void openDialog())}

      {open && (
        <Dialog
          title="New purchase order"
          onClose={close}
          busy={pending}
          onSubmit={vendorId && !pending ? create : undefined}
          footer={
            <>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={create}
                disabled={!vendorId || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Creating…" : "Create PO"}
              </button>
            </>
          }
        >
          <div className="space-y-1.5">
            <span className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
              Vendor
            </span>
            {loading ? (
              <p className="text-sm text-muted">Loading vendors…</p>
            ) : (
              <PickList
                variant="field"
                value={vendorId}
                onPick={setVendorId}
                ariaLabel="Vendor"
                placeholder="Choose a vendor"
                options={options}
              />
            )}
          </div>
          {failed && <p className="mt-3 text-sm text-accent">{failed}</p>}
        </Dialog>
      )}
    </>
  );
}
