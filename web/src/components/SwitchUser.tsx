"use client";

import { useState } from "react";

import { lockDevice } from "@/app/deviceActions";
import { BAR_CELL } from "@/components/tablet/barCell";
import { BarLabel, ICON_PERSON } from "@/components/tablet/BarLabel";

/**
 * The masthead's way out on a REGISTERED shared iPad: lock the device and
 * land on the picker. A client button rather than a `<form action>`, because
 * `lockDevice` deliberately does not redirect — the navigation is done HERE,
 * hard, after the action returns (see that function for the race it avoids).
 * Same dress as the Sign out it replaces; `size="lg"` is the tablet bar's
 * cell, icon over word, since the bar is where this mostly gets pressed.
 */
export function SwitchUser({ size = "md" }: { size?: "md" | "lg" }) {
  const [busy, setBusy] = useState(false);
  const lock = () => {
    setBusy(true);
    void lockDevice()
      .then(() => window.location.assign("/lock"))
      .catch(() => setBusy(false));
  };

  if (size === "lg") {
    return (
      <button type="button" disabled={busy} onClick={lock} className={BAR_CELL}>
        <BarLabel icon={ICON_PERSON} word={busy ? "Locking…" : "Switch user"} />
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={lock}
      className="text-[12px] font-semibold uppercase tracking-[0.06em] text-white/60 hover:text-white disabled:opacity-60"
    >
      {busy ? "Locking…" : "Switch user"}
    </button>
  );
}
