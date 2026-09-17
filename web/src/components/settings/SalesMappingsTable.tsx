"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { splitAccountName } from "@/lib/quickbooks";
import { InlineValue } from "@/components/catalog/InlineValue";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SALES_ROLES, SALES_ROLE_LABEL, type SalesRole, type AccountClassification } from "@/lib/salesPosting";

/**
 * WHERE EACH SQUARE NAME POSTS — one grid for the org (migration 104).
 *
 * Rows come from two places and read as one list: the fixed ROLES the entry
 * always needs (declared in `lib/salesPosting`, whether or not the table has
 * a row for them yet), then every CATEGORY and TENDER the sync has seen, which
 * `record_daily_sales` writes with no account the moment a new one arrives.
 * That is the answer to Shogo's silence: a name nobody has mapped is on this
 * screen with a picker beside it and an `unmapped` chip, and the receipt says
 * where it posted until somebody chooses.
 *
 * EVERY WRITE IS AN UPSERT on `(org_id, kind, square_key)` through `onWrite`,
 * because a role row does not exist until somebody picks an account for it
 * and `InlineValue`'s own update would then match nothing and report success.
 * The account NAME is written in the same statement — a snapshot, so renaming
 * an account in QuickBooks cannot rewrite what a row says it posts to.
 */

export type SalesMappingRow = {
  id: string | null;
  kind: "role" | "category" | "tender";
  square_key: string;
  square_name: string | null;
  account_ref: string | null;
  account_name: string | null;
  last_seen_at: string | null;
};

type Account = { id: string; name: string; classification: string; type: string };

const KIND_LABEL: Record<SalesMappingRow["kind"], string> = {
  role: "Role",
  category: "Category",
  tender: "Tender",
};

/** Which accounts a row is offered. A hint, not a gate: the picker narrows,
 *  and a shop that keeps its tips in an income account is still a shop. */
function classificationsFor(row: SalesMappingRow): AccountClassification[] {
  if (row.kind === "category") return ["Revenue"];
  if (row.kind === "tender") return ["Asset", "Liability"];
  const role = SALES_ROLES.find((r) => r.key === row.square_key);
  return role ? [role.classification] : ["Revenue", "Liability", "Asset", "Expense"];
}

export function SalesMappingsTable({
  orgId,
  rows,
  editable,
  connected,
}: {
  orgId: string;
  rows: SalesMappingRow[];
  editable: boolean;
  connected: boolean;
}) {
  const supabase = createClient();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ONE call, every classification, narrowed per row in the browser. Four
  // calls at once is the token-refresh race (2026-09-12).
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void (async () => {
      const a = await invokeQbo(supabase, { mode: "accounts", classification: "all" });
      if (cancelled) return;
      if (a.message) setError(a.message);
      if (a.data?.accounts) setAccounts(a.data.accounts as Account[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, supabase]);

  // The roles in their declared order, whether or not a row exists yet; then
  // what the sync has seen, unmapped first so the work is at the top.
  const tableRows: SalesMappingRow[] = useMemo(() => {
    const byKey = new Map(rows.map((r) => [`${r.kind}|${r.square_key}`, r]));
    const roles: SalesMappingRow[] = SALES_ROLES.map((r) =>
      byKey.get(`role|${r.key}`) ?? {
        id: null, kind: "role", square_key: r.key, square_name: null, account_ref: null, account_name: null, last_seen_at: null,
      }
    );
    const seen = rows
      .filter((r) => r.kind !== "role")
      .sort((a, b) => {
        if ((a.account_ref === null) !== (b.account_ref === null)) return a.account_ref === null ? -1 : 1;
        if (a.kind !== b.kind) return a.kind === "category" ? -1 : 1;
        return (a.square_name ?? a.square_key).localeCompare(b.square_name ?? b.square_key);
      });
    return [...roles, ...seen];
  }, [rows]);

  function write(row: SalesMappingRow) {
    return async (next: string | number | null) => {
      const ref = next === null || next === "" ? null : String(next);
      const name = ref ? accounts?.find((a) => a.id === ref)?.name ?? null : null;
      const { data, error: upErr } = await supabase
        .from("accounting_sales_mappings")
        .upsert(
          { org_id: orgId, kind: row.kind, square_key: row.square_key, square_name: row.square_name, account_ref: ref, account_name: name },
          { onConflict: "org_id,kind,square_key" }
        )
        .select("id");
      if (upErr) return { error: upErr.message };
      // Row count, not the absence of an error: below owner/admin the policy
      // matches nothing and PostgREST says nothing.
      if (!data || data.length === 0) return { error: "Not saved — only a manager or the owner can change where sales post." };
      // `InlineValue` refreshes the router itself after a successful `onWrite`.
      return { error: null };
    };
  }

  function placeholderFor(row: SalesMappingRow): string {
    if (!connected) return "Connect QuickBooks first";
    if (!accounts) return "Reading QuickBooks…";
    if (row.kind === "role") return "Choose an account";
    const role = row.kind === "category" ? "uncategorized_income" : "other_tender";
    return `→ ${SALES_ROLE_LABEL[role as SalesRole]}`;
  }

  const columns: DataColumn<SalesMappingRow>[] = [
    {
      key: "kind",
      label: "Kind",
      width: 90,
      sortValue: (r) => r.kind,
      render: (r) => <span className="text-muted">{KIND_LABEL[r.kind]}</span>,
    },
    {
      key: "name",
      label: "Square name",
      width: 260,
      pinned: true,
      sortValue: (r) => r.square_name ?? r.square_key,
      render: (r) =>
        r.kind === "role" ? (
          <span className="flex flex-col">
            <span>{SALES_ROLE_LABEL[r.square_key as SalesRole] ?? r.square_key}</span>
            <span className="text-[11px] text-muted">
              {SALES_ROLES.find((x) => x.key === r.square_key)?.hint}
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span>{r.square_name ?? r.square_key}</span>
            {r.account_ref === null ? (
              <span className="bg-mark-fill px-1 text-[11px]">unmapped</span>
            ) : null}
          </span>
        ),
    },
    {
      key: "account",
      label: "QuickBooks account",
      width: 320,
      sortValue: (r) => r.account_name ?? "",
      render: (r) => {
        const wanted = classificationsFor(r);
        const options = (accounts ?? [])
          .filter((a) => wanted.includes(a.classification as AccountClassification))
          .map((a) => {
            const { parent, leaf } = splitAccountName(a.name);
            return { value: a.id, label: leaf, group: parent ?? a.classification, hint: a.type };
          });
        return (
          <InlineValue
            readOnly={!editable || !connected}
            table="accounting_sales_mappings"
            id={r.id ?? undefined}
            column="account_ref"
            value={r.account_ref}
            kind="pick"
            clearable={r.kind !== "role"}
            placeholder={placeholderFor(r)}
            emptyClassName={r.kind === "role" ? "text-accent" : "text-muted"}
            ariaLabel={`QuickBooks account for ${r.square_name ?? r.square_key}`}
            options={options}
            onWrite={write(r)}
          />
        );
      },
    },
    {
      key: "seen",
      label: "Last seen",
      width: 120,
      hideWhenCompact: true,
      sortValue: (r) => r.last_seen_at ?? "",
      render: (r) => (
        <span className="text-muted tabular-nums">{r.last_seen_at ? r.last_seen_at.slice(0, 10) : "—"}</span>
      ),
    },
  ];

  const unmappedCount = rows.filter((r) => r.kind !== "role" && r.account_ref === null).length;
  const rolesMissing = SALES_ROLES.filter((r) => !rows.some((x) => x.kind === "role" && x.square_key === r.key && x.account_ref)).length;

  return (
    <section className="space-y-4">
      <SectionHeading>Sales from Square</SectionHeading>
      <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
        Each shop-day&rsquo;s Square sales post to QuickBooks as one journal entry, one line per
        category, tender and role below. A category or tender the sync has seen and nobody has
        mapped posts to its role&rsquo;s account and is named on the receipt until it is mapped.
        The shop&rsquo;s own class and location are set on each location&rsquo;s record.
      </p>
      {rolesMissing > 0 ? (
        <p className="max-w-2xl text-[13px] text-accent">
          {rolesMissing} role{rolesMissing === 1 ? " has" : "s have"} no account yet — a day that needs one is refused until it is set.
        </p>
      ) : null}
      {unmappedCount > 0 ? (
        <p className="max-w-2xl text-[13px]">
          <span className="bg-mark-fill px-1">{unmappedCount} Square name{unmappedCount === 1 ? "" : "s"} unmapped</span>
        </p>
      ) : null}
      {error ? <p className="max-w-2xl text-[13px] text-accent">{error}</p> : null}
      <DataTable
        rows={tableRows}
        columns={columns}
        rowKey={(r) => `${r.kind}|${r.square_key}`}
        storageKey="settings.salesMappings.v1"
        compactBelow={1024}
        empty={<span>Nothing to map yet — sync from Square first.</span>}
      />
    </section>
  );
}
