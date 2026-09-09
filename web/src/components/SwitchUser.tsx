"use client";

import { useState } from "react";

import { lockDevice } from "@/app/deviceActions";

/**
 * The masthead's way out on a REGISTERED shared iPad: lock the device and
 * land on the picker. A client button rather than a `<form action>`, because
 * `lockDevice` deliberately does not redirect — the navigation is done HERE,
 * hard, after the action returns (see that function for the race it avoids).
 * Same dress as the Sign out it replaces.
 */
export function SwitchUser() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void lockDevice()
          .then(() => window.location.assign("/lock"))
          .catch(() => setBusy(false));
      }}
      className="text-[12px] font-semibold uppercase tracking-[0.06em] text-white/60 hover:text-white disabled:opacity-60"
    >
      {busy ? "Locking…" : "Switch user"}
    </button>
  );
}
