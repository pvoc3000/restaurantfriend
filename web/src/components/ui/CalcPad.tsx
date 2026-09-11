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
const KEY_SIZE_BASE = "text-[24px]";
const KEY_SIZE: Record<string, string> = {
  "÷": "text-[29px]",
  "×": "text-[29px]",
  "−": "text-[29px]",
  "+": "text-[29px]",
  "=": "text-[32px]",
};
const KEY_NUDGE: Record<string, string> = { "⌫": "-translate-x-[3px]" };

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
    // NO KEY SENDS THIS ANY MORE — the catcher is its only caller, so "done"
    // means "the reader tapped outside" and nothing else. Keeping it an action
    // rather than inlining it at the catcher is deliberate: `write`'s fallthrough
    // below would otherwise type a stray character into the field for any action
    // it doesn't recognise, and this is the one that must never be typed.
    //
    // Every field commits on blur — InlineValue saves, the guide's boxes upsert
    // — so leaving IS the commit, and there is now exactly one way to leave.
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
      className="fixed inset-0 z-[80] flex items-center justify-center"
      // A tap OUTSIDE the pad does what `=` does. preventDefault first, or the
      // tap blurs the field by itself and the save happens without us — which
      // is the same outcome by luck rather than by decision, and on a field
      // whose editor unmounts on blur it would race the commit.
      onPointerDown={(e) => {
        e.preventDefault();
        press("done");
      }}
      // Suppress only — `press("done")` stays on pointerdown, so a tap outside
      // commits exactly once. This stops the synthesised mousedown blurring the
      // field a second time, by its own route, after we have already decided.
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* THE GUARD RING — transparent, and the reason the pad stopped
          dismissing itself while you were using it.

          Mark, 2026-08-10: "I don't like when the calc dismisses if you hit
          delete enough times to clear the number." Backspace never dismissed
          anything — 4 presses in the harness empty the field and leave the pad
          up. What dismisses is the CATCHER, and the panel's own padding put it
          only 12px outside the edge of a corner key. Hammer ⌫ in the bottom-left
          and a finger that drifts a few millimetres lands on it.

          The timing is the tell: this appeared when the scrim came off. While
          the page was dimmed you could SEE where the panel ended; invisible,
          that boundary is a guess, and a miss costs you the whole pad.

          So 28px of transparent margin absorbs a near miss instead. A tap that
          genuinely means "somewhere else" is still further out than that, and
          still finishes the edit. */}
      <div
        className="p-7"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        // See the key buttons: pointerdown alone doesn't hold focus in WebKit.
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
      <div
        // THE 1984 MAC CALCULATOR, IN THE APP'S OWN MAC LOOK (Mark, 2026-09-10:
        // "the calculator looks like the modern mac right now — let's retrofy
        // it while keeping the layout the same", with the original desk
        // accessory as the reference). A black title bar over a stippled body,
        // a 2px black frame, and a hard drop shadow — the same 3px-down-and-right
        // shadow every Mac button in the app carries, one step heavier for a
        // window.
        //
        // It replaced a dark, rounded, orange-keyed copy of macOS Calculator
        // (Mark, 2026-08-10: "copy this UI"). The argument for looking like a
        // calculator rather than like app chrome still holds — this stands in
        // for the system keyboard — and since the Mac look went app-wide the
        // calculator people know and the app's own buttons are the same thing.
        //
        // The corners are the one soft thing left, and deliberately: the
        // original's window corners were rounded, and they are what tells a
        // floating window from a box on the page.
        className="w-[min(21rem,calc(100vw-4.5rem))] overflow-hidden rounded-[8px] border-2 border-ink bg-white shadow-[4px_4px_0_0_#000]"
        // A tap anywhere on the pad, including its gaps, must not move focus —
        // and must not reach the catcher, or every key press would also commit.
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        // See the key buttons: pointerdown alone doesn't hold focus in WebKit.
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {/* THE TITLE BAR. Its close box is real: it does what a tap outside
            does (`done` — blur, which is the commit), because a close box that
            does nothing is a lie on the one surface people already know how to
            read. 44px of target around an 18px box. */}
        <div className="flex h-11 items-center gap-1 bg-ink pr-3 text-white">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close the calculator"
            className="flex h-11 w-11 shrink-0 items-center justify-center"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              press("done");
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <span className="block h-[18px] w-[18px] border-2 border-white" />
          </button>
          <span className="text-[17px] font-bold tracking-[0.02em]">Calculator</span>
        </div>

        <div className="mac-stipple p-3">
        {/* THE READOUT, Apple's way round: the expression small and grey above,
            what it comes to large below, both right-aligned so the digits line
            up as they grow. A sunken white well — `mac-field`, the search box's
            own inset — so it reads as a window onto a value rather than a key.

            It does a second job here that a calculator's doesn't have to. The
            field being edited is somewhere behind this panel and may be off
            screen entirely, so while the pad is up this IS the field — which is
            why it gets two lines and 40px of type rather than a caption. A
            refusal is red, the app's colour for something wrong. */}
        <div className="mac-field mb-3 border border-ink bg-white px-3 pb-1.5 pt-2 text-right">
          <div className="h-5 truncate font-mono text-[15px] leading-5 text-muted">
            {showsResult ? draft : showsRefusal ? "can’t read that" : "\u00a0"}
          </div>
          <div
            className={`truncate font-mono text-[40px] leading-tight ${
              showsRefusal ? "text-accent" : "text-ink"
            }`}
          >
            {showsResult ? result : draft || "0"}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2.5">
          {KEYS.map(([label, action]) => (
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
              // AND AGAIN ON MOUSEDOWN, which is not belt and braces — it is
              // the only one of the two WebKit is known to honour for keeping
              // focus. iOS builds pointer events on top of touches and then
              // synthesises a mouse sequence, and `preventDefault()` on the
              // POINTER event does not reliably cancel the focus change that
              // rides the synthesised `mousedown`. Chromium suppresses it from
              // the pointerdown alone, which is why the pad tests clean on a
              // desktop and only misbehaves on the iPad.
              //
              // Losing focus here is not cosmetic: the field's focusout is what
              // CalcPad reads as "the reader has left", so it takes the pad down
              // — on EVERY key (Mark, 2026-08-10). The digit still lands, since
              // pointerdown already ran, which is the tell.
              //
              // `TextInput`'s ✕ learned exactly this and for exactly this
              // reason ("without it the field blurs on press"). It acts on
              // pointerdown and nowhere else, so this handler only ever
              // suppresses — it can never double-press.
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
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
    </div>
  );
}
