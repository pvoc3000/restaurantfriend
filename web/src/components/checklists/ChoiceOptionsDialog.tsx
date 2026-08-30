"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { parseChoiceOptions, choiceOptionsText } from "@/lib/checklists";

/**
 * The options on a `choice` item — and the reason this is a dialog rather than
 * a cell.
 *
 * 076's `checklist_template_items_choices_when_choice` demands that a `choice`
 * item carry at least one option, so **the kind and its options have to be
 * written in ONE statement**. An inline picker that set `response_type` on its
 * own would bounce a raw 23514 into the cell — the one refusal `InlineValue`
 * cannot explain, and the same trap `special_orders_status_iff_order` set.
 * `AddTemplateItem` avoided it by not offering the kind at all and saying "set
 * the kind on the row afterwards, next to where the options live". This is
 * where they live.
 *
 * So the type picker beside this offers three kinds and this offers the fourth,
 * with its options in hand. It also refuses to leave a `choice` item with none,
 * which is the same constraint read the other way round.
 */
export function ChoiceOptionsDialog({
  row,
  onClose,
}: {
  row: { id: string; prompt: string; choices: string[] | null };
  onClose: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [raw, setRaw] = useState(() => choiceOptionsText(row.choices));
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options = parseChoiceOptions(raw);
  const blocked = options.length === 0 || pending;

  function save() {
    if (blocked) return;
    setFailed(null);
    startTransition(async () => {
      // BOTH COLUMNS, one statement. Splitting them is the CHECK violation.
      const { data, error } = await supabase
        .from("checklist_template_items")
        .update({ response_type: "choice", choices: options })
        .eq("id", row.id)
        .select("id");
      if (error) return setFailed(error.message);
      if (!data || data.length === 0) {
        return setFailed("Nothing was saved — you may not have permission.");
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      title={`Answers — ${row.prompt}`}
      onClose={onClose}
      width="max-w-lg"
      onSubmit={blocked ? undefined : save}
      footer={
        <div className="flex items-center justify-end gap-4">
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={DIALOG_COMMIT_CLASS}
            onClick={save}
            disabled={blocked}
          >
            Save
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
            The answers, separated by commas
          </span>
          <TextInput
            value={raw}
            onValueChange={setRaw}
            fullWidth
            placeholder="Clean, Needs attention, Broken"
            aria-label={`Answers for ${row.prompt}`}
          />
        </label>

        {options.length > 0 ? (
          <p className="text-[13px] text-muted">
            The list shows{" "}
            {options.map((o, i) => (
              <span key={o}>
                {i > 0 ? " · " : ""}
                <span className="bg-mark-fill px-1">{o}</span>
              </span>
            ))}
            , one button each.
          </p>
        ) : (
          <p className="text-[13px] text-muted">
            A choice item needs at least one answer — without one there is
            nothing for the list to offer.
          </p>
        )}

        <p className="max-w-[52ch] text-[13px] text-muted">
          Saving also sets this item’s answer type to Choice, because the
          two have to be written together. The four state buttons — Done, Issue,
          N/A — stay above them, and are still how something gets flagged.
        </p>

        {failed ? <p className="text-sm text-accent">{failed}</p> : null}
      </div>
    </Dialog>
  );
}
