import { Fragment } from "react";

import { percentLabel, toPercent } from "@/lib/percent";

import { PercentSetting } from "./PercentSetting";
import { SquareItemSetting } from "./SquareItemSetting";

import { InlineValue } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { DEFAULT_FULFILLMENT_NOTES, DEFAULT_TEMPLATES } from "@/lib/specialOrderDocs";

/**
 * Everything this module SAYS, in one place a person can edit (Mark,
 * 2026-08-21: "all the email stuff for special orders like what the
 * confirmation email says. The user needs a way to set these things").
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCREEN EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * Design rule 2 has always said the business's own words live in
 * `orgs.settings` and never in code, and every one of these keys did — but the
 * only way to change one was a hand-written UPDATE in the Supabase SQL editor.
 * That is not "configurable", it is "hardcoded somewhere less convenient": a
 * settings key nobody can reach is a literal with extra steps.
 *
 * ---------------------------------------------------------------------------
 * EMPTY MEANS "USE THE DEFAULT", AND THAT IS WHY THE PLACEHOLDER IS THE DEFAULT
 * ---------------------------------------------------------------------------
 * `InlineValue`'s jsonb write DELETES the key when a cell is cleared
 * (`setJsonPath`), so clearing a template restores the built-in wording rather
 * than sending an empty subject line. Each box therefore shows the default it
 * would fall back to, which is also how somebody reads what a message currently
 * says before deciding to replace it.
 *
 * ---------------------------------------------------------------------------
 * THE MAILBOX IS READ-ONLY, DELIBERATELY
 * ---------------------------------------------------------------------------
 * `email_provider` is plumbing, not wording: its `secret_ref` names an
 * edge-function secret holding an OAuth refresh token, and its `from` must be
 * an address that credential is authorised to send as. **Gmail does not refuse
 * a `From` it is not authorised for — it silently REWRITES it**, so a typo here
 * would not fail, it would quietly start signing the shop's quotes as somebody
 * else. Changing it is a setup job with a document
 * (`docs/po-email-setup.md`), so this states what is in force and sends you
 * there.
 */

type Settings = Record<string, unknown>;

/**
 * WHAT EACH TOKEN PUTS ON THE PAGE (Mark, 2026-09-22: "a key next to the
 * messages fields would be useful"), having had to ask what
 * `{event_time_clause}` was — the screen listed the names and said nothing
 * about any of them.
 *
 * AN EXAMPLE, NOT A DESCRIPTION. "The event time with 'at' in front of it, or
 * nothing when there isn't one" is a sentence you have to parse; ` at 10:00 AM`
 * is the answer. It is also the shortest the line can be, which is what the
 * no-hints rule asks for where a line does earn its place — and these earn it,
 * because what a token produces is the one fact the name cannot show.
 *
 * The CLAUSE tokens are the ones worth reading twice: each carries its own
 * leading space and connecting word so it can vanish completely, which is why
 * the templates butt them straight against what comes before.
 */
const VAR_EXAMPLE: Record<string, string> = {
  number: "9885",
  title: "Birthday",
  title_suffix: " — Birthday, or nothing",
  first_name: "Alexandra, or “there”",
  full_name: "Alexandra David",
  employee_name: "Traci — whoever took the order, or nothing",
  fulfillment_note: "the pickup or delivery paragraph below",
  event_day: "Saturday September 26, 2026",
  ready_time: "9:00 AM",
  delivery_company: "DeliverLA",
  delivery_phone: "(310) 478-8000",
  delivery_window: "between 4:30 PM and 6:30 PM",
  tracking: "1696665, or nothing",
  org: "Donut Friend",
  event_date: "8/16/2026",
  event_time: "10:00 AM",
  event_time_clause: " at 10:00 AM, or nothing",
  cutoff_clause: "5pm on 8/14/2026, or “5pm TODAY”",
  location: "DONUT FRIEND 01 HIGHLAND PARK",
  total: "$248.00",
  subtotal: "$230.00",
  balance: "$124.00",
  paid: "$248.00",
  period: "Sep 14 – Sep 20",
  approve_line: "the approval link, as its own paragraph — only on a quote that has one",
  pay_line: "the pay link, as its own paragraph — only on an invoice with a balance, once online payment is set up",
  amount: "$124.00 — what was just paid",
  method: "visa ending 1111",
  balance_line: "“Balance remaining: $124.00” as its own line, or nothing when paid in full",
  receipt_line: "Square’s receipt link as its own line, or nothing (always nothing in sandbox)",
  due_on: "10/8/2026",
  orders: "the invoice’s lines, one per order, each with its amount",
  items: "what the customer built on the form, a line each, with an estimated subtotal — or nothing when they only described it",
};

/** The nine messages this module can send, in the order somebody meets them. */
const TEMPLATES: {
  key: keyof typeof DEFAULT_TEMPLATES;
  label: string;
  when: string;
  vars: string[];
}[] = [
  {
    key: "inquiry",
    label: "Inquiry received",
    // Worth spelling out: this one is not just a courtesy. Its Message-ID
    // becomes the thread root every later message replies onto.
    when:
      "Sent the moment somebody submits the public form. It also starts the " +
      "email thread — every quote, invoice and receipt for that order replies " +
      "onto this message.",
    vars: ["number", "first_name", "full_name", "employee_name", "org", "items"],
  },
  {
    key: "quote",
    label: "Quote",
    when: "Sent with the quote PDF. {approve_line} is the approval link, and only appears when there is one.",
    vars: ["number", "title", "title_suffix", "first_name", "full_name", "event_date", "event_time", "event_time_clause", "cutoff_clause", "location", "total", "employee_name", "fulfillment_note", "approve_line"],
  },
  {
    key: "invoice",
    label: "Invoice",
    when: "Sent with the invoice PDF. {pay_line} is the pay link, and only appears when there is one.",
    vars: ["number", "title_suffix", "first_name", "event_date", "event_time_clause", "cutoff_clause", "total", "balance", "employee_name", "fulfillment_note", "pay_line"],
  },
  {
    key: "payment",
    label: "Payment received",
    when: "Sent automatically when a customer pays online with the invoice’s pay link.",
    vars: ["number", "title_suffix", "first_name", "full_name", "amount", "method", "balance", "balance_line", "receipt_line", "employee_name"],
  },
  {
    key: "receipt",
    label: "Receipt",
    when: "Sent with the receipt PDF, once an order is settled.",
    vars: ["number", "title_suffix", "first_name", "event_date", "event_time_clause", "paid", "employee_name", "fulfillment_note"],
  },
  {
    key: "order",
    label: "Kitchen order",
    when: "Internal — the kitchen document, which carries no prices.",
    vars: ["number", "event_date"],
  },
  {
    key: "customer_invoice",
    label: "Customer invoice",
    when: "Sent with a customer invoice — several orders billed at once, like a wholesale week. {pay_line} is the pay link.",
    vars: ["number", "first_name", "full_name", "total", "due_on", "orders", "pay_line"],
  },
  {
    key: "invoice_payment",
    label: "Payment received (invoice)",
    when: "Sent automatically when a customer pays a customer invoice with its pay link.",
    vars: ["number", "first_name", "full_name", "amount", "method", "balance", "balance_line", "receipt_line"],
  },
  {
    key: "statement",
    label: "Statement",
    when: "A customer's orders over a period — the weekly wholesale bill.",
    vars: ["number", "first_name", "period", "total"],
  },
];

export function SpecialOrderSettings({
  orgId,
  settings,
  editable,
  section,
  shops = [],
}: {
  orgId: string;
  /** The org's open physical shops, for the delivery estimate's origin. */
  shops?: { id: string; label: string }[];
  settings: Settings;
  editable: boolean;
  /**
   * Which of the org settings screen's tabs this is rendering for (Mark,
   * 2026-09-05, moved the same day): `messages` is every piece of WORDING a
   * customer reads — the seven templates, the inquiry form's copy, the
   * documents' copy — and the mailbox they leave from; `general` is the timing
   * numbers. One component, because every cell writes the same jsonb
   * document through the same `cell` helper.
   */
  section: "general" | "messages";
}) {
  const so = (settings.special_orders ?? {}) as Record<string, unknown>;
  const provider = (so.email_provider ?? {}) as Record<string, unknown>;
  const emails = (so.email ?? {}) as Record<string, { subject?: string; body?: string }>;
  const fulfillmentNotes = (so.fulfillment_note ?? {}) as Record<string, unknown>;
  const squarePay = (settings.square_payments ?? {}) as Record<string, unknown>;
  const minimums = (so.inquiry_minimums ?? {}) as Record<string, unknown>;
  const delivery = (so.delivery ?? {}) as Record<string, unknown>;

  /** Every cell on this screen writes one key inside `orgs.settings`. */
  const cell = (
    path: string[],
    value: string | number | null,
    extra: Record<string, unknown> = {}
  ) => (
    <InlineValue
      table="orgs"
      id={orgId}
      column={path[path.length - 1]}
      value={value}
      jsonColumn="settings"
      jsonPath={path}
      jsonDocument={settings}
      {...extra}
    />
  );

  const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const num = (v: unknown) => (typeof v === "number" ? v : null);

  return (
    <div className="space-y-16">
      {section === "messages" ? (
        <>
      {/* ---- the messages ------------------------------------------- */}
      <section className="space-y-6">
        <SectionHeading count={TEMPLATES.length}>Messages we send</SectionHeading>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
          Each box holds the wording that will be sent.{" "}
          <strong>Clear one to go back to our default.</strong> Anything in
          curly braces is filled in when the message is sent; a name we do not
          recognise is left on the page as you typed it, so a typo is visible
          rather than swallowed.
        </p>

        {/* THE FIELD HOLDS THE DEFAULT, IT DOES NOT HINT AT IT (Mark,
            2026-09-22: "These placeholder texts are almost indistinguishable
            from actual text, so the impulse is to be able to click into the
            field and edit it, but when we do the text disappears since it's
            just placeholder").
            He is describing the failure exactly. A grey nine-line paragraph
            that reads like the message IS the message as far as anyone can
            tell, so clicking it is the obvious move — and clicking emptied the
            box, which is both a shock and a nine-line-to-two-line jump.
            It is also the placeholder convention being applied rather than
            bent: a default that will really be sent is a LIVE value, like the
            payment box resting at the outstanding balance, not example text.
            Live values belong in the field.
            NOTHING IS WRITTEN BY LOOKING. `InlineValue.write` returns early
            when the draft matches the value it was given, so clicking in and
            out of an untouched default saves nothing and the org stays on the
            default — including any later improvement to it. Only typing pins
            the wording to this org.
            AND CLEARING IS THE WAY BACK. An emptied cell writes null, the
            fallback resolves again, and the default reappears — which is the
            honest answer, since a template with no words is not a thing that
            can be sent. */}
        {TEMPLATES.map((t) => {
          const fallback = DEFAULT_TEMPLATES[t.key];
          const configured = emails[t.key] ?? {};
          return (
            /* WIDER THAN EVERY OTHER BLOCK ON THE PAGE, because it is the
               only one with two columns (Mark, 2026-09-22: "move the token keys
               to beside the message fields"). The rule spans the block, so it
               spans the wider block — a hairline stopping short of its own
               content reads as a mistake. `max-w-5xl` is exactly what the pair
               needs: the fields keep their 2xl reading width, 40px of gap, and
               a 288px key. The prose above keeps `max-w-2xl` regardless, since
               a sentence does not want the extra width. */
            <div key={t.key} className="max-w-5xl space-y-2 border-t border-hairline pt-5">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em]">
                {t.label}
              </h3>
              <p className="max-w-2xl text-[13px] leading-relaxed text-muted">{t.when}</p>

              {/* SIDE BY SIDE ONLY WHERE THERE IS ROOM FOR BOTH AT FULL SIZE.
                  672 + 40 + 288 = 1000, and `xl` with the page's own 48px
                  gutters leaves 1184 — so nothing is squeezed to achieve it.
                  Below that it stacks back to exactly what it was, key under
                  fields, because the alternative is a paragraph field narrowed
                  to make room for a legend. */}
              <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:gap-10">
              <dl className="min-w-0 max-w-2xl flex-1 space-y-3">
                <div className="space-y-1">
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">
                    Subject
                  </dt>
                  <dd>
                    {editable
                      ? cell(
                          ["special_orders", "email", t.key, "subject"],
                          text(configured.subject) ?? fallback.subject,
                          { ariaLabel: `${t.label} subject`, boxed: true }
                        )
                      : (
                        <span className="block whitespace-pre-wrap border border-hairline px-1 py-0.5 text-[13px]">
                          {configured.subject || fallback.subject}
                        </span>
                      )}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">
                    Body
                  </dt>
                  <dd>
                    {editable
                      ? cell(
                          ["special_orders", "email", t.key, "body"],
                          text(configured.body) ?? fallback.body,
                          { ariaLabel: `${t.label} body`, multiline: true, boxed: true }
                        )
                      : (
                        <span className="block min-h-16 whitespace-pre-wrap border border-hairline px-1 py-0.5 text-[13px]">
                          {configured.body || fallback.body}
                        </span>
                      )}
                  </dd>
                </div>
              </dl>

              {/* The key. A two-track grid rather than a table: the rows are
                  short, and a `DataTable` here would dress a legend as a list
                  you can sort. The grid's default stretch already puts a
                  wrapped example's first line level with its token.

                  THE TOKEN IS THE DARKER OF THE TWO (`muted` is neutral-600,
                  `subtle` neutral-500). You scan this column for the name you
                  half-remember and read across; it had them the other way round
                  for one commit, which made the thing you are looking for the
                  faintest text in the block. */}
              {/* The heading wears the SUBJECT/BODY dress (Mark, 2026-09-22),
                  so the two columns start on one line and read as peers rather
                  than as a field and an afterthought beside it. Sentence case
                  in the source like every other label here — `uppercase` is
                  what puts it on the page as FIELD TOKEN KEYS. */}
              <div className="shrink-0 space-y-1 xl:w-72">
                <p className="text-[11px] uppercase tracking-[0.12em] text-subtle">
                  Field token keys
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
                  {t.vars.map((v) => (
                    <Fragment key={v}>
                      <dt className="whitespace-nowrap text-muted">{`{${v}}`}</dt>
                      <dd className="text-subtle">{VAR_EXAMPLE[v] ?? ""}</dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
              </div>
            </div>
          );
        })}

        {/* THE TWO PARAGRAPHS `{fulfillment_note}` CHOOSES BETWEEN. They sit
            with the messages rather than under "What the documents say"
            because they are message wording, and they are settings rather than
            a composed token so the words stay where every other word a
            customer reads is edited. */}
        <div className="max-w-5xl space-y-2 border-t border-hairline pt-5">
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em]">
            What {"{fulfillment_note}"} says
          </h3>
          <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
            One of these, depending on the order. A line whose values are all
            empty is dropped, so an order with no tracking number simply does
            not get that sentence.
          </p>
          <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:gap-10">
            <dl className="min-w-0 max-w-2xl flex-1 space-y-3">
              {([
                ["pickup", "Pickup"] as const,
                ["delivery", "Delivery"] as const,
              ]).map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">
                    {label}
                  </dt>
                  <dd>
                    {editable
                      ? cell(
                          ["special_orders", "fulfillment_note", key],
                          text(fulfillmentNotes[key]) ?? DEFAULT_FULFILLMENT_NOTES[key],
                          { ariaLabel: `${label} note`, multiline: true, boxed: true }
                        )
                      : (
                        <span className="block whitespace-pre-wrap border border-hairline px-1 py-0.5 text-[13px]">
                          {text(fulfillmentNotes[key]) ?? DEFAULT_FULFILLMENT_NOTES[key]}
                        </span>
                      )}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="shrink-0 space-y-1 xl:w-72">
              <p className="text-[11px] uppercase tracking-[0.12em] text-subtle">
                Field token keys
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
                {["event_day", "ready_time", "delivery_company", "delivery_phone",
                  "delivery_window", "tracking"].map((v) => (
                  <Fragment key={v}>
                    <dt className="whitespace-nowrap text-muted">{`{${v}}`}</dt>
                    <dd className="text-subtle">{VAR_EXAMPLE[v] ?? ""}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
          </div>
        </div>

        <div className="max-w-2xl space-y-1 border-t border-hairline pt-5">
          <dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">
            Copy every customer message to
          </dt>
          <dd>
            {editable
              ? cell(["special_orders", "email_cc"], text(so.email_cc), {
                  placeholder: "nobody",
                  ariaLabel: "Cc on customer documents",
                })
              : <span>{text(so.email_cc) ?? "nobody"}</span>}
          </dd>
          <p className="text-[12px] text-subtle">
            Quotes, invoices and receipts staff send. Empty since 2026-09-24 —
            the sent copy is already in the specialorders@ mailbox, and the shop
            is told separately when a customer acts (below).
          </p>
        </div>

        {/* "Copy quote approvals to" (`approval_cc`) IS GONE (2026-09-24): the
            approval confirmation no longer Cc's the shop, which gets its own
            quote-approved notice at the address below. The key is left in
            the settings document, unread. */}
        {/* THE SHOP NOTICES (Mark, 2026-09-24; migration 137). Not copies of
            anything the customer receives — the shop's own emails, sent the
            moment a customer acts without anybody here pressing a button: a
            new inquiry, a quote approved (with the signed PDF), a payment
            taken online (Square or QuickBooks). The key is still called
            `inquiry_notify`, from when it was only the first of the three.
            Empty really is nobody: none of them is sent. */}
        <div className="max-w-2xl space-y-1 border-t border-hairline pt-5">
          <dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">
            Tell us when a customer acts, at
          </dt>
          <dd>
            {editable
              ? cell(["special_orders", "inquiry_notify"], text(so.inquiry_notify), {
                  placeholder: "nobody",
                  ariaLabel: "Shop notices go to",
                })
              : <span>{text(so.inquiry_notify) ?? "nobody"}</span>}
          </dd>
          <p className="text-[12px] text-subtle">
            One email each for a new inquiry, an approved quote (with the signed
            PDF) and a payment taken online. Several addresses are separated by
            commas; leave empty for none.
          </p>
        </div>
      </section>
      {/* ---- the public form ---------------------------------------- */}
      <section className="space-y-4">
        <SectionHeading>What the inquiry form says</SectionHeading>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
          The two paragraphs a customer reads on the public form. The notice is
          a NOTICE — it never stops anybody choosing a date inside the cutoff.
        </p>
        <dl className="max-w-2xl space-y-4">
          <div className="space-y-1">
            <dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">
              Introduction
            </dt>
            <dd>
              {editable
                ? cell(["special_orders", "inquiry_intro"], text(so.inquiry_intro), {
                    multiline: true, boxed: true, ariaLabel: "Inquiry form introduction",
                  })
                : <span className="whitespace-pre-wrap">{text(so.inquiry_intro) ?? "—"}</span>}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">
              Lead-time notice
            </dt>
            <dd>
              {editable
                ? cell(["special_orders", "inquiry_cutoff_notice"], text(so.inquiry_cutoff_notice), {
                    multiline: true, boxed: true, ariaLabel: "Inquiry form lead-time notice",
                  })
                : <span className="whitespace-pre-wrap">{text(so.inquiry_cutoff_notice) ?? "—"}</span>}
            </dd>
          </div>
        </dl>
      </section>
      {/* ---- the documents ------------------------------------------ */}
      <section className="space-y-4">
        <SectionHeading>What the documents say</SectionHeading>
        <dl className="max-w-2xl space-y-4">
          <div className="space-y-1">
            <dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">
              Terms, printed on every quote
            </dt>
            <dd>
              {editable
                ? cell(["special_orders", "terms"], text(so.terms), {
                    multiline: true, boxed: true, ariaLabel: "Quote terms",
                  })
                : <span className="whitespace-pre-wrap">{text(so.terms) ?? "—"}</span>}
            </dd>
            <p className="text-[12px] text-subtle">
              The customer agrees to this wording when they approve a quote
              online, so the rush-fee figures below should match what it says.
            </p>
          </div>
          <div className="space-y-1">
            <dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">
              Invoice footer
            </dt>
            <dd>
              {editable
                ? cell(["special_orders", "invoice_footer"], text(so.invoice_footer), {
                    ariaLabel: "Invoice footer",
                  })
                : <span>{text(so.invoice_footer) ?? "—"}</span>}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">
              Phone number on documents
            </dt>
            <dd>
              {editable
                ? cell(["special_orders", "document_phone"], text(so.document_phone), {
                    placeholder: String(
                      ((settings.billing ?? {}) as Record<string, unknown>).phone ?? "none"
                    ),
                    ariaLabel: "Phone number printed on documents",
                  })
                : <span>{text(so.document_phone) ?? "—"}</span>}
            </dd>
            <p className="text-[12px] text-subtle">
              Empty falls back to the billing phone.
            </p>
          </div>
        </dl>
      </section>
      {/* ---- the mailbox, stated not offered ------------------------ */}
      <section className="space-y-4">
        <SectionHeading>Where these are sent from</SectionHeading>
        <dl className="grid max-w-2xl grid-cols-[10rem_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="py-0.5 text-subtle">From</dt>
          <dd className="py-0.5">{String(provider.from ?? "the app's own sender")}</dd>
          <dt className="py-0.5 text-subtle">Replies go to</dt>
          <dd className="py-0.5">{String(provider.reply_to ?? provider.from ?? "—")}</dd>
          <dt className="py-0.5 text-subtle">Through</dt>
          <dd className="py-0.5">
            {provider.kind ? String(provider.kind) : "the app's default"}
            {provider.secret_ref ? ` · ${String(provider.secret_ref)}` : ""}
          </dd>
        </dl>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
          Not editable here, on purpose. The credential behind this lives in the
          server&rsquo;s own secrets and never in the database, and the address has to
          be one that credential is allowed to send as —{" "}
          <strong>Gmail does not refuse an address it is not authorised for, it
          silently replaces it</strong>, so a typo would not fail, it would
          quietly start signing your quotes as somebody else. Changing it is a
          setup job: see <code>docs/po-email-setup.md</code>.
        </p>
      </section>
        </>
      ) : (
        <>
      {/* ---- the numbers -------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeading>Timing and limits</SectionHeading>
        <dl className="grid max-w-2xl grid-cols-[1fr_6rem] gap-x-6 gap-y-1 text-sm">
          <Num label="Rush fee applies within (business days)" path={["special_orders", "rush_cutoff_business_days"]} v={num(so.rush_cutoff_business_days)} {...{ cell, editable }} />
          <Num label="Rush fee minimum ($)" path={["special_orders", "rush_minimum"]} v={num(so.rush_minimum)} {...{ cell, editable }} />
          <Num label="Rush fee rate (%)" path={["special_orders", "rush_rate"]} v={num(so.rush_rate)} percent
               orgId={orgId} settings={settings} {...{ cell, editable }} />
          <Num label="Deposit, suggested by New Payment (%)" path={["special_orders", "deposit_rate"]} v={num(so.deposit_rate)} percent
               orgId={orgId} settings={settings} {...{ cell, editable }} />
          <Num label="Chase a quote after (days)" path={["special_orders", "attention_quote_unanswered_days"]} v={num(so.attention_quote_unanswered_days)} {...{ cell, editable }} />
          <Num label="Flag unpaid within (days of the event)" path={["special_orders", "attention_unpaid_within_days"]} v={num(so.attention_unpaid_within_days)} {...{ cell, editable }} />
          <Num label="Flag unprinted within (days of the event)" path={["special_orders", "attention_print_within_days"]} v={num(so.attention_print_within_days)} {...{ cell, editable }} />
          <Num label="Standing orders made this far ahead (days)" path={["special_orders", "horizon_days"]} v={num(so.horizon_days)} {...{ cell, editable }} />
          <Num label="Inquiries accepted per hour, per email" path={["special_orders", "inquiry_max_per_email_per_hour"]} v={num(so.inquiry_max_per_email_per_hour)} {...{ cell, editable }} />
          <Num label="Inquiries accepted per hour, in total" path={["special_orders", "inquiry_max_per_hour"]} v={num(so.inquiry_max_per_hour)} {...{ cell, editable }} />
        </dl>
      </section>

      {/* ---- the inquiry form's minimums (migration 132) ------------------
          Each category a customer orders must meet its own (Mark,
          2026-09-24). Read by the form AND by `create_inquiry`, which refuses
          a basket short of any of them. 0 turns one off. */}
      <section className="space-y-4">
        <SectionHeading>Inquiry form minimums</SectionHeading>
        <dl className="grid max-w-2xl grid-cols-[1fr_6rem] gap-x-6 gap-y-1 text-sm">
          <Num label="Donuts, in total" path={["special_orders", "inquiry_minimums", "regular"]} v={num(minimums.regular)} {...{ cell, editable }} />
          <Num label="Mini donuts, in total" path={["special_orders", "inquiry_minimums", "mini"]} v={num(minimums.mini)} {...{ cell, editable }} />
          <Num label="Mini donuts, of each flavor" path={["special_orders", "inquiry_minimums", "mini_per_flavor"]} v={num(minimums.mini_per_flavor)} {...{ cell, editable }} />
          <Num label="Donut letters, in total" path={["special_orders", "inquiry_minimums", "letter"]} v={num(minimums.letter)} {...{ cell, editable }} />
          <Num label="Giant donuts, in total" path={["special_orders", "inquiry_minimums", "giant"]} v={num(minimums.giant)} {...{ cell, editable }} />
        </dl>
      </section>

      {/* ---- the delivery estimate (inquiry form) --------------------------
          Base fee + a rate per DRIVING mile from one shop, worked out by the
          `inquiry-delivery-quote` function (Google Routes). Beyond the maximum
          the form says "we'll quote it". Until the shop and the per-mile rate
          are both set, the form offers no estimate at all. Only the computed
          fee ever reaches a customer; these numbers stay here. */}
      <section className="space-y-4">
        <SectionHeading>Delivery estimate</SectionHeading>
        <dl className="grid max-w-2xl grid-cols-[1fr_12rem] gap-x-6 gap-y-1 text-sm">
          <dt className="py-0.5 text-subtle">Measured from</dt>
          <dd className="py-0.5">
            {editable
              ? cell(["special_orders", "delivery", "origin_location_id"], text(delivery.origin_location_id), {
                  kind: "pick",
                  options: shops.map((s) => ({ value: s.id, label: s.label })),
                  ariaLabel: "Delivery measured from",
                })
              : <span>{shops.find((s) => s.id === delivery.origin_location_id)?.label ?? "—"}</span>}
          </dd>
          <Num label="Base fee ($)" path={["special_orders", "delivery", "base_fee"]} v={num(delivery.base_fee)} {...{ cell, editable }} />
          <Num label="Per mile ($)" path={["special_orders", "delivery", "per_mile"]} v={num(delivery.per_mile)} {...{ cell, editable }} />
          <Num label="Farthest we estimate (miles)" path={["special_orders", "delivery", "max_miles"]} v={num(delivery.max_miles)} {...{ cell, editable }} />
        </dl>
      </section>
      {/* ---- the pay link (migrations 119, 120) --------------------------
          `orgs.settings.square_payments`, outside `special_orders` because
          wholesale invoices will read it too. The ids are PUBLIC by Square's
          design (they sit in every Square checkout's page source); the access
          token is not, and lives only in the `square-pay` function's secrets.
          There is NO location here for real payments: since 120 a payment
          lands at the Square location of the shop that makes the order (Mark,
          2026-09-22). The sandbox one exists because the sandbox is a
          separate Square account where DF01's real id does not exist.
          The item variation ids (123) name the "Special Order" item every
          pay-link line is sold as, which is what files the money under the
          Special Orders category; empty reports as Uncategorized. The sandbox
          has its own catalog, so its own id.
          Until the application id is filled, no invoice carries a pay link. */}
      <section className="space-y-4">
        <SectionHeading>Online payment (Square)</SectionHeading>
        <dl className="grid max-w-2xl grid-cols-[14rem_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="py-0.5 text-subtle">Environment</dt>
          <dd className="py-0.5">
            {editable
              ? cell(["square_payments", "environment"], text(squarePay.environment), {
                  kind: "pick",
                  options: [
                    { value: "production", label: "Production" },
                    { value: "sandbox", label: "Sandbox (testing)" },
                  ],
                  ariaLabel: "Square environment",
                })
              : <span>{text(squarePay.environment) ?? "—"}</span>}
          </dd>
          <dt className="py-0.5 text-subtle">Application ID</dt>
          <dd className="py-0.5">
            {editable
              ? cell(["square_payments", "application_id"], text(squarePay.application_id), {
                  ariaLabel: "Square application ID",
                })
              : <span>{text(squarePay.application_id) ?? "—"}</span>}
          </dd>
          {/* THE ITEMS A PAYMENT IS SOLD AS, chosen from Square's own catalog
              (2026-09-23) — the environment the pay link charges into is a
              picker, the other is typed. "Wholesale Order" (125) is used when
              every order being paid was made by a standing order; empty, those
              payments are sold as the Special Order item as before. */}
          {(
            [
              ["item_variation_id", "“Special Order” item", "production"],
              ["wholesale_item_variation_id", "“Wholesale Order” item", "production"],
              ["sandbox_item_variation_id", "Sandbox “Special Order” item", "sandbox"],
              ["sandbox_wholesale_item_variation_id", "Sandbox “Wholesale Order” item", "sandbox"],
            ] as const
          ).map(([key, label, env]) => (
            <Fragment key={key}>
              <dt className="py-0.5 text-subtle">{label}</dt>
              <dd className="py-0.5">
                {editable ? (
                  <SquareItemSetting
                    orgId={orgId}
                    path={["square_payments", key]}
                    value={text(squarePay[key])}
                    settings={settings}
                    environment={env}
                    label={`Square ${label.replace(/[“”]/g, "")}`}
                  />
                ) : (
                  <span>{text(squarePay[key]) ?? "—"}</span>
                )}
              </dd>
            </Fragment>
          ))}
          <dt className="py-0.5 text-subtle">Sandbox location ID</dt>
          <dd className="py-0.5">
            {editable
              ? cell(["square_payments", "sandbox_location_id"], text(squarePay.sandbox_location_id), {
                  ariaLabel: "Square sandbox location ID",
                })
              : <span>{text(squarePay.sandbox_location_id) ?? "—"}</span>}
          </dd>
        </dl>
      </section>
        </>
      )}
    </div>
  );
}

/** One numeric setting — a label and a right-aligned box, in a two-track dl. */
function Num({
  label,
  path,
  v,
  cell,
  editable,
  percent = false,
  orgId,
  settings,
}: {
  label: string;
  path: string[];
  v: number | null;
  cell: (p: string[], value: string | number | null, extra?: Record<string, unknown>) => React.ReactNode;
  editable: boolean;
  /** TYPED AND READ AS A PERCENTAGE, stored as a fraction (Mark, 2026-09-22:
   *  "the user facing rush fee field should be a percentage, i.e. 35%"). The
   *  same `PERCENT_SCALE` the order's own rate cells use, so the number means
   *  one thing in both places. */
  percent?: boolean;
  /** Only the percent branch needs these: it renders its own client component
   *  rather than going through `cell`, because `cell` cannot carry a function
   *  across the server boundary. See `PercentSetting`. */
  orgId?: string;
  settings?: Record<string, unknown>;
}) {
  return (
    <div className="contents">
      <dt className="py-0.5 text-subtle">{label}</dt>
      <dd className="py-0.5">
        {!editable ? (
          <span className="tabular-nums">
            {percent ? percentLabel(toPercent(v ?? 0)) : (v ?? "—")}
          </span>
        ) : percent && orgId && settings ? (
          <PercentSetting orgId={orgId} path={path} value={v} settings={settings} label={label} />
        ) : (
          cell(path, v, { kind: "number", align: "right", ariaLabel: label })
        )}
      </dd>
    </div>
  );
}
