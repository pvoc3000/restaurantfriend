"use client";

import { useEffect, useRef, useState } from "react";

import { unlockWithPin, type LockMember } from "@/app/deviceActions";
import { PIN_LENGTH, retryLabel } from "@/lib/sharedDevice";

/**
 * The shared iPad's picker: who are you, then four digits.
 *
 * Tablet-first — 44px targets, 16px type (below which iOS Safari zooms on
 * focus), a keypad of our own rather than the system keyboard — and the
 * idiom is the POS one everybody here already knows from Square and
 * Homebase, so there is nothing to learn.
 *
 * Nothing on this screen is a credential. The names come from the server
 * (`lockScreenMembers`, carrying the device cookie), the PIN goes to
 * `unlockWithPin`, and the session is established INSIDE that action — the
 * token never reaches this component. On success the page does a HARD
 * navigation (`window.location.assign`), deliberately: the in-memory Maps in
 * `scrollMemory`, `viewMemory` and `navMemoryStore` are the previous
 * person's, and only a full load empties them. localStorage — column widths,
 * layouts — is device-level and survives on purpose.
 *
 * The keypad auto-submits at four digits (there is no fifth thing to press)
 * and accepts a hardware keyboard's digits too, since an iPad with a
 * keyboard case is the ordering setup.
 */
export function LockScreen({
  members,
  deviceName,
}: {
  members: LockMember[];
  deviceName: string | null;
}) {
  const [who, setWho] = useState<LockMember | null>(members.length === 1 ? members[0] : null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function submit(candidate: string) {
    if (!who || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const result = await unlockWithPin(who.user_id, candidate);
    if (result.ok) {
      window.location.assign("/");
      return;
    }
    submitting.current = false;
    setBusy(false);
    setPin("");
    if (result.reason === "wrong") setError("Wrong PIN.");
    else if (result.reason === "locked") setError(`Too many tries. ${retryLabel(result.retryAfterSeconds)}`);
    else if (result.reason === "unknown_device") {
      setError("This iPad is no longer registered — sign in with a password.");
    } else setError(result.message);
  }

  function press(digit: string) {
    if (busy || !who) return;
    setError(null);
    const next = (pin + digit).slice(0, PIN_LENGTH);
    setPin(next);
    if (next.length === PIN_LENGTH) void submit(next);
  }

  function erase() {
    if (busy) return;
    setPin((p) => p.slice(0, -1));
  }

  // A hardware keyboard: digits type, Backspace erases, Escape goes back to
  // the names. Only while a person is chosen, so the picker's own keys
  // (Tab, Enter on a name) are left alone.
  useEffect(() => {
    if (!who) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        erase();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setWho(null);
        setPin("");
        setError(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who, pin, busy]);

  const KEY =
    "flex h-14 items-center justify-center border border-ink bg-white text-[22px] font-semibold tabular-nums transition-colors hover:bg-ink hover:text-white active:bg-ink active:text-white disabled:opacity-35";

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md border-2 border-ink bg-white">
        <h1 className="bg-ink px-6 py-4 text-[15px] font-bold uppercase tracking-[0.06em] text-white">
          {who ? who.name : "Who are you?"}
        </h1>

        <div className="space-y-6 p-6 text-[16px]">
          {members.length === 0 && (
            <p className="text-muted">
              Nobody has set a PIN yet. Sign in with a password, then set one under Your
              settings.
            </p>
          )}

          {!who && members.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {members.map((m) => (
                <li key={m.user_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setWho(m);
                      setPin("");
                      setError(null);
                    }}
                    className="flex h-12 w-full items-center justify-center border border-ink bg-white px-3 text-center font-semibold uppercase tracking-[0.04em] transition-colors hover:bg-ink hover:text-white"
                  >
                    <span className="truncate">{m.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {who && (
            <>
              {/* The four dots: filled as you type, never the digits. */}
              <div className="flex items-center justify-center gap-4" aria-live="polite">
                {Array.from({ length: PIN_LENGTH }, (_, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className={`block h-4 w-4 rounded-full border-2 border-ink ${
                      i < pin.length ? "bg-ink" : "bg-white"
                    }`}
                  />
                ))}
                <span className="sr-only">
                  {pin.length} of {PIN_LENGTH} digits entered
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={busy}
                    onClick={() => press(d)}
                    className={KEY}
                    aria-label={d}
                  >
                    {d}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setWho(null);
                    setPin("");
                    setError(null);
                  }}
                  className={`${KEY} text-[12px] font-semibold uppercase tracking-[0.06em]`}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => press("0")}
                  className={KEY}
                  aria-label="0"
                >
                  0
                </button>
                <button
                  type="button"
                  disabled={busy || pin.length === 0}
                  onClick={erase}
                  className={KEY}
                  aria-label="Erase"
                >
                  ⌫
                </button>
              </div>

              <p className="min-h-6 text-center text-[14px] text-accent" role="alert">
                {busy ? <span className="text-muted">Checking…</span> : error}
              </p>
            </>
          )}

          <div className="space-y-2 border-t border-hairline pt-4 text-center">
            <a
              href="/login"
              className="block text-[12px] uppercase tracking-[0.06em] text-muted underline hover:text-ink"
            >
              Sign in with a password instead
            </a>
            {deviceName && (
              <p className="text-[11px] uppercase tracking-[0.12em] text-subtle">{deviceName}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
