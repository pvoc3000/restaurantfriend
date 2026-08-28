"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { confirmDialog } from "@/lib/confirm";
import { createClient } from "@/lib/supabase/client";
import {
  MENU_HEADER_CLASS,
  MENU_ITEM_CLASS,
  MENU_PANEL_CLASS,
  MENU_SEARCH_CLASS,
  menuItemState,
  sinkInactive,
  useAnchoredPanel,
  MENU_CARET,
} from "@/lib/anchoredPanel";

export type PickOption = {
  value: string;
  label: string;
  /** Said quietly after the label — "case" beside "CS". */
  hint?: string;
  /** Options carrying the same group name are listed under it. */
  group?: string;
  /**
   * Retired, but still worth knowing about (Mark, 2026-08-15: "sometimes I'd
   * like to be able to at least know an item exists").
   *
   * A caller passing these does NOT have to sort or label them — this control
   * sinks every one of them below the live vocabulary, rules them off, heads
   * them and greys them, so a search answers "does this exist?" without an
   * inactive entry ever being mistaken for a current one. Doing it here rather
   * than at each call site is what stops six vocabularies inventing six
   * different headings.
   *
   * Pair it with `activateTable`: choosing one of these asks to REVIVE it
   * first, so being inactive still means something (Mark, 2026-08-15).
   */
  inactive?: boolean;
};

/**
 * Choose one of a known set of values. THE app's answer to "this field should
 * not accept anything you can type" (Mark, 2026-07-30), and the one control for
 * it — a small list that opens directly below the field rather than a native
 * popup menu, which was Mark's stated preference.
 *
 * Why not `<select>`: a native menu can't show a hint beside an option, can't
 * be searched on iPad, and renders as an OS menu that lands wherever the system
 * decides. This is a list under the field, styled like the rest of the app.
 *
 * What makes it work anywhere it's dropped — portalling to the body, fixed
 * coordinates measured off the trigger, closing on scroll — lives in
 * `lib/anchoredPanel`, which the ⋯ row menu shares. The reasons are written up
 * there.
 *
 * The stored value is ALWAYS shown even when it isn't on the list: the catalog
 * holds values this vocabulary doesn't (FMP wrote sizes into package_desc), and
 * a control that silently swapped one for a neighbour would be an edit nobody
 * asked for. It's listed above the vocabulary, marked as the current value —
 * under the clear row, where there is one.
 *
 * THREE TRIGGERS, one list (Mark, 2026-08-01). `inline` is the original: the
 * dotted underline `InlineValue` rests in, for a cell whose value you edit in
 * place. `field` is a bordered h-9 box matching `TextInput` and `TabPicker`,
 * for a control standing on its own in a filter row or a form — which is what
 * finally retired the last native `<select>`s in the app. `masthead` is that
 * box inverted for the black bar (2026-08-27), which retired the last one
 * OUTSIDE it — the working-location switcher. The panel is identical in every
 * case, because the thing being chosen from doesn't change with how the
 * trigger is dressed.
 */
export function PickList({
  value,
  options,
  onPick,
  placeholder = "—",
  disabled = false,
  allowNew = false,
  clearable = false,
  clearLabel = "None",
  inactiveLabel = "Inactive",
  activateTable,
  ariaLabel,
  align = "left",
  variant = "inline",
  boxed = false,
  className = "",
  panelMinWidth = 168,
  defaultOpen = false,
  onClose,
}: {
  value: string | null;
  options: PickOption[];
  /** Called with the chosen value; "" when cleared. Choosing IS the edit. */
  onPick: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Let a value that isn't on the list be typed in. For a vocabulary that
   * legitimately grows — item categories — and off for one that mustn't, like
   * the package tokens a vendor reads on an order.
   */
  allowNew?: boolean;
  /**
   * Offer a row that EMPTIES the field (Mark, 2026-08-11: "a clear option would
   * be useful on the picklist throughout the app"). Until this there was no way
   * back out of a pick at all — choosing IS the edit, so every value you could
   * reach was another value, and a field picked by mistake stayed picked.
   *
   * `InlineValue` passes `nullable` straight into this, which is what makes it
   * "throughout the app" without a sweep: that flag already says whether the
   * column accepts null, so a NOT NULL cell keeps offering no way to empty it
   * and no cell can offer a write the database would reject.
   *
   * IT SUPPRESSES ITSELF when the caller already declares an option whose value
   * is `""` — "No section" on an item's shelf, "All categories" in a filter.
   * Those are the same answer in the caller's own words, and two rows saying it
   * would read as two different things.
   *
   * It joins the LIST and not `options`, which is what keeps the trigger's
   * empty state the app's faint "—" rather than a black "None": 203 of 470
   * elements have no type because nobody has got to them, and a full-strength
   * label would report that as a decision. It is first, so it is in one place
   * whether or not the current value is on the list.
   */
  clearable?: boolean;
  /** The clear row's word, when "None" isn't the right one. */
  clearLabel?: string;
  /**
   * The heading over the sunken `inactive` options.
   *
   * "Inactive" rather than "Inactive items", because ONE control lists
   * elements, production items, vendors, vendor items and payroll benefits, and
   * a heading reading "items" over a list of vendors is wrong five times to be
   * right once. A caller with a better word for its own vocabulary passes it.
   */
  inactiveLabel?: string;
  /**
   * The table an `inactive` option lives in, so choosing one can REVIVE it.
   *
   * Mark, 2026-08-15: "if the user chooses an inactive item ask them if they
   * want it to be made active. If they do, proceed. If not, then do not add the
   * item (inactive needs to mean something, right?)" — which is the whole
   * argument. Listing retired entries so they can be found is one thing;
   * letting one be silently dropped into a live recipe or a live plan would
   * make the flag decorative.
   *
   * So: confirm → flip `is_active` → and only then does `onPick` fire. Cancel
   * picks NOTHING, deliberately. The three steps live here rather than at each
   * call site because the middle one is the easy one to skip, and a caller that
   * skipped it would look identical to one that didn't until an inactive row
   * turned up on a purchase order.
   *
   * The write is a plain update through RLS, so a reader without catalog rights
   * gets zero rows and the message rather than a silent success.
   *
   * Requires `is_active` on the table — that spelling, the one
   * `catalog/ActiveToggle` already hardcodes.
   */
  activateTable?: string;
  ariaLabel?: string;
  align?: "left" | "right";
  /**
   * `inline` — a dotted-underline value inside a cell (the default, and what
   * `InlineValue kind="pick"` uses). `field` — a bordered box standing on its
   * own, for filter rows and forms. `masthead` — the same box dressed for the
   * black bar: white type on nothing, sized to a nav tier.
   */
  variant?: "inline" | "field" | "masthead";
  /**
   * Wear a bounding box instead of the dotted underline. `inline` only — the
   * other two dresses already carry their own frame or deliberately carry
   * none.
   *
   * It exists so a screen that boxes its editable fields can box ALL of them:
   * `InlineValue` hands this straight down, and without it a page's typed
   * fields would be boxed while its pickers stayed underlined, which reads as
   * the pickers not being editable.
   */
  boxed?: boolean;
  className?: string;
  /** Narrowest the PANEL may be, in px — capped at 340 like the derived width.
   *  Raise it where the trigger is much narrower than the rows it opens. */
  panelMinWidth?: number;
  /**
   * Open the panel as soon as this renders, rather than waiting for a click.
   *
   * For a picker that a button has just REVEALED — the plan matrix's "+ add"
   * swaps itself for one of these — where pressing the button already said
   * "I want to choose something" and a second click to open the list is a tap
   * spent on nothing. Only ever pass it when the picker was summoned by a
   * deliberate act; a list that opens itself on page load is a popup.
   */
  defaultOpen?: boolean;
  /**
   * Called when the panel closes WITHOUT a pick — Escape, or a click away.
   *
   * Lets a caller that revealed the picker put its button back, so an abandoned
   * choice leaves no empty field sitting where the command used to be.
   */
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  // Only ever set by a failed revival. There is nowhere else in this control an
  // error can come from — a pick is not a write.
  const [reviveError, setReviveError] = useState<string | null>(null);
  const supabase = createClient();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The DISMISS path — Escape, or a click away. `choose` closes without coming
  // through here, because a pick is not an abandonment and a caller that put
  // its button back on every close would tear the picker down mid-choice.
  const close = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);
  const box = useAnchoredPanel({ open, triggerRef, panelRef, align, onClose: close });

  // A search box only earns its place on a long list; on five options it's one
  // more thing between you and the answer.
  const searchable = options.length > 8 || allowNew;

  const known = options.some((o) => o.value === value);
  // A null column and a `""` option are the same answer, and `choose` already
  // treats them as one. Comparing raw would leave the clear row unticked while
  // it IS the current state.
  const selected = value ?? "";
  const clearOption: PickOption | null =
    clearable && !options.some((o) => o.value === "")
      ? { value: "", label: clearLabel }
      : null;
  const listed: PickOption[] = [
    ...(clearOption ? [clearOption] : []),
    ...(value && !known
      ? [{ value, label: value, hint: "current value", group: "Current" }]
      : []),
    ...options,
  ];

  // Retired entries sink below the live vocabulary under one heading — the rule
  // and its reasons live in `sinkInactive`, beside the heading it produces.
  const ordered: PickOption[] = sinkInactive(listed, inactiveLabel);

  const q = term.trim().toLowerCase();
  const shown = q
    ? ordered.filter((o) =>
        `${o.label} ${o.hint ?? ""} ${o.value}`.toLowerCase().includes(q)
      )
    : ordered;
  const exact = shown.some((o) => o.label.toLowerCase() === q);
  const offerNew = allowNew && q !== "" && !exact;

  /**
   * Take a value: close, and — for a retired one — ask to revive it first.
   *
   * The ORDER is the point. Confirm, then the write, then `onPick`; a cancel or
   * a failed write picks nothing at all, so "inactive" still means something
   * even though the entry is now findable. The panel closes before the confirm
   * so there are never two floating layers arguing over Escape.
   */
  async function choose(next: string) {
    const picked = ordered.find((o) => o.value === next);
    setOpen(false);
    setTerm("");
    setReviveError(null);

    if (picked?.inactive && activateTable) {
      const ok = await confirmDialog({
        title: `Make “${picked.label}” active again?`,
        // "everywhere" is the one word doing real work here: reviving from a
        // recipe row also revives it for the plan matrix and the order guide,
        // and that should not be a surprise.
        body:
          "It is currently inactive and unavailable for use. " +
          "Choosing it here makes it active everywhere.",
        confirmLabel: "Make active",
      });
      if (!ok) {
        // A cancel is an ABANDONMENT, so it goes through `close` — which is
        // what puts a revealed picker's own button back ("+ add", "Add
        // component"). Leaving it revealed-but-closed would sit there as an
        // empty field, which reads as a half-finished choice rather than as the
        // "nothing was chosen" it is.
        close();
        triggerRef.current?.focus();
        return;
      }
      const { data, error } = await supabase
        .from(activateTable)
        .update({ is_active: true })
        .eq("id", next)
        // An update matching no policy changes nothing and returns NO error, so
        // a bare call would report success and then hand a still-inactive row
        // to `onPick` — the exact silence this whole confirm exists to break.
        .select("id");
      if (error || !data?.length) {
        // Deliberately NOT `close()`, unlike the cancel above: a revealed picker
        // unmounts on close, and it would take this message with it — leaving a
        // refusal that never got to say anything.
        setReviveError(
          error?.message ?? "Not allowed — it is still inactive, so nothing was chosen."
        );
        triggerRef.current?.focus();
        return;
      }
    }

    if (next !== (value ?? "")) onPick(next);
    triggerRef.current?.focus();
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setActive(Math.max(0, shown.findIndex((o) => o.value === selected)));
      setOpen(true);
    }
  }

  function onListKey(e: React.KeyboardEvent) {
    const max = shown.length - 1 + (offerNew ? 1 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(max, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (offerNew && active === shown.length) void choose(term.trim());
      else if (shown[active]) void choose(shown[active].value);
    }
  }

  const current = options.find((o) => o.value === value);
  const shownLabel = current?.label ?? (value || placeholder);
  // Faint means "nothing chosen". An option that legitimately IS the empty
  // string — a filter's "All categories" — is a real choice with a real label,
  // so it reads at full strength; only a value with no option behind it fades.
  const empty = !value && !current;

  // Headers computed up front rather than tracked with a running variable
  // during render — the list stays flat, so one keyboard index still walks it,
  // and nothing is mutated mid-render (which the React Compiler lint rejects).
  const rows = shown.map((o, i) => ({
    option: o,
    header: o.group && o.group !== shown[i - 1]?.group ? o.group : null,
    // A rule ABOVE the heading, so a group reads as a break rather than as a
    // caption on the row beneath it. Not on the first row: the search box (or
    // the panel's own edge) is already the line above it.
    headerRule: i > 0,
    // The clear row is an action, not a value, so it is ruled off from the
    // vocabulary underneath it — the same treatment `Add "…"` gets at the
    // other end of the list.
    divider: o === clearOption,
  }));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          setTerm("");
          // `ordered`, not `listed` — the keyboard index walks what is on
          // SCREEN, and the inactive partition moves rows.
          setActive(Math.max(0, ordered.findIndex((o) => o.value === selected)));
          // Closing by pressing the trigger again is an abandonment like any
          // other, so it goes through `close` rather than flipping the flag.
          if (open) close();
          else setOpen(true);
        }}
        onKeyDown={onTriggerKey}
        className={
          variant === "field"
            ? // A box like TextInput's and TabPicker's, so a filter row reads as
              // one set of controls at one height.
              `flex h-9 items-center gap-2 border border-ink bg-white px-3 text-left text-sm hover:bg-neutral-100 disabled:opacity-35 ${
                empty ? "text-faint" : ""
              } ${className}`
            : variant === "masthead"
              ? // NOT a box at all (Mark, 2026-08-27) — this is `field`'s
                // metrics with `field`'s dress taken off. Everything that
                // dresses the other two for a white page (bg-white,
                // border-ink, text-faint, a grey hover wash) is either
                // invisible or unreadable on the black bar, so nothing is
                // inherited by accident: it is all stated, because Tailwind
                // resolves competing utilities by STYLESHEET order rather than
                // class-string order and a caller passing `bg-transparent`
                // through `className` could not be relied on to beat
                // `bg-white`.
                //
                // The border went the way "Sign out" lost its: up here a box
                // reads as a different KIND of object from the type it stands
                // among, and this row is six quiet tabs, two line icons and
                // this. What says it opens a list is the caret, which is the
                // one mark that means that anywhere in the app.
                //
                // No horizontal padding, for the same reason: with the box
                // gone, padding would hold the code 8px off the page gutter
                // that "Sign out" directly beneath it sits on. `h-6` stays —
                // it is a nav tier tall, so the masthead's two columns line up
                // whether or not anything is drawn around it.
                //
                // YELLOW (Mark, 2026-08-27: "so it stands out"), which is the
                // rule applying rather than an exception to it. `text-mark` is
                // 1.43:1 on white and is banned as an ink there — but ON BLACK
                // it is the app's own mark for WHICH SHOP YOU ARE AT, worn by
                // this exact spot's predecessor (the location tab was
                // `text-mark` from every other section until this control took
                // the code off it) and by `WorkingHere`'s chip. Type, never a
                // fill: a filled yellow box in the masthead would be the one
                // yellow-filled button in the app, and `WorkingHere` refuses a
                // black fill for the same reason in reverse. Hover brightens
                // to yellow-200 — yellow-500 is already near the top of its
                // range, so a quiet control that darkens elsewhere has to go
                // the other way here.
                //
                // The colour is in the VARIANT because the masthead has one
                // picker and yellow is what it is FOR. A second one that isn't
                // about the working location wants the colour split out to a
                // prop, not this dress reused.
                `flex h-6 items-center gap-2 bg-transparent text-left text-[12px] font-semibold uppercase tracking-[0.06em] text-mark hover:text-mark-fill disabled:opacity-35 ${className}`
              : // The same resting dress InlineValue wears, so an editable cell
                // reads as editable whether it takes typing or a choice — the
                // dotted underline, or the bounding box where the caller has
                // asked for one. The underline comes OFF when the box goes on:
                // two cues for one fact, and the second reads as an artefact.
                `flex w-full items-center gap-1 px-1 py-0.5 text-left hover:bg-neutral-100 disabled:opacity-35 ${
                  boxed
                    ? "border border-hairline hover:border-ink"
                    : "underline decoration-neutral-300 decoration-dotted underline-offset-4"
                } ${empty ? "text-faint" : ""} ${className}`
        }
      >
        {/* Inline: the caret sits WITH the value, not pushed to the far edge —
            in a definition list the field is as wide as the column, and a
            marker floating 400px from the word it belongs to reads as a
            different control. As a FIELD it goes to the right edge, which is
            where a box's own marker belongs and where a `<select>` put it. */}
        <span className="truncate">{shownLabel}</span>
        <span
          aria-hidden
          className={`shrink-0 text-[9px] ${variant === "inline" ? "text-muted" : "ml-auto"} ${
            // On the masthead the caret inherits the trigger's white; `text-muted`
            // is a grey chosen against a white page and reads as a smudge on black.
            variant === "field" ? "text-muted" : ""
          }`}
        >
          {MENU_CARET}
        </span>
      </button>

      {/* Only ever a refused or failed revival — see `choose`. It sits under the
          trigger rather than in the panel because by the time it exists the
          panel has closed, and the reader needs to know that NOTHING was
          chosen. */}
      {reviveError && (
        <span className="mt-0.5 block text-xs text-accent">{reviveError}</span>
      )}

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            onKeyDown={onListKey}
            style={{
              top: box.top,
              ...(align === "right"
                ? { left: box.left, transform: "translateX(-100%)" }
                : { left: box.left }),
              // Match the field, but stay SMALL (Mark asked for a small list):
              // a definition-list field can be 500px wide and nine three-letter
              // tokens rattling around in that is not a menu, it's a wall.
              //
              // CLAMPED INTO min-width, not expressed as a max-width beside it:
              // min-width WINS over max-width in CSS, so a 528px field kept a
              // 528px panel and the cap did nothing at all.
              //
              // The FLOOR is a caller's to raise (`panelMinWidth`, MenuButton's
              // idiom): a trigger narrower than its own options — the masthead's
              // 66px code — leaves 168px to set a label and a hint in, and a
              // shop's full name then breaks over four lines.
              minWidth: Math.min(Math.max(box.width, panelMinWidth), 340),
            }}
            className={MENU_PANEL_CLASS}
          >
            {searchable && (
              <input
                autoFocus
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setActive(0);
                }}
                placeholder={allowNew ? "Find or add…" : "Find…"}
                className={MENU_SEARCH_CLASS}
              />
            )}
            {shown.length === 0 && !offerNew && (
              <p className="px-3 py-2 text-sm text-muted">Nothing matches.</p>
            )}
            {rows.map(({ option: o, header, headerRule, divider }, i) => {
              return (
                <div key={`${o.group ?? ""}:${o.value}`}>
                  {header && (
                    <p
                      className={`${MENU_HEADER_CLASS} ${
                        headerRule ? "border-t border-hairline" : ""
                      }`}
                    >
                      {header}
                    </p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === selected}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void choose(o.value)}
                    className={`${MENU_ITEM_CLASS} flex items-baseline gap-2 ${
                      divider ? "border-b border-hairline" : ""
                    } ${menuItemState(i === active)}`}
                  >
                    <span
                      className={`${o.value === selected ? "font-semibold" : ""} ${
                        // Grey says "retired" at a glance, so the heading is not
                        // the only thing carrying it — a panel scrolled past its
                        // rule would otherwise look like an ordinary list. Not
                        // when the row is under the cursor: that bar is solid
                        // black, and muted grey on it is unreadable. Same
                        // either/or the hint below already uses.
                        o.inactive && i !== active ? "text-muted" : ""
                      }`}
                    >
                      {o.label}
                    </span>
                    {o.hint && (
                      <span
                        className={`text-xs ${i === active ? "text-white/70" : "text-muted"}`}
                      >
                        {o.hint}
                      </span>
                    )}
                    {o.value === selected && (
                      <span aria-hidden className="ml-auto text-xs">
                        ✓
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
            {offerNew && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseEnter={() => setActive(shown.length)}
                onClick={() => void choose(term.trim())}
                className={`${MENU_ITEM_CLASS} flex items-baseline gap-2 border-t border-hairline ${menuItemState(
                  active === shown.length
                )}`}
              >
                <span>Add “{term.trim()}”</span>
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
