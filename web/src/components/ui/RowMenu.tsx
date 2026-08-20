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
}: {
  items: RowMenuItem[];
  /** What this menu is FOR, for screen readers — "Actions for AP flour". */
  label: string;
  align?: "left" | "right";
}) {
  return (
    <MenuButton
      items={items}
      label={label}
      align={align}
      trigger="⋯"
      // 36px square: a comfortable thumb target inside a 56px row, and square
      // like every other control here.
      triggerClassName="grid h-9 w-9 place-items-center text-[17px] leading-none text-muted hover:bg-neutral-100 hover:text-ink"
    />
  );
}
