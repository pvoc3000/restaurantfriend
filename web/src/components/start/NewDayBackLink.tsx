"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { NEW_DAY_BACK_KEY, parseBack, readBack } from "@/lib/newDay";

// The way back is written once, before this page loads, and spent when you
// leave it — so there is nothing to subscribe to.
const subscribe = () => () => {};
// The stored string itself (stable between calls), or null when it is too old.
function snapshot(): string | null {
  try {
    const raw = sessionStorage.getItem(NEW_DAY_BACK_KEY);
    return readBack(raw, Date.now()) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * "Back to …" — where a new day found you (`lib/newDay`), on the Start page it
 * sent you to, so the move costs one click for anybody who wanted the page they
 * left. Nothing at all on an ordinary visit to Start.
 */
export function NewDayBackLink() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const back = parseBack(raw);
  if (!back) return null;
  return (
    <Link
      href={back.href}
      className="inline-block text-[12px] uppercase tracking-[0.12em] text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
    >
      ← Back to {back.label}
    </Link>
  );
}
