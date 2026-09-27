"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { DateField } from "@/components/ui/DateField";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { money } from "@/lib/specialOrders";
import { documentFileName, docOrgFrom, usDate } from "@/lib/specialOrderDocs";
import { readInvoiceTerms } from "@/lib/customerInvoices";
import { fetchStatement } from "@/lib/customerInvoiceQueries";
import { statementPeriod, type StatementDocument } from "@/lib/customerStatement";
import { downloadBlob, openWindowNow, showBlob } from "@/lib/poProcessing";

/**
 * THE CUSTOMER'S STATEMENT (144): their account over a period, balance
 * forward — the opening balance, every invoice and payment with the balance
 * after each, the closing balance, and the invoices still open with their
 * aging (`lib/customerStatement`). Invoices are the bill now; decision 21's
 * one-row-per-order statement was the stand-in until they were.
 *
 * Nothing is stored and nothing auto-sends: it is rendered from the ledger
 * each time, so the same period renders the same — until money held on an
 * order is applied by a later invoice, which dates it the day it was paid.
 *
 * THE DATES DEFAULT TO A MONTH BACK TO TODAY (`statementPeriod`), as
 * QuickBooks' statement does; the opening balance carries the rest.
 */
export function CustomerStatement({
  customerId,
  today,
  canWrite,
}: {
  customerId: string;
  /** Today in the ORG's timezone. A browser's own idea of today would put a
   *  statement in the wrong week for anyone working past 5pm on the coast. */
  today: string;
  canWrite: boolean;
}) {
  const supabase = createClient();
  const initial = statementPeriod(today);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<StatementDocument | null>(null);

  if (!canWrite) return null;

  async function org() {
    const { data } = await supabase.from("orgs").select("name, settings").maybeSingle();
    const settings = (data?.settings ?? {}) as Record<string, unknown>;
    return { doc: docOrgFrom((data?.name as string) ?? "", settings), terms: readInvoiceTerms(settings) };
  }

  async function load(): Promise<{ statement: StatementDocument; header: Awaited<ReturnType<typeof org>> }> {
    const header = await org();
    const statement = await fetchStatement(supabase, customerId, from, to, header.terms);
    setPreview(statement);
    return { statement, header };
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function render() {
    const [{ statement, header }, { pdf }, docs] = await Promise.all([
      load(),
      import("@react-pdf/renderer"),
      import("./pdf/SpecialOrderPdfs"),
    ]);
    const blob = await pdf(<docs.StatementPdf statement={statement} org={header.doc} />).toBlob();
    return { blob, statement };
  }

  const show = () => {
    // Opened synchronously in the handler — a popup after an await is silently
    // blocked.
    const win = openWindowNow();
    return run("preview", async () => {
      try {
        const { blob } = await render();
        showBlob(win, blob, documentFileName("statement", customerId.slice(0, 8), from));
      } catch (e) {
        win?.close();
        throw e;
      }
    });
  };

  const save = () =>
    run("download", async () => {
      const { blob } = await render();
      downloadBlob(blob, documentFileName("statement", customerId.slice(0, 8), from));
    });

  return (
    <>
      <button type="button" className={BUTTON_CLASS} onClick={() => setOpen(true)}>
        Statement&hellip;
      </button>

      {open && (
        <Dialog
          title="Statement"
          onClose={() => setOpen(false)}
          busy={busy !== null}
          width="max-w-lg"
          footer={
            <>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy !== null}
                className={DIALOG_CANCEL_CLASS}
              >
                Close
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy !== null}
                className={BUTTON_CLASS}
              >
                {busy === "download" ? "Rendering…" : "Download"}
              </button>
              <button
                type="button"
                onClick={show}
                disabled={busy !== null}
                className={DIALOG_COMMIT_CLASS}
              >
                {busy === "preview" ? "Rendering…" : "Open"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <label className="space-y-1.5">
                <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
                  From
                </span>
                <DateField value={from} onChange={(v) => setFrom(v ?? from)} ariaLabel="From" />
              </label>
              <label className="space-y-1.5">
                <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
                  To
                </span>
                <DateField value={to} onChange={(v) => setTo(v ?? to)} ariaLabel="To" />
              </label>
            </div>

            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={busy !== null}
              onClick={() => run("count", async () => void (await load()))}
            >
              {busy === "count" ? "Counting…" : "What's in it?"}
            </button>

            {/* Said BEFORE you render, because "the statement was empty" is
                something you want to find out here rather than in a PDF you
                have already attached to an email. */}
            {preview && <StatementSummary statement={preview} from={from} to={to} />}

            {error && <p className="text-sm text-accent">{error}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}

function StatementSummary({ statement: doc, from, to }: { statement: StatementDocument; from: string; to: string }) {
  const st = doc.statement;
  if (st.rows.length === 0 && Math.abs(st.opening) < 0.005) {
    return (
      <p className="text-[13px]">
        <span className="box-decoration-clone bg-mark-fill px-1">
          No invoices or payments between {usDate(from)} and {usDate(to)}.
        </span>
      </p>
    );
  }
  const invoices = st.rows.filter((r) => r.kind === "invoice").length;
  const payments = st.rows.filter((r) => r.kind === "payment" || r.kind === "refund").length;
  return (
    <p className="text-[13px] tabular-nums">
      Opening {money(st.opening)} · {invoices} {invoices === 1 ? "invoice" : "invoices"} · {payments}{" "}
      {payments === 1 ? "payment" : "payments"} ·{" "}
      {st.closing < -0.005 ? (
        <span>{money(-st.closing)} credit</span>
      ) : st.closing > 0.005 ? (
        <span className="text-accent">{money(st.closing)} due</span>
      ) : (
        <span>settled</span>
      )}
    </p>
  );
}
