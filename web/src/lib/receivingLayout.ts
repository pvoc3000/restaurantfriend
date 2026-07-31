"use client";

// How the receiving screen is arranged: side by side or stacked, and where the
// divider sits between the document and the lines.
//
// Both are per-user DISPLAY preferences, so localStorage — the same rule that
// puts column widths there and filters in the query string. Read through
// useSyncExternalStore rather than an effect + setState: the server has no
// localStorage, so the server snapshot is the default and React swaps in the
// stored value after hydration with no mismatch and no setState-in-an-effect.
//
// `layout` is deliberately THREE-valued. "auto" is the default and means "side
// by side if the window is wide enough", which is decided in CSS rather than
// here — a media-query hook would have to guess during SSR and could paint the
// wrong arrangement first. Only an explicit choice is stored.

import { useSyncExternalStore } from "react";

export type ReceivingLayout = "auto" | "split" | "stacked";

const LAYOUT_KEY = "rf.receiving.layout";
const SPLIT_KEY = "rf.receiving.split";

/** Fraction of the width the DOCUMENT gets in split mode. */
export const DEFAULT_SPLIT = 0.5;
export const MIN_SPLIT = 0.25;
export const MAX_SPLIT = 0.75;

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function announce() {
  for (const listener of listeners) listener();
}

function readLayout(): ReceivingLayout {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    return raw === "split" || raw === "stacked" ? raw : "auto";
  } catch {
    return "auto";
  }
}

function readSplit(): number {
  try {
    const raw = Number(window.localStorage.getItem(SPLIT_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SPLIT;
    return clampSplit(raw);
  } catch {
    return DEFAULT_SPLIT;
  }
}

export function clampSplit(fraction: number): number {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, fraction));
}

export function setReceivingLayout(next: ReceivingLayout) {
  try {
    window.localStorage.setItem(LAYOUT_KEY, next);
  } catch {
    // Not being able to persist shouldn't stop the control working this session.
  }
  announce();
}

export function setReceivingSplit(fraction: number) {
  try {
    window.localStorage.setItem(SPLIT_KEY, String(clampSplit(fraction)));
  } catch {
    // As above.
  }
  announce();
}

export function useReceivingLayout(): ReceivingLayout {
  return useSyncExternalStore(subscribe, readLayout, () => "auto" as const);
}

export function useReceivingSplit(): number {
  return useSyncExternalStore(subscribe, readSplit, () => DEFAULT_SPLIT);
}
