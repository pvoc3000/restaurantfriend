"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { Checkbox } from "@/components/ui/Checkbox";
import { formatCents } from "@/lib/tipPool";
import { buildJournalEntry, buildDeposit, type DepositBuild, type JournalBuild, type SquarePayout } from "@/lib/salesPosting";
import { readPostingContext, readBreakdowns, readPayouts, postDay, postPayout, type DayForPosting } from "./salesPostClient";
import type { ActionDay, ActionPayout } from "./SalesActions";

/**
 * THE RECEIPT FIRST, THEN THE POST. Every day in range is BUILT in the browser
 * (`lib/salesPosting`, the pure rule) and laid out before anything is sent:
 * what would be created or updated, what would be skipped because nothing
 * changed, what is refused and why, and — the line this whole feature exists
 * for — which Square names posted to a default because nobody has mapped them.
 * `Post n entries` then sends ONE AFTER ANOTHER, because every call into
 * `qbo-sync` shares a token and four at once was the refresh race.
 */

type Planned = {
  day: ActionDay;
  read: DayForPosting | null;
  build: JournalBuild | null;
  /** Decided here from the stored hashes so the receipt can say "skip" before
   *  the server does; the server decides for real. */
  action: "create" | "update" | "skip" | "refused";
  result?: { ok: true; skipped: boolean; label: string; updated: boolean; warnings: string[] } | { ok: false; message: string };
};

/**
 * THE DEPOSITS COME AFTER THE DAYS (105). One Bank Deposit per Square payout,
 * for the payout's exact amount, so the bank feed matches it rather than
 * adding its own. Built from the rows read fresh — a payout's sync token is
 * the one thing a stale list row would get wrong — and sent one after
 * another once every day has gone.
 */
type PlannedDeposit = {
  payout: ActionPayout;
  read: SquarePayout | null;
  build: DepositBuild | null;
  action: "create" | "update" | "skip" | "refused";
  result?: Planned["result"];
};

export function PostToQuickBooksDialog({
  orgId,
  days,
  payouts,
  onClose,
}: {
  orgId: string;
  days: ActionDay[];
  payouts: ActionPayout[];
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [planned, setPlanned] = useState<Planned[] | null>(null);
  const [plannedDeposits, setPlannedDeposits] = useState<PlannedDeposit[] | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ctx = await readPostingContext(supabase, orgId);
      if (ctx.schemaError) {
        if (!cancelled) setLoadError(ctx.schemaError);
        return;
      }
      const { days: read, error } = await readBreakdowns(supabase, days.map((d) => d.id));
      if (cancelled) return;
      if (error) {
        setLoadError(error);
        return;
      }
      const byId = new Map(read.map((r) => [r.id, r]));
      const out: Planned[] = days
        .slice()
        .sort((a, b) => a.business_date.localeCompare(b.business_date) || a.locationCode.localeCompare(b.locationCode))
        .map((day) => {
          const r = byId.get(day.id) ?? null;
          const shop = ctx.shops.get(day.location_id);
          if (!r || !shop) return { day, read: r, build: null, action: "refused" as const };
          const build = buildJournalEntry({
            breakdown: r.breakdown,
            mappings: ctx.mappings,
            shop,
            businessDate: r.business_date,
            netSalesCents: r.netSalesCents,
            tipsCents: r.tipsCents,
            existing: r.external_ref,
            orgName: ctx.orgName,
          });
          if (!build.ok) return { day, read: r, build, action: "refused" as const };
          const stored = r.external_ref?.qbo;
          const unchanged =
            Boolean(stored?.id) &&
            stored?.journal_hash === build.hash &&
            stored?.breakdown_hash === r.breakdown_hash;
          return { day, read: r, build, action: unchanged ? ("skip" as const) : build.mode };
        });
      setPlanned(out);

      // The deposits, read fresh by id. A missing table (105 pending) is a
      // sentence on this half, never a reason to hold the days back.
      const dep = await readPayouts(supabase, payouts.map((p) => p.id));
      if (cancelled) return;
      if (dep.error) {
        setDepositError(/square_payouts/.test(dep.error) ? "Deposits need migration 105, which has not been applied yet." : dep.error);
        setPlannedDeposits([]);
        return;
      }
      const depById = new Map(dep.payouts.map((p) => [p.id, p]));
      setPlannedDeposits(
        payouts
          .slice()
          .sort((a, b) => a.arrival_date.localeCompare(b.arrival_date) || a.locationCode.localeCompare(b.locationCode))
          .map((payout) => {
            const r = depById.get(payout.id) ?? null;
            const shop = ctx.shops.get(payout.location_id);
            if (!r || !shop) return { payout, read: r, build: null, action: "refused" as const };
            const build = buildDeposit({ payout: r, mappings: ctx.mappings, shop, orgName: ctx.orgName });
            if (!build.ok) return { payout, read: r, build, action: "refused" as const };
            const stored = r.external_ref?.qbo;
            const unchanged =
              Boolean(stored?.id) &&
              stored?.deposit_hash === build.hash &&
              stored?.amount_cents === r.amount_cents &&
              stored?.arrival_date === r.arrival_date;
            return { payout, read: r, build, action: unchanged ? ("skip" as const) : build.mode };
          })
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, orgId, days, payouts]);

  const toSend = (planned ?? []).filter((p) => p.build?.ok && (force ? p.action !== "refused" : p.action === "create" || p.action === "update"));
  const depositsToSend = (plannedDeposits ?? []).filter((p) => p.build?.ok && (force ? p.action !== "refused" : p.action === "create" || p.action === "update"));
  const refusedCount = (planned ?? []).filter((p) => p.action === "refused").length;
  const depositsRefused = (plannedDeposits ?? []).filter((p) => p.action === "refused").length;
  const sendCount = toSend.length + depositsToSend.length;
  const unmappedAll = new Map<string, { name: string; kind: string; role: string }>();
  for (const p of planned ?? []) {
    if (p.build?.ok) for (const u of p.build.unmapped) unmappedAll.set(`${u.kind}|${u.key}`, { name: u.name, kind: u.kind, role: u.role });
  }

  async function commit() {
    if (!planned) return;
    setBusy("Posting…");
    const next = [...planned];
    for (const [i, p] of next.entries()) {
      if (!toSend.includes(p) || !p.build?.ok || !p.read) continue;
      setBusy(`Posting ${p.day.locationCode} ${p.day.business_date} (${toSend.indexOf(p) + 1} of ${toSend.length})`);
      const result = await postDay(supabase, p.read, p.build, force);
      next[i] = { ...p, result };
      setPlanned([...next]);
      // A failure stops the run: the rest are unchanged and can be sent again,
      // and a refused connection would fail thirteen times in a row otherwise.
      if (!result.ok) {
        setBusy(null);
        setDone(true);
        router.refresh();
        return;
      }
    }
    // Then the deposits, in the same manner.
    const nextDeposits = [...(plannedDeposits ?? [])];
    for (const [i, p] of nextDeposits.entries()) {
      if (!depositsToSend.includes(p) || !p.build?.ok || !p.read) continue;
      setBusy(`Posting deposit ${p.payout.locationCode} ${p.payout.arrival_date} (${depositsToSend.indexOf(p) + 1} of ${depositsToSend.length})`);
      const result = await postPayout(supabase, p.read, p.build, force);
      nextDeposits[i] = { ...p, result };
      setPlannedDeposits([...nextDeposits]);
      if (!result.ok) break;
    }
    setBusy(null);
    setDone(true);
    router.refresh();
  }

  const sent = (planned ?? []).filter((p) => p.result?.ok && !p.result.skipped).length;
  const sentDeposits = (plannedDeposits ?? []).filter((p) => p.result?.ok && !p.result.skipped).length;
  const failed = (planned ?? []).find((p) => p.result && !p.result.ok);
  const failedDeposit = (plannedDeposits ?? []).find((p) => p.result && !p.result.ok);

  return (
    <Dialog
      title="Post to QuickBooks"
      onClose={onClose}
      width="max-w-5xl"
      busy={busy !== null}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!done ? (
            <Checkbox checked={force} onChange={setForce} className="mr-auto text-[13px]">
              Post unchanged days and deposits again
            </Checkbox>
          ) : null}
          <button type="button" className={DIALOG_CANCEL_CLASS} disabled={busy !== null} onClick={onClose}>
            {done ? "Done" : "Cancel"}
          </button>
          {!done ? (
            <button
              type="button"
              className={DIALOG_COMMIT_CLASS}
              disabled={busy !== null || !planned || !plannedDeposits || sendCount === 0}
              onClick={() => void commit()}
            >
              {busy ? "Posting…" : `Post ${sendCount} ${sendCount === 1 ? "entry" : "entries"}`}
            </button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        {loadError ? <p className="text-accent">{loadError}</p> : null}
        {!planned && !loadError ? <ProgressBand label="Building the entries…" /> : null}

        {planned ? (
          <>
            <p className="text-[13px] text-muted">
              One journal entry per shop-day. A day already in QuickBooks whose figures have not
              moved is skipped; a day pulled again is updated in place.
              {refusedCount ? ` ${refusedCount} day${refusedCount === 1 ? " is" : "s are"} refused and say why.` : ""}
            </p>

            {unmappedAll.size > 0 ? (
              <div className="bg-mark-fill px-3 py-2 text-[13px]">
                <p className="font-semibold">
                  {unmappedAll.size} Square name{unmappedAll.size === 1 ? "" : "s"} posted to a default:
                </p>
                <ul className="mt-1 space-y-0.5">
                  {[...unmappedAll.values()].map((u) => (
                    <li key={`${u.kind}|${u.name}`}>
                      {u.name} <span className="text-ink/70">({u.kind}) → {u.role.replace(/_/g, " ")}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-ink/70">Map them under Settings → Accounting, then post again to correct the entries.</p>
              </div>
            ) : null}

            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b-2 border-ink text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <th className="py-1 pr-3">Date</th>
                  <th className="py-1 pr-3">Shop</th>
                  <th className="py-1 pr-3">Action</th>
                  <th className="py-1 pr-3 text-right">Debits</th>
                  <th className="py-1 pr-3 text-right">Credits</th>
                  <th className="py-1 pr-3">Unmapped</th>
                  <th className="py-1">Notes</th>
                </tr>
              </thead>
              <tbody>
                {planned.map((p) => (
                  <tr key={p.day.id} className="border-b border-hairline align-top">
                    <td className="py-1.5 pr-3 tabular-nums">{p.day.business_date}</td>
                    <td className="py-1.5 pr-3">{p.day.locationCode}</td>
                    <td className="py-1.5 pr-3">{actionWord(p, force)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{p.build?.ok ? formatCents(p.build.debits) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{p.build?.ok ? formatCents(p.build.credits) : "—"}</td>
                    <td className="py-1.5 pr-3">
                      {p.build?.ok && p.build.unmapped.length ? (
                        <span className="bg-mark-fill px-1">{p.build.unmapped.map((u) => u.name).join(", ")}</span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="py-1.5">
                      <ul className="space-y-0.5">
                        {p.build && !p.build.ok ? p.build.refusals.map((r, i) => <li key={i} className="text-accent">{r}</li>) : null}
                        {!p.read ? <li className="text-accent">This day could not be read.</li> : null}
                        {p.build?.ok ? p.build.warnings.map((w, i) => <li key={i} className="text-muted">{w}</li>) : null}
                        {p.result && !p.result.ok ? <li className="text-accent">{p.result.message}</li> : null}
                        {p.result?.ok ? p.result.warnings.map((w, i) => <li key={`r${i}`}><span className="bg-mark-fill px-1">{w}</span></li>) : null}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="space-y-2 pt-2">
              <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">Deposits</p>
              <p className="text-[13px] text-muted">
                One bank deposit per Square payout, for the payout’s exact amount, dated the day it
                reaches the bank — so the bank feed matches it instead of adding its own.
                {depositsRefused ? ` ${depositsRefused} ${depositsRefused === 1 ? "is" : "are"} refused and say why.` : ""}
              </p>
              {depositError ? <p className="text-[13px] text-accent">{depositError}</p> : null}
              {!plannedDeposits && !depositError ? <ProgressBand label="Building the deposits…" /> : null}
              {plannedDeposits && plannedDeposits.length === 0 && !depositError ? (
                <p className="text-[13px] text-faint">No payouts in this range. Sync from Square brings them.</p>
              ) : null}
              {plannedDeposits && plannedDeposits.length > 0 ? (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b-2 border-ink text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                      <th className="py-1 pr-3">Arrives</th>
                      <th className="py-1 pr-3">Shop</th>
                      <th className="py-1 pr-3 text-right">Amount</th>
                      <th className="py-1 pr-3">Action</th>
                      <th className="py-1">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plannedDeposits.map((p) => (
                      <tr key={p.payout.id} className="border-b border-hairline align-top">
                        <td className="py-1.5 pr-3 tabular-nums">{p.payout.arrival_date}</td>
                        <td className="py-1.5 pr-3">{p.payout.locationCode}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{formatCents(p.payout.amount_cents)}</td>
                        <td className="py-1.5 pr-3">{actionWord(p, force)}</td>
                        <td className="py-1.5">
                          <ul className="space-y-0.5">
                            {p.build && !p.build.ok ? p.build.refusals.map((r, i) => <li key={i} className="text-accent">{r}</li>) : null}
                            {!p.read ? <li className="text-accent">This payout could not be read.</li> : null}
                            {p.build?.ok ? <li className="text-muted">{p.build.docNumber} · {p.build.bank.name ?? p.build.bank.ref} ← {p.build.account.name ?? p.build.account.ref}</li> : null}
                            {p.result && !p.result.ok ? <li className="text-accent">{p.result.message}</li> : null}
                            {p.result?.ok ? p.result.warnings.map((w, i) => <li key={`r${i}`}><span className="bg-mark-fill px-1">{w}</span></li>) : null}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>

            {busy ? <ProgressBand label={busy} /> : null}
            {done ? (
              <p className={failed || failedDeposit ? "text-accent" : "text-muted"}>
                {sent} entr{sent === 1 ? "y" : "ies"} and {sentDeposits} deposit{sentDeposits === 1 ? "" : "s"} posted.
                {failed ? ` Stopped at ${failed.day.locationCode} ${failed.day.business_date}; nothing after it was sent.` : ""}
                {failedDeposit ? ` Stopped at the ${failedDeposit.payout.locationCode} deposit arriving ${failedDeposit.payout.arrival_date}; the deposits after it were not sent.` : ""}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

function actionWord(p: Pick<Planned, "result" | "action">, force: boolean): string {
  if (p.result) {
    if (!p.result.ok) return "failed";
    if (p.result.skipped) return "skipped";
    return p.result.updated ? `updated · ${p.result.label}` : `created · ${p.result.label}`;
  }
  switch (p.action) {
    case "create":
      return "create";
    case "update":
      return "update";
    case "skip":
      return force ? "update (unchanged)" : "skip (unchanged)";
    case "refused":
      return "refused";
  }
}
