// SAMPLE DATA FOR /forms — every printed document in the app, filled in with
// made-up rows so its LAYOUT can be worked on without hunting for a real
// record that happens to exercise every block (Mark, 2026-09-25).
//
// Nothing here is read from the database, and nothing here is anybody's real
// order. The one real thing is the ORG — its masthead, terms and billing
// address come from `orgs.settings` (design rule 2), passed in by the page, so
// the header on every sample is the one a customer or vendor actually sees.
//
// Each sample is shaped to SHOW the layout's optional blocks at once: the
// order has a discount, delivery, a rush fee, tax, a Misc line (which the
// kitchen sheet must drop), a line with no size (which it must keep), a
// payment, and notes on every document. A layout change that breaks one of
// those shows up here first.

import type { ChecklistPdfData } from "@/components/checklists/pdf/ChecklistPdf";
import type { VendorListData } from "@/components/catalog/pdf/VendorItemListPdf";
import type { RecipePdfData } from "@/components/production/pdf/RecipePdf";
import type { CustomerInvoiceDoc } from "@/components/specialOrders/pdf/SpecialOrderPdfs";
import type { TagPrint } from "@/components/tags/pdf/TagSheetPdf";
import type { OrgDocData, PoDocData } from "@/lib/poProcessing";
import type { PacketData, PacketSchedule } from "@/lib/productionPacket";
import type { ScheduleLine } from "@/lib/productionSchedule";
import type { DocumentLine, OrderDocData, StatementData } from "@/lib/specialOrderDocs";
import { orderTotals, type MoneyOrder } from "@/lib/specialOrders";

/* -------------------------------------------------------------------------- */
/* Special orders                                                             */
/* -------------------------------------------------------------------------- */

function line(
  n: number,
  name: string,
  qty: number,
  unit_price: number,
  taxonomy: Partial<Pick<DocumentLine, "item_donut" | "item_type" | "item_cut" | "item_finish" | "item_size">>,
  notes: string | null = null,
  taxable = true
): DocumentLine {
  return {
    id: `line-${n}`,
    sort: n,
    name,
    item_donut: null,
    item_type: null,
    item_cut: null,
    item_finish: null,
    item_size: null,
    ...taxonomy,
    notes,
    qty,
    unit_price,
    taxable,
  };
}

const SAMPLE_LINES: DocumentLine[] = [
  line(1, "Glazed", 24, 2.75, { item_donut: "Glazed", item_type: "Raised", item_finish: "Glazed", item_size: "Regular" }),
  line(2, "Chocolate Sprinkle", 24, 3.25, { item_donut: "Chocolate", item_type: "Raised", item_finish: "Sprinkles", item_size: "Regular" }),
  line(3, "Promise Ring - Glazed - Letter", 12, 4.5, { item_donut: "Promise Ring", item_type: "Raised", item_cut: "Letter", item_finish: "Glazed", item_size: "Regular" }, "Spell H-A-P-P-Y B-D-A-Y, then two hearts"),
  line(4, "Maple Bacon", 12, 4.25, { item_donut: "Maple", item_type: "Raised", item_finish: "Bacon", item_size: "Regular" }),
  line(5, "Mini Old Fashioned", 48, 1.5, { item_donut: "Old Fashioned", item_type: "Cake", item_size: "Mini" }, "Half vanilla glaze, half chocolate"),
  line(6, "Mini Jelly", 36, 1.75, { item_donut: "Jelly", item_type: "Raised", item_finish: "Powdered", item_size: "Mini" }),
  line(7, "Giant Birthday Donut", 1, 45, { item_donut: "Birthday", item_type: "Raised", item_finish: "Sprinkles", item_size: "Giant" }, "“Happy 40th, Dana!” in white script"),
  line(8, "Vegan Cinnamon Sugar", 12, 3.5, { item_donut: "Cinnamon Sugar", item_type: "Vegan" }, "No size recorded — should still print on the kitchen sheet"),
  line(9, "Window Box Upgrade", 12, 2, { item_type: "Misc" }, "Misc — kept off the kitchen sheet", false),
];

const SAMPLE_MONEY: MoneyOrder = {
  tax_rate: 0.1025,
  discount_amount: null,
  discount_rate: 0.1,
  delivery_charge: 35,
  rush_fee: null,
  rush_rate: 0.1,
};

function sampleOrder(paid: number, paymentNote = "Deposit"): OrderDocData {
  const payments = paid
    ? [{ amount: paid, paid_on: "2026-09-20", payment_type: "Card", note: paymentNote }]
    : [];
  return {
    id: "sample-order",
    org_id: "",
    number: "10123",
    kind: "order",
    status: "quote",
    title: "Dana’s 40th birthday",
    event_date: "2026-10-03",
    event_time: "09:30",
    ready_by_time: "09:00",
    fulfillment: "delivery",
    allergen_info: "One guest has a tree-nut allergy — keep the vegan dozen boxed separately.",
    taken_by: "Sam",
    taken_by_name: "Sam",
    date_initiated: "2026-09-18",
    contact_name: "Jordan Reyes",
    contact_phone: "(323) 555-0147",
    contact_email: "jordan.reyes@example.com",
    delivery_address: "1234 Sunset Blvd, Suite 5, Los Angeles CA 90026",
    delivery_tracking: null,
    delivery_boxes: 12,
    delivery_company: "Sample Courier",
    delivery_company_phone: "(213) 555-0199",
    delivery_window_start: "08:45",
    delivery_window_end: "09:15",
    customer: {
      first_name: "Dana",
      last_name: "Whitfield",
      company: "Example Studios",
      phone: "(323) 555-0101",
      email: "dana@example.com",
    },
    location_code: "DF01",
    location_name: "Highland Park",
    kitchen_code: "DF01",
    notes_quote: "Quote is good for 14 days. A 50% deposit holds the date.",
    notes_production: "Box the minis 24 to a box.",
    notes_invoice: "Thank you! Balance due on delivery.",
    notes_receipt: "Paid in full — thank you!",
    lines: SAMPLE_LINES,
    payments,
    money: SAMPLE_MONEY,
    totals: orderTotals(SAMPLE_MONEY, SAMPLE_LINES, payments),
  };
}

/** The quote and the kitchen sheet: nothing paid yet. */
export const sampleQuoteOrder = sampleOrder(0);
/** The invoice: a deposit taken, a balance left. */
export const sampleInvoiceOrder = sampleOrder(200);
/** The receipt: paid in full. */
export const sampleReceiptOrder = sampleOrder(sampleQuoteOrder.totals.total, "Paid in full");

export const sampleApproval = {
  name: "Dana Whitfield",
  at: "2026-09-19T17:42:00-07:00",
  reference: "Q-7F3K2",
};

export const sampleStatement: StatementData = {
  customer: {
    first_name: "Ji-Yeon",
    last_name: "Kim",
    company: "Sample Cafe",
    phone: "(818) 555-0133",
    email: "orders@samplecafe.example",
  },
  from: "2026-09-14",
  to: "2026-09-20",
  orders: [14, 15, 16, 17, 18, 19, 20].map((d, i) => {
    const total = 96 + (i % 3) * 12 + 25;
    return {
      id: `stmt-${d}`,
      number: String(10090 + i),
      event_date: `2026-09-${d}`,
      title: "Weekly wholesale",
      totals: {
        subtotal: total - 25,
        taxableSubtotal: 0,
        discount: 0,
        deliveryCharge: 25,
        rushFee: 0,
        tax: 0,
        total,
        paid: i < 2 ? total : 0,
        balance: i < 2 ? 0 : total,
      },
    };
  }),
  total: 0,
  paid: 0,
  balance: 0,
};
sampleStatement.total = sampleStatement.orders.reduce((a, o) => a + o.totals.total, 0);
sampleStatement.paid = sampleStatement.orders.reduce((a, o) => a + o.totals.paid, 0);
sampleStatement.balance = sampleStatement.total - sampleStatement.paid;

/** A multi-order invoice: one row per order, the wholesale week. */
export const sampleCustomerInvoice: CustomerInvoiceDoc = {
  number: "INV-1042",
  issued_on: "2026-09-20",
  due_on: "2026-09-24",
  notes: "Due Thursday. Pay online with the link in the email, or by ACH.",
  customer: { name: "Sample Cafe", phone: "(818) 555-0133", email: "orders@samplecafe.example" },
  lines: sampleStatement.orders.map((o) => ({
    description: `Order #${o.number} · Sample Cafe · ${o.event_date!.slice(5).replace("-", "/")}/2026`,
    amount: o.totals.total,
  })),
  total: sampleStatement.total,
  paid: 0,
  balance: sampleStatement.total,
};

/** A one-order invoice, which prints itemized. */
export const sampleItemizedInvoice: CustomerInvoiceDoc = (() => {
  const o = sampleInvoiceOrder;
  const t = o.totals;
  const rows = [
    ...o.lines
      .filter((l) => l.qty * l.unit_price !== 0)
      .map((l) => ({ label: `${l.qty} × ${l.name}`, amount: l.qty * l.unit_price })),
    { label: "Discount (10%)", amount: -t.discount },
    { label: "Delivery", amount: t.deliveryCharge },
    { label: "Rush", amount: t.rushFee },
    { label: "Sales tax", amount: t.tax },
    { label: "Deposit paid 9/20/2026", amount: -t.paid },
  ];
  return {
    number: "INV-1043",
    issued_on: "2026-09-25",
    due_on: "2026-10-03",
    notes: o.notes_invoice,
    customer: { name: "Example Studios (Dana Whitfield)", phone: "(323) 555-0101", email: "dana@example.com" },
    lines: [{ description: `Order #${o.number} · Example Studios · 10/3/2026`, amount: t.balance, detail: { rows } }],
    total: t.total,
    paid: t.paid,
    balance: t.balance,
  };
})();

/* -------------------------------------------------------------------------- */
/* Purchasing                                                                 */
/* -------------------------------------------------------------------------- */

function poLine(
  n: number,
  description: string,
  brand: string | null,
  pack: string,
  pack_type: string,
  qty: number,
  unit_price: number,
  category: string,
  section: string,
  sectionSort: number,
  notes: string | null = null
) {
  return {
    id: `po-line-${n}`,
    product_id: String(100200 + n * 37),
    brand,
    description,
    pack,
    pack_type,
    qty,
    unit_price,
    item_name: description,
    category,
    notes,
    shop_section: section,
    shop_section_sort: sectionSort,
  };
}

export const samplePo: PoDocData = {
  id: "sample-po",
  po_number: "260925-DF01-07",
  status: "draft",
  order_date: "2026-09-25",
  delivery_date: "2026-09-29",
  notes: "Deliver to the back door before 10am, please.",
  vendor_id: "sample-vendor",
  vendor_name: "Sample Foodservice",
  order_type: "email_po",
  vendor_url: null,
  vendor_notes: "1pm cutoff",
  location_id: "sample-location",
  location_code: "DF01",
  location_name: "Highland Park",
  ship_to: { street1: "5000 York Blvd", city: "Los Angeles", state: "CA", zip: "90042", phone: "(323) 555-0100" },
  account_number: "SAMPLE-4471",
  rep_email: "rep@example.com",
  sales_rep: "Pat",
  lines: [
    poLine(1, "Flour, Bread, Unbleached", "Sample Mills", "50 lb", "BAG", 12, 24.5, "Dry goods", "Storage - R1 S1", 10),
    poLine(2, "Sugar, Granulated, Cane", "Sample Sugar", "50 lb", "BAG", 4, 38.9, "Dry goods", "Storage - R1 S1", 10),
    poLine(3, "Sugar, Powdered 10X", "Sample Sugar", "12 × 2 lb", "CS", 2, 31.2, "Dry goods", "Storage - R1 S2", 11),
    poLine(4, "Yeast, Instant Dry", "Sample Yeast", "20 × 1 lb", "CS", 1, 64, "Dry goods", "Storage - R1 S2", 11, "Red label only"),
    poLine(5, "Milk, Whole", null, "4 × 1 gal", "CS", 3, 18.75, "Dairy", "Walk-in", 30),
    poLine(6, "Butter, Unsalted AA", "Sample Creamery", "36 × 1 lb", "CS", 1, 142.8, "Dairy", "Walk-in", 30),
    poLine(7, "Eggs, Large, Grade AA, Loose", null, "15 dz", "CS", 2, 52.5, "Dairy", "Walk-in", 30),
    poLine(8, "Oil, Frying, Soybean", "Sample Oils", "35 lb", "JIB", 6, 41.25, "Oils", "Fry station", 40),
    poLine(9, "Cups, Hot, 12 oz, Printed", "Sample Paper", "1000 ct", "CS", 1, 88, "Paper", "Storage - R2 S1", 20),
    poLine(10, "Napkins, Dinner, Kraft", "Sample Paper", "3000 ct", "CS", 1, 46.4, "Paper", "Storage - R2 S1", 20),
  ],
};

/** The in-person shopping list reads the same PO shape. */
export const sampleShoppingPo: PoDocData = {
  ...samplePo,
  id: "sample-po-shopping",
  po_number: "260925-DF01-08",
  vendor_name: "Sample Cash & Carry",
  order_type: "in_person",
  notes: null,
};

export function poOrgFrom(name: string, settings: Record<string, unknown>): OrgDocData {
  return {
    name,
    billing: (settings.billing as OrgDocData["billing"]) ?? null,
    po_email: (settings.po_email as OrgDocData["po_email"]) ?? null,
  };
}

export function sampleVendorList(orgName: string): VendorListData {
  const row = (item: string, brand: string | null, description: string, pack: string, price: number, unitPrice: number, baseUnit: string) => ({
    item,
    productId: String(300000 + item.length * 97),
    brand,
    description,
    pack,
    price,
    unitPrice,
    baseUnit,
  });
  const groups = [
    {
      type: "Dry goods",
      rows: [
        row("Bread flour", "Sample Mills", "Flour, Bread, Unbleached", "50 lb", 24.5, 0.49, "lb"),
        row("Cane sugar", "Sample Sugar", "Sugar, Granulated, Cane", "50 lb", 38.9, 0.78, "lb"),
        row("Powdered sugar", "Sample Sugar", "Sugar, Powdered 10X", "12 × 2 lb", 31.2, 1.3, "lb"),
      ],
    },
    {
      type: "Dairy",
      rows: [
        row("Whole milk", null, "Milk, Whole", "4 × 1 gal", 18.75, 4.69, "gal"),
        row("Butter", "Sample Creamery", "Butter, Unsalted AA", "36 × 1 lb", 142.8, 3.97, "lb"),
      ],
    },
    {
      type: "Paper",
      rows: [row("12 oz hot cup", "Sample Paper", "Cups, Hot, 12 oz, Printed", "1000 ct", 88, 0.09, "each")],
    },
  ];
  return {
    orgName,
    vendorName: "Sample Foodservice",
    locationCode: "DF01",
    dateLabel: "9/25/2026",
    groups,
    itemCount: groups.reduce((a, g) => a + g.rows.length, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Production                                                                 */
/* -------------------------------------------------------------------------- */

export function sampleRecipe(orgName: string): RecipePdfData {
  const l = (sort: number, name: string, qty: number, unit: string, hidden = false) => ({
    name,
    qty,
    unit,
    scaleAuto: true,
    scaleAmounts: null,
    scaleUnits: null,
    hidden,
    sort,
  });
  return {
    orgName,
    recipeName: "Raised Dough",
    versionLabel: "3",
    createdAt: "2025-03-14",
    author: "Sam",
    info: "The base dough for every raised donut. Mix cold; proof warm.",
    shelfLife: "Use within 18 hours",
    storage: "Walk-in, covered",
    tools: "60 qt mixer, dough hook, bench scraper",
    scaleLabels: ["Half", "Full", "Double"],
    scaleMultipliers: [0.5, 1, 2],
    lines: [
      l(1, "Bread flour", 25, "lb"),
      l(2, "Cane sugar", 3, "lb"),
      l(3, "Salt", 8, "oz"),
      l(4, "Instant yeast", 6, "oz"),
      l(10, "Whole milk", 1.5, "gal"),
      l(11, "Water", 1, "gal"),
      l(12, "Eggs", 18, "each"),
      l(20, "Butter, softened", 3, "lb"),
    ],
    steps: [
      { body: "Combine flour, sugar, salt and yeast in the mixer bowl. Mix on low for 1 minute.", imageUrl: null },
      { body: "Add milk, water and eggs. Mix on low until no dry flour remains, about 3 minutes.", imageUrl: null },
      { body: "Add butter a piece at a time on medium. Mix until the dough passes the window-pane test, 8–10 minutes.", imageUrl: null },
      { body: "Rest covered 20 minutes, then divide and sheet.", imageUrl: null },
    ],
    printedOn: "2026-09-25",
  };
}

function schedLine(
  n: number,
  item_name: string,
  item_type: string,
  finish: string | null,
  size: string,
  par: number,
  tray_number: string | null
): ScheduleLine {
  return {
    id: `sched-${n}`,
    item_id: `item-${n}`,
    item_name,
    item_type,
    subtype: null,
    finish,
    size,
    tally_box_size: 12,
    tray_capacity: size === "Mini" ? 48 : 24,
    tray_number,
    par,
    made: null,
    leftover: null,
  };
}

export function samplePacket(orgName: string): PacketData {
  const lines = [
    schedLine(1, "Glazed", "Raised", "Glazed", "Regular", 120, "1"),
    schedLine(2, "Chocolate Sprinkle", "Raised", "Sprinkles", "Regular", 60, "2"),
    schedLine(3, "Maple Bacon", "Raised", "Bacon", "Regular", 36, "3"),
    schedLine(4, "Old Fashioned", "Cake", null, "Regular", 48, "4"),
    schedLine(5, "Blueberry Cake", "Cake", "Glazed", "Regular", 36, "5"),
    schedLine(6, "Apple Fritter", "Fritter", "Glazed", "Regular", 24, "6"),
    schedLine(7, "Mini Glazed", "Raised", "Glazed", "Mini", 96, "7"),
  ];
  const schedule: PacketSchedule = {
    id: "sample-schedule",
    date: "2026-09-26",
    sellsCode: "DF01",
    kitchenCode: "DF01",
    source: "plan",
    title: null,
    generatedAt: "2026-09-25T14:00:00-07:00",
    generatedByName: "Sam",
    printedAt: null,
    note: "Saturday — expect a rush after 10.",
    lines,
  };
  const element = (id: string, name: string, shift: string, amount: number, unit: string, sort: number) => ({
    id,
    name,
    elementType: "Filling",
    shift,
    batchLabel: "Full",
    sort,
    amount,
    unit,
    stock: "2 × 1 qt",
    note: null,
    isExcluded: false,
  });
  return {
    orgName,
    printedOn: "2026-09-25",
    schedules: [schedule],
    companions: [],
    kitchens: [
      {
        key: "2026-09-26|DF01",
        date: "2026-09-26",
        kitchenCode: "DF01",
        shopCodes: ["DF01"],
        lines,
        demand: [
          { elementId: "e1", name: "Raised Dough", batches: 2, quantity: 70, unit: "lb", unresolved: [] },
          { elementId: "e2", name: "Cake Batter", batches: 1, quantity: 30, unit: "lb", unresolved: [] },
          { elementId: "e3", name: "Vanilla Glaze", batches: null, quantity: 12, unit: "qt", unresolved: [] },
        ],
        ab: [element("e4", "Lemon Curd", "AM", 2, "qt", 1), element("e5", "Raspberry Jam", "PM", 3, "qt", 2)],
        weekly: [element("e6", "Maple Glaze Base", "AM", 1, "gal", 1)],
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Location                                                                   */
/* -------------------------------------------------------------------------- */

export function sampleChecklist(orgName: string): ChecklistPdfData {
  const item = (
    status: ChecklistPdfData["items"][number]["status"],
    sectionName: string,
    prompt: string,
    extra: Partial<ChecklistPdfData["items"][number]> = {}
  ) => ({
    status,
    prompt,
    sectionName,
    guidance: null,
    position: null,
    equipmentName: null,
    note: null,
    valueText: null,
    valueNumber: null,
    unit: null,
    expected: null,
    score: null,
    ...extra,
  });
  return {
    orgName,
    kindLabel: "Opening checklist",
    title: "Morning open",
    locationCode: "DF01",
    businessDate: "2026-09-25",
    shiftLabel: "AM",
    status: "submitted",
    walkedBy: "Sam",
    submittedAt: "2026-09-25",
    printedOn: "2026-09-25",
    items: [
      item("done", "Front of house", "Lights and music on"),
      item("done", "Front of house", "Case glass wiped, inside and out"),
      item("issue", "Front of house", "Register drawer counted", { note: "Short $2.15 against last night’s close", valueText: "$197.85", expected: "$200.00" }),
      item("done", "Kitchen", "Walk-in temperature", { equipmentName: "Walk-in cooler", valueNumber: 37, unit: "°F", expected: "≤ 41" }),
      item("done", "Kitchen", "Fryer oil checked", { equipmentName: "Fryer 1", guidance: "Replace if dark or foaming" }),
      item("na", "Kitchen", "Ice machine descaled", { note: "Monthly — not due" }),
      item("pending", "Kitchen", "Sanitizer bucket at 200 ppm"),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                       */
/* -------------------------------------------------------------------------- */

/** Tag art is an uploaded image; the sample uses the app's own icon, which
 *  the renderer fetches from this origin. */
export function sampleTags(origin: string): TagPrint[] {
  const url = `${origin}/icon-512.png`;
  return [
    { url, price: "$3.25", title: "Glazed" },
    { url, price: "$3.75", title: "Chocolate Sprinkle" },
    { url, price: "$4.50", title: "Maple Bacon" },
    { url, price: "$4.25", title: "Apple Fritter" },
  ];
}
