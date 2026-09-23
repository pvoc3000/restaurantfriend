"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { evaluateNumeric, looksUnfinished } from "@/lib/calc";

/**
 * THE NUMERIC KEYPAD — our own, replacing iOS's, for every field `lib/calc`
 * reads (Mark, 2026-08-10: "can we write our own numeric keyboard that includes
 * operators?").
 *
 * The problem it answers: `inputMode="decimal"` gives iOS's number pad, which
 * has ten digits and no operators, so "4×9×25" cannot be typed at all. Dropping
 * `inputMode` gives the full keyboard instead, but on iPadOS `*`, `+`, `×` and
 * `÷` all sit two layers deep on `#+=`, so an expression costs a layer switch
 * per operator and every ordinary count pays for arithmetic it isn't doing.
 *
 * THE FIRST ATTEMPT KEPT iOS'S PAD AND FLOATED A STRIP OF OPERATORS ABOVE IT,
 * and Mark's verdict on real hardware was "clumsy and awkward" — rightly. It
 * made you work two keyboards at once: digits from Apple's, operators from
 * ours, 300px apart, with our strip riding a keyboard whose height we could
 * only infer. One keyboard that has all the keys is the answer; half a keyboard
 * bolted to Apple's is not.
 *
 * So the field asks for NO system keyboard (`inputMode="none"` — the input
 * stays focusable, keeps its caret, and can still be tapped to position it) and
 * this renders in the space that buys. Being ours, it can do the two things
 * Apple's never could: carry `× ÷ + − ( )` beside the digits, and show what the
 * expression comes to BEFORE you commit it.
 *
 * TOUCH ONLY. On a fine pointer the fields keep `inputMode="decimal"` and this
 * renders nothing — a real keyboard already has every one of these characters,
 * and a mouse would be a worse way to enter a number than typing it.
 *
 * Wiring is one spread per field, `useCalcField()`. Everything else is done
 * from here through the NATIVE value setter plus a bubbled `input` event, which
 * is how you drive a controlled React input from outside React — so none of the
 * eight fields carries a line of logic for this.
 */

const COARSE = "(pointer: coarse)";

function subscribeCoarse(onChange: () => void) {
  const mq = window.matchMedia(COARSE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * True on a touchscreen. `useSyncExternalStore` rather than an effect, per the
 * `set-state-in-effect` lint and the same reasoning `/welcome`'s hydration
 * guard uses; the server snapshot is false, so the markup ships with the
 * ordinary `inputMode="decimal"` and the client corrects it before any focus.
 */
export function useCoarsePointer() {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia(COARSE).matches,
    () => false
  );
}

/**
 * Spread onto any numeric input whose value goes through `evaluateNumeric`.
 *
 * `inputMode` MUST be decided by the field rather than set from here once the
 * input exists: iOS reads it when the element takes focus, and these inputs are
 * created already focused (`autoFocus`), so there is no moment in between for
 * an outside observer to change it. Hence a spread and not a MutationObserver.
 *
 * Mark ONLY fields the calculator reads. Several others carry
 * `inputMode="decimal"` and parse with a plain `Number()` — receiving's price,
 * a new invoice's total, a shop section's sort — and on those an inserted `×`
 * is a value that cannot save.
 */
export function useCalcField() {
  const coarse = useCoarsePointer();
  // `aria-label` (or `title`) on the field is what the pad's title bar shows,
  // so a field reached with › says which one it is — give it one.
  return {
    "data-rf-calc": "",
    inputMode: (coarse ? "none" : "decimal") as "none" | "decimal",
  } as const;
}

/**
 * [what it says, what it does, how it's painted].
 *
 * APPLE'S CALCULATOR, with Mark's own arrangement (2026-08-10, giving the grid
 * key by key). Four columns, operators down the right, the commit where `=`
 * lives — because that is where a hand already expects them, and this is the
 * one surface in the app that nobody should have to learn.
 *
 *     ⌫   (   )   ÷
 *     7   8   9   ×
 *     4   5   6   −
 *     1   2   3   +
 *     C   0   .   =
 *
 * `(` and `)` are ADJACENT, which the first cut got wrong by splitting them
 * across the two function corners to mirror Apple's `%` and `+/−`. A pair of
 * brackets is one idea and reads as one; copying the positions of two keys we
 * don't have was following the reference past the point it had anything to say.
 * `⌫` takes the corner they vacated.
 *
 * `=` EVALUATES AND STAYS (Mark, 2026-08-10: "make the [=] button not dismiss
 * the panel… I can always tap outside of it to make it go away"). It was `Done`
 * under its proper name, on the reasoning that evaluating and leaving were one
 * act here because the field behind holds the answer. They aren't: `=` on a
 * calculator collapses the expression to its result and leaves you sitting on
 * it, ready to keep going — 5×3 = 15, then ÷2. Dismissing on it made the answer
 * the end of the conversation, and cost you the pad every time you wanted to
 * check a number before committing to it.
 *
 * So `=` writes the result into the field and holds focus, and LEAVING is one
 * gesture with one meaning: tap outside. That is also the only route that
 * commits, since every field here saves on blur.
 */
type Key = readonly [label: string, action: string];

const KEYS: ReadonlyArray<Key> = [
  ["⌫", "back"],  ["(", "("],  [")", ")"],  ["÷", "÷"],
  ["7", "7"],     ["8", "8"],  ["9", "9"],  ["×", "×"],
  ["4", "4"],     ["5", "5"],  ["6", "6"],  ["−", "-"],
  ["1", "1"],     ["2", "2"],  ["3", "3"],  ["+", "+"],
  ["C", "clear"], ["0", "0"],  [".", "."],  ["=", "equals"],
];

/**
 * EVERY KEY IS A SINGLE GLYPH — no words, no captions (Mark, 2026-08-10: "all
 * glyphs instead of a mix of glyphs and captions… would probably look more
 * coherent"). It already was, as of `Done` becoming `=`; what remained was a
 * size branch that rendered caption type for any label longer than one
 * character, unreachable and quietly waiting to be wrong. Gone. If a key ever
 * needs a word, that is a decision to take deliberately, not a fallback to
 * inherit.
 *
 * WHAT MAKES THEM COHERENT IS OPTICAL SIZE, NOT ONE SIZE. A glyph is drawn
 * inside its em box at whatever proportion the typeface chose, so setting every
 * key to 24px makes them equal by measurement and unequal to the eye: `+` and
 * `×` occupy about two-thirds the height of an `8`, and `=` — two thin strokes,
 * no ascender, no descender — less again. Sizing each class until they LOOK the
 * same is what "coherent" actually asks for. Digits and the rest sit at the
 * base; the four operators come up, and `=` further still.
 *
 * `⌫` (U+232B) needs the other kind of correction: its mass is the box on the
 * RIGHT and it tapers to a point on the left, so centring by the bounding box
 * reads as pushed right. The nudge moves the GLYPH, never the key — a key is a
 * bordered square now, and shifting the box would put one key out of the grid.
 *
 * SIZE IS A LOOKUP, NOT AN EXTRA CLASS, and that is deliberate: Tailwind
 * resolves competing utilities by STYLESHEET order, so appending `text-[30px]`
 * after `text-[24px]` is a coin flip that a token reorder would silently flip
 * back. Exactly one text-size utility is ever emitted per key.
 */
const KEY_SIZE_BASE = "text-[19px]";
const KEY_SIZE: Record<string, string> = {
  "÷": "text-[23px]",
  "×": "text-[23px]",
  "−": "text-[23px]",
  "+": "text-[23px]",
  "=": "text-[25px]",
};
const KEY_NUDGE: Record<string, string> = { "⌫": "-translate-x-[2px]" };

/**
 * EVERY KEY IS THE APP'S OWN MAC BUTTON (Mark, 2026-09-10: "give our calculator
 * control the classic mac look using our mac styling for buttons … keeping the
 * layout the same"): white, square, a 1px black border, `mac-control`'s hard
 * 3px shadow, and the drop into it on press. One dress for all twenty — the
 * 1984 Calculator told its keys apart by glyph alone, and the orange operators
 * were the modern Mac this replaces.
 *
 * `mac-own-hover` because this pad only ever renders on a TOUCH screen, where a
 * tap leaves `:hover` stuck on the last key pressed — a grey key sitting there
 * after you have moved on reads as a key still held. The press says it instead:
 * the drop, plus the app's hover grey for as long as the finger is down.
 */
const KEY_CLASS =
  "mac-control mac-own-hover flex aspect-square items-center justify-center border border-ink bg-white font-normal leading-none text-ink active:bg-[#c0c0c0]";

/**
 * Drive a controlled React input from outside React. Assigning `el.value`
 * directly is swallowed — React's value tracker sees no change, `onChange`
 * never fires, and the character is wiped by the next render. Going through the
 * prototype's setter updates the tracker; the bubbled `input` event is what
 * React's root listener turns back into `onChange`.
 */
function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el) as object,
    "value"
  )?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Every field the pad can reach, in page order: the inputs it drives, and the
 * resting `InlineValue` buttons that OPEN one (`data-rf-calc-opener`). A
 * disabled field, or one not on screen at all, is skipped.
 */
function calcStops(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-rf-calc], [data-rf-calc-opener]")
  ).filter(
    (n) =>
      !(n instanceof HTMLInputElement || n instanceof HTMLButtonElement ? n.disabled : false) &&
      n.getClientRects().length > 0
  );
}

function isCalcField(n: EventTarget | Element | null): n is HTMLInputElement {
  return n instanceof HTMLInputElement && n.dataset.rfCalc !== undefined;
}

/** What the title bar calls the field: its accessible name, else its tooltip. */
function labelFor(el: HTMLInputElement): string {
  return (
    el.getAttribute("aria-label") ||
    el.labels?.[0]?.textContent?.trim() ||
    el.title ||
    "Calculator"
  );
}

/**
 * THE PAD SITS ON THE FAR SIDE OF THE PAGE FROM THE FIELD (Mark, 2026-09-23,
 * after supervisors complained it sat on the shift report's Made and Left
 * columns). It used to be centred, which is where a table's number columns
 * usually are.
 *
 * Pinned to the window's LEFT edge when the field is right of centre, the right
 * edge otherwise, and centred up and down. Only when neither side has room for
 * it beside the field (a phone) does it go above or below instead.
 *
 * AND ONCE UP, IT STAYS WHERE IT IS until it would cover the field. A table's
 * number columns often straddle the middle — the shift report's Made is left of
 * centre and Left right of it — and choosing afresh for every field flipped the
 * pad across the screen on every ›, so the next tap landed on the page instead
 * of a key (measured 2026-09-23). It remembers between openings as well, so
 * tapping the next field brings it back where it was. A pad that holds still
 * can be learned.
 */
type Side = "left" | "right" | "top" | "bottom";

/** The window's width plus the guard ring, both sides. Keep in step with the classes below. */
const PAD_OUTER_WIDTH = 240 + 2 * 16;

/** Would the pad, parked at `side`, sit on top of the field? */
function covers(side: Side, r: DOMRect, padHeight: number): boolean {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (side === "left") return r.left < PAD_OUTER_WIDTH;
  if (side === "right") return r.right > vw - PAD_OUTER_WIDTH;
  if (side === "top") return r.top < padHeight;
  return r.bottom > vh - padHeight;
}

function sideFor(el: HTMLElement, current: Side | null, padHeight: number): Side {
  const r = el.getBoundingClientRect();
  if (current && !covers(current, r, padHeight)) return current;
  const vw = window.innerWidth;
  const fieldIsRight = r.left + r.width / 2 > vw / 2;
  const order: Side[] = fieldIsRight ? ["left", "right"] : ["right", "left"];
  for (const side of order) if (!covers(side, r, padHeight)) return side;
  return r.top + r.height / 2 > window.innerHeight / 2 ? "top" : "bottom";
}

const SIDE_CLASS: Record<Side, string> = {
  left: "left-0 top-1/2 -translate-y-1/2",
  right: "right-0 top-1/2 -translate-y-1/2",
  top: "top-0 left-1/2 -translate-x-1/2",
  bottom: "bottom-0 left-1/2 -translate-x-1/2",
};

/** How far a finger may travel and still count as a tap rather than a scroll. */
const TAP_SLOP = 10;

export function CalcPad() {
  const coarse = useCoarsePointer();
  const [target, setTarget] = useState<HTMLInputElement | null>(null);
  /** Mirrored so the readout re-renders; the input is the source of truth. */
  const [draft, setDraft] = useState("");
  const [label, setLabel] = useState("");
  const [side, setSide] = useState<Side>("left");
  const padRef = useRef<HTMLDivElement>(null);
  /** Where the pad was last parked. Kept between openings too, so it comes back where it was. */
  const parked = useRef<Side | null>(null);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = isCalcField(e.target) ? e.target : null;
      setTarget(el);
      if (!el) return;
      setDraft(el.value);
      setLabel(labelFor(el));
      parked.current = sideFor(el, parked.current, padRef.current?.offsetHeight ?? 420);
      setSide(parked.current);
    };
    // No key can take focus (see the pointerdown handler), so a focusout is a
    // genuine departure — a save, an Escape, or the next field.
    //
    // DEFERRED ONE TICK, so moving from one field to the next doesn't take the
    // pad down and put it straight back up. The next field's `focusin` has
    // landed by then (an `InlineValue` mounts its input and autofocuses it
    // within the click that opened it), and the pad simply retargets.
    const onFocusOut = () => {
      setTimeout(() => {
        if (!isCalcField(document.activeElement)) setTarget(null);
      }, 0);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // Follow the field's own value, so typing on a hardware keyboard (an iPad
  // with one attached is still a coarse pointer) keeps the readout honest.
  useEffect(() => {
    if (!target) return;
    const read = () => setDraft(target.value);
    target.addEventListener("input", read);
    return () => target.removeEventListener("input", read);
  }, [target]);

  /**
   * A STRANDED PAD IS THE WORST THING THIS COULD DO, so don't rely on
   * `focusout` alone to take it down.
   *
   * `InlineValue` unmounts its input on Escape and after a save, and a focused
   * element being removed is exactly the case where browsers have historically
   * disagreed about firing blur/focusout — WebKit especially, which is what
   * this runs on. If it doesn't fire, the pad is left pointing at a detached
   * node with every key inert.
   *
   * So watch for the target leaving the document and drop it. Cheap in the way
   * that matters — the observer exists only while the pad is up, and its
   * callback is one `isConnected` read.
   */
  useEffect(() => {
    if (!target) return;
    const observer = new MutationObserver(() => {
      if (!target.isConnected) setTarget(null);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [target]);

  /**
   * THE FIELD BEING EDITED IS OUTLINED (`[data-rf-calc-active]` in
   * mac-look.css), because › can take you to a field you never touched and the
   * pad is no longer beside it. And if › lands on one that is off screen, it is
   * scrolled to the middle — only then: a field you just tapped is already where
   * your finger is, and moving the page under it would be a lurch.
   */
  useEffect(() => {
    if (!target || !coarse) return;
    target.setAttribute("data-rf-calc-active", "");
    const r = target.getBoundingClientRect();
    if (r.top < 96 || r.bottom > window.innerHeight - 24) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    const onResize = () => {
      parked.current = sideFor(target, parked.current, padRef.current?.offsetHeight ?? 420);
      setSide(parked.current);
    };
    window.addEventListener("resize", onResize);
    return () => {
      target.removeAttribute("data-rf-calc-active");
      window.removeEventListener("resize", onResize);
    };
  }, [target, coarse]);

  /**
   * THE PAGE STAYS LIVE WHILE THE PAD IS UP (Mark, 2026-09-23). There used to
   * be an invisible full-screen catcher behind the pad, so the first tap
   * anywhere else only dismissed it — tapping the next field meant tapping it
   * twice, which is what supervisors were complaining about on the shift report.
   *
   * Now a tap outside the pad goes where it was aimed, and ALSO finishes the
   * edit: the field is blurred (every field here saves on blur) before the tap
   * lands. That blur is ours rather than the browser's because iOS does not
   * take focus off an input when you tap something that can't take focus
   * itself — a plain cell, a button — so without it the pad would never leave.
   *
   * A TAP ON ANOTHER FIELD FOCUSES IT OURSELVES, rather than leaving that to
   * the browser (Mark, 2026-09-23, on the iPad: "the first tap dismisses the
   * calculator, the second to focus the next field"). In the desktop harness
   * the browser's own focus arrived after our blur and it took one tap; on iOS
   * it didn't. The likely reason is WebKit's content-change heuristic: iOS
   * fires the tap's mouse events and focus AFTER pointerup, and when the page
   * changes in between — here our blur saves the field, the pad unmounts, the
   * outline comes off — it can treat the tap as a hover and drop the focus. So
   * we don't wait for it: the tapped field is focused right here, before
   * anything changes, which also blurs (and saves) the old one in the same
   * move, and the pad retargets without ever going down. An `InlineValue` cell
   * at rest is opened by clicking it, the way › does.
   *
   * On pointerUP, and only for a TAP: a finger that travels is scrolling the
   * page, and the pad should ride that out rather than close.
   */
  useEffect(() => {
    if (!target || !coarse) return;
    let start: { x: number; y: number } | null = null;
    const inside = (n: EventTarget | null) =>
      n instanceof Node && (padRef.current?.contains(n) || n === target);
    const onDown = (e: PointerEvent) => {
      start = inside(e.target) ? null : { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!start) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      start = null;
      if (moved > TAP_SLOP || inside(e.target)) return;
      const hit = e.target instanceof Element ? e.target : null;
      const field = hit?.closest<HTMLElement>("input, textarea, select, [contenteditable='true']");
      if (field && !(field as HTMLInputElement).disabled) {
        field.focus({ preventScroll: true });
        return;
      }
      const opener = hit?.closest<HTMLElement>("[data-rf-calc-opener]");
      if (opener) {
        target.blur();
        opener.click();
        return;
      }
      target.blur();
      setTarget(null);
    };
    const onCancel = () => {
      start = null;
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onCancel, true);
    };
  }, [target, coarse]);

  if (!target || !coarse) return null;

  /** Replace the selection, or insert at the caret. */
  function write(ch: string) {
    const el = target;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    setNativeValue(el, el.value.slice(0, start) + ch + el.value.slice(end));
    caretTo(el, start + ch.length);
  }

  function back() {
    const el = target;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    // A selection is deleted whole; otherwise take the character before the
    // caret, which is what a backspace key means.
    const from = start === end ? Math.max(0, start - 1) : start;
    // NOTHING LEFT TO DELETE IS A NO-OP, NEVER AN EXIT (Mark, 2026-08-10: "it
    // should just get to zero and stay there"). The readout already prints an
    // empty field as `0`, so a pad you can't backspace your way out of reads
    // exactly like a calculator sitting at zero.
    //
    // Empty is left EMPTY rather than made a literal "0", and that matters on
    // the order guide: a quantity has three states, and an explicit 0 ("we're
    // ordering none") is a different sentence from untouched. Writing a 0 here
    // to satisfy the readout would take away the only way back to untouched.
    if (from === end) return;
    setNativeValue(el, el.value.slice(0, from) + el.value.slice(end));
    caretTo(el, from);
  }

  /**
   * Put the caret back — now AND once more after React commits, which moves it
   * to the end when it re-renders a controlled input. A macrotask, deliberately
   * not `requestAnimationFrame`: rAF doesn't run in a backgrounded tab, which
   * `lib/scrollMemory` learned the hard way and this reproduced.
   */
  function caretTo(el: HTMLInputElement, at: number) {
    el.setSelectionRange(at, at);
    setTimeout(() => {
      if (document.activeElement === el) el.setSelectionRange(at, at);
    }, 0);
  }

  /**
   * Collapse the expression to its answer, in the field, and stay.
   *
   * NOTHING TO EVALUATE IS A NO-OP, NEVER AN EXIT — the same rule `back` keeps,
   * and for the same reason: `=` on a half-typed "5×" is a mis-tap, and taking
   * the pad down would answer it by throwing the expression away. An empty
   * field, an unfinished one and an unreadable one all leave the field exactly
   * as it is, which is what the readout is already saying in words.
   *
   * The readout follows for free. Once the field holds the answer, `draft` IS
   * the result, so `showsResult` goes false and the small grey expression line
   * clears — the same thing a calculator does when you press it.
   */
  function equals() {
    const el = target;
    if (!el) return;
    const text = el.value.trim();
    if (text === "") return;
    const value = evaluateNumeric(text);
    if (value === null) return;
    const next = String(value);
    if (next === el.value) return;
    setNativeValue(el, next);
    caretTo(el, next.length);
  }

  function press(action: string) {
    const el = target;
    if (!el) return;
    if (action === "back") return back();
    if (action === "equals") return equals();
    if (action === "clear") {
      setNativeValue(el, "");
      caretTo(el, 0);
      return;
    }
    // "done" is the close box, and nothing else sends it. Keeping it an action
    // rather than inlining it is deliberate: `write`'s fallthrough below would
    // otherwise type a stray character into the field for any action it
    // doesn't recognise, and this is the one that must never be typed.
    //
    // Every field commits on blur — InlineValue saves, the guide's boxes upsert
    // — so leaving IS the commit. Clearing `target` as well is belt and braces:
    // on a detached node (see the observer above) blur is a no-op.
    if (action === "done") {
      el.blur();
      setTarget(null);
      return;
    }
    if (action === "prev" || action === "next") return step(el, action === "next" ? 1 : -1);
    write(action);
  }

  /**
   * ‹ AND › WALK THE PAGE'S CALCULATOR FIELDS IN ORDER (Mark, 2026-09-23) —
   * the arrows over iOS's own keyboard, for a shift report that is thirty counts
   * in a row. Page order is reading order: across a row, then down.
   *
   * Moving focus is the commit, as ever: the field being left blurs and saves.
   * An `InlineValue` at rest is a button rather than an input, so it is opened
   * by clicking it, and its editor takes focus as it mounts. At either end the
   * arrow does nothing, rather than wrapping round to a field off screen.
   */
  function step(el: HTMLInputElement, dir: 1 | -1) {
    const stops = calcStops();
    const next = stops[stops.indexOf(el) + dir];
    if (stops.indexOf(el) < 0 || !next) return;
    if (next instanceof HTMLInputElement) {
      next.focus({ preventScroll: true });
    } else {
      el.blur();
      next.click();
    }
  }

  const text = draft.trim();
  const result = text === "" ? null : evaluateNumeric(text);
  // Only worth saying when it isn't just the number already on screen.
  const showsResult = result !== null && String(result) !== text;
  // HALF AN EXPRESSION IS NOT A MISTAKE — "5×" doesn't parse, and saying so the
  // instant you press an operator would put a warning on screen for most of the
  // time you spend typing. `looksUnfinished` lives in lib/calc beside the
  // parser it defers to, and is fixture-pinned in both directions.
  const showsRefusal = result === null && text !== "" && !looksUnfinished(text);

  /** Every control on the pad acts on pointerdown and holds focus; see the keys. */
  const hold = {
    onMouseDown: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
  };
  const act = (action: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      press(action);
    },
    ...hold,
  });

  return (
    <div
      ref={padRef}
      // z-[80] is above anchored panels (70), the top of the app's ladder:
      // this stands in for the system keyboard, so nothing may cover it.
      //
      // THE GUARD RING — `p-4` of transparent margin round the window. A tap
      // on it is swallowed rather than reaching the page, so a finger that
      // drifts a few millimetres off a corner key while hammering ⌫ doesn't
      // land on whatever is behind (Mark, 2026-08-10, when a near miss used to
      // dismiss the pad). Keep `PAD_OUTER_WIDTH` in step with it.
      className={`fixed z-[80] p-4 ${SIDE_CLASS[side]}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      {...hold}
    >
      <div
        // THE 1984 MAC CALCULATOR, IN THE APP'S OWN MAC LOOK (Mark, 2026-09-10:
        // "retrofy it while keeping the layout the same"). A black title bar
        // over a stippled body, a 2px black frame, and the hard drop shadow
        // every Mac button in the app carries, one step heavier for a window.
        // The rounded corners are what tells a floating window from a box on
        // the page.
        //
        // 15rem WIDE, down from 21 (Mark, 2026-09-23: "it doesn't need to be so
        // big"). A key still comes out about 50px square, over the 44px a
        // finger needs.
        className="w-[15rem] overflow-hidden rounded-[8px] border-2 border-ink bg-white shadow-[4px_4px_0_0_#000]"
      >
        {/* THE TITLE BAR names the field being edited — `aria-label` on the
            input — since › can reach one you never touched and the pad is
            across the page from it. Its close box does what a tap outside does
            (`done` — blur, which is the commit). Every target is 40px. */}
        <div className="flex h-10 items-center bg-ink text-white">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close the calculator"
            className="flex h-10 w-10 shrink-0 items-center justify-center"
            {...act("done")}
          >
            <span className="block h-[16px] w-[16px] border-2 border-white" />
          </button>
          <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{label}</span>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Previous field"
            className="flex h-10 w-10 shrink-0 items-center justify-center text-[26px] leading-none active:bg-neutral-700"
            {...act("prev")}
          >
            ‹
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Next field"
            className="flex h-10 w-10 shrink-0 items-center justify-center text-[26px] leading-none active:bg-neutral-700"
            {...act("next")}
          >
            ›
          </button>
        </div>

        <div className="mac-stipple p-2">
          {/* THE READOUT, Apple's way round: the expression small and grey
              above, what it comes to large below, both right-aligned so the
              digits line up as they grow. A sunken white well — `mac-field`,
              the search box's own inset. A refusal is red, the app's colour
              for something wrong. */}
          <div className="mac-field mb-2 border border-ink bg-white px-2 pb-1 pt-1 text-right">
            <div className="h-4 truncate font-mono text-[12px] leading-4 text-muted">
              {showsResult ? draft : showsRefusal ? "can’t read that" : " "}
            </div>
            <div
              className={`truncate font-mono text-[28px] leading-tight ${
                showsRefusal ? "text-accent" : "text-ink"
              }`}
            >
              {showsResult ? result : draft || "0"}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {KEYS.map(([label, action]) => (
              <button
                key={label}
                type="button"
                // Act on pointerdown and preventDefault: focus must never leave
                // the field (a blur would save a half-typed expression), and
                // acting here means the key doesn't depend on a compatibility
                // click arriving after we've cancelled the default.
                //
                // AND preventDefault AGAIN ON MOUSEDOWN (`hold`), which is not
                // belt and braces — it is the only one of the two WebKit is
                // known to honour for keeping focus. iOS synthesises a mouse
                // sequence after the pointer events, and `preventDefault()` on
                // the POINTER event does not reliably cancel the focus change
                // that rides the synthesised `mousedown`. Chromium suppresses
                // it from the pointerdown alone, which is why the pad tests
                // clean on a desktop and only misbehaves on the iPad (Mark,
                // 2026-08-10). `TextInput`'s ✕ learned exactly this.
                {...act(action)}
                tabIndex={-1}
                aria-label={label}
                className={`${KEY_CLASS} ${KEY_SIZE[label] ?? KEY_SIZE_BASE}`}
              >
                <span className={KEY_NUDGE[label]}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
