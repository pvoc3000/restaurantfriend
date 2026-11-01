import type { ReactNode } from "react";
// The shift report guide's look, shared rather than copied: one guide style.
import s from "../shift-report/guide.module.css";

export const metadata = {
  title: "A Short Delivery — Donut Friend guides",
  description:
    "What to do when a special order goes out short or missing an item: recording it on the order, and how the customer is credited or refunded.",
};

/**
 * The guide to a short delivery, public at /guides/short-delivery (migrations
 * 217 and 218, docs/customer-credit-memos-brief.md).
 *
 * EVERY LABEL HERE IS THE SCREEN'S OWN: the Items tab's "Delivered" column and
 * "Record Short…" button (OrderLines), the "Record Short" dialog with Item ·
 * Ordered · Delivered, "Reason" and "Save", the notice's "Issue Credit Memo…",
 * "No Credit…" and "Change Decision…", and the memo dialog's "Apply to the
 * next invoice" / "Refund to the card" / "Refunded in cash" / "Refunded by
 * check" (IssueCreditMemo). When one of those changes, this page changes too.
 */

function Ui({ children }: { children: ReactNode }) {
  return <span className={s.ui}>{children}</span>;
}

function Note({ head, warn, children }: { head: string; warn?: boolean; children: ReactNode }) {
  return (
    <div className={warn ? `${s.note} ${s.warn}` : s.note}>
      <strong className={s.noteHead}>{head}</strong>
      {children}
    </div>
  );
}

export default function ShortDeliveryGuide() {
  return (
    <article className={s.guide}>
      <div className={s.head}>
        <div className={s.eyebrow}>For supervisors and managers</div>
        <h1>A Short Delivery</h1>
        <p>
          What to do when a special order goes out short — fewer donuts than were ordered, or a
          missing item. The order itself never changes: it keeps what the customer ordered. You
          record what actually went out, and the customer’s money follows from that.
        </p>
      </div>

      <nav className={s.toc} aria-label="Sections">
        <a href="#record">1 · Record the short</a>
        <a href="#credit">2 · Credit or refund</a>
        <a href="#before">3 · Before it’s invoiced</a>
      </nav>

      <section className={s.part} id="record">
        <h2>
          <span className={s.tag}>Supervisors</span>Record the short
        </h2>
        <p className={s.lede}>
          Every order counts as delivered in full unless someone records a short. Do it as soon as
          you know — at the handover if you can.
        </p>
        <ol className={s.steps}>
          <li>
            Open the order and go to its <strong>Items</strong> tab.
            <p>
              The <strong>Delivered</strong> column shows the ordered quantity on every line until a
              short is recorded.
            </p>
          </li>
          <li>
            Press <Ui>Record Short…</Ui> above the lines — or press the figure in a line’s{" "}
            <strong>Delivered</strong> column to open it at that line.
          </li>
          <li>
            In <strong>Record Short</strong>, change <strong>Delivered</strong> for each line that
            went out short (0 for a missing item), type the <strong>Reason</strong>, and press{" "}
            <Ui>Save</Ui>.
            <p>
              A reason is required. The order now shows, for example, “Delivered 518 of 560
              Knotted Bismark — dropped a rack”, with your name and the date.
            </p>
          </li>
        </ol>
        <Note head="Got it wrong?">
          Open <Ui>Record Short…</Ui> again and set the line back to its ordered quantity. That
          clears the short, and the order’s history keeps both.
        </Note>
      </section>

      <section className={s.part} id="credit">
        <h2>
          <span className={s.tag}>Managers</span>Credit or refund
        </h2>
        <p className={s.lede}>
          A short on an order that has already been invoiced puts <strong>Issue Credit Memo</strong>{" "}
          on the order’s to-do. Nothing about the money changes until a manager decides.
        </p>
        <ol className={s.steps}>
          <li>
            On the order’s Items tab, press <Ui>Issue Credit Memo…</Ui>.
            <p>
              The memo is filled in from the record: the short quantity at the price it was billed
              at, with its tax. You can credit less than the record shows, never more.
            </p>
          </li>
          <li>
            Choose how it is settled:
            <p>
              <Ui>Refund to the card</Ui> for a retail customer — the money goes back to the card
              they paid with, and their invoice stays paid in full. <Ui>Apply to the next invoice</Ui>{" "}
              for a wholesale customer — the credit comes off their next invoice when it is sent.
              On an invoice collected through Square you can also choose{" "}
              <Ui>Refunded in cash</Ui> or <Ui>Refunded by check</Ui> when the shop gave the money
              back itself.
            </p>
          </li>
          <li>
            Issue it. The memo’s own record opens; use <Ui>Email…</Ui> there to send the customer
            the credit memo.
          </li>
        </ol>
        <Note head="No credit at all?">
          If the missing donuts went out on the next delivery, or the short is a gift, press{" "}
          <Ui>No Credit…</Ui> and say why. <Ui>Change Decision…</Ui> reopens it.
        </Note>
        <Note head="If the memo says a step is still to do" warn>
          A memo that could not reach QuickBooks, or a refund that did not go through, says so at
          the top of its record. Use <Ui>Send to QuickBooks</Ui> or <Ui>Refund Again</Ui> there.
          Never make the credit memo by hand in QuickBooks — the app would not know about it.
        </Note>
      </section>

      <section className={s.part} id="before">
        <h2>
          <span className={s.tag}>Anyone</span>Before it’s invoiced
        </h2>
        <p className={s.lede}>
          If the short is recorded before the order goes on an invoice, there is nothing to credit:
          the invoice bills what was delivered. It shows Ordered and Delivered side by side, so the
          customer can see why.
        </p>
      </section>
    </article>
  );
}
