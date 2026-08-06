"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** White left between the page's last block and the band. The app's own block
 *  rhythm, so the gap above the band matches every other gap on the screen. */
const FOOTER_GAP = 16;

/**
 * A band pinned to the bottom of the window, with its own clearance reserved in
 * the page.
 *
 * Extracted from PO detail 2026-08-06, when the employee record wanted the same
 * treatment for its paperwork (Mark: "pin it in the footer area of the screen
 * and have it expand UP and OVER the content above it, just like how PO
 * works"). It was a local hook and a hand-placed pair of divs; a second copy is
 * the `ui/Dialog` story, so it is one component now.
 *
 * ---------------------------------------------------------------------------
 * THE HEIGHT IS MEASURED, NEVER A CONSTANT
 *
 * A `fixed` element takes no space, so two things need to know how much space
 * it WOULD have taken: the page's last content, which must not slide under it,
 * and — on PO detail — `useFillViewportHeight`, which sizes the line pane from
 * "everything below me". The band is 62px with nothing attached and taller with
 * files in it, so a guess is wrong the moment somebody files an invoice.
 *
 * IT RESERVES THE BAND MINUS WHAT ALREADY FOLLOWS IT. The spacer's own bottom
 * margin and the app layout's `py-8` sit under the band and are already covered
 * by it; reserving the full height on top of them left 56px of white (Mark,
 * 2026-08-02: "reduce the whitespace between the datatable and the paperwork
 * area"). Both are read off computed style rather than measured from the
 * layout, which keeps this out of the feedback loop it would otherwise have
 * with `useFillViewportHeight` — that hook sizes the pane from this spacer, so
 * a spacer that measured the page would be measuring its own effect.
 *
 * Written straight to the node, with no state, so a resize doesn't re-render
 * the page's tables and the `set-state-in-effect` lint has nothing to object
 * to. The >1px guard stops the observer reacting to its own write.
 */
export function StickyFooter({
  children,
  spacerClassName = "",
}: {
  children: ReactNode;
  /**
   * Cancels the page's own vertical rhythm above the spacer — `-mt-6` on a
   * `space-y-6` page, `-mt-8` on a `space-y-8` one. A spacer is a measurement
   * rather than a block of content, so the gap that separates real blocks
   * shouldn't apply to it, and the breathing room belongs in the band's own
   * padding (Mark, 2026-08-02: "you can tighten the white space at the bottom").
   */
  spacerClassName?: string;
}) {
  const footerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const footer = footerRef.current;
    const spacer = spacerRef.current;
    if (!footer || !spacer) return;

    const measure = () => {
      const below =
        (parseFloat(getComputedStyle(spacer).marginBottom) || 0) +
        (parseFloat(getComputedStyle(spacer.closest("main")!).paddingBottom) || 0);
      const target = Math.max(0, footer.getBoundingClientRect().height + FOOTER_GAP - below);
      if (Math.abs(parseFloat(spacer.style.height || "0") - target) > 1) {
        spacer.style.height = `${target}px`;
        // Tell any viewport-filling pane that its floor moved.
        // `useFillViewportHeight` re-measures on window resize and on
        // `document.body` resizing — and body is `min-h-full`, so when this
        // spacer SHRINKS (a file removed from the card) the body's box doesn't
        // change at all and the pane never reclaims the space. Measured: the
        // card going 188px → 86px left the pane at 263px with 118px of white
        // under it. A resize event is exactly the signal "the amount of page
        // below you changed".
        window.dispatchEvent(new Event("resize"));
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={spacerRef} className={spacerClassName} aria-hidden />
      <div
        ref={footerRef}
        // Full-bleed and opaque, but with NO border of its own — it carries the
        // page's own gutters as padding so its card lines up with the content
        // above, and the white is what stops rows showing through when the page
        // scrolls behind it (Mark, 2026-08-02: he "preferred the paperwork
        // section in a bounding box", so the CARD draws the frame and this
        // contributes only position and a backdrop).
        //
        // z-30 is the ActionBar's rung: above tables and their sticky column
        // labels (20), below the masthead (50) and anchored panels (70).
        className="fixed inset-x-0 bottom-0 z-30 bg-white px-4 pb-4 pt-2 xl:px-12"
      >
        {children}
      </div>
    </>
  );
}
