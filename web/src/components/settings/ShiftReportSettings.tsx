import { InlineValue } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";

type Settings = Record<string, unknown>;

/**
 * The shift report's settings — and there are fewer of them than the other
 * modules have, deliberately.
 *
 * ---------------------------------------------------------------------------
 * THERE ARE NO BODY TEMPLATES, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * Every other message this app sends is a LETTER — a quote, an invoice, a
 * purchase order — so `orgs.settings` carries its subject and body and
 * `/settings` edits them, which is design rule 2 working properly.
 *
 * A shift report is not a letter. Its body is a rendering of the night: the
 * narrative somebody typed, a table of premades, a table of ratings, the sales
 * beside last week's. There is no wording to own — the words are the
 * supervisor's and the numbers are the shop's — and a template box over HTML
 * tables would be a way to break the layout rather than a way to set the tone.
 *
 * So the one thing genuinely configurable is WHERE REPLIES GO, plus a statement
 * of the mailbox in force. If a covering sentence is ever wanted at the top of
 * the report, that is the moment to add a template — one key, and this block
 * already has the shape for it.
 *
 * ---------------------------------------------------------------------------
 * RECIPIENTS ARE NOT HERE EITHER
 * ---------------------------------------------------------------------------
 * They are derived from `org_members.role` (Mark, 2026-08-28): management is
 * owner and admin, supervisors are purchaser and supervisor. Nobody maintains a
 * list, so nobody forgets to take a leaver off one — which is the failure a
 * hand-kept address list has, and it fails silently.
 *
 * ---------------------------------------------------------------------------
 * THE MAILBOX IS STATED, NEVER OFFERED
 * ---------------------------------------------------------------------------
 * `SpecialOrderSettings`' reasoning, verbatim and for the same reason: a
 * provider's `from` must be an address its credential may send as, and **Gmail
 * does not refuse a `From` it is not authorised for — it silently REWRITES
 * it**, so a typo would not fail loudly, it would quietly sign the shop's
 * reports as somebody else.
 */
export function ShiftReportSettings({
  settings,
  editable,
}: {
  settings: Settings;
  editable: boolean;
}) {
  const shift = (settings.shift_report ?? {}) as Settings;
  const provider = (shift.email_provider ?? settings.email_provider ?? null) as {
    kind?: string;
    from?: string;
    secret_ref?: string;
  } | null;
  const billing = (settings.billing ?? {}) as Settings;

  return (
    <section className="space-y-4">
      <SectionHeading>Shift reports</SectionHeading>

      <dl className="max-w-[min(42rem,max(24rem,50%))] space-y-3">
        <div className="grid grid-cols-[10rem_1fr] items-baseline gap-x-6">
          <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            Replies go to
          </dt>
          <dd>
            {editable ? (
              <InlineValue
                table="orgs"
                column="reply_to"
                jsonColumn="settings"
                jsonPath={["shift_report", "reply_to"]}
                jsonDocument={settings}
                value={(shift.reply_to as string | null) ?? null}
                boxed
                ariaLabel="Where replies to a shift report go"
                placeholder={(billing.email as string) ?? "the sending mailbox"}
              />
            ) : (
              <span className="text-sm">
                {(shift.reply_to as string) ?? (billing.email as string) ?? "—"}
              </span>
            )}
          </dd>
        </div>

        <div className="grid grid-cols-[10rem_1fr] items-baseline gap-x-6">
          <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            Sent from
          </dt>
          <dd className="text-sm">
            {provider?.from ?? "the app's own default sender"}
            {provider?.kind ? (
              <span className="text-muted"> · {provider.kind}</span>
            ) : null}
          </dd>
        </div>
      </dl>

      <p className="max-w-xl text-sm text-muted">
        Who receives a report is decided by role, not by a list: managers and the owner get the
        version WITH staff ratings, purchasers and supervisors get the one without. Changing the
        mailbox itself is a setup job — see <code>docs/po-email-setup.md</code>.
      </p>
    </section>
  );
}
