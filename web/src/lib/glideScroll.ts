"use client";

/**
 * A FAST, EASED SCROLL OF THE WINDOW (Mark, 2026-11-23, on the order guide's
 * Next favorite and Next section: "Ramp up the speed at the beginning and slow
 * it down at the end. The scroll should be fast, but it should be an obvious
 * scroll and not a snap.").
 *
 * Driven frame by frame rather than with `behavior: "smooth"`, for two reasons.
 * Measured 2026-07-29: `smooth` silently did nothing in at least one Chromium
 * build, and a walk button that looks dead is the worst outcome. And the
 * browser's own curve and duration are its choice, not ours — this one is
 * an S-curve and short on purpose, so the eye can follow the page moving
 * without waiting on it.
 *
 * PRESSING AGAIN DOES NOT QUEUE. A new glide starts from wherever the page is
 * now, and `glideDestination()` says where the one in flight was heading, so a
 * "next" that asks "what is below here?" asks it of where you are going rather
 * than of a point halfway there — press-press-press walks forward instead of
 * finding the same target twice.
 *
 * THE READER WINS. A wheel or a finger dragging the page stops the glide where
 * it is. A drag, not a touch: on the iPad the tap on Next favorite is itself a
 * touchstart, and stopping on it would forget where the glide was heading just
 * as the next press asks. `prefers-reduced-motion` gets the jump, as before.
 */

let frame = 0;
let destination: number | null = null;
let stopListening: (() => void) | null = null;

function stop() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  destination = null;
  stopListening?.();
  stopListening = null;
}

/** Where the glide in flight will land, or the current scroll if none. */
export function glideDestination(): number {
  return destination ?? window.scrollY;
}

/**
 * The S-curve: slow away, a rush through the middle, slow into the landing.
 * QUINTIC, not cubic (Mark, 2026-11-23: longer at the start and the end, the
 * fastest part about the same). A quintic's peak speed is 5/3 of a cubic's
 * over the same time, so the duration below is 5/3 as long — the middle moves
 * exactly as fast as it did, and the extra time all goes to the two ends.
 */
function easeInOutQuint(t: number) {
  return t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

export function glideScrollTo(top: number) {
  stop();
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const to = Math.min(maxScroll, Math.max(0, top));
  const from = window.scrollY;
  const distance = to - from;
  if (Math.abs(distance) < 1) return;

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    window.scrollTo({ top: to, behavior: "instant" });
    return;
  }

  // Longer trips take a little longer, never much: about 0.4 s for a row or
  // two, 0.83 s at most for a whole screenful and beyond. (The cubic's 240–500
  // ms, times 5/3 — see easeInOutQuint.)
  const duration = Math.min(500, 240 + Math.sqrt(Math.abs(distance)) * 6) * (5 / 3);
  const start = performance.now();
  destination = to;

  const cancel = () => stop();
  window.addEventListener("wheel", cancel, { passive: true });
  window.addEventListener("touchmove", cancel, { passive: true });
  stopListening = () => {
    window.removeEventListener("wheel", cancel);
    window.removeEventListener("touchmove", cancel);
  };

  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    // "instant", not "auto": auto defers to any CSS scroll-behavior, which
    // would turn every frame into a smooth scroll of its own.
    window.scrollTo({ top: from + distance * easeInOutQuint(t), behavior: "instant" });
    if (t < 1) frame = requestAnimationFrame(step);
    else stop();
  };
  frame = requestAnimationFrame(step);
}
