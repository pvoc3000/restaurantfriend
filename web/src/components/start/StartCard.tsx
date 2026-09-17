import Link from "next/link";

/** One count on a card, e.g. "3 awaiting approval". */
export type CardLine = {
  count: number;
  label: string;
  href?: string;
};

/** One of the handful of records a card names. */
export type CardItem = {
  primary: string;
  secondary?: string;
  href?: string;
};

/**
 * A NEEDS-ATTENTION CARD on the desk start page: a heading that links to the
 * list, a few counts, and the top few records by name.
 *
 * A count above zero wears the mark FILL, never yellow ink (1.43:1 on white);
 * a zero is quiet. `error` replaces the body when the card's query failed —
 * the page still opens, and a card that silently read "0" would be claiming
 * nothing is outstanding.
 */
export function StartCard({
  title,
  href,
  lines,
  items = [],
  error,
  footnote,
}: {
  title: string;
  href: string;
  lines: CardLine[];
  items?: CardItem[];
  error?: string | null;
  footnote?: string | null;
}) {
  return (
    <section className="flex flex-col gap-3 border border-ink bg-white px-5 py-4">
      <h2 className="text-[16px] font-bold uppercase tracking-[0.08em]">
        <Link href={href} className="text-ink no-underline hover:underline">
          {title}
        </Link>
      </h2>

      {error ? (
        <p className="text-sm text-accent">Could not load: {error}</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {lines.map((line) => {
              const body = (
                <>
                  <span
                    className={`inline-block min-w-8 px-1 text-center font-bold tabular-nums ${
                      line.count > 0 ? "bg-mark-fill text-ink" : "text-faint"
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

          {items.length > 0 && (
            <ul className="space-y-2 border-t border-hairline pt-3 text-[14px]">
              {items.map((item, i) => (
                // The name over its detail, never side by side: at three cards
                // a row the reason ("Event has passed — send the receipt") is
                // the half worth reading, and beside the name it was cut off.
                <li key={i} className="min-w-0">
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

          {footnote && <p className="text-[13px] text-muted">{footnote}</p>}
        </>
      )}
    </section>
  );
}
