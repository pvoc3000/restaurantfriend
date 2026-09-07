"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { BOXED_FIELD, BOXED_FIELDS } from "@/components/ui/fieldMetrics";

export type TagItemOption = { value: string; label: string };

/**
 * Start a tag. The fields the LIST reads — a title and the donut it is priced
 * from — and nothing more; the description and the three backgrounds are on
 * the record it lands on (`NewEmployee`'s rule). Closes on commit.
 *
 * The item is asked for here rather than left to the record because without
 * it the row shows NO PRICE and never appears under On the plan — which is
 * the row you would then go looking for.
 */
export function NewTag({ orgId, items }: { orgId: string; items: TagItemOption[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [itemId, setItemId] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const canCommit = title.trim().length > 0 && !busy;

  function create() {
    if (!canCommit) return;
    setFailed(null);
    startTransition(async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { data, error } = await supabase
        .from("display_tags")
        .insert({
          org_id: orgId,
          title: title.trim(),
          production_item_id: itemId || null,
          created_by: uid,
        })
        .select("id")
        .single();
      if (error || !data) {
        setFailed(error?.message ?? "The tag was not created.");
        return;
      }
      setOpen(false);
      router.push(`/tags/${data.id}?from=%2Ftags&fromLabel=Tags`);
    });
  }

  const field = BOXED_FIELDS ? BOXED_FIELD : "";

  return (
    <>
      <button type="button" className={`${BUTTON_CLASS} ml-auto`} onClick={() => setOpen(true)}>
        New tag
      </button>
      {open && (
        <Dialog
          title="New tag"
          onClose={() => setOpen(false)}
          width="max-w-md"
          busy={busy}
          onSubmit={canCommit ? create : undefined}
          footer={
            <div className="flex items-center justify-end gap-3">
              <button type="button" className={DIALOG_CANCEL_CLASS} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className={DIALOG_COMMIT_CLASS} onClick={create} disabled={!canCommit}>
                Create tag
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Title</span>
              <TextInput value={title} onValueChange={setTitle} fullWidth autoFocus aria-label="Title" />
            </label>
            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Production item
              </span>
              <PickList
                variant="field"
                value={itemId}
                ariaLabel="Production item"
                boxed={BOXED_FIELDS}
                className={field}
                placeholder="No item yet"
                options={items}
                clearable
                onPick={setItemId}
              />
            </div>
            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
