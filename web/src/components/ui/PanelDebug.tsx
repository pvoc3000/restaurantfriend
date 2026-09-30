"use client";

import { useEffect, useState } from "react";

/**
 * A TEMPORARY ON-SCREEN LOG for the picker-and-keyboard fight on the tablet
 * (Mark, 2026-09-30: "tap on a picklist, both the picklist menu and keyboard
 * try to open, both give up and disappear"). The first fix — measuring the
 * trigger without its pressed transform — did not cure it, so this records
 * WHY each picker list closed, on the iPad's own screen, where the desk's
 * Chromium cannot reproduce it.
 *
 * OFF unless asked for: visit any screen with `?panel-debug=1` (remembered on
 * that device) and `?panel-debug=0` to stop. Off, `panelLog` is one boolean
 * read and the overlay renders nothing.
 *
 * Delete this file and its call sites once the cause is known.
 */

const KEY = "rf-panel-debug";
const MAX = 40;

let enabled = false;
let lines: string[] = [];
const listeners = new Set<() => void>();
let t0 = 0;

function readFlag() {
  try {
    const q = new URLSearchParams(window.location.search).get("panel-debug");
    if (q === "1") localStorage.setItem(KEY, "1");
    if (q === "0") localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** A short name for an element, for the log. */
export function describe(n: EventTarget | null | undefined): string {
  if (!n) return "null";
  if (n === window) return "window";
  if (n === document) return "document";
  if (!(n instanceof Element)) return String(n);
  const label =
    n.getAttribute("aria-label") ??
    n.getAttribute("placeholder") ??
    (n.textContent ?? "").trim().slice(0, 14);
  return `${n.tagName.toLowerCase()}${label ? `“${label}”` : ""}`;
}

/** The viewport, in one short string: scrollY, innerHeight, visual viewport. */
export function viewport(): string {
  const vv = window.visualViewport;
  return `sy${Math.round(window.scrollY)} ih${window.innerHeight}${
    vv ? ` vv${Math.round(vv.height)}@${Math.round(vv.offsetTop)}` : ""
  }`;
}

export function panelLog(msg: string) {
  if (!enabled) return;
  const ms = Math.round(performance.now() - t0);
  lines = [...lines.slice(-(MAX - 1)), `${ms} ${msg}`];
  for (const l of listeners) l();
}

export function PanelDebugLog() {
  const [on, setOn] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    enabled = readFlag();
    t0 = performance.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the flag lives in localStorage, which the server cannot read
    setOn(enabled);
    if (!enabled) return;

    const bump = () => setTick((t) => t + 1);
    listeners.add(bump);

    // What the page itself does around a tap — the things no component owns.
    const onFocusIn = (e: FocusEvent) => panelLog(`focusin ${describe(e.target)}`);
    const onFocusOut = (e: FocusEvent) =>
      panelLog(`focusout ${describe(e.target)} → ${describe(e.relatedTarget)}`);
    const onResize = () => panelLog(`window resize ${window.innerWidth}×${window.innerHeight}`);
    const onVv = () => panelLog(`vv resize ${viewport()}`);
    const onDown = (e: PointerEvent) => panelLog(`pointerdown ${describe(e.target)}`);
    const onClick = (e: MouseEvent) => panelLog(`click ${describe(e.target)}`);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onVv);
    return () => {
      listeners.delete(bump);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onVv);
    };
  }, []);

  if (!on) return null;
  return (
    <div className="pointer-events-none fixed right-0 top-0 z-[9999] max-h-[45vh] w-[360px] overflow-hidden bg-black/80 p-1 font-mono text-[10px] leading-tight text-white">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}
