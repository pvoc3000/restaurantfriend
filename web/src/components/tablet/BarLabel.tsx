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
/**
 * ">>" — two copies of `ICON_CHEVRON_RIGHT` side by side (Mark, 2026-09-10: an
 * ">>" glyph for Next favorite and Next section). Built from the bar's own
 * chevron rather than a typed character, so its weight and shape match every
 * other icon here; the pair is 200 units apart and centred in the box.
 */
export const ICON_DOUBLE_CHEVRON_RIGHT =
  "M416-480l-184-184 56-56 240 240-240 240-56-56 184-184ZM616-480l-184-184 56-56 240 240-240 240-56-56 184-184Z";
export const ICON_LAST_PAGE = "m280-240-56-56 184-184-184-184 56-56 240 240-240 240Zm360 0v-480h80v480h-80Z";
/** Material Symbols `refresh` at wght 700 — the order guide's Refresh. */
export const ICON_REFRESH =
  "M476-126q-147 0-250.5-103.5T122-480q0-147 103.5-250.5T476-834q78 0 147.5 31.5T742-711v-123h96v329H508v-95h162q-32-50-83-79t-111-29q-95 0-161.5 66.5T248-480q0 95 66.5 161.5T476-252q71 0 129.5-41T690-400h131q-29 120-125 197t-220 77Z";
export const ICON_ADD = "M414-414H160v-132h254v-254h132v254h254v132H546v254H414v-254Z";
export const ICON_CHECK = "M382-208 122-468l90-90 170 170 366-366 90 90-456 456Z";
export const ICON_UNDO = "M280-160v-126h300q52 0 90-36t38-90q0-54-38-90t-90-36H354l110 110-89 89L120-594l255-255 89 89-110 110h226q105 0 179.5 73T834-400q0 105-74.5 178.5T580-148H280v-12Z";
export const ICON_TRASH = "M267-74q-57 0-96.5-39.5T131-210v-538H80v-126h250v-60h300v60h250v126h-51v538q0 57-39.5 96.5T693-74H267Zm426-674H267v538h426v-538ZM348-256h103v-400H348v400Zm161 0h103v-400H509v400ZM267-748v538-538Z";
export const ICON_PERSON = "M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Z";
