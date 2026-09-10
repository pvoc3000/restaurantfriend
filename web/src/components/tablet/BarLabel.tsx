/**
 * An icon over its word — the shift report footer's `FooterLabel`, lifted out
 * so the tablet bar draws its cells the same way: 28px of Material Symbols
 * artwork (Apache 2.0, wght 700, one `currentColor` path in the
 * `0 -960 960 960` box) over a 12px bold small-caps word. The word is the
 * accessible name; the artwork is `aria-hidden`.
 *
 * A bare glyph cannot say which of two things the first cell is, and the
 * runners already made that argument at length — the word stays.
 */
export function BarLabel({ icon, word }: { icon: string; word: string }) {
  return (
    <span className="flex flex-col items-center gap-0.5">
      <svg width="28" height="28" viewBox="0 -960 960 960" aria-hidden="true">
        <path fill="currentColor" d={icon} />
      </svg>
      <span className="text-[12px] font-bold uppercase leading-none tracking-[0.08em]">{word}</span>
    </span>
  );
}

/** Material Symbols Outlined, wght 700 — the same weight the runners' footers use. */
export const ICON_ARROW_BACK = "m368-417 202 202-90 89-354-354 354-354 90 89-202 202h466v126H368Z";
export const ICON_HOME = "M200-160v-366L80-434l-40-70 440-336 440 336-40 70-120-92v366H560v-240H400v240H200Z";
export const ICON_FIRST_PAGE = "M240-240v-480h80v480h-80Zm440 0L440-480l240-240 56 56-184 184 184 184-56 56Z";
export const ICON_CHEVRON_LEFT = "M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z";
export const ICON_CHEVRON_RIGHT = "m504-480-184-184 56-56 240 240-240 240-56-56 184-184Z";
export const ICON_LAST_PAGE = "m280-240-56-56 184-184-184-184 56-56 240 240-240 240Zm360 0v-480h80v480h-80Z";
export const ICON_PERSON = "M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Z";
