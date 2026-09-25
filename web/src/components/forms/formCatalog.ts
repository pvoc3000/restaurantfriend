/**
 * Every printed document in the app, in the order /forms lists them — the
 * module that produces it, then the documents in the order that module's work
 * produces them. A plain module so the server page can check `?form=` against
 * it without loading any of the renderers.
 */
export const FORM_GROUPS = [
  {
    label: "Special orders",
    forms: [
      { key: "quote", label: "Quote" },
      { key: "signed-quote", label: "Signed quote" },
      { key: "kitchen-order", label: "Kitchen order" },
      { key: "invoice", label: "Invoice" },
      { key: "receipt", label: "Receipt" },
      { key: "customer-invoice-one", label: "Customer invoice · one order" },
      { key: "customer-invoice", label: "Customer invoice · weekly" },
      { key: "statement", label: "Statement" },
    ],
  },
  {
    label: "Purchasing",
    forms: [
      { key: "purchase-order", label: "Purchase order" },
      { key: "shopping-list", label: "Shopping list" },
      { key: "vendor-item-list", label: "Vendor item list" },
    ],
  },
  {
    label: "Production",
    forms: [
      { key: "production-packet", label: "Production packet" },
      { key: "recipe", label: "Recipe" },
    ],
  },
  {
    label: "Location",
    forms: [{ key: "checklist", label: "Checklist" }],
  },
  {
    label: "Tags",
    forms: [
      { key: "tags-2x3.5", label: "Tag sheet · 2 × 3.5" },
      { key: "tags-2x8", label: "Tag sheet · 2 × 8" },
      { key: "tags-2x10", label: "Tag sheet · 2 × 10" },
    ],
  },
] as const;

export type FormKey = (typeof FORM_GROUPS)[number]["forms"][number]["key"];

export const FORM_KEYS: FormKey[] = FORM_GROUPS.flatMap((g) => g.forms.map((f) => f.key));

export function formLabel(key: FormKey): string {
  for (const g of FORM_GROUPS) for (const f of g.forms) if (f.key === key) return f.label;
  return key;
}
