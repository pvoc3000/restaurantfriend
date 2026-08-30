"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { itemAppliesOn } from "@/lib/checklists";

/**
 * Start the shift's checklist FROM the report, and link it.
 *
 * The same snapshot `StartWalk` takes — see its note, which is where the rule
 * is written down — with two differences that both come from being inside a
 * report: the DATE is the report's own (so the two can never disagree about
 * which day they are, which is the module's highest-risk bug), and the new run
 * carries `shift_report_id` so the link is an FK rather than a tuple guess.
 */
export function LinkChecklistRun({
  reportId,
  orgId,
  locationId,
  reportDate,
  shift,
  askedFor,
}: {
  reportId: string;
  orgId: string;
  locationId: string;
  reportDate: string;
  shift: string;
  askedFor: { id: string; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (askedFor.length === 0) return null;

  function start(templateId: string) {
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
        setFailed("Could not read that master list.");
        return;
      }

      const { data: run, error } = await supabase
        .from("checklist_runs")
        .insert({
          org_id: orgId,
          location_id: locationId,
          template_id: templateId,
          kind: template.kind,
          title: template.name,
          business_date: reportDate,
          shift,
          status: "open",
          shift_report_id: reportId,
          created_by: uid,
          started_by: uid,
        })
        .select("id")
        .single();

      if (error || !run) {
        setFailed(error?.message ?? "The walk was not started.");
        return;
      }

      const weekday =
        ((new Date(`${reportDate}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
      const sectionOrder = new Map((sections ?? []).map((s, i) => [s.id as string, i]));
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
        const { error: itemsError } = await supabase
          .from("checklist_run_items")
          .insert(payload)
          .select("id");
        if (itemsError) {
          setFailed(`The walk was started but its items were not: ${itemsError.message}`);
          return;
        }
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {askedFor.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={busy}
            onClick={() => start(t.id)}
            className="min-h-11 border border-ink bg-white px-4 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
          >
            {busy ? "Starting…" : `Start ${t.name}`}
          </button>
        ))}
      </div>
      {failed && <p className="text-[14px] text-accent">{failed}</p>}
    </div>
  );
}
