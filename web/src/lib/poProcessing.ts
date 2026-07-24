// PO processing (spec §2 step 4): everything between "a draft PO exists" and
// "the vendor has it". Per vendor order_type — email_po gets the §4.9 PDF plus
// a prefilled mail draft, online opens the vendor's site, in_person gets a
// shopping list sorted by shop section. All of it stamps status='sent' with
// sent_via recording HOW.
//
// This module is client-safe on purpose: document data is fetched at click
// time through the caller's supabase client (RLS applies), so the PO detail
// page and the list's batch bar share one implementation and the data is as
// fresh as the click.

import type { SupabaseClient } from "@supabase/supabase-js";

/** How a PO went out, by the vendor's order_type. Matches the DB check. */
export const SENT_VIA_FOR_ORDER_TYPE: Record<string, string> = {
  email_po: "email",
  online: "online",
  in_person: "shopping",
  // 'none' vendors (landlord, plumber) rarely see a PO; print is the honest
  // record when one does get produced by hand.
  none: "print",
};

/** One PO line, shaped for the documents. */
export type DocLine = {
  id: string;
  product_id: string | null;
  brand: string | null;
  description: string | null;
  pack: string | null;
  qty: number;
  unit_price: number | null;
  item_name: string | null;
  category: string | null;
  /** Vendor-item ordering instructions — §4.9: they print on the line. */
  instructions: string | null;
  shop_section: string | null;
  shop_section_sort: number | null;
};

export type PoDocData = {
  id: string;
  po_number: string;
  status: string;
  order_date: string;
  delivery_date: string | null;
  notes: string | null;
  vendor_id: string;
  vendor_name: string;
  order_type: string;
  vendor_url: string | null;
  /** Vendor-level operational notes ("1pm cutoff") — internal, not printed. */
  vendor_notes: string | null;
  location_id: string;
  location_code: string;
  location_name: string;
  ship_to: Address | null;
  account_number: string | null;
  rep_email: string | null;
  sales_rep: string | null;
  lines: DocLine[];
};

export type Address = {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
};

export type OrgDocData = {
  name: string;
  billing: (Address & { entity_name?: string; address1?: string; email?: string }) | null;
  po_email: { cc?: string; subject?: string; body?: string } | null;
};

/**
 * Everything the documents and the mail draft need, for one or many POs.
 * Four queries regardless of PO count — lines, account numbers and shop
 * sections are fetched in bulk and joined here.
 */
export async function fetchPoDocData(
  supabase: SupabaseClient,
  poIds: string[]
): Promise<{ org: OrgDocData; pos: PoDocData[] }> {
  const [{ data: org, error: orgError }, { data: pos, error: poError }] =
    await Promise.all([
      supabase.from("orgs").select("name, settings").maybeSingle(),
      supabase
        .from("purchase_orders")
        .select(
          `id, po_number, status, order_date, delivery_date, notes,
           vendor_id, location_id,
           vendors ( id, name, order_type, url, notes ),
           locations ( id, code, name, address )`
        )
        .in("id", poIds),
    ]);
  if (orgError) throw new Error(orgError.message);
  if (poError) throw new Error(poError.message);
  if (!org) throw new Error("No org visible — are you signed in?");

  type PoRow = {
    id: string;
    po_number: string;
    status: string;
    order_date: string;
    delivery_date: string | null;
    notes: string | null;
    vendor_id: string;
    location_id: string;
    vendors: {
      id: string;
      name: string;
      order_type: string;
      url: string | null;
      notes: string | null;
    } | null;
    locations: {
      id: string;
      code: string;
      name: string;
      address: { shipping?: Address } | null;
    } | null;
  };
  const poRows = (pos ?? []) as unknown as PoRow[];

  const vendorIds = [...new Set(poRows.map((p) => p.vendor_id))];
  const locationIds = [...new Set(poRows.map((p) => p.location_id))];

  const [{ data: vendorLocs, error: vlError }, lines] = await Promise.all([
    supabase
      .from("vendor_locations")
      .select("vendor_id, location_id, account_number, rep_email, sales_rep")
      .in("vendor_id", vendorIds)
      .in("location_id", locationIds),
    fetchLines(supabase, poIds),
  ]);
  if (vlError) throw new Error(vlError.message);

  // Shop sections: the line's inventory item at the PO's location.
  const itemIds = [
    ...new Set(lines.map((l) => l.inventory_item_id).filter(Boolean)),
  ] as string[];
  const sections = await fetchSections(supabase, itemIds, locationIds);

  const settings = (org.settings ?? {}) as {
    billing?: OrgDocData["billing"];
    po_email?: OrgDocData["po_email"];
  };

  const result: PoDocData[] = poRows.map((po) => {
    const vl = (vendorLocs ?? []).find(
      (v) => v.vendor_id === po.vendor_id && v.location_id === po.location_id
    );
    return {
      id: po.id,
      po_number: po.po_number,
      status: po.status,
      order_date: po.order_date,
      delivery_date: po.delivery_date,
      notes: po.notes,
      vendor_id: po.vendor_id,
      vendor_name: po.vendors?.name ?? "—",
      order_type: po.vendors?.order_type ?? "none",
      vendor_url: po.vendors?.url ?? null,
      vendor_notes: po.vendors?.notes ?? null,
      location_id: po.location_id,
      location_code: po.locations?.code ?? "—",
      location_name: po.locations?.name ?? "—",
      ship_to: po.locations?.address?.shipping ?? null,
      account_number: vl?.account_number ?? null,
      rep_email: vl?.rep_email ?? null,
      sales_rep: vl?.sales_rep ?? null,
      lines: lines
        .filter((l) => l.po_id === po.id)
        .map((l) => ({
          id: l.id,
          product_id: l.product_id,
          brand: l.brand,
          description: l.description,
          pack: l.package_desc,
          qty: Number(l.qty_ordered),
          unit_price: l.unit_price === null ? null : Number(l.unit_price),
          item_name: l.item_name,
          category: l.category,
          instructions: l.instructions,
          shop_section: l.inventory_item_id
            ? (sections.get(`${l.inventory_item_id}:${po.location_id}`)?.name ?? null)
            : null,
          shop_section_sort: l.inventory_item_id
            ? (sections.get(`${l.inventory_item_id}:${po.location_id}`)?.sort ?? null)
            : null,
        })),
    };
  });

  return {
    org: {
      name: org.name,
      billing: settings.billing ?? null,
      po_email: settings.po_email ?? null,
    },
    pos: result,
  };
}

type RawLine = {
  id: string;
  po_id: string;
  product_id: string | null;
  brand: string | null;
  description: string | null;
  package_desc: string | null;
  qty_ordered: number;
  unit_price: number | null;
  item_name: string | null;
  category: string | null;
  instructions: string | null;
  inventory_item_id: string | null;
};

async function fetchLines(
  supabase: SupabaseClient,
  poIds: string[]
): Promise<RawLine[]> {
  const out: RawLine[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("purchase_order_items")
      .select(
        `id, po_id, product_id, brand, description, package_desc,
         qty_ordered, unit_price,
         vendor_items ( id, notes, inventory_items ( id, name, category ) )`
      )
      .in("po_id", poIds)
      .range(from, from + 999);
    if (error) throw new Error(error.message);

    type Row = {
      id: string;
      po_id: string;
      product_id: string | null;
      brand: string | null;
      description: string | null;
      package_desc: string | null;
      qty_ordered: number;
      unit_price: number | null;
      vendor_items: {
        id: string;
        notes: string | null;
        inventory_items: { id: string; name: string; category: string | null } | null;
      } | null;
    };
    for (const row of (data ?? []) as unknown as Row[]) {
      out.push({
        id: row.id,
        po_id: row.po_id,
        product_id: row.product_id,
        brand: row.brand,
        description: row.description,
        package_desc: row.package_desc,
        qty_ordered: row.qty_ordered,
        unit_price: row.unit_price,
        item_name: row.vendor_items?.inventory_items?.name ?? null,
        category: row.vendor_items?.inventory_items?.category ?? null,
        instructions: row.vendor_items?.notes ?? null,
        inventory_item_id: row.vendor_items?.inventory_items?.id ?? null,
      });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function fetchSections(
  supabase: SupabaseClient,
  itemIds: string[],
  locationIds: string[]
): Promise<Map<string, { name: string; sort: number }>> {
  const map = new Map<string, { name: string; sort: number }>();
  // .in() lists go in the URL — chunk to keep it under sane length.
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data, error } = await supabase
      .from("inventory_item_locations")
      .select(
        `inventory_item_id, location_id,
         shop_sections ( display_name, sort_order )`
      )
      .in("inventory_item_id", itemIds.slice(i, i + 200))
      .in("location_id", locationIds);
    if (error) throw new Error(error.message);

    type Row = {
      inventory_item_id: string;
      location_id: string;
      shop_sections: { display_name: string; sort_order: number | null } | null;
    };
    for (const row of (data ?? []) as unknown as Row[]) {
      if (!row.shop_sections) continue;
      map.set(`${row.inventory_item_id}:${row.location_id}`, {
        name: row.shop_sections.display_name,
        sort: Number(row.shop_sections.sort_order ?? 0),
      });
    }
  }
  return map;
}

/** "N PRODUCTS / M QUANTITY" — §4.9's summary line. */
export function summaryLine(lines: DocLine[]): string {
  const qty = lines.reduce((sum, l) => sum + l.qty, 0);
  return `${lines.length} PRODUCTS / ${trimNumber(qty)} QUANTITY`;
}

export function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

export function formatAddress(a: Address | null | undefined): string[] {
  if (!a) return [];
  const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [a.street1, a.street2, cityLine, a.phone].filter(Boolean) as string[];
}

// ---------------------------------------------------------------------------
// The mail draft. mailto: can't attach a file, so processing an email PO is
// generate-PDF-then-open-draft: the PDF lands in Downloads, the draft opens in
// the mail app with everything but the attachment, the human drags the file in
// and edits the text before sending (Mark, 2026-07-23). Subject and body are
// templates from orgs.settings.po_email (design rule 2 — the fallbacks below
// are deliberately generic, no business identity in code).
// ---------------------------------------------------------------------------

const DEFAULT_SUBJECT = "Purchase Order {po_number}";
const DEFAULT_BODY =
  "Hello{rep_first_comma}\n\n" +
  "Please find attached purchase order {po_number} for {location_name}." +
  "{account_line}{delivery_line}\n\nThank you!";

export function fillTemplate(template: string, po: PoDocData): string {
  const repFirst = po.sales_rep?.trim().split(/\s+/)[0] ?? "";
  const vars: Record<string, string> = {
    po_number: po.po_number,
    vendor_name: po.vendor_name,
    location_name: po.location_name,
    location_code: po.location_code,
    order_date: po.order_date,
    delivery_date: po.delivery_date ?? "",
    account_number: po.account_number ?? "",
    rep_name: po.sales_rep ?? "",
    rep_first: repFirst,
    rep_first_comma: repFirst ? ` ${repFirst},` : ",",
    account_line: po.account_number ? `\nAccount #: ${po.account_number}` : "",
    delivery_line: po.delivery_date ? `\nDelivery: ${po.delivery_date}` : "",
  };
  return template.replace(/\{(\w+)\}/g, (m, key) => vars[key] ?? m);
}

export function buildMailto(po: PoDocData, org: OrgDocData): string {
  const params = new URLSearchParams();
  if (org.po_email?.cc) params.set("cc", org.po_email.cc);
  params.set("subject", fillTemplate(org.po_email?.subject ?? DEFAULT_SUBJECT, po));
  params.set("body", fillTemplate(org.po_email?.body ?? DEFAULT_BODY, po));
  // URLSearchParams encodes spaces as '+', which mail apps take literally.
  const query = params.toString().replace(/\+/g, "%20");
  return `mailto:${encodeURIComponent(po.rep_email ?? "")}?${query}`;
}

// ---------------------------------------------------------------------------
// Delivery date suggestion: the vendor's first delivery day strictly after the
// order date (§4.9 wants an explicit date on the document; delivery_days are
// already in vendor_locations).
// ---------------------------------------------------------------------------

export function nextDeliveryDate(
  orderDate: string,
  deliveryDays: number[] | null | undefined
): string | null {
  if (!deliveryDays || deliveryDays.length === 0) return null;
  const d = new Date(`${orderDate}T00:00:00Z`);
  for (let i = 1; i <= 7; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = ((d.getUTCDay() + 6) % 7) + 1; // JS Sunday=0 → ISO Mon=1
    if (deliveryDays.includes(iso)) return d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Open a Blob in a new tab, dodging the popup blocker: the window must be
 * opened SYNCHRONOUSLY in the click handler (while the user gesture is live),
 * then navigated once the blob exists. Call openWindowNow() first, do the
 * async work, then showBlob(). If the window was blocked anyway, falls back
 * to a download.
 */
export function openWindowNow(): Window | null {
  return window.open("", "_blank");
}

export function showBlob(win: Window | null, blob: Blob, fallbackName: string) {
  const url = URL.createObjectURL(blob);
  if (win) {
    win.location.href = url;
  } else {
    downloadBlob(blob, fallbackName);
  }
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Give the browser a beat to start the download before the URL dies.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
