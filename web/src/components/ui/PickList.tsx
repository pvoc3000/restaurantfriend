"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
 * Two things make it work anywhere it's dropped:
 *
 * - **It portals to the body and positions `fixed`.** Half its homes are table
 *   cells inside `overflow-auto` panes — the vendor's items table — where an
 *   absolutely-positioned panel is simply clipped. Fixed coordinates measured
 *   off the trigger escape both that and WebKit's rule that a table cell under
 *   `border-collapse` isn't a containing block (CLAUDE.md).
 * - **It closes on scroll.** Fixed coordinates go stale the moment the page
 *   moves, and a list left floating over unrelated rows is worse than one that
 *   shut. Same reason `resize` closes it.
 *
 * The stored value is ALWAYS shown even when it isn't on the list: the catalog
 * holds values this vocabulary doesn't (FMP wrote sizes into package_desc), and
 * a control that silently swapped one for a neighbour would be an edit nobody
 * asked for. It's listed first, marked as the current value.
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
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  // Measured off the trigger at open time, and again if the panel's own size
  // changes under it (the list shrinks as you type).
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({
        top: r.bottom + 2,
        left: align === "right" ? r.right : r.left,
        width: r.width,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (triggerRef.current) observer.observe(triggerRef.current);
    return () => observer.disconnect();
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    // `true` — capture, so a scroll inside a pane closes it too, not just the
    // window's own.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

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
        // The same dotted underline InlineValue rests in, so an editable cell
        // reads as editable whether it takes typing or a choice.
        className={`flex w-full items-center gap-1 px-1 py-0.5 text-left underline decoration-neutral-300 decoration-dotted underline-offset-4 hover:bg-neutral-100 disabled:opacity-35 ${
          value ? "" : "text-faint"
        } ${className}`}
      >
        {/* The caret sits WITH the value, not pushed to the far edge of the
            cell: in a definition list the field is as wide as the column, and a
            marker floating 400px from the word it belongs to reads as a
            different control. The button stays full width for the hit area. */}
        <span className="truncate">{shownLabel}</span>
        <span aria-hidden className="shrink-0 text-[9px] text-muted">
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
            // 2px black edge and no shadow: depth is edges here (the design
            // system's elevation rule). z-50 clears the ActionBar and sits with
            // the masthead, which is the only thing above it.
            className="fixed z-50 max-h-72 overflow-auto border-2 border-ink bg-white text-ink"
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
                className="sticky top-0 z-10 w-full border-b border-hairline bg-white px-2 py-1.5 text-sm outline-none"
              />
            )}
            {shown.length === 0 && !offerNew && (
              <p className="px-2 py-2 text-sm text-muted">Nothing matches.</p>
            )}
            {rows.map(({ option: o, header }, i) => {
              return (
                <div key={`${o.group ?? ""}:${o.value}`}>
                  {header && (
                    <p className="border-b border-hairline bg-neutral-50 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-subtle">
                      {header}
                    </p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o.value)}
                    className={`flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-sm ${
                      i === active ? "bg-ink text-white" : "hover:bg-neutral-100"
                    }`}
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
                className={`flex w-full items-baseline gap-2 border-t border-hairline px-2 py-1.5 text-left text-sm ${
                  active === shown.length ? "bg-ink text-white" : "hover:bg-neutral-100"
                }`}
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
