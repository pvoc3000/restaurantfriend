"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { ProgressBand } from "@/components/ui/ProgressBand";
import {
  pagesForShift,
  pageTitle,
  supervisorBody,
  managementBody,
  wrapEmail,
  emailSubject,
  type EmailReport,
  type ShiftReportPage,
  type ShiftSlot,
} from "@/lib/shiftReports";
import { salesSnapshot, serverSalesSnapshot, subscribeSales } from "@/lib/shiftReportSales";

/**
 * The report itself: a full-screen, tablet-first walk through the pages this
 * shift is asked for.
 *
 * FileMaker's furniture, deliberately — a black band naming the page and its
 * number, and a black footer of three commands. Supervisors have walked this
 * shape for nine years and the muscle memory is worth more than a redesign.
 *
 * It owns the page index and nothing else. Every page writes as it goes,
 * straight to the report's own draft rows, so Back and Next are navigation
 * rather than a save. What none of them touches is the tables that OWN these
 * facts — that is `submit_shift_report`, once, at the end.
 */
/** One dress for every footer cell, so a four-across row cannot drift. */
const FOOTER_CELL =
  "min-h-14 px-4 py-3 text-sm font-bold uppercase tracking-[0.08em] text-white disabled:opacity-35";

export function ShiftReportRunner({
  reportId,
  shift,
  isSent,
  canSend,
  emailReport,
  pages,
}: {
  reportId: string;
  shift: ShiftSlot;
  isSent: boolean;
  canSend: boolean;
  /**
   * Everything the email says, assembled on the server — except the sales
   * figure, which is only known once the Sales page has asked Square.
   */
  emailReport: EmailReport;
  /** One rendered body per page, built by the server component. */
  pages: Partial<Record<ShiftReportPage, React.ReactNode>>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const order = pagesForShift(shift);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Published by the Sales page when it reads Square. Null on an opening
  // report, which has no sales page at all — and then the email says so
  // rather than quoting a figure nobody looked at.
  const liveSales = useSyncExternalStore(subscribeSales, salesSnapshot, serverSalesSnapshot);

  const page = order[index];
  const first = index === 0;
  const last = index === order.length - 1;

  async function cancel() {
    const ok = await confirmDialog({
      ...splitConfirmMessage(
        "Leave this report? Everything typed so far is saved as a draft, so you can pick it up " +
          "again from the list. Nothing has been written to the schedule or to anybody's record."
      ),
      confirmLabel: "Leave it",
    });
    if (ok) router.push("/shift-reports");
  }

  function pause() {
    // Every page has already written. This is a navigation with a promise
    // attached, which is exactly what makes it safe to offer.
    router.push("/shift-reports");
  }

  function send() {
    setFailed(null);
    startTransition(async () => {
      // 1. The flush. One transaction; nothing is half-written.
      setBusy("Recording the counts and ratings…");
      const { data: receipt, error } = await supabase.rpc("submit_shift_report", {
        p_report_id: reportId,
      });
      if (error) {
        setBusy(null);
        setFailed(error.message);
        return;
      }

      // 2. The mail. SEPARATE, because "the facts were committed" and "the team
      //    was told" are two facts — a failure here leaves a report that is
      //    sent and not emailed, which the list offers to resend rather than
      //    losing. So a mail failure is reported and the send still stands.
      //
      //    BOTH BODIES ARE BUILT HERE, not in the edge function. `_shared`
      //    cannot import from `web/`, so a Deno copy of `supervisorBody` would
      //    be a second implementation of the one rule that must never drift —
      //    that the supervisor version carries no names or scores. This is
      //    `send-po-email`'s shape: the client composes, the function sends.
      setBusy("Emailing the team…");
      const forEmail: EmailReport = liveSales?.reportId === reportId
        ? {
            ...emailReport,
            netSalesCents: liveSales.netCents,
            tipsCents: liveSales.tipsCents,
            salesAreProvisional: liveSales.provisional,
          }
        : emailReport;

      const { error: mailError } = await supabase.functions.invoke("send-shift-report", {
        body: {
          report_id: reportId,
          subject: emailSubject(forEmail),
          supervisor_html: wrapEmail(supervisorBody(forEmail)),
          management_html: wrapEmail(managementBody(forEmail)),
          net_sales_cents: forEmail.netSalesCents,
          tips_cents: forEmail.tipsCents,
          sales_provisional: forEmail.salesAreProvisional,
        },
      });

      setBusy(null);
      if (mailError) {
        setFailed(
          `The report was recorded, but the email did not go out: ${mailError.message}. ` +
            "It is on the list as “Sent, but not emailed” — you can resend it from there."
        );
        router.refresh();
        return;
      }

      // Finishing is the end of the task, so it LEAVES — the receiving
      // screen's lesson. Staying put would make you press Close afterwards for
      // the same destination.
      void receipt;
      router.push("/shift-reports");
    });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-ink px-6 py-5 text-center">
        <h1 className="text-lg font-bold uppercase tracking-[0.08em] text-white">
          Shift report — page {index + 1} of {order.length} — {pageTitle(page)}
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-8">
        {busy ? <ProgressBand label={busy} /> : null}
        {failed ? (
          <p className="mb-6 border border-accent px-4 py-3 text-sm text-accent">{failed}</p>
        ) : null}
        {isSent ? (
          <p className="mb-6 text-sm">
            <span className="bg-mark-fill px-1">This report has been sent</span>{" "}
            <span className="text-muted">— it is a document now, and read-only.</span>
          </p>
        ) : null}
        {pages[page] ?? <p className="text-sm text-muted">Nothing to do on this page.</p>}
      </main>

      {/* FOUR CELLS, FIXED (Mark, 2026-08-28: "Pause & close only appears on the
          first page ... seems like it should always be available"). It used to
          share a cell with Back, which meant the one command you reach for when
          the shop gets busy was available only on page 1 — the page you are
          least likely to be on when that happens.
          A fixed four means no cell ever changes what it DOES as you page
          through: Back is disabled on page 1 rather than absent, so nothing
          shifts under a thumb. 44px targets throughout — this is read at arm's
          length by somebody who is tired. */}
      <footer className="sticky bottom-0 grid grid-cols-4 divide-x divide-white/20 border-t border-white/20 bg-ink">
        <button
          type="button"
          className={FOOTER_CELL}
          onClick={() => void cancel()}
          disabled={busy !== null}
        >
          Cancel
        </button>
        <button
          type="button"
          className={FOOTER_CELL}
          onClick={pause}
          disabled={busy !== null}
        >
          Pause &amp; close
        </button>
        <button
          type="button"
          className={FOOTER_CELL}
          onClick={() => setIndex(index - 1)}
          disabled={busy !== null || first}
        >
          Back
        </button>
        {last ? (
          <button
            type="button"
            className={`${FOOTER_CELL} text-mark`}
            onClick={send}
            disabled={busy !== null || isSent || !canSend}
            title={
              isSent
                ? "This report has already been sent."
                : !canSend
                  ? "A report is sent by whoever started it."
                  : undefined
            }
          >
            Send
          </button>
        ) : (
          <button
            type="button"
            className={FOOTER_CELL}
            onClick={() => setIndex(index + 1)}
            disabled={busy !== null}
          >
            Next
          </button>
        )}
      </footer>
    </div>
  );
}
