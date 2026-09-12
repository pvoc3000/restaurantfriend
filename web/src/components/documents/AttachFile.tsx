"use client";

import { useCallback, useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { attachFile } from "./documentWrites";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { TARGETS, type FiledDocumentsKind } from "./FiledDocuments";

/**
 * PUTTING A FILE ON A RECORD — the upload, and the one place it lives.
 *
 * Lifted out of `FiledDocuments` on 2026-09-12, when the documents record
 * wanted this command in the title row's Actions menu (Mark) while the
 * inspection record keeps it as the card's own button. Two dresses, ONE
 * implementation: pass `children` and it hands back its row, otherwise it
 * draws the button — the arrangement every other command in this app uses.
 *
 * THE HIDDEN INPUT COMES WITH IT, and that is the reason this is a component
 * rather than a function in `documentWrites`. Opening a file picker is
 * `input.click()` and the browser only honours it INSIDE a user gesture, so
 * the input has to be mounted wherever the command is — which, from a menu,
 * means here rather than three components away. `ActionMenu` closes
 * synchronously on select, so the row's `onSelect` still runs inside the
 * click, exactly like `openWindowNow`.
 */
export function AttachFile({
  kind,
  ownerId,
  orgId,
  children,
}: {
  kind: FiledDocumentsKind;
  ownerId: string;
  orgId: string;
  /** Hand the row to an `ActionMenu` instead of drawing a button. */
  children?: (items: ActionMenuItem[]) => ReactNode;
}) {
  const target = TARGETS[kind];
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /**
   * THE INPUT IS FOUND BY ID, NOT HELD IN A REF, and that is `react-hooks/refs`
   * rather than a preference. The menu path hands this handler into
   * `children(...)`, which the rule reads as a CALL DURING RENDER and so
   * refuses any closure over `someRef.current` — the same wall
   * `PushToQuickBooks` hit, and the same answer: restructure rather than
   * silence it. `useId` is stable across renders, and the lookup happens in the
   * click, which is where the element is wanted anyway.
   */
  const inputId = useId();
  const openPicker = useCallback(() => {
    const el = document.getElementById(inputId);
    if (el instanceof HTMLInputElement) el.click();
  }, [inputId]);

  async function add(file: File) {
    setFailed(null);
    setBusy(true);
    // Storage first, then the row, and the insert's row count checked — see
    // `attachFile`, which the card's button and a DROP on the card share.
    const { error } = await attachFile(supabase, target, orgId, ownerId, file);
    setBusy(false);
    if (error) return setFailed(error);
    router.refresh();
  }

  const input = (
    <input
      id={inputId}
      type="file"
      accept={target.accept.join(",")}
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        // Cleared before the upload, so picking the SAME file twice still
        // fires a change event.
        e.target.value = "";
        if (f) void add(f);
      }}
    />
  );

  if (children) {
    return (
      <>
        {input}
        {children([
          {
            label: busy ? "Uploading…" : "Attach File…",
            disabled: busy,
            onSelect: openPicker,
          },
        ])}
        {failed && <p className="max-w-sm text-right text-sm text-accent">{failed}</p>}
      </>
    );
  }

  return (
    <>
      {input}
      <button
        type="button"
        disabled={busy}
        onClick={openPicker}
        className={`${BUTTON_CLASS} ml-auto`}
      >
        {busy ? "Uploading…" : "Attach File…"}
      </button>
      {failed && <p className="w-full text-sm text-accent">{failed}</p>}
    </>
  );
}
