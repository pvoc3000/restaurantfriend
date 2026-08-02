"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MENU_HEADER_CLASS,
  MENU_ITEM_CLASS,
  MENU_PANEL_CLASS,
  MENU_SEARCH_CLASS,
  menuItemState,
  useAnchoredPanel,
} from "@/lib/anchoredPanel";

export type PickOption = {
  value: string;
  label: string;
  /** Said quietly after the label — "case" beside "CS". */
  hint?: string;
  /** Options carrying the same group name are listed under it. */
  group?: string;
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
 * asked for. It's listed first, marked as the current value.
 *
 * TWO TRIGGERS, one list (Mark, 2026-08-01). `inline` is the original: the
 * dotted underline `InlineValue` rests in, for a cell whose value you edit in
 * place. `field` is a bordered h-9 box matching `TextInput` and `TabPicker`,
 * for a control standing on its own in a filter row or a form — which is what
 * finally retired the last native `<select>`s in the app. The panel is
 * identical either way, because the thing being chosen from doesn't change with
 * how the trigger is dressed.
 */
export function PickList({
  value,
  options,
  onPick,
  placeholder = "—",
  disabled = false,
  allowNew = false,
  ariaLabel,
  align = "left",
  variant = "inline",
  className = "",
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
  ariaLabel?: string;
  align?: "left" | "right";
  /**
   * `inline` — a dotted-underline value inside a cell (the default, and what
   * `InlineValue kind="pick"` uses). `field` — a bordered box standing on its
   * own, for filter rows and forms.
   */
  variant?: "inline" | "field";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const box = useAnchoredPanel({ open, triggerRef, panelRef, align, onClose: close });

  // A search box only earns its place on a long list; on five options it's one
  // more thing between you and the answer.
  const searchable = options.length > 8 || allowNew;

  const known = options.some((o) => o.value === value);
  const listed: PickOption[] =
    value && !known
      ? [{ value, label: value, hint: "current value", group: "Current" }, ...options]
      : options;

  const q = term.trim().toLowerCase();
  const shown = q
    ? listed.filter((o) =>
        `${o.label} ${o.hint ?? ""} ${o.value}`.toLowerCase().includes(q)
      )
    : listed;
  const exact = shown.some((o) => o.label.toLowerCase() === q);
  const offerNew = allowNew && q !== "" && !exact;

  function choose(next: string) {
    setOpen(false);
    setTerm("");
    if (next !== (value ?? "")) onPick(next);
    triggerRef.current?.focus();
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setActive(Math.max(0, shown.findIndex((o) => o.value === value)));
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
      if (offerNew && active === shown.length) choose(term.trim());
      else if (shown[active]) choose(shown[active].value);
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
          setActive(Math.max(0, listed.findIndex((o) => o.value === value)));
          setOpen((v) => !v);
        }}
        onKeyDown={onTriggerKey}
        className={
          variant === "field"
            ? // A box like TextInput's and TabPicker's, so a filter row reads as
              // one set of controls at one height.
              `flex h-9 items-center gap-2 border border-ink bg-white px-3 text-left text-sm hover:bg-neutral-100 disabled:opacity-35 ${
                empty ? "text-faint" : ""
              } ${className}`
            : // The same dotted underline InlineValue rests in, so an editable
              // cell reads as editable whether it takes typing or a choice.
              `flex w-full items-center gap-1 px-1 py-0.5 text-left underline decoration-neutral-300 decoration-dotted underline-offset-4 hover:bg-neutral-100 disabled:opacity-35 ${
                empty ? "text-faint" : ""
              } ${className}`
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
          className={`shrink-0 text-[9px] text-muted ${variant === "field" ? "ml-auto" : ""}`}
        >
          ▼
        </span>
      </button>

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
              minWidth: Math.min(Math.max(box.width, 168), 340),
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
            {rows.map(({ option: o, header }, i) => {
              return (
                <div key={`${o.group ?? ""}:${o.value}`}>
                  {header && <p className={MENU_HEADER_CLASS}>{header}</p>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o.value)}
                    className={`${MENU_ITEM_CLASS} flex items-baseline gap-2 ${menuItemState(
                      i === active
                    )}`}
                  >
                    <span className={o.value === value ? "font-semibold" : ""}>
                      {o.label}
                    </span>
                    {o.hint && (
                      <span
                        className={`text-xs ${i === active ? "text-white/70" : "text-muted"}`}
                      >
                        {o.hint}
                      </span>
                    )}
                    {o.value === value && (
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
                onClick={() => choose(term.trim())}
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
