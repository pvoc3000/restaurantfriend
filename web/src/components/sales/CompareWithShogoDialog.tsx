"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS } from "@/components/ui/Dialog";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { formatCents } from "@/lib/tipPool";
import { addDays, daysBetween } from "@/lib/payPeriods";
import type { DateRange } from "@/lib/sales";
import {
  buildJournalEntry,
  diffAgainstShogo,
  isOurDocNumber,
  shopForEntryLines,
  type FlatJournalLine,
  type JournalLine,
  type ShogoDiffRow,
} from "@/lib/salesPosting";
import { readPostingContext, readBreakdowns, findJournalEntries, type JournalEntrySummary } from "./salesPostClient";
import type { ActionDay } from "./SalesActions";

/**
 * THE PARALLEL RUN. Shogo's entries for the same dates are read back out of
 * QuickBooks (`find_journal_entries`) and laid beside what this app WOULD
 * post, built from the stored breakdown — so it runs before anything has ever
 * been posted, and writes nothing. Shogo stays on until a week reads clean.
 *
 * Shogo's entries are everything in the window that is not one of ours
 * (`isOurDocNumber`), attributed to a shop by the class or location its lines
 * name. Its DocNumber format is DISCOVERED here rather than assumed: the first
 * few are shown.
 */

const MAX_DAYS = 31;

type DiffLine = ShogoDiffRow & { key: string; shop: string; date: string };

export function CompareWithShogoDialog({
  orgId,
  days,
  range,
  shopCodes,
  onClose,
}: {
  orgId: string;
  days: ActionDay[];
  range: DateRange;
  shopCodes: string[];
  onClose: () => void;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<DiffLine[] | null>(null);
  const [missing, setMissing] = useState<{ oursOnly: string[]; theirsOnly: string[] }>({ oursOnly: [], theirsOnly: [] });
  const [shogoDocs, setShogoDocs] = useState<string[]>([]);
  const [refused, setRefused] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // A month at most, from the END of the range: the recent days are the ones
  // being compared while Shogo is still running.
  const window: DateRange = useMemo(() => {
    const span = daysBetween(range.from, range.to);
    return span > MAX_DAYS ? { from: addDays(range.to, -(MAX_DAYS - 1)), to: range.to } : range;
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const inWindow = days.filter((d) => d.business_date >= window.from && d.business_date <= window.to);
      const ctx = await readPostingContext(supabase, orgId);
      if (ctx.schemaError) {
        if (!cancelled) setError(ctx.schemaError);
        return;
      }
      const { days: read, error: readErr } = await readBreakdowns(supabase, inWindow.map((d) => d.id));
      if (readErr) {
        if (!cancelled) setError(readErr);
        return;
      }
      const found = await findJournalEntries(supabase, window);
      if (cancelled) return;
      if (found.error) {
        setError(found.error);
        return;
      }

      // Ours, per shop-day, from dry builds.
      const ours = new Map<string, JournalLine[]>();
      const refusals: string[] = [];
      for (const r of read) {
        const day = inWindow.find((d) => d.id === r.id);
        const shop = day ? ctx.shops.get(day.location_id) : undefined;
        if (!day || !shop) continue;
        const b = buildJournalEntry({
          breakdown: r.breakdown,
          mappings: ctx.mappings,
          shop,
          businessDate: r.business_date,
          netSalesCents: r.netSalesCents,
          tipsCents: r.tipsCents,
          existing: null,
        });
        if (b.ok) ours.set(`${day.locationCode}|${r.business_date}`, b.lines);
        else refusals.push(`${day.locationCode} ${r.business_date}: ${b.refusals[0]}`);
      }

      // Theirs, per shop-day, from every entry that is not ours.
      const shops = [...ctx.shops.values()];
      const theirs = new Map<string, FlatJournalLine[]>();
      const docs = new Set<string>();
      for (const e of found.entries as JournalEntrySummary[]) {
        if (isOurDocNumber(e.doc_number, shopCodes)) continue;
        const flat: FlatJournalLine[] = e.lines.map((l) => ({
          entry_id: e.id,
          doc_number: e.doc_number,
          txn_date: e.txn_date,
          posting: l.posting === "Credit" ? "Credit" : "Debit",
          amount: l.amount,
          account_ref: l.account_ref,
          account_name: l.account_name,
          class_name: l.class_name,
          department_name: l.department_name,
          description: l.description,
        }));
        const shop = shopForEntryLines(flat, shops);
        if (!shop) continue;
        if (e.doc_number) docs.add(e.doc_number);
        const key = `${shop}|${e.txn_date}`;
        theirs.set(key, [...(theirs.get(key) ?? []), ...flat]);
      }

      const keys = new Set([...ours.keys(), ...theirs.keys()]);
      const out: DiffLine[] = [];
      const oursOnly: string[] = [];
      const theirsOnly: string[] = [];
      for (const key of [...keys].sort()) {
        const [shop, date] = key.split("|");
        const o = ours.get(key);
        const t = theirs.get(key);
        if (o && !t) oursOnly.push(`${shop} ${date}`);
        if (!o && t) theirsOnly.push(`${shop} ${date}`);
        for (const row of diffAgainstShogo(o ?? [], t ?? [])) {
          out.push({ ...row, key: `${key}|${row.account}`, shop, date });
        }
      }
      setRows(out);
      setMissing({ oursOnly, theirsOnly });
      setShogoDocs([...docs].slice(0, 5));
      setRefused(refusals);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, orgId, days, window, shopCodes]);

  const offCount = (rows ?? []).filter((r) => r.delta !== 0).length;

  return (
    <Dialog
      title="Compare with Shogo"
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <div className="flex justify-end">
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-[13px] text-muted">
          What this app would post for {window.from} – {window.to}, beside what is already on the
          books for those dates from any other source. Nothing is written. A credit reads positive,
          a debit negative.
        </p>
        {error ? <p className="text-accent">{error}</p> : null}
        {!rows && !error ? <ProgressBand label="Reading QuickBooks…" /> : null}

        {rows ? (
          <>
            <p className="text-[13px]">
              {offCount === 0 ? (
                <span>Every account agrees to the cent.</span>
              ) : (
                <span className="bg-mark-fill px-1">{offCount} account line{offCount === 1 ? "" : "s"} differ</span>
              )}
              {shogoDocs.length ? (
                <span className="text-muted"> · Shogo’s document numbers look like {shogoDocs.join(", ")}</span>
              ) : (
                <span className="text-muted"> · no entries from another source were found in this window</span>
              )}
            </p>
            {missing.theirsOnly.length ? (
              <p className="text-[13px] text-muted">Shogo has, we do not: {missing.theirsOnly.join(", ")}</p>
            ) : null}
            {missing.oursOnly.length ? (
              <p className="text-[13px] text-muted">We have, Shogo does not: {missing.oursOnly.join(", ")}</p>
            ) : null}
            {refused.length ? (
              <ul className="space-y-0.5 text-[13px] text-accent">
                {refused.map((r) => <li key={r}>{r}</li>)}
              </ul>
            ) : null}

            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b-2 border-ink text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <th className="py-1 pr-3">Shop</th>
                  <th className="py-1 pr-3">Date</th>
                  <th className="py-1 pr-3">Account</th>
                  <th className="py-1 pr-3 text-right">Ours</th>
                  <th className="py-1 pr-3 text-right">Shogo</th>
                  <th className="py-1 text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-hairline">
                    <td className="py-1 pr-3">{r.shop}</td>
                    <td className="py-1 pr-3 tabular-nums">{r.date}</td>
                    <td className="py-1 pr-3">{r.account}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatCents(r.ours)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatCents(r.theirs)}</td>
                    <td className={`py-1 text-right tabular-nums ${r.delta !== 0 ? "text-accent" : "text-faint"}`}>
                      {r.delta === 0 ? "—" : formatCents(r.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
