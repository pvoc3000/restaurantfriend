import { InlineValue } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { DEFAULT_TEMPLATES } from "@/lib/specialOrderDocs";

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

/** The six messages this module can send, in the order somebody meets them. */
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
    vars: ["number", "first_name", "full_name", "org"],
  },
  {
    key: "quote",
    label: "Quote",
    when: "Sent with the quote PDF. {approve_line} is the approval link, and only appears when there is one.",
    vars: ["number", "title", "title_suffix", "first_name", "full_name", "event_date", "event_time", "event_time_clause", "location", "total", "approve_line"],
  },
  {
    key: "invoice",
    label: "Invoice",
    when: "Sent with the invoice PDF.",
    vars: ["number", "title_suffix", "first_name", "event_date", "event_time_clause", "total", "balance"],
  },
  {
    key: "receipt",
    label: "Receipt",
    when: "Sent with the receipt PDF, once an order is settled.",
    vars: ["number", "title_suffix", "first_name", "event_date", "event_time_clause", "paid"],
  },
  {
    key: "order",
    label: "Kitchen order",
    when: "Internal — the kitchen document, which carries no prices.",
    vars: ["number", "event_date"],
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
}: {
  orgId: string;
  settings: Settings;
  editable: boolean;
}) {
  const so = (settings.special_orders ?? {}) as Record<string, unknown>;
  const provider = (so.email_provider ?? {}) as Record<string, unknown>;
  const emails = (so.email ?? {}) as Record<string, { subject?: string; body?: string }>;

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
      {/* ---- the messages ------------------------------------------- */}
      <section className="space-y-6">
        <SectionHeading count={TEMPLATES.length}>Messages we send</SectionHeading>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
          Each box shows the wording that is used when you have not set your
          own. <strong>Clear a box to go back to it.</strong> Anything in curly
          braces is filled in when the message is sent; a name we do not
          recognise is left on the page as you typed it, so a typo is visible
          rather than swallowed.
        </p>

        {TEMPLATES.map((t) => {
          const fallback = DEFAULT_TEMPLATES[t.key];
          const configured = emails[t.key] ?? {};
          return (
            <div key={t.key} className="max-w-2xl space-y-2 border-t border-hairline pt-5">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em]">
                {t.label}
              </h3>
              <p className="text-[13px] leading-relaxed text-muted">{t.when}</p>

              <dl className="space-y-3">
                <div className="space-y-1">
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">
                    Subject
                  </dt>
                  <dd>
                    {editable
                      ? cell(["special_orders", "email", t.key, "subject"], text(configured.subject), {
                          placeholder: fallback.subject,
                          ariaLabel: `${t.label} subject`,
                          boxed: true,
                        })
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
                      ? cell(["special_orders", "email", t.key, "body"], text(configured.body), {
                          placeholder: fallback.body,
                          ariaLabel: `${t.label} body`,
                          multiline: true,
                          boxed: true,
                        })
                      : (
                        <span className="block min-h-16 whitespace-pre-wrap border border-hairline px-1 py-0.5 text-[13px]">
                          {configured.body || fallback.body}
                        </span>
                      )}
                  </dd>
                </div>
              </dl>

              <p className="text-[12px] text-subtle">
                {t.vars.map((v) => `{${v}}`).join(" · ")}
              </p>
            </div>
          );
        })}

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
            Quotes, invoices and receipts. Leave empty for none — the sent copy
            is already in the specialorders@ mailbox either way.
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

      {/* ---- the numbers -------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeading>Timing and limits</SectionHeading>
        <dl className="grid max-w-2xl grid-cols-[1fr_6rem] gap-x-6 gap-y-1 text-sm">
          <Num label="Rush fee applies within (business days)" path={["special_orders", "rush_cutoff_business_days"]} v={num(so.rush_cutoff_business_days)} {...{ cell, editable }} />
          <Num label="Rush fee minimum ($)" path={["special_orders", "rush_minimum"]} v={num(so.rush_minimum)} {...{ cell, editable }} />
          <Num label="Rush fee rate (a fraction — .30 is 30%)" path={["special_orders", "rush_rate"]} v={num(so.rush_rate)} {...{ cell, editable }} />
          <Num label="Chase a quote after (days)" path={["special_orders", "attention_quote_unanswered_days"]} v={num(so.attention_quote_unanswered_days)} {...{ cell, editable }} />
          <Num label="Flag unpaid within (days of the event)" path={["special_orders", "attention_unpaid_within_days"]} v={num(so.attention_unpaid_within_days)} {...{ cell, editable }} />
          <Num label="Flag unprinted within (days of the event)" path={["special_orders", "attention_print_within_days"]} v={num(so.attention_print_within_days)} {...{ cell, editable }} />
          <Num label="Standing orders made this far ahead (days)" path={["special_orders", "horizon_days"]} v={num(so.horizon_days)} {...{ cell, editable }} />
          <Num label="Inquiries accepted per hour, per email" path={["special_orders", "inquiry_max_per_email_per_hour"]} v={num(so.inquiry_max_per_email_per_hour)} {...{ cell, editable }} />
          <Num label="Inquiries accepted per hour, in total" path={["special_orders", "inquiry_max_per_hour"]} v={num(so.inquiry_max_per_hour)} {...{ cell, editable }} />
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
}: {
  label: string;
  path: string[];
  v: number | null;
  cell: (p: string[], value: string | number | null, extra?: Record<string, unknown>) => React.ReactNode;
  editable: boolean;
}) {
  return (
    <div className="contents">
      <dt className="py-0.5 text-subtle">{label}</dt>
      <dd className="py-0.5">
        {editable
          ? cell(path, v, { kind: "number", align: "right", ariaLabel: label })
          : <span className="tabular-nums">{v ?? "—"}</span>}
      </dd>
    </div>
  );
}
