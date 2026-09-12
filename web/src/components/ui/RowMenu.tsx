"use client";

import { MenuButton, type MenuCommand } from "@/components/ui/MenuButton";

export type RowMenuItem = MenuCommand;

/**
 * A ⋯ button on a table row that opens that row's commands.
 *
 * A MENU BUTTON rather than a right-click (the open thread's call, 2026-07-23):
 * a context menu has no touch equivalent, and iPad Safari is the ordering
 * surface, so a command reachable only by right-click is a command half the
 * operation cannot reach.
 *
 * The panel and every rule in it now live in `ui/MenuButton` — same portal,
 * same fixed coordinates, same flip-and-clamp, same close-on-scroll — because a
 * command bar needed the identical menu behind a LABELLED button and the
 * alternative was a second copy of all of it. This is the ⋯ dress over that
 * control, and nothing about a row menu changed when it moved.
 *
 * Anchored `right` by default: this lives in a table's last column, and a panel
 * hanging off the left of a 56px cell would run off the screen edge.
 */
export function RowMenu({
  items,
  label,
  align = "right",
  onFill = false,
}: {
  items: RowMenuItem[];
  /** What this menu is FOR, for screen readers — "Actions for AP flour". */
  label: string;
  align?: "left" | "right";
  /** This ⋯ stands on a COLOURED ground, so its hover is weight rather than a
   *  grey wash — see the trigger below. */
  onFill?: boolean;
}) {
  return (
    <MenuButton
      items={items}
      label={label}
      align={align}
      trigger="⋯"
      // 36px square: a comfortable thumb target inside a 56px row, and square
      // like every other control here.
      //
      // ON A COLOURED BAND THE AFFORDANCE IS WEIGHT, NOT A WASH (Mark,
      // 2026-09-11, of the order guide's requests band). The app's rule is that
      // a control you press fills grey on hover, and that rule is written for a
      // control standing on WHITE: over `bg-mark-fill` a `neutral-100` wash
      // paints a grey patch on yellow, which reads as a smudge rather than a
      // highlight. So there the ⋯ thickens and darkens instead — the same
      // "you can press this", said with the only property a coloured ground
      // leaves free.
      triggerClassName={`grid h-9 w-9 place-items-center text-[17px] leading-none text-muted ${
        onFill ? "hover:font-bold hover:text-ink" : "hover:bg-neutral-100 hover:text-ink"
      }`}
    />
  );
}
