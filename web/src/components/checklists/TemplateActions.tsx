"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { PickList } from "@/components/ui/PickList";
import { BOXED_FIELD, BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { confirmDialog } from "@/lib/confirm";
import { duplicateReceipt, sectionMapForDuplicate } from "@/lib/checklists";

/**
 * Duplicate a template to another shop, and delete one.
 *
 * DUPLICATE IS THE SHORTCUT MARK ASKED FOR (2026-08-29): "we should be able to
 * duplicate checklists then change the location to something else as a short
 * cut to creating a new one."
 *
 * The thing that makes it more than a row copy is that `shop_section_id` is
 * LOCATION-SCOPED, so a DF01 list copied to DF02 arrives with every item
 * pointing at a shelf that isn't in the building. `sectionMapForDuplicate`
 * matches by DISPLAY NAME (unique per location since 017), anything with no
 * counterpart lands in "No section", and the receipt NAMES what didn't map —
 * the loaders' own posture rather than failing or silently guessing.
 *
 * AND IT ARRIVES INACTIVE. `PlanDetail`'s duplicate does the same for its own
 * reason (pars would sum); here it is that a half-mapped checklist landing live
 * means tonight's supervisor walks a list pointing at rooms that don't exist.
 */
export function TemplateActions({
  templateId,
  name,
  itemCount,
  locationId,
  orgId,
  locations,
  editable,
  add,
}: {
  templateId: string;
  name: string;
  itemCount: number;
  locationId: string;
  orgId: string;
  locations: { id: string; code: string }[];
  editable: boolean;
  /**
   * Add item, rendered by the caller (Mark, 2026-08-30: "move the add item
   * button up with the other action buttons").
   *
   * A SLOT rather than props, which is `ScheduleActions`' own shape and its
   * reason: the dialog's query and state stay with the component that owns
   * them, while this row decides the ORDER. Add LEADS, because it is the only
   * one of the three that changes what the list ASKS — the other two act on
   * the document as a whole.
   */
  add?: React.ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(locationId);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (!editable) return null;

  const targetCode = locations.find((l) => l.id === target)?.code ?? "there";

  function duplicate() {
    setFailed(null);
    setReceipt(null);
    startTransition(async () => {
      // 1. The source, and both shops' shelves.
      const [{ data: source }, { data: fromSections }, { data: toSections }, { data: items }] =
        await Promise.all([
          supabase
            .from("checklist_templates")
            .select("kind, name, weekdays, shifts, notes")
            .eq("id", templateId)
            .single(),
          supabase
            .from("shop_sections")
            .select("id, display_name")
            .eq("location_id", locationId),
          supabase
            .from("shop_sections")
            .select("id, display_name")
            .eq("location_id", target),
          supabase
            .from("checklist_template_items")
            .select(
              "shop_section_id, sort, prompt, response_type, unit, min_value, max_value, choices, requires_photo, weekdays, is_active, guidance, position",
            )
            .eq("template_id", templateId)
            .order("sort"),
        ]);

      if (!source) {
        setFailed("Could not read the list to copy.");
        return;
      }

      const { map, unmapped } = sectionMapForDuplicate(
        (fromSections ?? []).map((s) => ({
          id: s.id as string,
          display_name: s.display_name as string,
        })),
        (toSections ?? []).map((s) => ({
          id: s.id as string,
          display_name: s.display_name as string,
        })),
      );

      // 2. Parent first — a template with no items is visible and one gesture
      //    from fixed, where items with no template cannot exist at all.
      const { data: created, error: templateError } = await supabase
        .from("checklist_templates")
        .insert({
          org_id: orgId,
          location_id: target,
          kind: source.kind,
          name: `${source.name} copy`,
          weekdays: source.weekdays,
          shifts: source.shifts,
          notes: source.notes,
          // INACTIVE, deliberately — see the note above.
          is_active: false,
        })
        .select("id")
        .single();

      if (templateError || !created) {
        setFailed(templateError?.message ?? "The copy was not created.");
        return;
      }

      // 3. The items, with their sections REMAPPED. An unmapped one becomes
      //    null, which renders as "No section" rather than pointing at a shelf
      //    in the other building.
      const payload = (items ?? []).map((i) => ({
        org_id: orgId,
        template_id: created.id as string,
        shop_section_id: i.shop_section_id
          ? (map[i.shop_section_id as string] ?? null)
          : null,
        sort: i.sort,
        prompt: i.prompt,
        response_type: i.response_type,
        unit: i.unit,
        min_value: i.min_value,
        max_value: i.max_value,
        choices: i.choices,
        // `equipment_id` is deliberately NOT carried across: a fryer is a
        // physical thing in one building, so pointing the copy at the other
        // shop's unit would be a claim about the wrong machine. Sections have a
        // name to match on; equipment does not, and guessing here would be
        // worse than leaving it to be set.
        equipment_id: null,
        requires_photo: i.requires_photo,
        weekdays: i.weekdays,
        is_active: i.is_active,
        guidance: i.guidance,
        position: i.position,
      }));

      if (payload.length > 0) {
        const { data: written, error: itemsError } = await supabase
          .from("checklist_template_items")
          .insert(payload)
          .select("id");
        if (itemsError || !written) {
          setFailed(
            `The copy was created but its items were not: ${itemsError?.message ?? "no rows"}`,
          );
          setNewId(created.id as string);
          return;
        }
      }

      setNewId(created.id as string);
      setReceipt(duplicateReceipt(payload.length, unmapped, targetCode));
      router.refresh();
    });
  }

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete “${name}”?`,
      body:
        itemCount > 0
          ? `This removes the list and its ${itemCount} item${itemCount === 1 ? "" : "s"}. ` +
            "Anything already recorded against it keeps its own copy of every " +
            "question, so nothing already done is lost — but a template with records " +
            "behind it cannot be deleted at all, and should be made inactive instead."
          : "This list has no items yet.",
      tone: "danger",
      confirmLabel: "Delete it",
    });
    if (!ok) return;

    startTransition(async () => {
      const { data, error } = await supabase
        .from("checklist_templates")
        .delete()
        .eq("id", templateId)
        // A DELETE that matches no policy removes zero rows and returns NO
        // error, so without this the screen would navigate back to a list that
        // had grown by one — the employee-delete lesson.
        .select("id");
      if (error) {
        setFailed(
          error.message.includes("violates foreign key")
            ? "This template has records against it, so it cannot be deleted. Make it inactive instead."
            : error.message,
        );
        return;
      }
      if (!data || data.length === 0) {
        setFailed("Nothing was deleted — you may not have permission.");
        return;
      }
      router.push("/checklist-templates");
    });
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      {add}
      <button
        type="button"
        className={`${BUTTON_CLASS} shrink-0`}
        onClick={() => {
          setOpen(true);
          setReceipt(null);
          setNewId(null);
          setFailed(null);
        }}
      >
        Duplicate…
      </button>
      <button
        type="button"
        className={`${DANGER_BUTTON_CLASS} shrink-0`}
        onClick={remove}
        disabled={busy}
      >
        Delete
      </button>

      {failed && <p className="basis-full text-sm text-accent">{failed}</p>}

      {open && (
        <Dialog
          title="Duplicate this template"
          onClose={() => setOpen(false)}
          width="max-w-lg"
          busy={busy}
          footer={
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                onClick={() => setOpen(false)}
              >
                {receipt ? "Done" : "Cancel"}
              </button>
              {!receipt && (
                <button
                  type="button"
                  className={DIALOG_COMMIT_CLASS}
                  onClick={duplicate}
                  disabled={busy}
                >
                  Duplicate
                </button>
              )}
              {receipt && newId && (
                <button
                  type="button"
                  className={DIALOG_COMMIT_CLASS}
                  onClick={() => router.push(`/checklist-templates/${newId}`)}
                >
                  Open the copy
                </button>
              )}
            </div>
          }
        >
          <div className="space-y-5">
            {!receipt && (
              <>
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Copy to
                  </span>
                  <PickList
                    variant="field"
                    value={target}
                    ariaLabel="Copy to which shop"
                    boxed={BOXED_FIELDS}
                    className={BOXED_FIELDS ? BOXED_FIELD : ""}
                    options={locations.map((l) => ({
                      value: l.id,
                      label: l.code,
                      hint: l.id === locationId ? "the same shop" : undefined,
                    }))}
                    onPick={setTarget}
                  />
                </div>
                <p className="max-w-[52ch] text-[13px] text-muted">
                  Items are matched to {targetCode}’s shop sections by name.
                  Anything with no match there lands in “No section”
                  and is named afterwards. Equipment links are not carried
                  across — a fryer is a thing in one building.
                </p>
                <p className="max-w-[52ch] text-[13px] text-muted">
                  The copy arrives <strong>inactive</strong>, so nobody is asked
                  to walk it before you have checked it.
                </p>
              </>
            )}
            {receipt && <p className="max-w-[52ch] text-sm">{receipt}</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
