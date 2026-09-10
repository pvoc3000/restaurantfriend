import Link from "next/link";

import type { TileGroup, TileKey } from "@/lib/tablet/landing";

/** What a tile says about itself today, and where it really goes. */
export type TileState = {
  /** One muted line under the label — what is outstanding — or null. */
  note: string | null;
  /** A more specific destination than the tile's own (a draft's runner). */
  href?: string;
};

/**
 * The tablet landing page — a page filled with the things a supervisor might
 * need to do (Mark, 2026-09-09), grouped the way he grouped them. Each tile is
 * a door, ≥96px tall so a thumb finds it, at the runners' 16px. The state line
 * is what turns a menu into the shift's routine: "Resume tonight's closing
 * report" is a different page from "Start or Resume a Shift Report".
 */
export function Landing({
  groups,
  state,
}: {
  groups: TileGroup[];
  state: Partial<Record<TileKey, TileState>>;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-10 text-[16px]">
      {groups.map((group) => (
        <section key={group.label} className="space-y-3">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
            {group.label}
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.tiles.map((tile) => {
              const s = state[tile.key];
              return (
                // `flex` on the cell and `flex-1` on the link: the grid stretches
                // every LI to its row's height, but a link inside is only as
                // tall as its own label, so a two-line tile stood 11px taller
                // than the one-line tiles beside it (Mark, 2026-09-09).
                <li key={tile.key} className="flex">
                  <Link
                    href={s?.href ?? tile.href}
                    className="flex min-h-24 flex-1 flex-col justify-center gap-1 border border-ink bg-white px-5 py-4 no-underline transition-colors hover:bg-neutral-100 active:bg-neutral-200"
                  >
                    <span className="font-bold uppercase tracking-[0.04em] text-ink">{tile.label}</span>
                    {s?.note && <span className="text-[14px] text-muted">{s.note}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
