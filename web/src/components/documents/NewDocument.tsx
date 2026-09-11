"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { BOXED_FIELD, BOXED_FIELDS } from "@/components/ui/fieldMetrics";

/** Record a document (094): the fields the LIST reads; the file, the
 *  description and the rest are on the record it lands on. Closes on commit. */
export function NewDocument({
  orgId,
  today,
  categories,
  locations,
  children,
}: {
  orgId: string;
  today: string;
  categories: string[];
  locations: { id: string; code: string }[];
  /** A trigger of the caller's own — the list's Actions menu. Without one the
   *  dialog draws its own button. */
  children?: (open: () => void) => ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("01");
  const [category, setCategory] = useState("");
  const [locationId, setLocationId] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const canCommit = title.trim().length > 0 && !busy;

  function create() {
    if (!canCommit) return;
    setFailed(null);
    startTransition(async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { data, error } = await supabase
        .from("org_documents")
        .insert({
          org_id: orgId,
          location_id: locationId || null,
          title: title.trim(),
          version: version.trim() || null,
          category: category.trim() || null,
          added_on: today,
          created_by: uid,
        })
        .select("id")
        .single();
      if (error || !data) {
        setFailed(error?.message ?? "The document was not recorded.");
        return;
      }
      setOpen(false);
      router.push(`/documents/${data.id}?from=%2Fdocuments&fromLabel=Documents`);
    });
  }

  const field = BOXED_FIELDS ? BOXED_FIELD : "";
  const label = "block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted";

  return (
    <>
      {children ? (
        children(() => setOpen(true))
      ) : (
        <button type="button" className={`${BUTTON_CLASS} ml-auto`} onClick={() => setOpen(true)}>
          New document
        </button>
      )}
      {open && (
        <Dialog
          title="New document"
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
                Create
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            <label className="block space-y-1.5">
              <span className={label}>Title</span>
              <TextInput value={title} onValueChange={setTitle} fullWidth autoFocus aria-label="Title" />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <span className={label}>Category</span>
                <PickList
                  variant="field"
                  value={category}
                  ariaLabel="Category"
                  boxed={BOXED_FIELDS}
                  className={field}
                  allowNew
                  options={[{ value: "", label: "No category" }, ...categories.map((c) => ({ value: c, label: c }))]}
                  onPick={setCategory}
                />
              </div>
              <label className="block space-y-1.5">
                <span className={label}>Version</span>
                <TextInput value={version} onValueChange={setVersion} fullWidth aria-label="Version" />
              </label>
            </div>
            <div className="space-y-1.5">
              <span className={label}>Shop</span>
              <PickList
                variant="field"
                value={locationId}
                ariaLabel="Shop"
                boxed={BOXED_FIELDS}
                className={field}
                options={[{ value: "", label: "All shops" }, ...locations.map((l) => ({ value: l.id, label: l.code }))]}
                onPick={setLocationId}
              />
            </div>
            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
