"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { BOXED_FIELD, BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import type { ResponseType } from "@/lib/checklists";

const ASKS: { value: ResponseType; label: string; hint: string }[] = [
  { value: "check", label: "Tick", hint: "looked at, or not" },
  { value: "number", label: "Number", hint: "a temperature, a count" },
  { value: "text", label: "Text", hint: "something written down" },
];

/**
 * Add one question to a template.
 *
 * IT STAYS OPEN after each add, which is `AddPoLines`' ending rather than
 * `NewChecklistTemplate`'s: you write a checklist's twenty questions in one
 * sitting, so closing after each one would mean twenty round trips through the
 * same dialog. The count in the footer is the confirmation.
 *
 * `choice` is deliberately absent from the picker here — 076 refuses a choice
 * item with no choices, so offering it in a form that cannot collect them would
 * bounce a raw 23514 back at somebody. Set the kind on the row afterwards, next
 * to where the options live.
 */
export function AddTemplateItem({
  templateId,
  orgId,
  sections,
  nextSort,
}: {
  templateId: string;
  orgId: string;
  sections: { id: string; display_name: string }[];
  nextSort: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [asks, setAsks] = useState<ResponseType>("check");
  const [added, setAdded] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const canCommit = prompt.trim().length > 0 && !busy;

  function add() {
    if (!canCommit) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("checklist_template_items")
        .insert({
          org_id: orgId,
          template_id: templateId,
          shop_section_id: sectionId || null,
          // Sorts step by ten so a later insert between two rows needs no
          // renumber — `sort` is numeric(8,2), the same reason FMP's own shop
          // sections carry 09.5 and 13.1.
          sort: nextSort + added * 10,
          prompt: prompt.trim(),
          response_type: asks,
        })
        .select("id");

      if (error || !data || data.length === 0) {
        setFailed(error?.message ?? "That item was not added.");
        return;
      }
      setAdded((n) => n + 1);
      setPrompt("");
      router.refresh();
    });
  }

  const field = BOXED_FIELDS ? BOXED_FIELD : "";

  return (
    <>
      <button
        type="button"
        className={`${BUTTON_CLASS} shrink-0`}
        onClick={() => {
          setOpen(true);
          setAdded(0);
          setFailed(null);
        }}
      >
        Add item
      </button>

      {open && (
        <Dialog
          title="Add an item"
          onClose={() => setOpen(false)}
          width="max-w-lg"
          busy={busy}
          onSubmit={canCommit ? add : undefined}
          footer={
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-muted">
                {added > 0 && `${added} added`}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={DIALOG_CANCEL_CLASS}
                  onClick={() => setOpen(false)}
                >
                  {added > 0 ? "Done" : "Cancel"}
                </button>
                <button
                  type="button"
                  className={DIALOG_COMMIT_CLASS}
                  onClick={add}
                  disabled={!canCommit}
                >
                  Add
                </button>
              </div>
            </div>
          }
        >
          <div className="space-y-5">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                What it asks
              </span>
              <TextInput
                value={prompt}
                onValueChange={setPrompt}
                fullWidth
                autoFocus
                placeholder="Walk-in temperature"
                aria-label="What it asks"
              />
            </label>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Section
              </span>
              <PickList
                variant="field"
                value={sectionId}
                ariaLabel="Section"
                boxed={BOXED_FIELDS}
                className={field}
                // Kept between adds, deliberately: you fill a shelf's questions
                // together, so re-picking the section twenty times would be the
                // typing this dialog exists to save.
                options={[
                  { value: "", label: "No section" },
                  ...sections.map((s) => ({ value: s.id, label: s.display_name })),
                ]}
                onPick={setSectionId}
              />
            </div>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Answer
              </span>
              <PickList
                variant="field"
                value={asks}
                ariaLabel="Answer"
                boxed={BOXED_FIELDS}
                className={field}
                options={ASKS}
                onPick={(v) => setAsks(v as ResponseType)}
              />
              {asks === "number" && (
                <p className="text-[12px] text-muted">
                  Set the expected range on the row afterwards — a reading
                  outside it flags itself as an issue.
                </p>
              )}
            </div>

            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
