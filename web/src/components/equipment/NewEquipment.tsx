"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { BOXED_FIELD, BOXED_FIELDS } from "@/components/ui/fieldMetrics";

/**
 * Register a machine.
 *
 * IT WARNS ON A DUPLICATE NAME AND LETS YOU THROUGH — `findPossibleRehires`'
 * treatment, and the reason 075 has no unique constraint on (location, name):
 * a name is a LABEL, and a composite unique makes the first rename fail with no
 * order of edits that works. Two walk-ins really can both be called "Walk-in",
 * and the shop knows which is which.
 */
export function NewEquipment({
  orgId,
  locationId,
  sections,
  kinds,
}: {
  orgId: string;
  locationId: string;
  sections: { id: string; display_name: string }[];
  kinds: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [existing, setExisting] = useState<string[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const canCommit = name.trim().length > 0 && !busy;

  const duplicate = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q) return false;
    return existing.some((n) => n.toLowerCase() === q);
  }, [name, existing]);

  function openDialog() {
    setOpen(true);
    setFailed(null);
    startTransition(async () => {
      const { data } = await supabase
        .from("equipment")
        .select("name")
        .eq("location_id", locationId);
      setExisting((data ?? []).map((e) => e.name as string));
    });
  }

  function create() {
    if (!canCommit) return;
    setFailed(null);
    startTransition(async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { data, error } = await supabase
        .from("equipment")
        .insert({
          org_id: orgId,
          location_id: locationId,
          name: name.trim(),
          kind: kind.trim() || null,
          shop_section_id: sectionId || null,
          created_by: uid,
        })
        .select("id")
        .single();
      if (error || !data) {
        setFailed(error?.message ?? "It was not registered.");
        return;
      }
      setOpen(false);
      setName("");
      router.push(`/equipment/${data.id}`);
    });
  }

  const field = BOXED_FIELDS ? BOXED_FIELD : "";

  return (
    <>
      <button type="button" className={BUTTON_CLASS} onClick={openDialog}>
        New equipment
      </button>

      {open && (
        <Dialog
          title="Register equipment"
          onClose={() => setOpen(false)}
          width="max-w-lg"
          busy={busy}
          onSubmit={canCommit ? create : undefined}
          footer={
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={DIALOG_COMMIT_CLASS}
                onClick={create}
                disabled={!canCommit}
              >
                Register
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Name
              </span>
              <TextInput
                value={name}
                onValueChange={setName}
                fullWidth
                autoFocus
                placeholder="Walk-in 1"
                aria-label="Name"
              />
              {duplicate && (
                <span className="block text-[12px]">
                  <span className="bg-mark-fill px-1">
                    Something here is already called that.
                  </span>{" "}
                  That is allowed — give it a name the crew would use.
                </span>
              )}
            </label>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Kind
              </span>
              <PickList
                variant="field"
                value={kind}
                ariaLabel="Kind"
                allowNew
                boxed={BOXED_FIELDS}
                className={field}
                placeholder="Walk-in, Fryer, Mixer…"
                options={kinds.map((k) => ({ value: k, label: k }))}
                onPick={setKind}
              />
            </div>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Where it stands
              </span>
              <PickList
                variant="field"
                value={sectionId}
                ariaLabel="Where it stands"
                boxed={BOXED_FIELDS}
                className={field}
                options={[
                  { value: "", label: "No section" },
                  ...sections.map((s) => ({ value: s.id, label: s.display_name })),
                ]}
                onPick={setSectionId}
              />
            </div>

            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
