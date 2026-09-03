"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/lib/confirm";
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
  openAtPage,
  blockers,
  checklistRun,
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
  /**
   * Where to open, 1-based, or null for the first page.
   *
   * The create dialog passes 2, because page 1 restates it. Clamped here
   * rather than at the caller: only this component knows how many pages this
   * shift is asked for, and a report whose shift has since been corrected to
   * `off_site` has fewer of them.
   */
  openAtPage: number | null;
  /**
   * What must be settled before Send will work — `submitBlockers`, which is a
   * list of one kind of thing and is meant to stay that way.
   *
   * The BUTTON is the gate rather than `submit_shift_report`: a function that
   * raised at Send would be a hard failure at the last possible moment with no
   * way through, where a disabled button says what is wrong while there is
   * still time to go back and fix it. The database's job here is integrity;
   * whether tonight's paperwork is finished is a workflow rule.
   */
  blockers: string[];
  /**
   * The checklist linked to this report, ONLY while it is still open.
   *
   * Null when there is none or it is already finished, which is what makes
   * `finishChecklist` below safe to call unconditionally on send.
   */
  checklistRun: { id: string; title: string } | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const order = pagesForShift(shift);
  const [index, setIndex] = useState(() =>
    openAtPage === null ? 0 : Math.min(Math.max(openAtPage - 1, 0), order.length - 1)
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Published by the Sales page when it reads Square. Null on an opening
  // report, which has no sales page at all — and then the email says so
  // rather than quoting a figure nobody looked at.
  const liveSales = useSyncExternalStore(subscribeSales, salesSnapshot, serverSalesSnapshot);

  // Your own draft, which is exactly what 070's delete policy allows and what
  // `editable` already means upstream. `canSend` carries that same value; the
  // two acts have the same owner, which is the point.
  const canDiscard = canSend && !isSent;
  const hasChecklist = checklistRun !== null;

  const page = order[index];
  const first = index === 0;
  const last = index === order.length - 1;

  /**
   * DISCARD THE REPORT — which is what "Cancel" now means (Mark, 2026-09-01,
   * having asked "what's the difference between cancel and pause and close?").
   *
   * There was none. Both called `router.push("/shift-reports")`; Cancel simply
   * asked first, in a confirm whose own text explained that nothing would be
   * lost. So the footer had two cells for one act and the word "Cancel" was the
   * only thing on this screen promising an undo the app did not have.
   *
   * It has one now. Deleting the report row is enough and the schema says so:
   * 070 gives all three draft tables `on delete cascade`, while 076 makes
   * `checklist_runs.shift_report_id` `on delete set null` — so THE CHECKLIST
   * SURVIVES, unlinked. That is right rather than incidental: a walk somebody
   * did is their record of what they found, and it should not evaporate
   * because the report that would have carried it was binned.
   *
   * ONLY YOUR OWN DRAFT. 070's delete policy is owner/admin, or a draft you
   * created — and this offers only the second, so a sent report is a document
   * here whoever you are. Everything else gets the plain leave that
   * "Pause & close" gives, under a label that says so.
   */
  async function cancel() {
    if (!canDiscard) {
      router.push("/shift-reports");
      return;
    }

    // COUNTED AT CLICK TIME, not from the page's own props. A confirm about
    // deleting things has to name what is actually there, and the runner's copy
    // is as old as its last render — somebody may have counted a case since.
    const [ratings, counts, batches] = await Promise.all([
      supabase
        .from("shift_report_ratings")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId),
      supabase
        .from("shift_report_counts")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId),
      supabase
        .from("shift_report_batches")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId),
    ]);

    const holds = [
      [ratings.count ?? 0, "rating", "ratings"],
      [counts.count ?? 0, "count", "counts"],
      [batches.count ?? 0, "batch yield", "batch yields"],
    ]
      .filter(([n]) => (n as number) > 0)
      .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);

    const ok = await confirmDialog({
      title: "Discard this report?",
      body:
        (holds.length > 0
          ? `The report and ${holds.join(", ")} are deleted. `
          : "The report is deleted. ") +
        "Nothing was ever written to the schedule or to anybody's record, so " +
        "there is nothing else to undo." +
        (hasChecklist
          ? " The checklist stays — it is its own record and unlinks rather than going with this."
          : ""),
      confirmLabel: "Discard",
      tone: "danger",
    });
    if (!ok) return;

    setFailed(null);
    // `.select()` and the row count: a delete matching no policy removes
    // nothing and PostgREST returns NO error, so a bare one would report a
    // cheerful success AND navigate — which reads exactly like the report
    // having been binned.
    const { data, error } = await supabase
      .from("shift_reports")
      .delete()
      .eq("id", reportId)
      .select("id");

    if (error || !data || data.length === 0) {
      setFailed(
        error?.message ??
          "The report was not discarded — nothing changed. A report is discarded by whoever started it, and only while it is a draft."
      );
      return;
    }
    router.push("/shift-reports");
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

      // 2. THE CHECKLIST IS FINISHED BY FINISHING THE REPORT (Mark,
      //    2026-09-01: it "feels like an unnecessary extra step"). The page's
      //    own Finish button is gone; this is where the run is submitted.
      //
      //    AFTER the flush and BEFORE the mail, which is the only order that
      //    works: the email quotes whether the checklist was finished, so
      //    doing it afterwards would send "this checklist was not finished"
      //    about one that just had been.
      //
      //    NOT folded into `submit_shift_report`. That is an applied definer
      //    function and 072's `reopen_shift_report` exists to undo exactly what
      //    it flushes; teaching it to submit a run would mean teaching the
      //    reopen to reopen one, and reopening a checklist is a decision
      //    somebody makes about the checklist. `ReopenChecklistRun` is that
      //    door and stays it.
      //
      //    A SEPARATE STATEMENT, so a refusal here cannot un-send a report
      //    whose facts are already committed — the same reasoning as the mail
      //    below. 076's update policy is supervisor+ AND `created_by =
      //    auth.uid()`, so a run somebody ELSE started refuses this, changing
      //    zero rows and returning no error. Hence `.select()` and the count:
      //    the alternative is a cheerful success over a checklist still marked
      //    open.
      let checklistFinished = false;
      let checklistWarning: string | null = null;
      if (checklistRun) {
        setBusy("Finishing the checklist…");
        const { data: finished, error: finishError } = await supabase
          .from("checklist_runs")
          .update({
            status: "submitted",
            submitted_at: new Date().toISOString(),
            submitted_by: (await supabase.auth.getUser()).data.user?.id ?? null,
          })
          .eq("id", checklistRun.id)
          .select("id");

        if (finishError || !finished || finished.length === 0) {
          checklistWarning =
            finishError?.message ??
            `“${checklistRun.title}” was not finished — a checklist is finished by whoever started it. ` +
              "You can finish it from Facilities › Checklists.";
        } else {
          checklistFinished = true;
        }
      }

      // 3. The mail. SEPARATE, because "the facts were committed" and "the team
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
      const withSales: EmailReport = liveSales?.reportId === reportId
        ? {
            ...emailReport,
            netSalesCents: liveSales.netCents,
            tipsCents: liveSales.tipsCents,
            salesAreProvisional: liveSales.provisional,
          }
        : emailReport;

      // The run was open when the server rendered this and is submitted now, so
      // the payload has to say so — otherwise the section reads "This checklist
      // was not finished" about the one this very act just finished.
      const forEmail: EmailReport =
        checklistFinished && withSales.checklist
          ? { ...withSales, checklist: { ...withSales.checklist, finished: true } }
          : withSales;

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
            "It is on the list as “Sent, but not emailed” — you can resend it from there." +
            (checklistWarning ? ` Also: ${checklistWarning}` : "")
        );
        router.refresh();
        return;
      }

      // A checklist that refused to close is worth stopping for: the report is
      // sent either way, but leaving without saying so would leave a run open
      // that nobody is going to come back to.
      if (checklistWarning) {
        setFailed(`The report was sent. ${checklistWarning}`);
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

      <main className="flex flex-1 flex-col overflow-y-auto px-6 py-8">
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
        {/* ONE CELL, TWO HONEST WORDS. On your own draft this really does
            cancel the report, so it says Cancel; on a sent one, or somebody
            else's, there is nothing to discard and it is the same plain leave
            that Pause & close gives — so it says Close rather than offering an
            act it will not perform. The word is fixed for the whole visit: a
            report's status cannot change under you here, because Send
            navigates away. */}
        <button
          type="button"
          className={FOOTER_CELL}
          onClick={() => void cancel()}
          disabled={busy !== null}
        >
          {canDiscard ? "Cancel" : "Close"}
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
            disabled={busy !== null || isSent || !canSend || blockers.length > 0}
            title={
              isSent
                ? "This report has already been sent."
                : !canSend
                  ? "A report is sent by whoever started it."
                  : blockers.length > 0
                    ? blockers.join(" ")
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
