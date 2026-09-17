import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeQbo } from "@/lib/qboClient";
import type {
  FlatJournalLine,
  JournalBuild,
  PostingShop,
  SalesBreakdown,
  SalesMapping,
  SalesPostingRef,
} from "@/lib/salesPosting";

/**
 * POSTING A SHOP-DAY TO QUICKBOOKS, the client half — `qboBillPush.ts`'s shape.
 *
 * The rule (what the entry is, whether it balances, where an unmapped name
 * goes) is `lib/salesPosting` and stays pure; this reads what it needs, calls
 * `qbo-sync`, and reports in sentences. Client-side, not `lib/`, because it
 * takes the browser client.
 *
 * EVERY CALL INTO `qbo-sync` FROM HERE IS MADE ONE AFTER ANOTHER by its
 * callers. Four calls at once after an idle hour were four token refreshes at
 * once, and the losers marked a working connection disconnected (2026-09-12).
 */

export type PostingContext = {
  connected: boolean;
  /** Every location, keyed by id — the shop's class and location ride here. */
  shops: Map<string, PostingShop & { id: string }>;
  mappings: SalesMapping[];
  /** A missing column, which means migration 104 is not applied. */
  schemaError: string | null;
};

export async function readPostingContext(
  supabase: SupabaseClient,
  orgId: string
): Promise<PostingContext> {
  const [conn, locs, maps] = await Promise.all([
    supabase.rpc("accounting_connection_status", { p_org: orgId }),
    supabase
      .from("locations")
      .select("id, code, qbo_class_ref, qbo_class_name, qbo_location_ref, qbo_location_name"),
    supabase
      .from("accounting_sales_mappings")
      .select("kind, square_key, square_name, account_ref, account_name"),
  ]);
  const row = Array.isArray(conn.data) ? (conn.data[0] as { status?: string } | undefined) : undefined;
  const shops = new Map<string, PostingShop & { id: string }>();
  for (const l of (locs.data ?? []) as (PostingShop & { id: string })[]) shops.set(l.id, l);
  return {
    connected: row?.status === "connected",
    shops,
    mappings: ((maps.data ?? []) as SalesMapping[]),
    schemaError: locs.error?.message ?? maps.error?.message ?? null,
  };
}

/** A day as the builder wants it, read fresh — never from the list's rows,
 *  which deliberately do not carry the breakdown. */
export type DayForPosting = {
  id: string;
  location_id: string;
  business_date: string;
  netSalesCents: number;
  tipsCents: number;
  breakdown: SalesBreakdown | null;
  breakdown_hash: string | null;
  external_ref: SalesPostingRef | null;
  post_error: string | null;
};

export async function readBreakdowns(
  supabase: SupabaseClient,
  ids: readonly string[]
): Promise<{ days: DayForPosting[]; error: string | null }> {
  const days: DayForPosting[] = [];
  // Chunked: a `.in()` is a URL, and a quarter's worth of ids is how you find
  // its length limit.
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from("daily_sales")
      .select("id, location_id, business_date, net_sales_cents, tips_cents, breakdown, breakdown_hash, external_ref, post_error")
      .in("id", ids.slice(i, i + 100));
    if (error) return { days, error: error.message };
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      days.push({
        id: r.id as string,
        location_id: r.location_id as string,
        business_date: r.business_date as string,
        netSalesCents: Number(r.net_sales_cents),
        tipsCents: Number(r.tips_cents),
        breakdown: (r.breakdown as SalesBreakdown | null) ?? null,
        breakdown_hash: (r.breakdown_hash as string | null) ?? null,
        external_ref: (r.external_ref as SalesPostingRef | null) ?? null,
        post_error: (r.post_error as string | null) ?? null,
      });
    }
  }
  return { days, error: null };
}

export type DayPostResult =
  | { ok: true; skipped: boolean; label: string; updated: boolean; warnings: string[] }
  | { ok: false; message: string };

/** Send one built day. The server validates every claim in the body against
 *  the day it names and skips an unchanged one unless `force`. */
export async function postDay(
  supabase: SupabaseClient,
  day: Pick<DayForPosting, "id">,
  build: Extract<JournalBuild, { ok: true }>,
  force = false
): Promise<DayPostResult> {
  const { data, message } = await invokeQbo(supabase, {
    mode: "post_daily_sales",
    daily_sales_id: day.id,
    payload: build.body,
    journal_hash: build.hash,
    ...(force ? { force: true } : {}),
  });
  if (message) return { ok: false, message };
  if (data?.skipped) {
    return { ok: true, skipped: true, label: String(data.doc_number ?? data.qbo_id ?? ""), updated: false, warnings: [] };
  }
  return {
    ok: true,
    skipped: false,
    label: String((data?.doc_number as string) ?? (data?.qbo_id as string) ?? ""),
    updated: Boolean(data?.updated),
    warnings: (data?.warnings as string[]) ?? [],
  };
}

export type JournalEntrySummary = {
  id: string;
  sync_token: string;
  doc_number: string | null;
  txn_date: string;
  private_note: string | null;
  lines: Omit<FlatJournalLine, "entry_id" | "doc_number" | "txn_date">[];
};

export async function findJournalEntries(
  supabase: SupabaseClient,
  range: { from: string; to: string }
): Promise<{ entries: JournalEntrySummary[]; error: string | null }> {
  const { data, message } = await invokeQbo(supabase, { mode: "find_journal_entries", ...range });
  if (message) return { entries: [], error: message };
  return { entries: ((data?.entries as JournalEntrySummary[]) ?? []), error: null };
}
