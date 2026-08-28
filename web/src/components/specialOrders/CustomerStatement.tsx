"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { DateField } from "@/components/ui/DateField";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { money } from "@/lib/specialOrders";
import {
  documentFileName,
  fetchStatementData,
  lastWeek,
  orgDocHeader,
  usDate,
  type StatementData,
} from "@/lib/specialOrderDocs";
import { downloadBlob, openWindowNow, showBlob } from "@/lib/poProcessing";

/**
 * Decision 21: the weekly wholesale statement, as ONE command.
 *
 * Mark bills Cafe Knotted every week for the previous week's orders, by hand.
 * This is a RENDERING OVER ROWS — the `PoPdf` idiom, no new tables — and it
 * exists to make a recurring chore one tap rather than to introduce a billing
 * concept. Nothing auto-sends and nothing is stored: a statement is a view of
 * money that is already derived (decision 6), so re-rendering it next month
 * gives the same answer.
 *
 * THE DATES DEFAULT TO LAST WEEK, Monday to Sunday — see `lastWeek` for why
 * that is not "the last seven days". They are editable because the exceptions
 * are real: a month-end catch-up, or a week somebody billed late.
 *
 * It is also the dry run for the QBO era, which is the other half of decision
 * 21: the statement's line grain — one row per ORDER — is exactly what an
 * accounting export will want.
 */
export function CustomerStatement({
  customerId,
  customerEmail,
  today,
  canWrite,
}: {
  customerId: string;
  customerEmail: string | null;
  /** Today in the ORG's timezone. A browser's own idea of today would put a
   *  statement in the wrong week for anyone working past 5pm on the coast. */
  today: string;
  canWrite: boolean;
}) {
  const supabase = createClient();
  const initial = lastWeek(today);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<StatementData | null>(null);

  if (!canWrite) return null;

  async function load(): Promise<StatementData> {
    const statement = await fetchStatementData(supabase, customerId, from, to);
    setPreview(statement);
    return statement;
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

  /**
   * The org header comes from the SAME assembler the documents use, which
   * needs an order to hang off. A customer with no orders in range still has
   * orders somewhere; with none at all the masthead falls back to the org's
   * own settings, which is what `orgDocHeader` reads anyway.
   */
  async function orgHeader() {
    const { data: org } = await supabase.from("orgs").select("name, settings").maybeSingle();
    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    const so = (settings.special_orders ?? {}) as Record<string, unknown>;
    return {
      ...orgDocHeader((org?.name as string) ?? "", settings),
      terms: typeof so.terms === "string" ? so.terms : "",
      invoiceFooter: typeof so.invoice_footer === "string" ? so.invoice_footer : "",
    };
  }

  async function render() {
    const [statement, org, { pdf }, docs] = await Promise.all([
      load(),
      orgHeader(),
      import("@react-pdf/renderer"),
      import("./pdf/SpecialOrderPdfs"),
    ]);
    const blob = await pdf(<docs.StatementPdf statement={statement} org={org} />).toBlob();
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
            <p className="text-sm text-muted">
              One line per order over the period, with the money derived the way
              every other screen derives it. Defaults to last week — Monday to
              Sunday — which is how wholesale is billed in arrears.
            </p>

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
            {preview && (
              <p className="text-[13px]">
                {preview.orders.length === 0 ? (
                  <span className="box-decoration-clone bg-mark-fill px-1">
                    No orders between {usDate(from)} and {usDate(to)}.
                  </span>
                ) : (
                  <>
                    {preview.orders.length}{" "}
                    {preview.orders.length === 1 ? "order" : "orders"} ·{" "}
                    <span className="tabular-nums">{money(preview.total)}</span>
                    {preview.balance !== 0 && (
                      <>
                        {" · "}
                        <span className="tabular-nums text-accent">
                          {money(preview.balance)} outstanding
                        </span>
                      </>
                    )}
                  </>
                )}
              </p>
            )}

            {customerEmail ? (
              <p className="text-[12px] text-muted">
                To send it, attach the downloaded file to a message to{" "}
                {customerEmail}. Statements are deliberately not auto-sent —
                wholesale billing is a decision, not a schedule.
              </p>
            ) : null}

            {error && <p className="text-sm text-accent">{error}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
