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

/** [what it says, what it does]. */
type Key = readonly [label: string, action: string];

const KEYS: ReadonlyArray<Key> = [
  ["7", "7"], ["8", "8"], ["9", "9"], ["÷", "÷"], ["⌫", "back"],
  ["4", "4"], ["5", "5"], ["6", "6"], ["×", "×"], ["(", "("],
  ["1", "1"], ["2", "2"], ["3", "3"], ["−", "-"], [")", ")"],
  ["0", "0"], [".", "."], ["C", "clear"], ["+", "+"], ["Done", "done"],
];

/** Keep in step with the grid below; the scroll-clear check reads it. */
const PAD_H = 292;

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

  // KEEP THE FIELD IN SIGHT. With no system keyboard, Safari has nothing to
  // scroll for and won't — so a field near the foot of the window would sit
  // behind the pad, which is the one way this could be worse than what it
  // replaced. Deferred a tick so the pad is laid out and any pane the field
  // lives in has settled.
  useEffect(() => {
    if (!target || !coarse) return;
    const id = setTimeout(() => {
      const covered =
        target.getBoundingClientRect().bottom > window.innerHeight - PAD_H - 16;
      if (covered) target.scrollIntoView({ block: "center" });
    }, 60);
    return () => clearTimeout(id);
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
    if (action === "done") return el.blur();
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
      // Above anchored panels (70), the top of the app's ladder: this stands in
      // for the system keyboard, so nothing may cover it.
      className="fixed bottom-4 left-1/2 z-[80] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 border border-ink bg-white"
      // A tap anywhere on the pad, including its gaps, must not move focus.
      onPointerDown={(e) => e.preventDefault()}
    >
      {/* THE READOUT — the thing Apple's pad could never give: what you have
          typed and what it comes to, before you commit it. An expression you
          can't check is an expression you have to trust. */}
      <div className="flex items-baseline justify-between gap-3 border-b border-ink bg-ink px-3 py-2">
        <span className="truncate font-mono text-[15px] text-white">
          {draft || " "}
        </span>
        {showsResult && (
          <span className="shrink-0 font-mono text-[15px] font-bold text-white">
            = {result}
          </span>
        )}
        {showsRefusal && (
          <span className="shrink-0 text-[11px] uppercase tracking-[0.12em] text-mark">
            can&rsquo;t read
          </span>
        )}
      </div>

      <div className="grid grid-cols-5 gap-1.5 p-1.5">
        {KEYS.map(([label, action]) => (
          <button
            key={label}
            type="button"
            // Act on pointerdown and preventDefault: focus must never leave the
            // field (a blur would save a half-typed expression), and acting
            // here means the key doesn't depend on a compatibility click
            // arriving after we've cancelled the default.
            onPointerDown={(e) => {
              e.preventDefault();
              press(action);
            }}
            tabIndex={-1}
            aria-label={label}
            // Done is BLACK, which is the panel-commit exception rather than a
            // breach of "every button is white": this is a panel producing one
            // outcome, and its commit sits among character keys rather than
            // among peer commands. It is also where every keyboard on earth
            // puts its return key.
            className={`h-12 border border-ink text-[17px] font-semibold leading-none active:bg-ink active:text-white ${
              action === "done"
                ? "bg-ink text-[13px] uppercase tracking-[0.08em] text-white"
                : "bg-white text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
