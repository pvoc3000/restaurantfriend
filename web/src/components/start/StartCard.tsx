import Link from "next/link";

/** One count on a card, e.g. "3 awaiting approval". */
export type CardLine = {
  count: number;
  label: string;
  href?: string;
  /**
   * Does a count here mean somebody has to DO something? Default yes. A line
   * that only informs — "sent, still to arrive", "awaiting payment" — says
   * false: its count is set in ink rather than on the yellow fill, and it is
   * left out of the Home button's badge (2026-10-20), so the badge is always
   * the sum of the yellow numbers on your page.
   */
  urgent?: boolean;
  /** Yellow, but already inside another line's count — "flagged" is a part of
   *  "need attention" — so the badge must not count it twice. */
  subset?: boolean;
};

/** A card's body, as a widget computes it once for the card and the badge. */
export type CardSummary = { lines: CardLine[]; items?: CardItem[]; error?: string | null; footnote?: string | null };

/** What a card adds to the Home button's badge: its urgent counts, once each.
 *  A card that failed to load adds nothing. */
export function urgentCount(summary: CardSummary): number {
  if (summary.error) return 0;
  return summary.lines.reduce((n, l) => (l.urgent === false || l.subset ? n : n + l.count), 0);
}

/** One of the handful of records a card names. */
export type CardItem = {
  primary: string;
  secondary?: string;
  href?: string;
};

/** The most records a card is handed — what a three-column widget shows. */
export const CARD_ITEMS = 10;

/**
 * Which records show at which width (2026-10-20). The body is rendered whole
 * and the widget's own width decides — `@container` is on the widget frame — so
 * changing a widget's width in edit mode needs no trip to the server. Three at
 * one column (the page as it was), six at two, all ten at three.
 * Whole literals, so Tailwind ships them.
 */
function itemClass(i: number): string {
  if (i < 3) return "min-w-0";
  if (i < 6) return "hidden min-w-0 @xl:block";
  return "hidden min-w-0 @4xl:block";
}

/**
 * A NEEDS-ATTENTION CARD's body on the desk start page: a few counts, and the
 * top few records by name. The frame — the title that links to the list, the
 * tint, the edit-mode grip and corner menu — is `StartWidget`'s.
 *
 * A count above zero wears the mark FILL, never yellow ink (1.43:1 on white);
 * a zero is quiet. `error` replaces the body when the card's query failed —
 * the page still opens, and a card that silently read "0" would be claiming
 * nothing is outstanding.
 *
 * WIDER, IT SAYS MORE. One column is the card as it was: counts over the
 * records. From two columns the counts sit on the left and the records on the
 * right, and at three the records run in two columns of their own.
 */
export function StartCard({
  lines,
  items = [],
  error,
  footnote,
}: {
  lines: CardLine[];
  items?: CardItem[];
  error?: string | null;
  footnote?: string | null;
}) {
  if (error) return <p className="text-sm text-accent">Could not load: {error}</p>;

  return (
    <div className="grid gap-3 @xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @xl:gap-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="space-y-3">
        <ul className="space-y-1.5">
          {lines.map((line) => {
            const body = (
              <>
                <span
                  className={`inline-block min-w-8 px-1 text-center font-bold tabular-nums ${
                    line.count === 0 ? "text-faint" : line.urgent === false ? "text-ink" : "bg-mark-fill text-ink"
                  }`}
                >
                  {line.count}
                </span>
                <span className={line.count > 0 ? "text-ink" : "text-muted"}>{line.label}</span>
              </>
            );
            return (
              <li key={line.label} className="flex items-baseline gap-2 text-[15px]">
                {line.href && line.count > 0 ? (
                  <Link href={line.href} className="flex items-baseline gap-2 no-underline hover:underline">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
        {footnote && <p className="text-[13px] text-muted">{footnote}</p>}
      </div>

      {items.length > 0 && (
        <ul className="grid content-start gap-2 border-t border-hairline pt-3 text-[14px] @xl:border-l @xl:border-t-0 @xl:pl-6 @xl:pt-0 @4xl:grid-cols-2 @4xl:gap-x-6">
          {items.slice(0, CARD_ITEMS).map((item, i) => (
            // The name over its detail, never side by side: at one column the
            // reason ("Event has passed — send the receipt") is the half worth
            // reading, and beside the name it was cut off.
            <li key={i} className={itemClass(i)}>
              {item.href ? (
                <Link href={item.href} title={item.primary} className="block truncate text-ink underline">
                  {item.primary}
                </Link>
              ) : (
                <span title={item.primary} className="block truncate text-ink">
                  {item.primary}
                </span>
              )}
              {item.secondary && (
                <span className="block text-[13px] tabular-nums text-muted">{item.secondary}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
