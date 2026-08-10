"use client";

import { useEffect, useState } from "react";

/**
 * THE OPERATOR STRIP — an input accessory view for the software keyboard
 * (Mark, 2026-08-10, on an iPad: "I am only presented with the 10 digit
 * keyboard. I am unable to type a mathematical expression… a big feature").
 *
 * `lib/calc` lets a numeric field take "4*9*25" and store 900, and every field
 * that does is a plain text input with `inputMode="decimal"` — which iOS renders
 * as the number pad: ten digits, a separator, and no operators at all. The
 * parser was never the problem; the characters simply could not be typed.
 *
 * DROPPING `inputMode` IS THE WRONG FIX and was considered first. It gives you
 * the full keyboard, but on iPadOS `-` and `/` sit on the `.?123` layer while
 * `*`, `+`, `×` and `÷` are all one layer deeper on `#+=` — so an expression
 * costs a layer switch per operator, and every ordinary count typed during a
 * walk pays for arithmetic it isn't doing. The number pad is right for the
 * common case; what was missing is the six characters beside it.
 *
 * ONE COMPONENT, MOUNTED ONCE, AND THE FIELDS DON'T KNOW IT EXISTS. It watches
 * the document for focus landing on an input marked `data-rf-calc`, and writes
 * through the NATIVE value setter plus a bubbled `input` event — which is how
 * you drive a controlled React input from outside React. That's what buys the
 * zero-wiring: InlineValue, the guide's two boxes, AddPoLines and the four
 * cleanup editors each gained one attribute and not a line of logic.
 *
 * The opt-in is an explicit attribute rather than `input[inputmode="decimal"]`,
 * because several fields carry that attribute and parse with a plain `Number()`
 * — receiving's price, a new invoice's total, a shop section's sort. Inserting a
 * `×` into one of those produces a value that fails to save, so they are left
 * alone deliberately; the strip appears on exactly the fields `evaluateNumeric`
 * reads.
 */

/** Shown → inserted. `−` is not the hyphen the grammar wants; `×`/`÷` are. */
const KEYS: ReadonlyArray<readonly [label: string, insert: string]> = [
  ["×", "×"],
  ["÷", "÷"],
  ["+", "+"],
  ["−", "-"],
  ["(", "("],
  [")", ")"],
];

/** Below this the visual viewport hasn't lost enough room to be a keyboard. */
const KEYBOARD_MIN = 120;

const STRIP_H = 52;

/**
 * Drive a controlled React input from outside React. Assigning `el.value`
 * directly is swallowed — React's own value tracker sees no change and the
 * component's `onChange` never fires, so the character appears and is then
 * wiped by the next render. Going through the prototype's setter updates the
 * tracker, and the bubbled `input` event is what React's root listener turns
 * back into `onChange`.
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

export function CalcKeys() {
  const [target, setTarget] = useState<HTMLInputElement | null>(null);
  /** Bottom of the VISIBLE area in layout-viewport coordinates, or null. */
  const [visibleBottom, setVisibleBottom] = useState<number | null>(null);
  const [coarse, setCoarse] = useState(false);

  // A hardware keyboard already has these six characters, and a mouse has a
  // keyboard behind it. The strip is for the on-screen one only.
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const read = () => setCoarse(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  useEffect(() => {
    const isCalcField = (n: EventTarget | null): n is HTMLInputElement =>
      n instanceof HTMLInputElement && n.dataset.rfCalc !== undefined;

    const onFocusIn = (e: FocusEvent) =>
      setTarget(isCalcField(e.target) ? e.target : null);
    // Nothing in the strip can steal focus (see the pointerdown handler), so a
    // focusout is a genuine departure — a save, an Escape, or the next field.
    const onFocusOut = () => setTarget(null);

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // WHERE THE KEYBOARD IS. `position: fixed` resolves against the LAYOUT
  // viewport, which iOS does not shrink when the keyboard opens — only the
  // visual viewport does. So the strip is placed at the visual viewport's own
  // bottom edge, which puts it directly above the keys and keeps it there while
  // Safari scrolls the focused field into view.
  //
  // When nothing has shrunk (a desk, or an iPad with a hardware keyboard) this
  // is simply the bottom of the window and `visibleBottom` stays null, so the
  // strip renders nowhere.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const read = () => {
      const shrunk = window.innerHeight - vv.height;
      setVisibleBottom(shrunk > KEYBOARD_MIN ? vv.offsetTop + vv.height : null);
    };
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, []);

  if (!target || !coarse) return null;

  function insert(ch: string) {
    const el = target;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    setNativeValue(el, el.value.slice(0, start) + ch + el.value.slice(end));
    // Put the caret back after the glyph. Setting a controlled input's value
    // sends it to the end, which is wrong the moment you fix an operator in the
    // middle of an expression — so it's restored now AND once more after React
    // has committed its re-render, which moves it again.
    //
    // A macrotask, deliberately not requestAnimationFrame: rAF doesn't run in a
    // backgrounded tab, and `lib/scrollMemory` learned that the hard way.
    const at = start + ch.length;
    el.setSelectionRange(at, at);
    setTimeout(() => {
      if (document.activeElement === el) el.setSelectionRange(at, at);
    }, 0);
  }

  return (
    <div
      // Above anchored panels (70), which is the top of the app's own ladder —
      // this sits over the keyboard, so nothing may cover it.
      className="fixed inset-x-0 z-[80] flex items-center justify-center gap-2 border-t border-ink bg-white px-4"
      style={
        visibleBottom === null
          ? { bottom: 0, height: STRIP_H }
          : { top: visibleBottom - STRIP_H, height: STRIP_H }
      }
    >
      {KEYS.map(([label, ch]) => (
        <button
          key={label}
          type="button"
          // Never let a tap move focus. Every one of these fields commits on
          // BLUR, so a button that stole focus would save the half-typed
          // expression and close the editor — the same reason `ui/TextInput`'s
          // clear button preventDefaults. Acting on pointerdown rather than
          // waiting for click also means the insert doesn't depend on a
          // compatibility click event arriving after we've cancelled the
          // default.
          onPointerDown={(e) => {
            e.preventDefault();
            insert(ch);
          }}
          // Out of the tab order: Tab belongs to the next field, and a device
          // with a hardware keyboard never sees this strip anyway.
          tabIndex={-1}
          aria-label={label}
          className="h-11 min-w-14 border border-ink bg-white text-[18px] font-semibold leading-none text-ink"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
