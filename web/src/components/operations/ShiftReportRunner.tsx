"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
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
import { usePublishedHeight } from "@/lib/tableHead";

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
/**
 * One dress for every footer cell, so a four-across row cannot drift.
 *
 * `inline-flex items-center justify-center` rather than leaning on a button's
 * own centring, which is a UA behaviour and not a stated one.
 *
 * `py-[7px]`, not `py-3`, and that is arithmetic rather than taste: a cell now
 * holds a 28px icon over a 12px word with 2px between them, so 7 + 42 + 7 is
 * EXACTLY the `min-h-14` (56px) the bar has always been. At `py-3` it would be
 * 66 and every page would lose ten pixels of content. Change either size and
 * this has to be recomputed: 28/10 lands on the same 56 with a plain `py-2`.
 */
const FOOTER_CELL =
  "inline-flex min-h-14 items-center justify-center px-4 py-[7px] text-white disabled:opacity-35";

/**
 * THE FOOTER IS ICONS WITH THE WORD KEPT UNDER THEM (Mark, 2026-09-09, choosing
 * it out of eight mockups: "material symbols with a small word under it (H) but
 * with a check mark instead of an arrow for send. And send is green").
 *
 * MATERIAL SYMBOLS AS REAL ARTWORK, WHICH IS WHAT THIS APP ALREADY DOES —
 * `RecordNav`'s four record-book buttons and the Columns eye, Apache 2.0,
 * inlined as one `currentColor` path each rather than taking an icon
 * dependency. And it settles the same complaint RecordNav's own note records
 * from 2026-07-31, when those four had shipped as TYPED CHARACTERS while the
 * eye was artwork: "two families of arrow in one app is the sort of thing you
 * can't unsee". The Dingbat U+279C that stood here for an afternoon was the
 * typed half of exactly that split.
 *
 * SF Symbols were asked about and cannot be used here, for two independent
 * reasons: Apple's licence covers app UIs on Apple platforms rather than a
 * website, and there is no delivery route anyway — the glyphs live in a private
 * system font that no `font-family` exposes, so the only access is undocumented
 * Private Use Area codepoints that are tofu everywhere else. They are the right
 * answer for phase 5's SwiftUI app, where they are native and free.
 *
 * WHY THE WORD STAYS. A bare `✕` cannot say which of two things this button is:
 * the first cell is Cancel on your own draft and Close on a sent report or
 * somebody else's, which is a distinction that file already argues for at
 * length. Same for "Pause & close", where the "& close" is the half that tells
 * you it LEAVES. The words are the ones that were already there, unshortened —
 * an icon was added, nothing was taken away — and they are what gives each
 * button its accessible name, so no `aria-label` is needed and the artwork is
 * `aria-hidden`.
 *
 * wght 700 rather than RecordNav's 300: these sit over 12px bold uppercase type
 * on a black bar at arm's length, where 300 reads as hairline. Same family,
 * different weight, which is what a weight axis is for.
 */
const ICON_CLOSE =
  "m256-168-88-88 224-224-224-224 88-88 224 224 224-224 88 88-224 224 224 224-88 88-224-224-224 224Z";
const ICON_PAUSE = "M544-139v-682h252v682H544Zm-380 0v-682h252v682H164Z";
const ICON_BACK = "m368-417 202 202-90 89-354-354 354-354 90 89-202 202h466v126H368Z";
const ICON_NEXT = "M592-417H126v-126h466L390-745l90-89 354 354-354 354-90-89 202-202Z";
const ICON_SEND = "M382-208 122-468l90-90 170 170 366-366 90 90-456 456Z";

/**
 * SEND IS GREEN, AND IT IS `--rf-green-300` (Mark, 2026-09-09: "send is green,
 * not yellow/orange").
 *
 * MEASURED, because the obvious token is the wrong one. `--color-go-ink`
 * (green-600) is built to be INK ON WHITE, where it passes at 5.34:1; on this
 * bar it is **3.54:1**, under AA. `--color-go` (green-200) is the other way —
 * 14.44:1, and so pale that against the white cells beside it the tick reads as
 * off-white rather than as green. green-300 is 11.24:1 and unmistakably green,
 * which is the pair of things this needs.
 *
 * A FILL-RANGE VALUE USED AS INK ON A DARK GROUND is the same move `text-mark`
 * makes on the masthead, and that file's rule says so in as many words: yellow
 * is a fill and never an ink, "the one place `text-mark` is right is on BLACK".
 * Green behaves identically. For reference the yellow this replaces measures
 * 9.85:1, so the bar got brighter rather than dimmer.
 *
 * `var(--rf-green-300)` directly, since no semantic token names it — the same
 * way the bill-stage ladder reaches for `--rf-green-300` for Paid.
 */
const FOOTER_SEND = "text-[var(--rf-green-300)]";

/**
 * 28px of artwork over a 12px word — Mark's, off eight pairs rendered side by
 * side (26/9, 26/10, 26/12, 24/12, then 28/11, 28/10 and 28/12).
 *
 * AND IT LANDS BACK ON THIS SURFACE'S OWN TYPE SCALE, whose floor is the 12px
 * of its small-caps labels and column heads — which is worth saying because the
 * two runners-up did not: 28/11 and 28/10 were both shipped for a few minutes
 * and both would have introduced a size below that floor, on the argument that
 * a caption under an icon is its own element rather than a label in the scale.
 * That argument was never needed. The icon is what carries the size difference
 * and the word stays the size every other label on this screen is.
 */
function FooterLabel({ icon, word }: { icon: string; word: string }) {
  return (
    <span className="flex flex-col items-center gap-0.5">
      <svg width="28" height="28" viewBox="0 -960 960 960" aria-hidden="true">
        <path fill="currentColor" d={icon} />
      </svg>
      <span className="text-[12px] font-bold uppercase leading-none tracking-[0.08em]">
        {word}
      </span>
    </span>
  );
}
const FOOTER_GLYPH = "text-[32px] leading-none tracking-normal";

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

  // The black banner's measured height, for everything that sticks under it —
  // see the header itself for why this is measured and not written down.
  const bannerRef = useRef<HTMLElement | null>(null);
  usePublishedHeight(bannerRef, "--rf-runner-h");

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
      {/* THE TITLE STAYS ON SCREEN (Mark, 2026-09-09: "make all titles and
          headers in the shift report sticky"). It is the only thing that says
          which of eight pages you are on and what it is for, and it was the
          first thing to leave as soon as anybody scrolled.

          It PUBLISHES ITS OWN MEASURED HEIGHT, because everything that sticks
          beneath it has to stack under it and this bar WRAPS — one line at a
          desk, two on a portrait iPad — so any constant is right at one width
          and wrong at another, and being wrong here means a page's column
          labels sitting on top of the rows they label. Measured, never written
          down: the masthead's own lesson.

          `WalkRunner` has had a sticky banner since it shipped; this shell was
          the odd one out. */}
      <header
        ref={bannerRef}
        className="sticky top-0 z-30 bg-ink px-6 py-5 text-center"
      >
        <h1 className="text-lg font-bold uppercase tracking-[0.08em] text-white">
          Shift report — page {index + 1} of {order.length} — {pageTitle(page)}
        </h1>
      </header>

      {/* 16px IS THIS SURFACE'S BODY SIZE. The app's own base is 15px (a desk
          size), and anything unstyled here inherits it — a `ui/Checkbox` label
          beside 16px rows, for instance. Setting it once on main is what makes
          the scale hold for elements no page sizes explicitly.

          NO `overflow-y-auto` HERE, AND PUTTING IT BACK BREAKS THE PREMADES
          HEADER. It carried one until 2026-09-09 and that class never did
          anything: the shell is `min-h-screen` with height auto, so this box is
          content-sized and its scrollHeight always equals its clientHeight —
          measured 2097 against 2097 — while the WINDOW is what really scrolls.
          What it did do was make this an `overflow` scroll CONTAINER, and a
          sticky cell pins to its nearest such ancestor: so the premades column
          labels pinned to a box that never moves and left with the page,
          measured at −511px after a 600px scroll. That is `lib/tableHead`'s own
          documented trap, in the file it is documented in.

          If this surface ever wants a genuinely fixed banner and footer the
          answer is a DEFINITE height on the shell (`h-dvh`, not `h-screen` —
          iOS Safari's `100vh` is the large viewport and would hide the footer
          under the browser chrome), and the `overflow-y-auto` comes back at the
          same time. One without the other is what was here. */}
      <main className="flex-1 px-6 py-8 text-[16px]">
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
      {/* z-30, the banner's own rung. It had none, which was safe only while
          nothing else on this surface was sticky — a sticky table head at z-20
          would now paint OVER these four buttons on a viewport short enough for
          the two to meet, and these four are the way out. */}
      <footer className="sticky bottom-0 z-30 grid grid-cols-4 divide-x divide-white/20 border-t border-white/20 bg-ink">
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
          <FooterLabel icon={ICON_CLOSE} word={canDiscard ? "Cancel" : "Close"} />
        </button>
        <button
          type="button"
          className={FOOTER_CELL}
          onClick={pause}
          disabled={busy !== null}
        >
          <FooterLabel icon={ICON_PAUSE} word={"Pause & close"} />
        </button>
        {/* THE WORD SURVIVES AS THE ACCESSIBLE NAME. `aria-label` wins over
            the content, so a screen reader says "Back" rather than
            "leftwards arrow", and `title` gives a desk browser the same word
            on hover — which the iPad has no equivalent of, and does not need:
            a full-width arrow in a wizard's footer is about as unambiguous as
            this app gets. */}
        <button
          type="button"
          className={`${FOOTER_CELL} ${FOOTER_GLYPH}`}
          onClick={() => setIndex(index - 1)}
          disabled={busy !== null || first}
        >
          <FooterLabel icon={ICON_BACK} word="Back" />
        </button>
        {last ? (
          <button
            type="button"
            className={`${FOOTER_CELL} ${FOOTER_SEND}`}
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
            <FooterLabel icon={ICON_SEND} word="Send" />
          </button>
        ) : (
          <button
            type="button"
            className={`${FOOTER_CELL} ${FOOTER_GLYPH}`}
            onClick={() => setIndex(index + 1)}
            disabled={busy !== null}
          >
            <FooterLabel icon={ICON_NEXT} word="Next" />
          </button>
        )}
      </footer>
    </div>
  );
}
