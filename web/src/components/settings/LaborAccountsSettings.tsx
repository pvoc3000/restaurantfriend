"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { splitAccountName } from "@/lib/quickbooks";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { PickList } from "@/components/ui/PickList";
import { SMALL_BUTTON_CLASS } from "@/components/ui/buttons";

/**
 * WHICH QUICKBOOKS ACCOUNTS ARE LABOR (migration 205). The monthly labor split
 * moves every journal-entry line on these accounts between shops by hours, so
 * this list IS the definition of labor cost: the wage accounts, and employer
 * taxes and benefits if they should follow the hours too. Never a liability
 * or the bank — the picker offers expense accounts only.
 */

export type LaborAccountRow = { id: string; account_ref: string; account_name: string | null };

type Account = { id: string; name: string; classification: string; type: string };

export function LaborAccountsSettings({
  orgId,
  rows,
  editable,
  connected,
}: {
  orgId: string;
  rows: LaborAccountRow[];
  editable: boolean;
  connected: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void (async () => {
      const a = await invokeQbo(supabase, { mode: "accounts", classification: "Expense" });
      if (cancelled) return;
      if (a.message) setError(a.message);
      if (a.data?.accounts) setAccounts(a.data.accounts as Account[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, supabase]);

  // A PARENT ACCOUNT HOLDS NOTHING when its sub-accounts are where the money
  // is posted — and the split matches lines by exact account, so a chosen
  // parent quietly adds nothing (Mark chose "Employee Earnings" while Gusto
  // posts to "Regular Wages" under it, 2026-10-14). Only accounts with nothing
  // under them are offered, and a parent already chosen says so.
  const subAccounts = (name: string) => (accounts ?? []).filter((b) => b.name.startsWith(`${name}:`));
  const chosen = new Set(rows.map((r) => r.account_ref));
  const options = (accounts ?? [])
    .filter((a) => !chosen.has(a.id) && subAccounts(a.name).length === 0)
    .map((a) => {
      const { parent, leaf } = splitAccountName(a.name);
      return { value: a.id, label: leaf, group: parent ?? a.classification, hint: a.type };
    });

  async function add(ref: string) {
    const name = accounts?.find((a) => a.id === ref)?.name ?? null;
    setBusy(true);
    const { data, error: insErr } = await supabase
      .from("accounting_labor_accounts")
      .insert({ org_id: orgId, account_ref: ref, account_name: name })
      .select("id");
    setBusy(false);
    if (insErr) return setError(insErr.message);
    if (!data || data.length === 0) return setError("Not saved — only a manager or the owner can change the labor accounts.");
    setError(null);
    router.refresh();
  }

  async function remove(row: LaborAccountRow) {
    setBusy(true);
    const { data, error: delErr } = await supabase.from("accounting_labor_accounts").delete().eq("id", row.id).select("id");
    setBusy(false);
    if (delErr) return setError(delErr.message);
    if (!data || data.length === 0) return setError("Not removed — only a manager or the owner can change the labor accounts.");
    setError(null);
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <SectionHeading>Labor Accounts</SectionHeading>
      <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
        Labor by Shop splits everything Gusto posts to these accounts between the shops by the hours worked at
        each. Choose the wage accounts, and the payroll tax and benefit accounts if they should follow the hours
        too.
      </p>
      {error ? <p className="max-w-2xl text-[13px] text-accent">{error}</p> : null}
      {rows.length === 0 ? (
        <p className="text-[13px] text-accent">No labor accounts yet — Labor by Shop has nothing to split.</p>
      ) : (
        <ul className="max-w-xl divide-y divide-hairline border-y border-hairline text-[13px]">
          {rows
            .slice()
            .sort((a, b) => (a.account_name ?? a.account_ref).localeCompare(b.account_name ?? b.account_ref))
            .map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="flex flex-col">
                  <span>{r.account_name ?? r.account_ref}</span>
                  {(() => {
                    const subs = r.account_name ? subAccounts(r.account_name) : [];
                    return subs.length ? (
                      <span className="text-[12px] text-accent">
                        Has sub-accounts, so nothing is posted here. Choose the accounts under it instead:{" "}
                        {subs.map((b) => splitAccountName(b.name).leaf).join(", ")}.
                      </span>
                    ) : null;
                  })()}
                </span>
                {editable ? (
                  <button type="button" className={SMALL_BUTTON_CLASS} disabled={busy} onClick={() => void remove(r)}>
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
        </ul>
      )}
      {editable ? (
        <div className="max-w-xl">
          <PickList
            variant="field"
            value={null}
            options={options}
            onPick={(ref) => void add(ref)}
            placeholder={!connected ? "Connect QuickBooks first" : accounts ? "Add an account…" : "Reading QuickBooks…"}
            disabled={!connected || !accounts || busy}
            ariaLabel="Add a labor account"
          />
        </div>
      ) : null}
    </section>
  );
}
