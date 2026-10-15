"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { Checkbox } from "@/components/ui/Checkbox";
import { formatCents } from "@/lib/tipPool";
import { findJournalEntries } from "@/components/sales/salesPostClient";
import {
  buildLaborJournalEntry,
  expandLaborAccounts,
  lastDayOfMonth,
  monthLabel,
  percentText,
  poolFromEntries,
  sharesFromHours,
  type LaborBuild,
  type LaborEntry,
  type LaborPostingRef,
  type LaborShop,
  type QboAccount,
  type ShopShare,
} from "@/lib/laborAllocation";
import type { LaborMonthRow } from "./LaborAllocationList";

/**
 * THE RECEIPT FIRST, THEN THE POST — `PostToQuickBooksDialog`'s rule for one
 * month. Everything is read fresh and built in the browser
 * (`lib/laborAllocation`, pure): the month's hours per shop, every journal
 * entry QuickBooks holds for the month, and the entry that would move the
 * labor. `qbo-sync` checks it again before anything is sent.
 */

type Loaded = {
  build: LaborBuild;
  shares: ShopShare[];
  totalHours: number;
  stored: LaborPostingRef | null;
  connected: boolean;
  accountsChosen: number;
};

type Result = { ok: true; skipped: boolean; label: string; updated: boolean; warnings: string[] } | { ok: false; message: string };

export function LaborAllocationDialog({
  orgId,
  row,
  editable,
  onClose,
}: {
  orgId: string;
  row: LaborMonthRow;
  editable: boolean;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const month = row.month;
  const to = lastDayOfMonth(month);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [conn, locs, accts, hours, alloc, org] = await Promise.all([
        supabase.rpc("accounting_connection_status", { p_org: orgId }),
        supabase.from("locations").select("id, code, qbo_class_ref, qbo_class_name, qbo_location_ref, qbo_location_name"),
        supabase.from("accounting_labor_accounts").select("account_ref, account_name").eq("org_id", orgId),
        supabase.rpc("labor_hours_by_month", { p_org: orgId, p_from: month, p_to: to }),
        supabase.from("labor_allocations").select("external_ref").eq("org_id", orgId).eq("month", month).maybeSingle(),
        supabase.from("orgs").select("name").eq("id", orgId).maybeSingle(),
      ]);
      const err = locs.error ?? accts.error ?? hours.error ?? alloc.error;
      if (err) {
        if (!cancelled) setLoadError(err.message);
        return;
      }
      const status = Array.isArray(conn.data) ? (conn.data[0] as { status?: string } | undefined)?.status : undefined;
      const connected = status === "connected";
      const accounts = ((accts.data ?? []) as { account_ref: string; account_name: string | null }[]).map((a) => ({
        ref: a.account_ref,
        name: a.account_name,
      }));
      const shares = sharesFromHours(
        ((hours.data ?? []) as { location_id: string | null; hours: number }[]).map((h) => ({
          location_id: h.location_id,
          hours: Number(h.hours),
        })),
        (locs.data ?? []) as LaborShop[]
      );

      // QuickBooks last, and only when there is something to read it for.
      // One after the other, never at once: two calls together after an idle
      // hour are two token refreshes racing (2026-09-12).
      let entries: LaborEntry[] = [];
      let labor = accounts;
      if (connected && accounts.length > 0) {
        const listed = await invokeQbo(supabase, { mode: "accounts", classification: "Expense" });
        if (cancelled) return;
        if (listed.message) {
          setLoadError(listed.message);
          return;
        }
        labor = expandLaborAccounts(accounts, (listed.data?.accounts as QboAccount[] | undefined) ?? []);
        const found = await findJournalEntries(supabase, { from: month, to });
        if (cancelled) return;
        if (found.error) {
          setLoadError(found.error);
          return;
        }
        entries = found.entries as unknown as LaborEntry[];
      }
      const stored = ((alloc.data?.external_ref as LaborPostingRef | null) ?? null);
      const build = buildLaborJournalEntry({
        month,
        pool: poolFromEntries(entries, labor),
        shares,
        existing: stored,
        orgName: (org.data?.name as string | undefined) ?? "",
      });
      if (cancelled) return;
      setLoaded({
        build,
        shares: shares.ok ? shares.shares : [],
        totalHours: shares.ok ? shares.totalHours : 0,
        stored,
        connected,
        accountsChosen: accounts.length,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, orgId, month, to]);

  const build = loaded?.build ?? null;
  const unchanged = Boolean(build?.ok && loaded?.stored?.qbo?.id && loaded.stored.qbo.journal_hash === build.hash);
  const canPost = editable && Boolean(build?.ok && build.body) && (!unchanged || force) && !result;

  async function commit() {
    if (!build?.ok || !build.body) return;
    setBusy(true);
    const { data, message } = await invokeQbo(supabase, {
      mode: "post_labor_allocation",
      month,
      payload: build.body,
      journal_hash: build.hash,
      shares: build.snapshot,
      ...(force ? { force: true } : {}),
    });
    setBusy(false);
    if (message) setResult({ ok: false, message });
    else
      setResult({
        ok: true,
        skipped: Boolean(data?.skipped),
        label: String(data?.doc_number ?? data?.qbo_id ?? ""),
        updated: Boolean(data?.updated),
        warnings: (data?.warnings as string[]) ?? [],
      });
    router.refresh();
  }

  const shopIds = loaded?.shares.map((s) => s.shop.id) ?? [];
  const hasOther = Boolean(build?.ok && build.moves.some((m) => m.current.other));

  return (
    <Dialog
      title={`Labor by Shop · ${monthLabel(month)}`}
      onClose={onClose}
      width="max-w-5xl"
      busy={busy}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {editable && !result && unchanged ? (
            <Checkbox checked={force} onChange={setForce} className="mr-auto text-[13px]">
              Post again although nothing changed
            </Checkbox>
          ) : null}
          <button type="button" className={DIALOG_CANCEL_CLASS} disabled={busy} onClick={onClose}>
            {result ? "Done" : "Cancel"}
          </button>
          {editable && !result ? (
            <button type="button" className={DIALOG_COMMIT_CLASS} disabled={busy || !canPost} onClick={() => void commit()}>
              {busy ? "Posting…" : build?.ok && build.mode === "update" ? "Update in QuickBooks" : "Post to QuickBooks"}
            </button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5 text-sm">
        {loadError ? <p className="text-accent">{loadError}</p> : null}
        {!loaded && !loadError ? <ProgressBand label="Reading the month from QuickBooks…" /> : null}

        {loaded ? (
          <>
            {!loaded.connected ? <p className="text-accent">QuickBooks is not connected (Settings → Integrations → QuickBooks).</p> : null}
            {loaded.connected && loaded.accountsChosen === 0 ? (
              <p className="text-accent">No labor accounts are chosen yet. Choose them under Settings → Integrations → QuickBooks.</p>
            ) : null}
            {row.current ? (
              <p className="bg-mark-fill px-2 py-1 text-[13px]">This month is not over, so its hours and payrolls are not complete.</p>
            ) : null}

            {build && !build.ok ? (
              <ul className="space-y-1">
                {build.refusals.map((r, i) => (
                  <li key={i} className="text-accent">{r}</li>
                ))}
              </ul>
            ) : null}

            {loaded.shares.length > 0 ? (
              <section className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Hours worked</p>
                <table className="text-[13px]">
                  <tbody>
                    {loaded.shares.map((s) => (
                      <tr key={s.shop.id}>
                        <td className="py-0.5 pr-6">{s.shop.code}</td>
                        <td className="py-0.5 pr-6 text-right tabular-nums">{s.hours.toFixed(1)} h</td>
                        <td className="py-0.5 text-right tabular-nums">{percentText(s.share)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-hairline">
                      <td className="py-0.5 pr-6 text-muted">Total</td>
                      <td className="py-0.5 pr-6 text-right tabular-nums">{loaded.totalHours.toFixed(1)} h</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </section>
            ) : null}

            {build?.ok ? (
              <>
                <section className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Labor, now → by hours</p>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b-2 border-ink text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                        <th className="py-1 pr-3">Account</th>
                        {loaded.shares.map((s) => (
                          <th key={s.shop.id} className="py-1 pr-3 text-right">{s.shop.code}</th>
                        ))}
                        {hasOther ? <th className="py-1 pr-3 text-right">No shop</th> : null}
                        <th className="py-1 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {build.moves.map((m) => (
                        <tr key={m.accountRef} className="border-b border-hairline align-top">
                          <td className="py-1.5 pr-3">{m.accountName ?? m.accountRef}</td>
                          {shopIds.map((id) => (
                            <td key={id} className="py-1.5 pr-3 text-right tabular-nums">
                              <span className="text-muted">{formatCents(m.current[id] ?? 0)}</span> → {formatCents(m.target[id] ?? 0)}
                            </td>
                          ))}
                          {hasOther ? (
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              <span className="text-muted">{formatCents(m.current.other ?? 0)}</span> → {formatCents(0)}
                            </td>
                          ) : null}
                          <td className="py-1.5 text-right tabular-nums">{formatCents(m.totalCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                    Journal entry {build.docNumber} · {build.txnDate}
                  </p>
                  {build.lines.length > 0 ? (
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b-2 border-ink text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                          <th className="py-1 pr-3">Account</th>
                          <th className="py-1 pr-3">Class</th>
                          <th className="py-1 pr-3">Location</th>
                          <th className="py-1 pr-3 text-right">Debit</th>
                          <th className="py-1 text-right">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {build.lines.map((l, i) => (
                          <tr key={i} className="border-b border-hairline">
                            <td className="py-1 pr-3">{l.accountName ?? l.accountRef}</td>
                            <td className="py-1 pr-3">{l.className ?? <span className="text-faint">—</span>}</td>
                            <td className="py-1 pr-3">{l.departmentName ?? <span className="text-faint">—</span>}</td>
                            <td className="py-1 pr-3 text-right tabular-nums">{l.posting === "Debit" ? formatCents(l.cents) : ""}</td>
                            <td className="py-1 text-right tabular-nums">{l.posting === "Credit" ? formatCents(l.cents) : ""}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="py-1 pr-3 text-muted" colSpan={3}>Total</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{formatCents(build.debits)}</td>
                          <td className="py-1 text-right tabular-nums">{formatCents(build.debits)}</td>
                        </tr>
                      </tbody>
                    </table>
                  ) : null}
                  <ul className="space-y-0.5 text-[13px] text-muted">
                    {build.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    {unchanged && !result ? <li>Already in QuickBooks as {loaded.stored?.qbo?.doc_number ?? "posted"}, and nothing has changed.</li> : null}
                  </ul>
                </section>

                <p className="max-w-[80ch] text-[13px] text-muted">
                  Labor is every journal-entry line this month on the labor accounts — Gusto’s payrolls are dated by
                  check date, so a payroll paid early in a month counts in that month, while hours count on the day
                  they were worked. Each account nets to zero: total labor is unchanged, only the shop moves.
                </p>
              </>
            ) : null}

            {busy ? <ProgressBand label="Posting…" /> : null}
            {result ? (
              result.ok ? (
                <div className="space-y-1">
                  <p>
                    {result.skipped
                      ? `Unchanged — ${result.label} was already in QuickBooks.`
                      : `${result.updated ? "Updated" : "Posted"} ${result.label}.`}
                  </p>
                  {result.warnings.map((w, i) => (
                    <p key={i}>
                      <span className="bg-mark-fill px-1">{w}</span>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-accent">{result.message}</p>
              )
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
