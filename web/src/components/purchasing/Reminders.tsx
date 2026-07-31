"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { daysOverdue, type Reminder } from "@/lib/reminders";
import { TextInput } from "@/components/ui/TextInput";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";

/**
 * Reminders due at this location, at the top of the order guide (spec §2 step 1).
 *
 * **Rendered OUTSIDE the guide's collapsing shelf, deliberately.** Everything in
 * that shelf — the title, the day picker, the totals bar, the filters — is
 * something you set BEFORE you start walking, so it hides with the masthead.
 * A due reminder is not a view control, it's an alert: if it lived in the shelf
 * then walking with the chrome collapsed (which is the point of collapsing it)
 * would mean never seeing one. It's dismissable and, by design, rare, so a band
 * that stays put costs nothing.
 *
 * A note on who can dismiss: `dismissed_at` is an UPDATE, and the RLS policy
 * `purchase_reminders` inherited from 001's generic loop makes writes
 * purchaser+. So staff see reminders and can't clear them. That's what the
 * policy says today; widening it is a decision, not a detail, and this reads
 * the same either way.
 */
export function Reminders({
  reminders,
  guideDate,
  locationId,
  orgId,
  canWrite,
}: {
  reminders: Reminder[];
  /** The day being walked, from the ORG's timezone — never the host's. */
  guideDate: string;
  locationId: string;
  orgId: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showOn, setShowOn] = useState(guideDate);

  async function dismiss(id: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("purchase_reminders")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("id", id);
    setBusy(false);
    if (error) setError(error.message);
    else router.refresh();
  }

  async function create() {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("purchase_reminders").insert({
      org_id: orgId,
      location_id: locationId,
      show_on_date: showOn,
      message: message.trim(),
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setComposing(false);
    setMessage("");
    setShowOn(guideDate);
    router.refresh();
  }

  // Nothing due and nothing to offer — take up no room at all. The guide's
  // first row should be the guide.
  if (reminders.length === 0 && !canWrite) return null;

  return (
    <>
      {reminders.length > 0 && (
        <div className="space-y-2 border-2 border-ink bg-[var(--rf-yellow-200)] px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink">
              {reminders.length === 1 ? "Reminder" : `${reminders.length} reminders`}
            </h2>
            {canWrite && (
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="ml-auto text-[12px] uppercase tracking-[0.12em] text-ink underline decoration-neutral-500 underline-offset-[3px] hover:decoration-ink"
              >
                Add reminder
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {reminders.map((r) => {
              const late = daysOverdue(r.show_on_date, guideDate);
              const context = [r.vendors?.name, r.inventory_items?.name]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={r.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="text-ink">{r.message}</span>
                  {context && <span className="text-ink/70">{context}</span>}
                  {late > 0 && (
                    <span className="border border-ink px-1 text-[11px] uppercase tracking-[0.12em] text-ink">
                      {late === 1 ? "yesterday" : `${late} days ago`}
                    </span>
                  )}
                  {canWrite && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void dismiss(r.id)}
                      className="ml-auto text-[12px] uppercase tracking-[0.12em] text-ink underline decoration-neutral-500 underline-offset-[3px] hover:decoration-ink disabled:opacity-35"
                    >
                      Dismiss
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {error && <p className="text-sm text-accent">{error}</p>}
        </div>
      )}

      {/* With nothing due the band disappears entirely, so the way to WRITE one
          has to survive somewhere. A quiet line rather than a second box. */}
      {reminders.length === 0 && canWrite && (
        <p className="text-right">
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="text-[12px] uppercase tracking-[0.12em] text-subtle underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            Add reminder
          </button>
        </p>
      )}

      {composing && (
        <ReminderDialog
          busy={busy}
          error={error}
          message={message}
          showOn={showOn}
          onMessage={setMessage}
          onShowOn={setShowOn}
          onClose={() => setComposing(false)}
          onCreate={() => void create()}
        />
      )}
    </>
  );
}

/**
 * Write one. Shared by the guide's banner and the vendor screen — the same
 * dialog, so a reminder written from a vendor is the same kind of thing as one
 * written mid-walk.
 */
function ReminderDialog({
  busy,
  error,
  message,
  showOn,
  onMessage,
  onShowOn,
  onClose,
  onCreate,
  vendorName,
}: {
  busy: boolean;
  error: string | null;
  message: string;
  showOn: string;
  onMessage: (v: string) => void;
  onShowOn: (v: string) => void;
  onClose: () => void;
  onCreate: () => void;
  vendorName?: string;
}) {
  return (
    <Dialog
      title={vendorName ? `Remind me about ${vendorName}` : "Add reminder"}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={DIALOG_CANCEL_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={busy || !message.trim()}
            className={DIALOG_COMMIT_CLASS}
          >
            {busy ? "Saving…" : "Add reminder"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1">
          <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
            Show on
          </span>
          <input
            type="date"
            value={showOn}
            disabled={busy}
            onChange={(e) => onShowOn(e.target.value)}
            className="h-9 border border-ink bg-white px-2 tabular-nums"
          />
          <span className="block text-xs text-muted">
            It appears on this day&rsquo;s guide and stays until dismissed, so a
            date you skip doesn&rsquo;t lose it.
          </span>
        </label>

        <label className="block space-y-1">
          <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
            Reminder
          </span>
          <TextInput
            autoFocus
            value={message}
            disabled={busy}
            onValueChange={onMessage}
            placeholder="Ask about the short case from last week"
            clearLabel="Clear the reminder"
            // A definite width, not `w-full`: TextInput's wrapper is
            // `inline-flex` and shrink-wraps, so a percentage on the input
            // resolves against a box that's already only as wide as the input.
            className="w-[26rem] max-w-full"
          />
        </label>

        {error && <p className="text-sm text-accent">{error}</p>}
      </div>
    </Dialog>
  );
}

/**
 * The vendor screen's trigger: same dialog, prefilled with that vendor, so the
 * thought "next time we order from these people…" can be recorded where it
 * occurs rather than remembered until Monday.
 */
export function AddVendorReminder({
  vendorId,
  vendorName,
  locationId,
  orgId,
  today,
}: {
  vendorId: string;
  vendorName: string;
  locationId: string;
  orgId: string;
  /** The org's calendar day — passed in for the same reason as guideDate. */
  today: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showOn, setShowOn] = useState(today);

  async function create() {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("purchase_reminders").insert({
      org_id: orgId,
      location_id: locationId,
      vendor_id: vendorId,
      show_on_date: showOn,
      message: message.trim(),
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setComposing(false);
    setMessage("");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setComposing(true)}
        className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white"
      >
        Add reminder…
      </button>
      {composing && (
        <ReminderDialog
          busy={busy}
          error={error}
          message={message}
          showOn={showOn}
          vendorName={vendorName}
          onMessage={setMessage}
          onShowOn={setShowOn}
          onClose={() => setComposing(false)}
          onCreate={() => void create()}
        />
      )}
    </>
  );
}
