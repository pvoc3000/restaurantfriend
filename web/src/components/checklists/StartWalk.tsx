"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { PickList } from "@/components/ui/PickList";
import { DateField } from "@/components/ui/DateField";
import { BOXED_FIELD, BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { SHIFT_SLOT_LABEL, SHIFT_SLOT_OPTIONS } from "@/lib/employeeEvents";
import { businessDateFor, itemAppliesOn } from "@/lib/checklists";
import type { StartableTemplate } from "./ChecklistsList";

/** ISO weekday (1 = Monday) of a YYYY-MM-DD string, pinned to UTC so it does
 *  not move west of Greenwich. `getDay()` is 0=Sunday, which is not this
 *  schema's convention anywhere. */
function isoWeekdayOf(date: string): number {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/**
 * Start a walk — and SNAPSHOT the template onto it.
 *
 * The snapshot is the single most important thing in this module. Without it,
 * rewording an item in September silently rewrites what August's supervisor is
 * recorded as having been asked to check, and history becomes a claim nobody
 * made. 013's rule, where a PO line snapshots description, pack and price.
 *
 * The DATE defaults through `businessDateFor`, which rolls a closing walk
 * finished after midnight back to the day it belongs to. It is editable here
 * and on the record, because no rule should try to cover the shift somebody
 * worked at an unusual hour.
 */
export function StartWalk({
  templates,
  today,
  orgId,
  locationId,
  noun = "checklist",
}: {
  templates: StartableTemplate[];
  today: string;
  orgId: string;
  locationId: string;
  /**
   * What this screen calls the thing being started (Mark, 2026-08-30: "New
   * Checklist").
   *
   * A prop rather than a constant because `/inspection-logs` renders this same
   * command, and "New checklist" on a screen of inspection logs would be a
   * button that names the wrong record. The two screens are one component and
   * two vocabularies.
   */
  noun?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>("");
  const [shift, setShift] = useState<string>("");
  const [date, setDate] = useState<string>(today);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const chosen = templates.find((t) => t.id === templateId);
  const canCommit = Boolean(templateId) && Boolean(date) && !busy;

  function openDialog() {
    // The local hour, in the browser's own clock, is what decides whether a
    // closing walk belongs to yesterday. The DATE it is compared against is the
    // org's, which the server computed — mixing the two is deliberate and
    // right: the day is the org's, the hour is where the person is standing.
    const hour = new Date().getHours();
    setDate(businessDateFor("closing", today, hour));
    setTemplateId("");
    setShift("");
    setFailed(null);
    setOpen(true);
  }

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    // Default the shift to the template's own, when it names exactly one —
    // otherwise leave it to be chosen, rather than guessing on somebody's
    // behalf at the one moment the record is created.
    setShift(t?.shifts && t.shifts.length === 1 ? t.shifts[0] : "");
  }

  function start() {
    if (!canCommit) return;
    setFailed(null);
    startTransition(async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;

      const [{ data: template }, { data: items }, { data: sections }] = await Promise.all([
        supabase
          .from("checklist_templates")
          .select("kind, name")
          .eq("id", templateId)
          .single(),
        supabase
          .from("checklist_template_items")
          .select(
            "id, shop_section_id, sort, prompt, response_type, unit, min_value, max_value, choices, equipment_id, requires_photo, weekdays, is_active, guidance, position",
          )
          .eq("template_id", templateId)
          .order("sort"),
        supabase
          .from("shop_sections")
          .select("id, display_name, sort_order")
          .eq("location_id", locationId)
          .order("sort_order"),
      ]);

      if (!template) {
        setFailed("Could not read that template.");
        return;
      }

      // 1. The run, carrying a SNAPSHOT of the template's kind and name — so
      //    renaming or re-kinding the master afterwards cannot change what this
      //    walk says it was.
      const { data: run, error: runError } = await supabase
        .from("checklist_runs")
        .insert({
          org_id: orgId,
          location_id: locationId,
          template_id: templateId,
          kind: template.kind,
          title: template.name,
          business_date: date,
          shift: shift || null,
          status: "open",
          created_by: uid,
          started_by: uid,
        })
        .select("id")
        .single();

      if (runError || !run) {
        setFailed(runError?.message ?? "The walk was not started.");
        return;
      }

      // 2. Its items, filtered to the ones this WEEKDAY asks for — that is how
      //    the Friday-only deep clean rides on a daily list — and each carrying
      //    its section's NAME as text, so a shelf renamed or deleted next month
      //    cannot rewrite or blank this walk.
      const weekday = isoWeekdayOf(date);
      const sectionOrder = new Map(
        (sections ?? []).map((s, i) => [s.id as string, i]),
      );
      const sectionName = new Map(
        (sections ?? []).map((s) => [s.id as string, s.display_name as string]),
      );

      const payload = (items ?? [])
        .filter((i) =>
          itemAppliesOn(
            {
              weekdays: (i.weekdays as number[] | null) ?? null,
              is_active: i.is_active as boolean,
            },
            weekday,
          ),
        )
        .map((i) => ({
          org_id: orgId,
          run_id: run.id as string,
          template_item_id: i.id as string,
          prompt: i.prompt,
          section_name: i.shop_section_id
            ? (sectionName.get(i.shop_section_id as string) ?? null)
            : null,
          shop_section_id: i.shop_section_id,
          // The walk's own order is the SHOP's: the shelf's walk position
          // first, the item's own sort within it. Composed into one number so
          // the run needs no join to render in order.
          sort:
            (i.shop_section_id
              ? (sectionOrder.get(i.shop_section_id as string) ?? 9999)
              : 9999) *
              1000 +
            Math.min(999, Number(i.sort)),
          response_type: i.response_type,
          unit: i.unit,
          min_value: i.min_value,
          max_value: i.max_value,
          choices: i.choices,
          requires_photo: i.requires_photo,
          equipment_id: i.equipment_id,
          guidance: i.guidance,
          position: i.position,
          status: "pending",
        }));

      if (payload.length > 0) {
        const { data: written, error: itemsError } = await supabase
          .from("checklist_run_items")
          .insert(payload)
          .select("id");
        if (itemsError || !written) {
          setFailed(
            `The walk was started but its items were not: ${itemsError?.message ?? "no rows"}`,
          );
          return;
        }
      }

      setOpen(false);
      router.push(`/checklists/${run.id}/run`);
    });
  }

  const field = BOXED_FIELDS ? BOXED_FIELD : "";
  const offered = [...templates].sort((a, b) => {
    if (a.asked_today !== b.asked_today) return a.asked_today ? -1 : 1;
    return a.name < b.name ? -1 : 1;
  });

  return (
    <>
      <button type="button" className={BUTTON_CLASS} onClick={openDialog}>
        New {noun}
      </button>

      {open && (
        <Dialog
          title={`New ${noun}`}
          onClose={() => setOpen(false)}
          width="max-w-lg"
          busy={busy}
          onSubmit={canCommit ? start : undefined}
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
                onClick={start}
                disabled={!canCommit}
              >
                Start
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Which template
              </span>
              <PickList
                variant="field"
                value={templateId}
                ariaLabel="Which template"
                boxed={BOXED_FIELDS}
                className={field}
                placeholder="Choose a template"
                options={offered.map((t) => ({
                  value: t.id,
                  label: t.name,
                  hint: t.already_run_today
                    ? "already used today"
                    : t.asked_today
                      ? "asked for today"
                      : undefined,
                }))}
                onPick={pickTemplate}
              />
              {chosen?.already_run_today && (
                // WARN, never block — 070 declined a unique constraint on this
                // very tuple because a handover legitimately produces two walks
                // for one night, and 024's lesson is that a statement true of
                // finished data is still wrong as a constraint.
                <p className="text-[12px]">
                  <span className="bg-mark-fill px-1">
                    This template has already been used today.
                  </span>{" "}
                  Starting another is fine — a handover produces two.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Shift
              </span>
              <PickList
                variant="field"
                value={shift}
                ariaLabel="Shift"
                boxed={BOXED_FIELDS}
                className={field}
                options={[
                  { value: "", label: "No shift", hint: "a walkthrough or an inspection" },
                  ...SHIFT_SLOT_OPTIONS.map((o) => ({
                    value: String(o.value),
                    label: SHIFT_SLOT_LABEL[o.value as never] ?? String(o.label),
                  })),
                ]}
                onPick={setShift}
              />
            </div>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Day it belongs to
              </span>
              <DateField
                variant="field"
                value={date}
                onChange={(v) => setDate(v ?? today)}
                ariaLabel="Day it belongs to"
                boxed={BOXED_FIELDS}
              />
              <p className="text-[12px] text-muted">
                A closing shift finished after midnight belongs to the day
                before, which is what this is already set to.
              </p>
            </div>

            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
