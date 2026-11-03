"use client";

import { useState, useTransition } from "react";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import { createClient } from "@/lib/supabase/client";
import { insertLine, type LinePlacement } from "./AddIngredientDialog";

/**
 * ADD PROCEDURE… — a dialog (Mark, 2026-09-12: "can we use a dialogue box
 * instead of putting something in the footer?"), because a step is prose and a
 * one-line box was a cramped place to write a paragraph. Opened since
 * 2026-11-03 from a step's ⋯, adding BELOW that step; it was the Actions
 * menu's until then, which keeps it only for a version with no steps.
 */
export function AddStepDialog({
  orgId,
  versionId,
  versionLabel,
  placement,
  onClose,
  onAdded,
}: {
  orgId: string;
  versionId: string;
  versionLabel: string;
  placement: LinePlacement;
  onClose: () => void;
  onAdded: () => void;
}) {
  const supabase = createClient();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function close() {
    if (!pending) onClose();
  }

  function add() {
    if (body.trim() === "") return;
    setError(null);
    start(async () => {
      const failed = await insertLine(
        supabase,
        placement,
        // EXPLICITLY — design rule 1.
        { org_id: orgId, version_id: versionId, body: body.trim() },
        "production_recipe_steps"
      );
      if (failed) {
        setError(failed);
        return;
      }
      onAdded();
    });
  }

  return (
    <Dialog
      title={`Add a step to v${versionLabel}`}
      onClose={close}
      busy={pending}
      width="max-w-lg"
      footer={
        <>
          <button type="button" onClick={close} disabled={pending} className={DIALOG_CANCEL_CLASS}>
            Cancel
          </button>
          <button
            type="button"
            onClick={add}
            disabled={pending || body.trim() === ""}
            className={DIALOG_COMMIT_CLASS}
          >
            {pending ? "Adding…" : "Add Step"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // ⌘↵ adds, the app's multiline commit; a plain Enter is a newline.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
          rows={6}
          autoFocus
          aria-label="What happens in this step"
          className={FORM_TEXTAREA}
        />
        {error ? <p className="text-[13px] text-accent">{error}</p> : null}
      </div>
    </Dialog>
  );
}
