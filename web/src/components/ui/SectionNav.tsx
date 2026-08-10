import Link from "next/link";

/**
 * A record's own sections, as plain text links (Mark, 2026-08-06: "make the
 * menu tab just text without any borders. The active cell can be bold, inactive
 * a dark grey"). Gusto's employee sidebar is the reference.
 *
 * THE ONE WAY THIS APP TABS A DETAIL SCREEN, and the whole reason it is a
 * component rather than markup on the employee record (Mark, 2026-08-06, having
 * seen it: "if we need tabs in any detail view in the future, this is the way to
 * do it, and we should reuse the code here so it doesn't drift"). The rest of
 * the pattern — the tab in the URL, the per-tab fetching, the identity block
 * indented to the content column — is written up under "A detail screen that
 * outgrows one page" in CLAUDE.md, with `/employees/[id]` as the worked example.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A `ui/TabPicker`
 *
 * The convention says every one-of-N choice is a TabPicker, and its selected
 * cell is always black. That rule is about CHOOSING — a filter, a scope, a view
 * mode: things that change what a screen shows you. This navigates: each item
 * is a different address, the browser's back button walks them, and a link that
 * can be opened in a new tab is not a segmented control.
 *
 * The app already agrees. `AppNav`'s two tiers are navigation and mark their
 * active item with colour and weight rather than a filled cell; nothing about
 * them is a TabPicker either. A record's sections are the third navigation
 * surface, so they read like the other two rather than like a filter bar — and
 * a bordered box beside a bordered table beside a bordered filter row was three
 * boxes deep before anybody had read a word.
 *
 * Weight carries the state and colour supports it: bold black for where you
 * are, `text-muted` (neutral-600 — the darkest of the three greys, not a
 * disabled grey) for everywhere else. That is the same pairing `AppNav` uses,
 * minus the yellow it needs to survive a black band.
 */
export type SectionNavItem<K extends string = string> = {
  key: K;
  label: string;
  /** Omit only when the nav is driven by `onSelect`. */
  href?: string;
  /** Shown after the label, dimmed and tabular. */
  count?: number;
};

export function SectionNav<K extends string>({
  items,
  value,
  orientation = "vertical",
  ariaLabel,
  className = "",
  onSelect,
}: {
  items: readonly SectionNavItem<K>[];
  value: K;
  /**
   * Sections of a record that has NO ROUTE — the batch log's detail pane, where
   * the subject is whichever row you clicked and lives in React state.
   *
   * Given this, each item renders as a button rather than a Link. Everything
   * else is identical, deliberately: the argument above is about how a record's
   * sections should LOOK and how state should read on them, and that doesn't
   * change because the record happens not to have an address. What would change
   * it is being a filter — and switching Info to Recipe is not narrowing the
   * batch, it is looking at another part of the same one.
   *
   * A URL was the alternative and is wrong here for a concrete reason: a batch
   * is picked from a list of thirty, so the tab flips constantly, and each flip
   * would be a navigation that re-runs the whole log's server component.
   */
  onSelect?: (key: K) => void;
  /**
   * `horizontal` is the narrow-screen form — the same links in a row above the
   * content, because a column of five costs 180px before anything is read.
   */
  orientation?: "vertical" | "horizontal";
  ariaLabel?: string;
  className?: string;
}) {
  const vertical = orientation === "vertical";

  return (
    <nav
      aria-label={ariaLabel}
      className={`flex ${
        vertical ? "flex-col items-start gap-0.5" : "flex-row flex-wrap items-center gap-x-5 gap-y-1"
      } ${className}`}
    >
      {items.map((item) => {
        const on = item.key === value;
        // `py-1` rather than nothing: these are touch targets on an iPad, and a
        // 12px line of text is not one on its own. No horizontal padding in the
        // vertical form — the labels have to start on the same left edge as the
        // content beside them, and 8px of padding would put them a visible step
        // to its left.
        const className = `inline-flex items-center gap-2 whitespace-nowrap py-1 text-[12px] uppercase tracking-[0.06em] no-underline transition-colors ${
          on ? "font-bold text-ink" : "font-semibold text-muted hover:text-ink"
        }`;
        const body = (
          <>
            {item.label}
            {item.count !== undefined && (
              <span className="font-normal tabular-nums opacity-55">{item.count}</span>
            )}
          </>
        );

        return onSelect ? (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            aria-current={on ? "page" : undefined}
            className={className}
          >
            {body}
          </button>
        ) : (
          <Link
            key={item.key}
            href={item.href ?? "#"}
            aria-current={on ? "page" : undefined}
            className={className}
          >
            {body}
          </Link>
        );
      })}
    </nav>
  );
}
