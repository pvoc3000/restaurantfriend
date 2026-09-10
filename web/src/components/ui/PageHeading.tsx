import type { ReactNode } from "react";

/**
 * THE APP'S PAGE HEADER. Every list screen uses this — see CLAUDE.md's
 * Conventions.
 *
 * The title, then one small-caps line under it reading SHOP FIRST:
 * `DF02 · 29 of 80 vendors`. It is `PurchaseOrderList`'s header, which Mark
 * named as the model on 2026-09-03 ("I like this the best") and asked to have
 * copied across the app. It REPLACES the one-line prose descriptions that stood
 * here before, on every screen that had one.
 *
 * THE COUNT IS THE FILTERED ONE, which is the whole reason this usually lives
 * in the list COMPONENT rather than the page: what is on screen right now, out
 * of everything the screen could show. Where a screen genuinely cannot reach
 * that number, `visible` is omitted and the line states the total alone.
 *
 * THE CREATE COMMAND IS TOP- AND RIGHT-ALIGNED (Mark, 2026-09-10: "make sure
 * the action buttons in the identity row are not only right aligned, but TOP
 * aligned as well"). `items-start`, so the button's top is the title's top. It
 * was `items-end` — bottom-aligned with the count line — from 2026-09-03, when
 * the production screens' commands were "bottom right" aligned beside a title
 * with a description under it; the descriptions are gone and the rule now
 * matches the detail screens, whose command rows were already `items-start`.
 */
export function PageHeading({
  title,
  code,
  visible,
  total,
  noun,
  action,
}: {
  title: string;
  /** The working shop, where the screen is scoped to one. Omitted org-wide. */
  code?: string | null;
  /** How many rows are showing. Omit when the screen cannot know. */
  visible?: number;
  total: number;
  /** Plural, lower case — "vendors", "inventory items", "shop sections". */
  noun: string;
  /** The screen's create command, right-aligned and TOP-aligned with the title. */
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {title}
        </h1>
        <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
          {code ? `${code} · ` : ""}
          {visible === undefined ? total : `${visible} of ${total}`} {noun}
        </p>
      </div>
      {action}
    </div>
  );
}
