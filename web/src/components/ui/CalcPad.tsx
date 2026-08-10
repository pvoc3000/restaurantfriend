"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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
  return {
    "data-rf-calc": "",
    inputMode: (coarse ? "none" : "decimal") as "none" | "decimal",
  } as const;
}

/**
 * [what it says, what it does, how it's painted].
 *
 * THE LAYOUT IS APPLE'S CALCULATOR, KEY FOR KEY (Mark, 2026-08-10, with a
 * screenshot: "copy this UI"). Four columns, operators down the right, the
 * commit where `=` lives — because that is where a hand already expects them,
 * and this is the one surface in the app that nobody should have to learn.
 *
 * Our four function keys take the positions Apple gives `⌫ AC %` and `+/−`:
 *
 *     ⌫   C   (   ÷
 *     7   8   9   ×
 *     4   5   6   −
 *     1   2   3   +
 *     )   0   .   Done
 *
 * `(` and `)` are split across the two function corners, which is the one place
 * this diverges in feel — they'd rather be adjacent. Keeping the right column
 * purely operators is worth more: it's the column you reach for without
 * looking.
 */
type Key = readonly [label: string, action: string, tone: "fn" | "digit" | "op"];

const KEYS: ReadonlyArray<Key> = [
  ["⌫", "back", "fn"],  ["C", "clear", "fn"], ["(", "(", "fn"],   ["÷", "÷", "op"],
  ["7", "7", "digit"],  ["8", "8", "digit"],  ["9", "9", "digit"], ["×", "×", "op"],
  ["4", "4", "digit"],  ["5", "5", "digit"],  ["6", "6", "digit"], ["−", "-", "op"],
  ["1", "1", "digit"],  ["2", "2", "digit"],  ["3", "3", "digit"], ["+", "+", "op"],
  [")", ")", "fn"],     ["0", "0", "digit"],  [".", ".", "digit"], ["Done", "done", "op"],
];

/** Apple's dark-mode calculator palette. */
const TONE: Record<Key[2], string> = {
  fn: "bg-[#6b6b6d] text-white active:bg-[#8a8a8c]",
  digit: "bg-[#4d4d4f] text-white active:bg-[#6b6b6d]",
  op: "bg-[#ff9f0a] text-white active:bg-[#ffb340]",
};

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

export function CalcPad() {
  const coarse = useCoarsePointer();
  const [target, setTarget] = useState<HTMLInputElement | null>(null);
  /** Mirrored so the readout re-renders; the input is the source of truth. */
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const isCalcField = (n: EventTarget | null): n is HTMLInputElement =>
      n instanceof HTMLInputElement && n.dataset.rfCalc !== undefined;

    const onFocusIn = (e: FocusEvent) => {
      const el = isCalcField(e.target) ? e.target : null;
      setTarget(el);
      setDraft(el?.value ?? "");
    };
    // No key can take focus (see the pointerdown handler), so a focusout is a
    // genuine departure — a save, an Escape, or the next field.
    const onFocusOut = () => setTarget(null);

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
   * A STRANDED SCRIM IS THE WORST THING THIS COULD DO, so don't rely on
   * `focusout` alone to take it down.
   *
   * `InlineValue` unmounts its input on Escape and after a save, and a focused
   * element being removed is exactly the case where browsers have historically
   * disagreed about firing blur/focusout — WebKit especially, which is what
   * this runs on. If it doesn't fire, the pad is left pointing at a detached
   * node with a full-screen scrim over the app and every key inert: it reads as
   * the app having frozen, and only a reload clears it.
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

  // NOTHING SCROLLS THE FIELD INTO VIEW ANY MORE, and that's the point of
  // centring (Mark, 2026-08-10: "can it appear as an overlay center of the
  // screen with a dim background"). While the pad sat at the foot of the window
  // it could cover the very field you were editing, so it measured and scrolled
  // — a lurch under your hands at the moment you started typing. Centred behind
  // a scrim there is nothing to avoid: everything else is dimmed anyway, and
  // the readout IS the field while the pad is up. The page stays exactly where
  // you left it.

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

  function press(action: string) {
    const el = target;
    if (!el) return;
    if (action === "back") return back();
    if (action === "clear") {
      setNativeValue(el, "");
      caretTo(el, 0);
      return;
    }
    // Every field commits on blur — InlineValue saves, the guide's boxes
    // upsert — so leaving IS the commit, and one route out keeps them uniform.
    // Clearing `target` as well is belt and braces: normally the blur's own
    // focusout does it, and on a detached node (see the observer above) blur is
    // a no-op, so without this a tap on the scrim couldn't dismiss the pad
    // either. Idempotent when focusout does arrive.
    if (action === "done") {
      el.blur();
      setTarget(null);
      return;
    }
    write(action);
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

  return (
    <div
      // THE CATCHER — full screen, and INVISIBLE (Mark, 2026-08-10: "no
      // dimming"). z-[80] is above anchored panels (70), the top of the app's
      // ladder: this stands in for the system keyboard, so nothing may cover
      // it.
      //
      // It still covers everything even with nothing painted, which is what
      // keeps "tap anywhere else to finish" working. Known cost of losing the
      // dimming, and accepted: the page behind now LOOKS live while it isn't,
      // so the first tap outside spends itself on dismissing rather than on
      // whatever you aimed at. That is how every popover in the app behaves,
      // but the scrim used to say so and now nothing does.
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      // A tap OUTSIDE the pad does what Done does. preventDefault first, or the
      // tap blurs the field by itself and the save happens without us — which
      // is the same outcome by luck rather than by decision, and on a field
      // whose editor unmounts on blur it would race the commit.
      onPointerDown={(e) => {
        e.preventDefault();
        press("done");
      }}
    >
      <div
        // THIS PANEL DELIBERATELY DOES NOT LOOK LIKE THE APP (Mark, 2026-08-10,
        // with a screenshot of macOS Calculator: "copy this UI"). Dark, round
        // corners, circular keys, orange operators, a drop shadow — four house
        // rules broken at once.
        //
        // The justification isn't that Mark asked, though he did. It's that
        // this is the one element in the app that ISN'T app chrome: it stands
        // in for the system keyboard, and a system keyboard has never matched
        // the app it types into. Looking like the calculator everyone already
        // owns is the whole point — nobody should have to learn this surface,
        // and its own conventions carry more than ours would. Every other
        // control on screen stays black and white and square.
        //
        // Keep it self-contained: these literals are the calculator's palette,
        // not new tokens, and nothing else in the app should reach for them.
        className="w-[min(21rem,calc(100vw-2rem))] rounded-[22px] bg-[#1c1c1e] p-3 shadow-[0_10px_44px_rgba(0,0,0,0.38)] ring-1 ring-white/10"
        // A tap anywhere on the pad, including its gaps, must not move focus —
        // and must not reach the catcher, or every key press would also commit.
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {/* THE READOUT, Apple's way round: the expression small and grey above,
            what it comes to large and white below, both right-aligned so the
            digits line up as they grow.
            
            It does a second job here that a calculator's doesn't have to. The
            field being edited is somewhere behind this panel and may be off
            screen entirely, so while the pad is up this IS the field — which is
            why it gets two lines and 40px of type rather than a caption. */}
        <div className="px-3 pb-3 pt-2 text-right">
          <div className="h-5 truncate font-mono text-[15px] leading-5 text-white/45">
            {showsResult ? draft : showsRefusal ? "can’t read that" : "\u00a0"}
          </div>
          <div
            className={`truncate font-mono text-[40px] font-light leading-tight ${
              showsRefusal ? "text-[#ff9f0a]" : "text-white"
            }`}
          >
            {showsResult ? result : draft || "0"}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2.5">
          {KEYS.map(([label, action, tone]) => (
            <button
              key={label}
              type="button"
              // Act on pointerdown and preventDefault: focus must never leave
              // the field (a blur would save a half-typed expression), and
              // acting here means the key doesn't depend on a compatibility
              // click arriving after we've cancelled the default.
              // stopPropagation keeps it off the catcher, whose own handler
              // commits.
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                press(action);
              }}
              tabIndex={-1}
              aria-label={label}
              className={`flex aspect-square items-center justify-center rounded-full leading-none ${
                action === "done"
                  ? "text-[13px] font-semibold uppercase tracking-[0.04em]"
                  : "text-[24px] font-normal"
              } ${TONE[tone]}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
