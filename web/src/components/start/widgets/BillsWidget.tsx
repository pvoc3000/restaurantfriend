import { billAttention, isOverdueBill, type StartBill } from "@/lib/startPage";

import { CARD_ITEMS, StartCard, type CardItem } from "../StartCard";
import { shortDate, type Result, type StartContext, type Supabase } from "./shared";

export async function BillsWidget(ctx: StartContext) {
  return <BillsCard result={await loadBills(ctx.supabase, ctx.shop.id)} today={ctx.today} />;
}

type BillRow = StartBill & {
  id: string;
  invoice_number: string | null;
  location_id: string | null;
  vendor: string | null;
};

async function loadBills(supabase: Supabase, loc: string): Promise<Result<BillRow[]>> {
  const rows: BillRow[] = [];
  for (let from = 0; ; from += 1000) {
    // Everything not void and not known to be paid — the only bills any of
    // the three counts can be about. A QuickBooks balance of zero is paid.
    const { data, error } = await supabase
      .from("vendor_bills")
      .select(
        `id, invoice_number, due_date, total, is_credit, status, external_ref,
         qbo_balance, qbo_checked_at, location_id, vendors ( name )`
      )
      .eq("location_id", loc)
      .neq("status", "void")
      .or("qbo_balance.is.null,qbo_balance.gt.0.005")
      .order("id")
      .range(from, from + 999);
    if (error) return { data: null, error: error.message };
    for (const r of data ?? []) {
      const raw = r as unknown as Record<string, unknown>;
      const ref = raw.external_ref as { qbo?: { id?: string } } | null;
      const vendor = raw.vendors as { name: string } | { name: string }[] | null;
      rows.push({
        id: raw.id as string,
        invoice_number: (raw.invoice_number as string | null) ?? null,
        location_id: (raw.location_id as string | null) ?? null,
        vendor: (Array.isArray(vendor) ? vendor[0]?.name : vendor?.name) ?? null,
        status: raw.status as StartBill["status"],
        due_date: (raw.due_date as string | null) ?? null,
        total: raw.total === null ? null : Number(raw.total),
        is_credit: Boolean(raw.is_credit),
        linked: Boolean(ref?.qbo?.id),
        qbo_balance: raw.qbo_balance === null ? null : Number(raw.qbo_balance),
        qbo_checked_at: (raw.qbo_checked_at as string | null) ?? null,
      });
    }
    if (!data || data.length < 1000) break;
  }
  return { data: rows, error: null };
}

function BillsCard({
  result,
  today,
}: {
  result: Result<BillRow[]>;
  today: string;
}) {
  if (result.data === null) return <StartCard lines={[]} error={result.error} />;
  const rows = result.data;
  const counts = billAttention(rows, today);

  // Overdue first, oldest due date first; then whatever is waiting on an
  // approval, oldest due date first.
  const overdue = rows
    .filter((r) => isOverdueBill(r, today))
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  const waiting = rows
    .filter((r) => r.status === "open" && !overdue.includes(r))
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const items: CardItem[] = [...overdue, ...waiting].slice(0, CARD_ITEMS).map((r) => ({
    primary: `${r.vendor ?? "Unknown vendor"} ${r.invoice_number ?? ""}`.trim(),
    secondary: `${overdue.includes(r) ? "Overdue" : "Due"} ${shortDate(r.due_date)}`,
    href: `/bills/${r.id}`,
  }));

  return (
    <StartCard
      lines={[
        { count: counts.overdue, label: "overdue", href: "/bills?status=all&aging=overdue&range=all" },
        { count: counts.awaitingApproval, label: "awaiting approval", href: "/bills?status=open&range=all" },
        {
          count: counts.notSent,
          label: "approved, not sent to QuickBooks",
          href: "/bills?status=approved&range=all",
        },
      ]}
      items={items}
    />
  );
}
