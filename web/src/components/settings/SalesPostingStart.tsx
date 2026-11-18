import { InlineValue } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { readPostingStart } from "@/lib/salesPosting";

type Settings = Record<string, unknown>;

/**
 * WHERE THIS APP'S POSTING STARTS (Mark, 2026-11-18) — `lib/salesPosting`'s
 * `readPostingStart`. Before these dates somebody else booked the money
 * (Shogo, until the cutover), so a day or a deposit before them is never
 * posted: Post to QuickBooks… leaves it out, the builder refuses it, and
 * `qbo-sync` refuses it again. It exists so a backfill of old days from
 * Square can never become a second booking of them.
 */
export function SalesPostingStart({
  orgId,
  settings,
  editable,
}: {
  orgId: string;
  settings: Settings;
  editable: boolean;
}) {
  const start = readPostingStart(settings);
  const fields: { label: string; path: "entries_from" | "deposits_from"; value: string | null; aria: string }[] = [
    { label: "Sales from", path: "entries_from", value: start.entriesFrom, aria: "The first day whose sales are posted" },
    { label: "Deposits from", path: "deposits_from", value: start.depositsFrom, aria: "The first arrival date whose deposits are posted" },
  ];
  const row = "grid grid-cols-[10rem_1fr] items-baseline gap-x-6";
  const term = "text-xs font-semibold uppercase tracking-[0.08em] text-muted";

  return (
    <section className="space-y-4">
      <SectionHeading>Posting Starts</SectionHeading>
      <dl className="max-w-[min(42rem,max(24rem,50%))] space-y-3">
        {fields.map((f) => (
          <div key={f.path} className={row}>
            <dt className={term}>{f.label}</dt>
            <dd>
              {editable ? (
                <InlineValue
                  table="orgs"
                  id={orgId}
                  column={f.path}
                  jsonColumn="settings"
                  jsonPath={["sales_posting", f.path]}
                  jsonDocument={settings}
                  value={f.value}
                  kind="date"
                  nullable
                  boxed
                  ariaLabel={f.aria}
                />
              ) : (
                <span className="text-sm tabular-nums">{f.value ?? "—"}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
