// Sizing a row to "the rest of the window" — MEASURED, never a CSS constant.
//
// Extracted from the receiving screen (2026-08-05) when invoice detail needed
// the same thing. `100vh - header - <guess>` is the tempting version and it is
// wrong for the same reason on both screens: what sits above the row varies —
// bands appear and disappear, a masthead wraps at narrow widths — and any
// constant is right at exactly one size.

import { useLayoutEffect } from "react";

const px = (value: string) => parseFloat(value) || 0;

/**
 * How much layout sits BELOW a node, measured by walking up to the body.
 *
 * The obvious answer — `documentElement.scrollHeight - node.bottom` — is wrong
 * in exactly the case this cares about, and wrong SILENTLY. `html` is `h-full`
 * and `body` is `min-h-full`, so a page whose content doesn't fill the window
 * reports the window's own height: `below` becomes
 * `viewportBottom - node.bottom`, and `innerHeight - top - below` reduces to the
 * node's CURRENT height. A fixed point. A five-line order therefore kept the
 * height five lines gave it and the columns stopped at the middle of the screen
 * (Mark, 2026-07-31), while a long order — whose page really does scroll —
 * measured correctly, which is why this looked like it worked.
 *
 * So sum the real boxes instead: at each level, whatever follows the node
 * (taken from the LAST following sibling's rect, so collapsed margins are
 * counted once and only once), then that parent's own bottom padding and
 * border. Out-of-flow siblings are skipped because they occupy no layout space.
 */
export function spaceBelow(node: HTMLElement): number {
  let total = 0;
  let el: HTMLElement | null = node;
  while (el && el !== document.body && el.parentElement) {
    const parent: HTMLElement = el.parentElement;
    let last: HTMLElement | null = null;
    for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
      const style = getComputedStyle(sib);
      if (style.display === "none") continue;
      if (style.position === "fixed" || style.position === "absolute") continue;
      last = sib as HTMLElement;
    }
    if (last) {
      total +=
        last.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom +
        px(getComputedStyle(last).marginBottom);
    } else {
      total += px(getComputedStyle(el).marginBottom);
    }
    const parentStyle = getComputedStyle(parent);
    total += px(parentStyle.paddingBottom) + px(parentStyle.borderBottomWidth);
    el = parent;
  }
  return total;
}

/**
 * Give a node exactly the height left between its own top and the bottom of the
 * window, so whatever follows it lands on the fold.
 *
 * The height is written STRAIGHT TO THE NODE rather than held in state: a
 * resize then doesn't re-render the rows inside it, and the
 * `set-state-in-effect` lint has nothing to object to. The >1px guard stops the
 * ResizeObserver reacting to its own write, which otherwise loops — shrinking
 * the row removes the page's scrollbar, which moves everything.
 *
 * `enabled` false clears the height and lets the node size itself, which is what
 * a stacked layout wants. Below `minHeight` it stops shrinking and lets the page
 * scroll instead: a window too short for this simply isn't one, and a 40px pane
 * is worse than a scrollbar.
 */
export function useFillToBottom(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  minHeight = 280
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    function measure() {
      if (!el) return;
      if (!enabled) {
        if (el.style.height) el.style.height = "";
        return;
      }
      const rect = el.getBoundingClientRect();
      const next = Math.max(
        minHeight,
        Math.round(window.innerHeight - rect.top - window.scrollY - spaceBelow(el))
      );
      if (Math.abs(parseFloat(el.style.height || "0") - next) > 1) {
        el.style.height = `${next}px`;
      }
    }

    measure();
    // The body AND the node's own container. The body alone was enough while
    // the page always scrolled, but a page sized to exactly one viewport keeps a
    // `min-h-full` body at a constant height — so a band appearing above the row
    // would move its top without the observer hearing a thing.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (el.parentElement) observer.observe(el.parentElement);
    // AND WHATEVER SITS ABOVE, directly. What moves this node's top is its
    // preceding siblings, and the parent's own box is only an indirect witness
    // to that — one that a `min-h-full` ancestor or a parent already sized by
    // something else can swallow.
    //
    // It stopped being theoretical when invoice detail put its commands in the
    // header (2026-09-02): the QuickBooks block renders NOTHING until it has
    // asked whether QuickBooks is connected, so the header grows a beat after
    // the first measurement and the row keeps a height taken when it sat 47px
    // higher. Observing the thing that moved is cheaper than inferring it.
    for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
      observer.observe(sib);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, enabled, minHeight]);
}
